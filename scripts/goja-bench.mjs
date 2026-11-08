// Times the committed server bundle in ten parallel goja VMs and fails when the p95 authoritative
// loop is over the 25 ms substep budget (half of the 50 ms server loop). Machine-dependent, so it
// is not part of `npm test`, which only logs the same number. Run with `npm run bench:goja`.
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUDGET_MS = 25;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = path.join(root, 'build', 'coop-sim.js');

const proc = spawnSync('go', ['run', '.', '-parallel', bundlePath], {
  cwd: path.join(root, 'scripts', 'goja-runner'),
  encoding: 'utf8',
  env: { ...process.env, GOTOOLCHAIN: process.env.GOTOOLCHAIN || 'auto' },
  timeout: 240000,
  maxBuffer: 16 * 1024 * 1024,
});
if (proc.status !== 0) {
  console.error(proc.stdout);
  console.error(proc.stderr);
  throw new Error('goja runner exited ' + proc.status);
}
const parallel = JSON.parse(proc.stdout.trim().split('\n').filter(Boolean).pop());
console.log('parallel', JSON.stringify(parallel));
assert.strictEqual(parallel.vms, 10);
assert.ok(parallel.p95LoopMs < BUDGET_MS, 'goja p95 loop ' + parallel.p95LoopMs + 'ms exceeds the ' + BUDGET_MS + ' ms substep budget');
console.log('goja p95 loop', parallel.p95LoopMs + 'ms', 'within', BUDGET_MS + 'ms');
