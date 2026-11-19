// Asset manifest, dynamic refs, dist containment, and the pinned byte baseline.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function main() {
  const assets = await import('../scripts/check-assets.mjs');
  const budgets = await import('../scripts/check-budgets.mjs');
  const build = await import('../scripts/build.mjs');
  const report = assets.inventory();
  assert.strictEqual(report.categories.shadow.count, 12, 'each stage has a Shadow atlas');
  assert.strictEqual(report.preloadCount, 8);
  const prefetchedBossBanks = 11 * 4;
  assert.strictEqual(report.categories.boss.count, prefetchedBossBanks + report.optionalMediaCount,
    'prefetched legacy banks, on-entry banks, and registered effect pages remain inventoried');
  assert.ok(report.basePublicBytes <= 10 * 1024 * 1024);
  assert.strictEqual(report.publicBytes, report.basePublicBytes + report.optionalMediaBytes);
  assert.deepStrictEqual(report.streamedMedia.validationErrors, []);
  assert.deepStrictEqual(report.streamedMedia.limitErrors, []);
  assert.deepStrictEqual(report.missingDynamic, []);
  assert.deepStrictEqual(report.missingLiterals, []);
  assert.deepStrictEqual(report.unused, [], 'every shipped asset is requested by the game (unused art lives in art/)');
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
  assert.strictEqual(built.manifest.fxScratchDecodedBytes, report.fxScratchDecodedBytes);
  assert.deepStrictEqual(built.manifest.mediaBudgetLimits, report.streamedMedia.limits);
  assert.strictEqual(built.manifest.files.length, report.files.length, 'no inventory file is dropped by partition reporting');
  assert.ok(built.distFiles.includes('index.html'));
  assert.ok(built.distFiles.includes('js/sim.js'));
  assert.ok(built.distFiles.includes('js/combat.js'));
  assert.ok(built.distFiles.includes('asset-manifest.json'));
  assert.ok(!built.distFiles.some(file => file.startsWith('server/') || file.startsWith('tools/') || file.startsWith('tests/') || file.endsWith('.py')));
  // dist/ loads one minified startup bundle and one in-game bundle, built from the same files in order.
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'dist', 'index.html'), 'utf8');
  const tags = Array.from(indexHtml.matchAll(/<script src="([^"?]+)/g), m => m[1]);
  assert.deepStrictEqual(tags, [build.APP_BUNDLE], 'the built page has a single startup script');
  assert.ok(/globalThis\.CoopFxBundle="fx\.bundle\.js"/.test(indexHtml));
  const rows = Object.fromEntries(built.manifest.bundles.map(row => [row.path, row]));
  assert.deepStrictEqual(rows[build.APP_BUNDLE].sources, build.startupScripts());
  assert.strictEqual(rows[build.APP_BUNDLE].sources.length, 17);
  assert.deepStrictEqual(rows[build.FX_BUNDLE].sources, build.fxScripts());
  assert.strictEqual(rows[build.FX_BUNDLE].sources.length, 9);
  for (const row of built.manifest.bundles) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'dist', row.path));
    assert.strictEqual(code.length, row.bytes);
    assert.ok(row.bytes < row.sourceBytes, row.path + ' is minified');
    assert.ok(built.distFiles.includes(row.path));
    new vm.Script(code.toString('utf8'), { filename: row.path }); // parses as one classic script
    for (const src of row.sources) assert.ok(code.includes('/* ' + src + ' */'), row.path + ' carries ' + src);
  }
  const result = budgets.assertBudgets(report, built);
  assert.deepStrictEqual(result.problems, [], result.problems.join('\n'));
  console.log('asset manifest ok');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
