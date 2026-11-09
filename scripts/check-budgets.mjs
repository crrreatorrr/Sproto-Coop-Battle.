// C2 transfer budgets. The fixture locks the measured tree; the gates below are the provisional caps.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inventory, loadAssetLoader, loadManifest } from './check-assets.mjs';
import { buildDist } from './build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(root, 'tests', 'fixtures', 'asset-baseline.json');
const provenancePath = path.join(root, 'tests', 'fixtures', 'atlas-provenance.json');
const MiB = 1024 * 1024;
const STATIC_BUDGET_BYTES = 10 * MiB;
const TITLE_BUDGET_BYTES = 1.5 * MiB;
const FIRST_STAGE_BUDGET_BYTES = 3 * MiB;
const CRITICAL_REQUESTS = 30;
const FIGHTER_META_SHA256 = 'abf8ee18e934ecf5921aa92043d7fd45015f0db56592ad0a47c07282115d9748';

const SYNTAX = [
  'server/server.js',
  'public/js/ai.js',
  'public/js/audio.js',
  'public/js/input.js',
  'public/js/main.js',
  'public/js/manifest.js',
  'public/js/net.js',
  'public/js/asset-loader.js',
  'public/js/crash.js',
  'public/js/render.js',
  'public/js/sim.js',
  'tests/sim.test.js',
  'tests/browser-online.cjs',
  'tests/relay-security.test.js',
  'tests/asset-manifest.test.js',
  'tests/atlas.test.js',
  'tests/loading.test.js',
  'tests/budgets.test.js',
  'tests/crash-guard.test.js',
  'tests/atlas-visual.cjs',
  'scripts/build.mjs',
  'scripts/check-assets.mjs',
  'scripts/check-budgets.mjs',
];

export function checkSyntax() {
  const failed = [];
  for (const rel of SYNTAX) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, rel)], { encoding: 'utf8' });
    if (result.status !== 0) failed.push(rel + '\n' + (result.stderr || result.stdout));
  }
  return failed;
}

function sameList(a, b) {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

export function fighterMetaSha256() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public', 'js', 'manifest.js'), 'utf8'), sandbox, { filename: 'manifest.js' });
  const fighters = sandbox.window.MANIFEST.fighters.map(f => ({ id: f.id, foot: f.foot, box: f.box, hands: f.hands }));
  return crypto.createHash('sha256').update(JSON.stringify(fighters)).digest('hex');
}

export function runtimeBudget(report) {
  const loader = loadAssetLoader();
  const manifest = loadManifest();
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const scripts = loader.pageScripts(html);
  const bytes = new Map(report.files.map(file => [file.path, file.bytes]));
  const budget = loader.budgetOf(manifest, rel => {
    if (!bytes.has(rel)) throw new Error('budget missing ' + rel);
    return bytes.get(rel);
  }, scripts, bytes.get('index.html'));
  const atlasFiles = report.files.filter(file => /assets\/fighters\/[^/]+\/atlas\.png$/.test(file.path));
  const poseFiles = report.files.filter(file => /assets\/fighters\/[^/]+\/(?:\d\d|w0\d)\.png$/.test(file.path));
  return Object.assign(budget, {
    staticBytes: report.publicBytes,
    atlasCount: atlasFiles.length,
    atlasEdge: atlasFiles.reduce((max, file) => Math.max(max, file.width || 0, file.height || 0), 0),
    poseCount: poseFiles.length,
    fighterMetaSha256: fighterMetaSha256(),
  });
}

