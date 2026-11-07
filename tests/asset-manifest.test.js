// Asset manifest, dynamic refs, dist containment, and the pinned byte baseline.
'use strict';

const assert = require('assert');

async function main() {
  const assets = await import('../scripts/check-assets.mjs');
  const budgets = await import('../scripts/check-budgets.mjs');
  const build = await import('../scripts/build.mjs');
  const report = assets.inventory();
  assert.strictEqual(report.assetCount, 324);
  assert.strictEqual(report.assetBytes, 9027457);
  assert.strictEqual(report.preloadCount, 274);
  assert.deepStrictEqual(report.missingDynamic, []);
  assert.deepStrictEqual(report.missingLiterals, []);
  assert.deepStrictEqual(report.unused, ['assets/ufo/red-laser.png', 'assets/ufo/thrust.png']);
  assert.ok(report.literalPrefixes.includes('assets/stages/'));
  assert.ok(report.literalPrefixes.includes('assets/ufo/shield'));
  const planted = assets.missingRefs(new Set(['assets/does-not-exist.png']), new Set(report.files.map(file => file.path)));
  assert.deepStrictEqual(planted, ['assets/does-not-exist.png']);
  const secret = assets.scanText('token AKIAIOSFODNN7EXAMPLE and SPROTO_PRACTICE_RELAY_NO_ECONOMY');
  assert.ok(secret.some(hit => hit.includes('AKIA')));
  assert.ok(secret.some(hit => hit.includes('SPROTO_PRACTICE_RELAY')));
  assert.deepStrictEqual(assets.scanText('ordinary game source'), []);
  const built = build.buildDist();
  assert.ok(built.distFiles.includes('index.html'));
  assert.ok(built.distFiles.includes('js/sim.js'));
  assert.ok(built.distFiles.includes('asset-manifest.json'));
  assert.ok(!built.distFiles.some(file => file.startsWith('server/') || file.startsWith('tools/') || file.startsWith('tests/') || file.endsWith('.py')));
  const result = budgets.assertBudgets(report, built);
  assert.deepStrictEqual(result.problems, [], result.problems.join('\n'));
  console.log('asset manifest ok');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
