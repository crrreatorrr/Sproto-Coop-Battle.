// Asset manifest, dynamic refs, dist containment, and the pinned byte baseline.
'use strict';

const assert = require('assert');

async function main() {
  const assets = await import('../scripts/check-assets.mjs');
  const budgets = await import('../scripts/check-budgets.mjs');
  const build = await import('../scripts/build.mjs');
  const report = assets.inventory();
  assert.strictEqual(report.categories.shadow.count, 12, 'each stage has a Shadow atlas');
  assert.strictEqual(report.preloadCount, 8);
  assert.strictEqual(report.categories.boss.count, 48 + report.optionalMediaCount,
    'legacy boss banks and every registered stream page remain inventoried');
  assert.ok(report.basePublicBytes <= 10 * 1024 * 1024);
  assert.strictEqual(report.publicBytes, report.basePublicBytes + report.optionalMediaBytes);
  assert.deepStrictEqual(report.streamedMedia.validationErrors, []);
  assert.deepStrictEqual(report.streamedMedia.limitErrors, []);
  assert.deepStrictEqual(report.missingDynamic, []);
  assert.deepStrictEqual(report.missingLiterals, []);
  assert.ok(report.unused.includes('assets/ufo/red-laser.png'));
  assert.ok(report.unused.includes('assets/ufo/thrust.png'));
  assert.ok(report.unused.includes('assets/ufo/idle.png'));
  assert.ok(report.unused.includes('assets/ufo/muzzle.png'));
  assert.ok(!report.files.some(file => /assets\/fighters\/[^/]+\/(?:\d\d|w0\d)\.png$/.test(file)), 'development poses stay out of the web tree');
  assert.ok(!report.unused.some(file => /\/atlas\.(png|webp)$/.test(file)));
  assert.ok(!report.unused.some(file => file.startsWith('assets/fx/')), 'boss effect sheets are in the load plan');
  assert.ok(report.literalPrefixes.includes('assets/stages/'));
  assert.ok(report.literalPrefixes.includes('assets/ufo/shield'));
  const planted = assets.missingRefs(new Set(['assets/does-not-exist.png']), new Set(report.files.map(file => file.path)));
  assert.deepStrictEqual(planted, ['assets/does-not-exist.png']);
  const secret = assets.scanText('token AKIAIOSFODNN7EXAMPLE and SPROTO_PRACTICE_RELAY_NO_ECONOMY');
  assert.ok(secret.some(hit => hit.includes('AKIA')));
  assert.ok(secret.some(hit => hit.includes('SPROTO_PRACTICE_RELAY')));
  assert.deepStrictEqual(assets.scanText('ordinary game source'), []);
  const built = build.buildDist();
  const live = budgets.runtimeBudget(report);
  assert.strictEqual(built.manifest.publicBytes, report.publicBytes);
  assert.strictEqual(built.manifest.runtimePublicBytes, live.staticBytes);
  assert.strictEqual(built.manifest.basePublicBytes, report.basePublicBytes);
  assert.strictEqual(built.manifest.runtimeBasePublicBytes, live.baseStaticBytes);
  assert.strictEqual(built.manifest.optionalMediaCount, report.optionalMediaCount);
  assert.strictEqual(built.manifest.optionalMediaBytes, report.optionalMediaBytes);
  assert.strictEqual(built.manifest.optionalMediaTreeSha256, report.optionalMediaTreeSha256);
  assert.deepStrictEqual(built.manifest.optionalMediaPaths, report.streamedMedia.optionalPaths);
  assert.strictEqual(built.manifest.presentationDecodedBytesMax, report.streamedMedia.maxPresentationDecodedBytes);
  assert.deepStrictEqual(built.manifest.mediaBudgetLimits, report.streamedMedia.limits);
  assert.strictEqual(built.manifest.files.length, report.files.length, 'no inventory file is dropped by partition reporting');
  assert.ok(built.distFiles.includes('index.html'));
  assert.ok(built.distFiles.includes('js/sim.js'));
  assert.ok(built.distFiles.includes('js/combat.js'));
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
