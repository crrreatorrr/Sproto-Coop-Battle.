// Lock the C0 byte/request baseline. Tighter transfer budgets belong to C2.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inventory } from './check-assets.mjs';
import { buildDist } from './build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(root, 'tests', 'fixtures', 'asset-baseline.json');
const STATIC_BUDGET_BYTES = 10 * 1024 * 1024;

const SYNTAX = [
  'server/server.js',
  'public/js/ai.js',
  'public/js/audio.js',
  'public/js/input.js',
  'public/js/main.js',
  'public/js/manifest.js',
  'public/js/net.js',
  'public/js/render.js',
  'public/js/sim.js',
  'tests/sim.test.js',
  'tests/browser-online.cjs',
  'tests/relay-security.test.js',
  'tests/asset-manifest.test.js',
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
  if (report.publicBytes > STATIC_BUDGET_BYTES) problems.push(`public bytes ${report.publicBytes} exceed ${STATIC_BUDGET_BYTES}`);
  if (report.preloadCount !== 274) problems.push('preload is not the recorded 274-image waterfall');
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
  console.log(`baseline ok: ${report.assetCount} assets, ${report.assetBytes} bytes, preload ${report.preloadCount}, static ${report.publicBytes} <= ${STATIC_BUDGET_BYTES}`);
}
