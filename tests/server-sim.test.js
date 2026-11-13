// Full-state restart, legacy snapshot hashes, and the 20 Hz substep contract.
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
globalThis.window = globalThis;
require('../public/js/manifest.js');
const Sim = require('../public/js/sim.js');
require('../public/js/ai.js');
require('../public/js/net-protocol.js');
require('./fixtures/sha256.js');
const Scenarios = require('./fixtures/scenarios.js');
const gameplay = require('./fixtures/gameplay-hashes.json');

function sha(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}
function mustThrow(fn, pattern) {
  assert.throws(fn, err => pattern.test(err.message));
}

for (const rel of ['public/js/sim.js', 'public/js/ai.js', 'public/js/net-protocol.js', 'scripts/build-server-sim.mjs']) {
  const checked = spawnSync(process.execPath, ['--check', path.join(root, rel)], { encoding: 'utf8' });
  assert.strictEqual(checked.status, 0, checked.stderr);
}

const legacy = [
  ['cpu-seed42-terminal', gameplay.cpuSeed42Terminal],
  ['mixed-seed7-1800', gameplay.mixedSeed7Tick1800],
  ['four-local-seed99-1800', gameplay.fourLocalSeed99Tick1800],
];
assert.strictEqual(Sha256.hex('abc'), sha('abc'));
for (const [id, expected] of legacy) {
  const row = Scenarios.runCase(Scenarios.caseList().find(spec => spec.id === id));
  assert.strictEqual(row.mode, expected.mode);
  assert.strictEqual(row.tick, expected.t);
  assert.strictEqual(row.snapHash, expected.snapSha256);
  console.log('legacy', id, row.snapHash);
}

{
  const row = Scenarios.runCase(Scenarios.caseList().find(spec => spec.id === 'human-seed3-stage1'));
  assert.ok(row.flags.ufo > 0, 'UFO');
  assert.ok(row.flags.revive > 0, 'revive');
  assert.ok(row.flags.dead > 0, 'death');
  assert.ok(row.flags.power > 0, 'power');
  assert.ok(row.flags.boss > 0, 'boss');
  const phase2 = Scenarios.runCase(Scenarios.caseList().find(spec => spec.id === 'human-seed16-stage1'));
  assert.ok(phase2.flags.bossPhase >= 1, 'boss phase 2 (seed 16)');
  assert.ok(row.resume && row.resume.hash, 'resume');
  assert.strictEqual(row.resume.steps, 120);
  console.log('stage1 coverage', row.flags, 'resume', row.resume.hash, 'bytes', row.stateBytes);
}

{
  const state = Sim.create(Array.from({ length: Sim.SLOTS }, (_, i) => ({ fid: i, weapon: i, ctrl: i < 2 ? 'local' : 'cpu', name: 'P' + (i + 1) })), 21);
  for (let i = 0; i < 400; i++) {
    state.players[0].in = { l: 0, r: 1, u: 0, d: 0, a: i % 8 === 0 ? 1 : 0, j: 0, s: 0, p: 0 };
    Sim.step(state);
  }
  const lives = state.players.map(p => p.lives);
  const powers = state.players.map(p => p.powers.slice());
  const items = state.items.map(item => item.id);
  const packed = Sim.exportState(state);
  assert.strictEqual(packed.kind, Sim.STATE_KIND);
  assert.notStrictEqual(JSON.stringify(packed).indexOf('"$set"'), -1);
  const restored = Sim.importState(JSON.parse(JSON.stringify(packed)));
  assert.deepStrictEqual(restored.players.map(p => p.lives), lives);
  assert.deepStrictEqual(restored.players.map(p => p.powers), powers);
  assert.deepStrictEqual(restored.items.map(item => item.id), items);
  assert.strictEqual(restored.items.length, state.items.length);
  for (const enemy of restored.enemies) {
    if (enemy.target) assert.strictEqual(enemy.target, restored.players[enemy.target.slot]);
  }
  const again = Sim.importState(JSON.parse(JSON.stringify(Sim.exportState(state))));
  for (let i = 0; i < 80; i++) {
    const inp = { l: 0, r: i % 2, u: 0, d: 0, a: i % 5 === 0 ? 1 : 0, j: 0, s: 0, p: 0 };
    state.players[0].in = inp;
    restored.players[0].in = { l: inp.l, r: inp.r, u: 0, d: 0, a: inp.a, j: 0, s: 0, p: 0 };
    Sim.step(state);
    Sim.step(restored);
    state.events.length = 0;
    restored.events.length = 0;
  }
  assert.strictEqual(sha(Sim.exportState(state)), sha(Sim.exportState(restored)));
  assert.deepStrictEqual(restored.players.map(p => p.lives), state.players.map(p => p.lives));
  mustThrow(() => Sim.importState(Sim.snapshot(state)), /version/);
  const nan = Sim.exportState(state);
  nan.state.seed = NaN;
  mustThrow(() => Sim.importState(nan), /nan/);
  const huge = Sim.exportState(state);
  huge.state.events = new Array(80000).fill('x');
  mustThrow(() => Sim.importState(huge), /oversized/);
  console.log('resume bytes', JSON.stringify(packed).length);
}

{
  const made = CoopProtocol.createMatch({ mode: 'banked', seed: 99, matchId: 'substeps' });
  assert.strictEqual(made.ok, true);
  const twin = Sim.importState(Sim.exportState(made.session.state));
  const stepped = CoopProtocol.stepLoop(made.session, [null, null, null], 1);
  assert.strictEqual(stepped.ok, true);
  assert.strictEqual(made.session.state.t, 3);
  Sim.step(twin); Sim.step(twin); Sim.step(twin);
  assert.strictEqual(sha(Sim.exportState(made.session.state)), sha(Sim.exportState(twin)));
  assert.strictEqual(stepped.snapshot, null);
  const second = CoopProtocol.stepLoop(made.session, [null, null, null], 2);
  assert.ok(second.snapshot && second.snapshot.restart === 0 && second.snapshot.hz === 10);
  mustThrow(() => Sim.importState(second.snapshot), /version/);
  console.log('substeps match raw 60 Hz steps');
}

console.log('server sim ok');