export function assertBudgets(report, built) {
  const expected = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const problems = [];
  const eq = (name, actual, want) => { if (actual !== want) problems.push(`${name}: ${actual} !== ${want}`); };
  eq('assetCount', report.assetCount, expected.assetCount);
  eq('assetBytes', report.assetBytes, expected.assetBytes);
  eq('publicFileCount', report.publicFileCount, expected.publicFileCount);
  eq('publicBytes', report.publicBytes, expected.publicBytes);
  eq('assetTreeSha256', report.assetTreeSha256, expected.assetTreeSha256);
  eq('publicTreeSha256', report.publicTreeSha256, expected.publicTreeSha256);
  eq('preloadCount', report.preloadCount, expected.preloadCount);
  eq('preloadBytes', report.preloadCost.bytes, expected.preloadBytes);
  eq('preloadGzipBytes', report.preloadCost.gzipBytes, expected.preloadGzipBytes);
  eq('preloadDecodedBytes', report.preloadCost.decodedBytes, expected.preloadDecodedBytes);
  eq('dynamicRefCount', report.dynamicRefCount, expected.dynamicRefCount);
  if (!sameList(report.unused, expected.unused)) problems.push('unused list changed: ' + report.unused.join(','));
  if (report.missingDynamic.length) problems.push('missing dynamic refs: ' + report.missingDynamic.join(','));
  if (report.missingLiterals.length) problems.push('missing literal refs: ' + report.missingLiterals.join(','));
  if (report.unreadable.length) problems.push('unreadable images: ' + report.unreadable.join(','));
  let budget;
  try { budget = runtimeBudget(report); }
  catch (err) { problems.push(err.message); budget = null; }
  if (budget) {
    if (budget.titleBytes > TITLE_BUDGET_BYTES) problems.push(`title bytes ${budget.titleBytes} exceed ${TITLE_BUDGET_BYTES}`);
    if (budget.firstStageBytes > FIRST_STAGE_BUDGET_BYTES) problems.push(`first stage bytes ${budget.firstStageBytes} exceed ${FIRST_STAGE_BUDGET_BYTES}`);
    if (budget.criticalRequests > CRITICAL_REQUESTS) problems.push(`critical requests ${budget.criticalRequests} exceed ${CRITICAL_REQUESTS}`);
    if (budget.staticBytes > STATIC_BUDGET_BYTES) problems.push(`public bytes ${budget.staticBytes} exceed ${STATIC_BUDGET_BYTES}`);
    if (budget.atlasCount !== 6) problems.push('expected 6 fighter atlases, got ' + budget.atlasCount);
    if (budget.atlasEdge > 1024) problems.push('atlas edge ' + budget.atlasEdge);
    if (budget.poseCount !== 240) problems.push('source poses changed: ' + budget.poseCount);
    if (budget.fighterMetaSha256 !== FIGHTER_META_SHA256) problems.push('fighter foot/hand/box metadata changed');
    eq('titleBytes', budget.titleBytes, expected.titleBytes);
    eq('firstStageBytes', budget.firstStageBytes, expected.firstStageBytes);
    eq('criticalRequests', budget.criticalRequests, expected.criticalRequests);
  }
  if (report.publicBytes > STATIC_BUDGET_BYTES) problems.push(`public bytes ${report.publicBytes} exceed ${STATIC_BUDGET_BYTES}`);
  const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
  if (provenance.shipped !== 'png' || provenance.webp.shipped !== false || provenance.webp.exact !== true) {
    problems.push('atlas provenance is not an exact-webp measurement with shipped png');
  }
  for (const [name, cat] of Object.entries(expected.categories)) {
    eq(name + '.count', report.categories[name].count, cat.count);
    eq(name + '.bytes', report.categories[name].bytes, cat.bytes);
    eq(name + '.gzipBytes', report.categories[name].gzipBytes, cat.gzipBytes);
    eq(name + '.decodedBytes', report.categories[name].decodedBytes, cat.decodedBytes);
  }
  if (built) {
    eq('built asset tree', built.manifest.assetTreeSha256, expected.assetTreeSha256);
    eq('built public tree', built.manifest.publicTreeSha256, expected.publicTreeSha256);
    if (built.distFiles.includes('server/server.js') || built.distFiles.some(file => file.startsWith('tools/') || file.startsWith('tests/'))) {
      problems.push('dist contains non-runtime files');
    }
  }
  const syntax = checkSyntax();
  if (syntax.length) problems.push('syntax\n' + syntax.join('\n'));
  return { expected, problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = inventory();
  let built = null;
  try { built = buildDist(); } catch (err) {
    console.error(err.detail || err);
    process.exit(1);
  }
  const result = assertBudgets(report, built);
  if (result.problems.length) {
    console.error(result.problems.join('\n'));
    process.exit(1);
  }
  const live = runtimeBudget(report);
  console.log(`budgets ok: assets ${report.assetCount} (${report.assetBytes} bytes), startup images ${report.preloadCount}, title ${live.titleBytes}, first stage ${live.firstStageBytes}, critical requests ${live.criticalRequests}, static ${report.publicBytes} <= ${STATIC_BUDGET_BYTES}`);
}
