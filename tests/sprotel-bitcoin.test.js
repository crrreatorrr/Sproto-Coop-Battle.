'use strict';
const assert = require('assert');
globalThis.window = globalThis;
require('../public/js/manifest.js');
const S = require('../public/js/sim.js');
require('../public/js/ai.js');
const P = require('../public/js/audio.js');
require('../public/js/net-protocol.js');

function arena(stage = 12) {
  const g = S.create(Array.from({ length: S.SLOTS }, (_, i) => ({ fid: i, weapon: 0, ctrl: i ? S.EMPTY : 'local' })), 331, stage);
  g.stage.waves.forEach(w => { w.done = true; });
  g.camX = g.stage.len - S.W + 160;
  g.players[0].x = g.camX + 120; g.players[0].y = 8; g.players[0].inv = 9999;
  S.step(g);
  Object.assign(g.boss, { st: 'idle', t: -9999, x: g.camX + 470, y: 60, face: -1 });
  return g;
}

const boss = MANIFEST.bosses[12];
assert.strictEqual(boss.scenery, 2);
assert.strictEqual(boss.phases.length, 1);
const content = CoopProtocol.contentManifest(MANIFEST);
assert.strictEqual(content.stages.length, 13);
assert.strictEqual(content.stages[12].phaseCount, 1);
assert.deepStrictEqual(content.stages[12].phase2Attacks, []);
const oldWin = P.normalize({ unlocked: 12, best: { stage: 12, score: 123, ticks: 200, victory: true } });
assert.strictEqual(oldWin.unlocked, 13, 'old campaign winners can play the added stage');
assert.strictEqual(P.weaponTier(oldWin), 13, 'old wins only count their twelve actual clears');
assert.strictEqual(P.clearStage(P.normalize({ unlocked: 12 }), 12).data.unlocked, 13);
let completed = P.blank();
for (let stage = 1; stage <= 13; stage++) completed = P.clearStage(completed, stage).data;
assert.strictEqual(P.weaponTier(completed), 13, 'the added stage does not invent a weapon tier');

for (let attack = 0; attack < 5; attack++) {
  const g = arena(), b = g.boss;
  Object.assign(b, { st: 'fire', t: 29, barAttack: attack, row: attack + 1, ty: 60,
    tx: g.camX + 180, both: false, marks: [[g.camX + 180, 60]], warn: [60] });
  S.step(g);
  const shots = g.projs.filter(p => p.bar === attack);
  assert.strictEqual(shots.length, attack === 2 ? 3 : attack === 3 ? 2 : 1);
  assert.ok(shots.every(p => !p.homing), 'bar throws never home');
  const shot = shots[0], first = { x: shot.x, y: shot.y, z: shot.z, vz: shot.vz };
  b.st = 'idle'; b.t = -9999;
  for (let t = 0; t < 20; t++) S.step(g);
  if (attack === 0) assert.strictEqual(shot.y, first.y, 'snacks are straight');
  if (attack === 1) assert.ok(shot.lob && shot.vz < first.vz && shot.z > first.z, 'beer follows a ballistic arc');
  if (attack === 2) assert.ok(shots[0].y < shots[1].y && shots[1].y < shots[2].y, 'cocktails fan into separate lanes');
  if (attack === 3) {
    for (let t = 0; t < 20; t++) S.step(g);
    assert.ok(shot.bounce >= 1 && shot.z >= 0, 'drinks bounce off the floor');
  }
  if (attack === 4) assert.ok(shot.y !== first.y && shot.z !== first.z, 'marlin weave in depth and height');
  const twin = S.importState(JSON.parse(JSON.stringify(S.exportState(g))));
  for (let t = 0; t < 12; t++) { S.step(g); S.step(twin); }
  assert.deepStrictEqual(S.exportState(twin), S.exportState(g), 'trajectory resumes exactly');
  const snap = S.snapshot(g);
  assert.ok(snap.projs.every(p => p.ba !== undefined), 'network snapshots preserve the projectile art');
}

// All five throws are reachable in phase one, followed by the charge.
{
  const g = arena(), b = g.boss;
  Object.assign(b, { st: 'idle', t: 40, cycle: 1, x: g.camX + 540, face: -1 });
  g.players.forEach((p, i) => { p.ctrl = 'local'; p.st = 'idle'; p.x = g.camX + (i < 2 ? 100 : 580); p.y = 60; p.inv = 9999; });
  S.step(g);
  assert.strictEqual(b.barAttack, 1);
  const marks = g.fx.filter(f => f.kind === 'mark');
  assert.ok(marks.every(f => f.small >= 85), 'beer warnings survive through the landing tick');
  for (let t = 0; t < 30; t++) S.step(g);
  assert.strictEqual(g.projs.filter(p => p.bar === 1).length, b.marks.length, 'every front or rear mark launches exactly one mug');
}
{
  const g = arena(), seen = new Set();
  for (let t = 0; t < 850; t++) {
    g.players[0].inv = 9999;
    if (g.boss.st === 'idle') g.boss.t = 40;
    S.step(g);
    if (g.boss.st === 'fire') seen.add(g.boss.barAttack);
    if (g.boss.st === 'charge') seen.add('charge');
  }
  assert.deepStrictEqual([...seen].sort(), [0, 1, 2, 3, 4, 'charge']);
}

// Crossing 50% must never enter an unprovided phase; zero HP finishes stage 13.
{
  const g = arena(), b = g.boss, p = g.players[0];
  const hit = hp => {
    b.hp = hp; b.hitCd = 0;
    g.projs.push({ id: g.nextId++, kind: 'laser', x: b.x - 1, y: b.y, z: 20, vx: 1, vy: 0, vz: 0, dmg: 10, t: 0, life: 30, owner: 0, hit: [] });
    S.step(g);
  };
  hit(b.maxHp / 2 + 1);
  assert.strictEqual(b.phase, 0); assert.notStrictEqual(b.st, 'transform');
  hit(1);
  assert.strictEqual(b.st, 'dead');
  for (let t = 0; t < 400; t++) { p.inv = 9999; S.step(g); }
  assert.strictEqual(g.mode, 'victory');
  const prev = arena(11);
  prev.mode = 'clear'; prev.clearT = 300; S.step(prev);
  assert.strictEqual(prev.stageIdx, 12, 'stage 12 advances to Last Call');
  assert.strictEqual(prev.mode, 'play');
}
console.log('Sprotel Bitcoin: five trajectories, phase-one clear, stage 13, progress and resume ok');
