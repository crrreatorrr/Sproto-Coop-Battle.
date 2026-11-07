// Node, goja, and (with --browser) Chromium must emit the same golden hashes.
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const { buildServerSim } = require('../scripts/build-server-sim.mjs');
const goldenPath = path.join(root, 'tests', 'fixtures', 'sim-goldens.json');
const browserOnly = process.argv.includes('--browser');

function normalize(result) {
  return JSON.parse(JSON.stringify({
    protocol: result.protocol,
    loopHz: result.loopHz,
    substeps: result.substeps,
    snapshotHz: result.snapshotHz,
    content: result.content,
    cases: result.cases,
  }));
}

function runInVm(sources) {
  const sandbox = { console: { log() {} } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(sources.join('\n'), sandbox, { filename: 'coop-goldens.js' });
  return sandbox.result;
}

function nodeGoldens(bundle) {
  const sha = fs.readFileSync(path.join(root, 'tests', 'fixtures', 'sha256.js'), 'utf8');
  const scenarios = fs.readFileSync(path.join(root, 'tests', 'fixtures', 'scenarios.js'), 'utf8');
  return runInVm([bundle, sha, scenarios, 'result = Scenarios.runAll();']);
}

function go(args) {
  const proc = spawnSync('go', args, {
    cwd: path.join(root, 'scripts', 'goja-runner'),
    encoding: 'utf8',
    env: { ...process.env, GOTOOLCHAIN: 'auto' },
    timeout: 240000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (proc.status !== 0) {
    console.error(proc.stdout);
    console.error(proc.stderr);
    throw new Error('goja runner exited ' + proc.status);
  }
  return proc.stdout.trim().split('\n').filter(Boolean).pop();
}

function assertCoverage(result) {
  const ids = result.cases.map(row => row.id);
  for (let stage = 0; stage < 12; stage++) {
    for (const kind of ['human', 'mixed', 'cpu']) assert.ok(ids.includes('stage-' + stage + '-' + kind));
  }
  const stage1 = result.cases.find(row => row.id === 'human-seed3-stage1');
  assert.ok(stage1.flags.ufo > 0 && stage1.flags.revive > 0 && stage1.flags.dead > 0 && stage1.flags.power > 0);
  assert.ok(stage1.flags.bossPhase >= 1);
  assert.ok(stage1.resume && stage1.resume.hash);
  const terminal = result.cases.find(row => row.id === 'cpu-seed42-terminal');
  assert.strictEqual(terminal.mode, 'gameover');
  assert.ok(terminal.flags.bossPhase >= 1 && terminal.flags.dead > 0);
}

async function browserGoldens(bundlePath) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>coop goldens</title>');
    for (const file of [bundlePath, path.join(root, 'tests', 'fixtures', 'sha256.js'), path.join(root, 'tests', 'fixtures', 'scenarios.js')]) {
      await page.addScriptTag({ path: file });
    }
    return await page.evaluate(() => Scenarios.runAll());
  } finally {
    await browser.close();
  }
}

async function main() {
  const built = buildServerSim();
  assert.strictEqual(crypto.createHash('sha256').update(built.bundle).digest('hex'), built.pin.bundleSha256);
  if (browserOnly) {
    const expected = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
    const browser = normalize(await browserGoldens(built.bundlePath));
    assert.deepStrictEqual(browser, expected);
    assert.strictEqual(browser.content, built.pin.contentSha256);
    console.log('browser goldens', browser.cases.length, 'content', browser.content);
    return;
  }
  const node = nodeGoldens(built.bundle);
  const normalized = normalize(node);
  assertCoverage(normalized);
  assert.strictEqual(normalized.content, built.pin.contentSha256);
  assert.strictEqual(normalized.loopHz, 20);
  assert.strictEqual(normalized.substeps, 3);
  if (process.env.UPDATE_GOLDENS === '1' || !fs.existsSync(goldenPath)) {
    fs.writeFileSync(goldenPath, JSON.stringify(normalized, null, 2) + '\n');
  }
  assert.deepStrictEqual(normalized, JSON.parse(fs.readFileSync(goldenPath, 'utf8')));
  const gojaStarted = Date.now();
  const goja = JSON.parse(go([
    'run', '.',
    built.bundlePath,
    path.join(root, 'tests', 'fixtures', 'sha256.js'),
    path.join(root, 'tests', 'fixtures', 'scenarios.js'),
    path.join(root, 'tests', 'fixtures', 'golden-entry.js'),
  ]));
  const gojaMs = Date.now() - gojaStarted;
  assert.deepStrictEqual(normalize(goja), normalized);
  const parallel = JSON.parse(go(['run', '.', '-parallel', built.bundlePath]));
  assert.strictEqual(parallel.vms, 10);
  assert.ok(parallel.p95LoopMs < 25, 'goja p95 loop ' + parallel.p95LoopMs + 'ms exceeds the 25 ms substep budget');
  const stage1 = normalized.cases.find(row => row.id === 'human-seed3-stage1');
  const stage = JSON.parse(go([
    'run', '.',
    built.bundlePath,
    path.join(root, 'tests', 'fixtures', 'sha256.js'),
    path.join(root, 'tests', 'fixtures', 'scenarios.js'),
    path.join(root, 'tests', 'fixtures', 'stage-bench.js'),
  ]));
  assert.strictEqual(stage.tick, stage1.tick);
  assert.strictEqual(stage.stateHash, stage1.stateHash);
  assert.ok(stage.simMs > 0);
  const bench = {
    host: os.cpus()[0] && os.cpus()[0].model,
    arch: process.arch,
    node: process.version,
    goja: built.pin.goja,
    nodeRunMs: node.ms,
    gojaWallMs: gojaMs,
    gojaRunMs: goja.ms,
    stage1Tick: stage1.tick,
    stage1StateBytes: stage1.stateBytes,
    stage1Hash: stage1.stateHash,
    stage1SimMs: stage.simMs,
    contentSha256: built.pin.contentSha256,
    bundleSha256: built.pin.bundleSha256,
    parallel: parallel,
  };
  fs.mkdirSync(path.join(root, 'tests', 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests', 'artifacts', 'goja-benchmark.json'), JSON.stringify(bench, null, 2) + '\n');
  console.log('goldens', normalized.cases.length, 'nodeMs', node.ms, 'gojaWallMs', gojaMs, 'gojaRunMs', goja.ms);
  console.log('stage1', stage1.tick, 'bytes', stage1.stateBytes, 'hash', stage1.stateHash);
  console.log('parallel', JSON.stringify(parallel));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
