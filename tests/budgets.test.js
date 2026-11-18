// Provisional C2 caps. The fixture locks the measured bytes; these inequalities are the gates.
'use strict';

const assert = require('assert');

const MiB = 1024 * 1024;

async function main() {
  const assets = await import('../scripts/check-assets.mjs');
  const budgets = await import('../scripts/check-budgets.mjs');
  const report = assets.inventory();
  const live = budgets.runtimeBudget(report);
  assert.ok(live.titleBytes <= 1.5 * MiB, 'title ' + live.titleBytes);
  assert.ok(live.firstStageBytes <= 3 * MiB, 'first stage ' + live.firstStageBytes);
  assert.ok(live.criticalRequests <= 30, 'critical ' + live.criticalRequests);
  assert.ok(live.baseStaticBytes <= 10 * MiB, 'base static ' + live.baseStaticBytes);
  assert.ok(live.optionalMediaBytes <= 64 * MiB, 'optional ' + live.optionalMediaBytes);
  assert.ok(live.maxPresentationDecodedBytes <= 32 * MiB, 'presentation ' + live.maxPresentationDecodedBytes);
  assert.strictEqual(live.staticBytes, live.baseStaticBytes + live.optionalMediaBytes, 'no public byte is hidden');
  assert.strictEqual(live.atlasCount, 16);
  assert.ok(live.atlasEdge <= 1024);
  assert.strictEqual(live.poseCount, 240);
  assert.strictEqual(live.startupImages, 8);
  assert.strictEqual(report.preloadCount, 8);
  const result = budgets.assertBudgets(report, null);
  assert.deepStrictEqual(result.problems, [], result.problems.join('\n'));
  console.log('budgets ok', live.titleBytes, live.firstStageBytes, live.criticalRequests,
    { total: live.staticBytes, base: live.baseStaticBytes, optional: live.optionalMediaBytes });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
