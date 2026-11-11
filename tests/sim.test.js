// Headless checks: six CPU Sprotos play the campaign; the sim must progress and stay sane.
'use strict';
globalThis.window = globalThis;
require('../public/js/manifest.js');
const Sim = require('../public/js/sim.js');
require('../public/js/ai.js');
const assert = require('assert');
const crypto = require('crypto');
const gameplay = require('./fixtures/gameplay-hashes.json');

function snapHash(state) {
  return crypto.createHash('sha256').update(JSON.stringify(Sim.snapshot(state))).digest('hex');
}

const slots = Array.from({ length: 6 }, (_, i) => ({ fid: i % MANIFEST.fighters.length, weapon: i, ctrl: 'cpu', name: 'CPU' + (i + 1) }));
const s = Sim.create(slots, 42);
let maxStage = 0, bossSeen = 0, ufoRides = 0, stageTicks = [0], last = 0;
for (let i = 0; i < 60 * 60 * 40 && s.mode !== 'victory' && s.mode !== 'gameover'; i++) {
  Sim.step(s);
  if (s.boss) bossSeen = Math.max(bossSeen, s.stageIdx + 1);
  if (s.players.some(p => p.st === 'ufo')) ufoRides++;
  if (s.stageIdx !== last) { stageTicks.push(i); last = s.stageIdx; }
  maxStage = Math.max(maxStage, s.stageIdx);
  for (const p of s.players) assert(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), 'player position finite');
  assert(s.players.length === 6, 'always six players');
  s.events.length = 0;
}
const snap = JSON.stringify(Sim.snapshot(s));
console.log({ mode: s.mode, stageReached: maxStage + 1, bossSeen, ufoTicks: ufoRides, snapshotBytes: snap.length,
  stageMinutes: stageTicks.slice(1).map((t, k) => ((t - stageTicks[k]) / 3600).toFixed(1)) });
assert(maxStage >= 1 || s.stage.waves.some(w => w.done), 'the team makes progress');
assert(ufoRides === 0, 'CPU Sprotos never take the UFO');
assert(s.mode === 'gameover' || s.mode === 'victory', 'an all-CPU team eventually wins or loses');
assert.strictEqual(s.mode, gameplay.cpuSeed42Terminal.mode);
assert.strictEqual(s.stageIdx + 1, gameplay.cpuSeed42Terminal.stageReached);
assert.strictEqual(s.t, gameplay.cpuSeed42Terminal.t);
assert.strictEqual(s.players.length, gameplay.cpuSeed42Terminal.players);
assert.strictEqual(snapHash(s), gameplay.cpuSeed42Terminal.snapSha256);
console.log('cpu gameplay hash', gameplay.cpuSeed42Terminal.snapSha256);
console.log('ok');

// God mode: human Sprotos never lose health and attack twice as fast.
{
  const cfg = Array.from({ length: 6 }, (_, i) => ({ fid: i % MANIFEST.fighters.length, weapon: 0, ctrl: i === 0 ? 'local' : 'cpu' }));
  const g = Sim.create(cfg, 7);
  Sim.toggleGod(g);
  const p = g.players[0];
  for (let i = 0; i < 3000; i++) { p.in = { l: 0, r: i % 2, u: 0, d: 0, a: i % 3 === 0 ? 1 : 0, j: 0, s: 0 }; Sim.step(g); g.events.length = 0; assert(p.hp === Sim.MAX_HP, 'god mode keeps full health'); }
  const timeAttack = god => { const s2 = Sim.create(cfg, 9); if (god) Sim.toggleGod(s2); const q = s2.players[0]; q.in = { l: 0, r: 0, u: 0, d: 0, a: 1, j: 0, s: 0 }; let n = 0; Sim.step(s2); q.in.a = 0; while (q.st === 'attack' && n < 200) { Sim.step(s2); n++; } return n; };
  const normal = timeAttack(false), fast = timeAttack(true);
  console.log('attack ticks normal/god:', normal, fast);
  assert(fast <= Math.ceil(normal / 2) + 1, 'god mode attacks about 2x faster');
  console.log('god mode ok');
}

// Death rules: no auto revive; 10 s to revive; a human's second death or a fully downed team loses.
{
  const cfg = Array.from({ length: 6 }, (_, i) => ({ fid: i, weapon: 0, ctrl: i === 0 ? 'local' : 'cpu' }));
  const g = Sim.create(cfg, 11);
  for (let i = 0; i < 200; i++) Sim.step(g);
  const cpu = g.players[3]; cpu.hp = 0; cpu.st = 'down'; cpu.downT = Sim.DOWN_TICKS; cpu.x = g.camX + 600; cpu.y = 0;
  g.players.forEach((p, k) => { if (k !== 3) { p.x = g.camX + 40; p.y = 110; } });
  const freeze = () => g.players.forEach((p, k) => { if (k !== 3) { p.in = { l: 0, r: 0, u: 0, d: 0, a: 0, j: 0, s: 0 }; p.ctrl = 'local'; } });
  for (let i = 0; i < Sim.DOWN_TICKS + 2; i++) { freeze(); Sim.step(g); g.events.length = 0; }
  assert(cpu.st === 'dead', 'an unrevived CPU dies after 10 s and stays dead');
  for (let i = 0; i < 600; i++) { freeze(); Sim.step(g); }
  assert(cpu.st === 'dead', 'dead Sprotos are not revived automatically');
  const me = g.players[0];
  for (const n of [1, 2]) { me.inv = 0; me.st = 'idle'; me.hp = 1; g.enemies.length = 0;
    me.hp = 0; me.st = 'down'; me.downT = 1; for (let i = 0; i < 3; i++) { freeze(); Sim.step(g); } }
  assert(g.mode === 'gameover', 'the second death of a human loses the game');
  console.log('death rules ok');
}

// Dodging: standing in a warned boss lane gets you hit; stepping out of it or jumping does not.
{
  const run = how => {
    const g = Sim.create(Array.from({ length: 6 }, (_, i) => ({ fid: i, weapon: 0, ctrl: 'local' })), 21);
    g.stage.waves.forEach(w => (w.done = true));
    for (let i = 0; i < 3000 && !(g.boss && g.boss.st === 'idle'); i++) { g.players.forEach(p => (p.in = { l: 0, r: 1, u: 0, d: 0, a: 0, j: 0, s: 0 })); Sim.step(g); }
    const me = g.players[0], b = g.boss;
    g.players.forEach((p, k) => { if (k) { p.st = 'jump'; p.z = 9999; p.vz = 0; } }); // keep the others out of the way
    g.enemies.length = 0; me.x = b.x - 200 * (b.face < 0 ? 1 : -1); me.y = 60; me.inv = 0; me.hp = 100; me.st = 'idle';
    b.face = me.x < b.x ? -1 : 1; b.st = 'fire'; b.t = 0; b.row = 1; b.missile = false; b.ty = 60; b.warn = [60];
    for (let i = 0; i < 120; i++) {
      g.players.forEach((p, k) => { if (k) { p.z = 9999; p.vz = 0; p.st = 'jump'; } });
      me.in = { l: 0, r: 0, u: how === 'step' && i > 5 && i < 25 ? 1 : 0, d: 0, a: 0, j: how === 'jump' && me.z === 0 && g.projs.some(pr => pr.enemy && Math.abs(pr.x - me.x) < 34) ? 1 : 0, s: 0 };
      b.x = b.x; Sim.step(g); g.events.length = 0;
    }
    return me.hp;
  };
  const stand = run('stand'), step = run('step'), jump = run('jump');
  console.log('hp after a weapon-A burst — standing:', stand, 'stepping out:', step, 'jumping:', jump);
  assert(stand < 100, 'standing in a warned lane gets hit');
  assert(step === 100, 'stepping out of the lane evades');
  assert(jump === 100, 'jumping over the low shots evades');
  console.log('dodge rules ok');
}

// Rescue: the first time a human goes down, the nearest CPU Sproto runs over and revives them.
{
  const g = Sim.create(Array.from({ length: 6 }, (_, i) => ({ fid: i, weapon: i, ctrl: i === 0 ? 'local' : 'cpu' })), 31);
  for (let i = 0; i < 200; i++) { g.players[0].in = { l: 0, r: 0, u: 0, d: 0, a: 0, j: 0, s: 0 }; Sim.step(g); g.events.length = 0; }
  const me = g.players[0];
  g.enemies.length = 0; g.stage.waves.forEach(w => (w.done = true)); g.lockX = g.camX;
  me.x = g.camX + 40; me.y = 10; me.hp = 0; me.st = 'down'; me.downT = Sim.DOWN_TICKS; me.revive = 0;
  g.players.forEach((p, k) => { if (k) { p.x = g.camX + 560; p.y = 110; } });
  let t = 0;
  for (; t < Sim.DOWN_TICKS && me.st === 'down'; t++) { me.in = { l: 0, r: 0, u: 0, d: 0, a: 0, j: 0, s: 0 }; Sim.step(g); g.events.length = 0; }
  console.log('rescued after', (t / 60).toFixed(1), 's; state', me.st, 'npcRevived', me.npcRevived);
  assert(me.st !== 'down' && me.st !== 'dead' && me.npcRevived, 'a CPU Sproto rescues a human on their first down');
  console.log('rescue ok');
}

// Power-ups: humans save up to 3; using one wipes out a crowd far wider than a normal attack.
{
  const g = Sim.create(Array.from({ length: 6 }, (_, i) => ({ fid: i, weapon: i, ctrl: i === 0 ? 'local' : 'cpu' })), 41);
  for (let i = 0; i < 120; i++) { g.players[0].in = { l: 0, r: 0, u: 0, d: 0, a: 0, j: 0, s: 0, p: 0 }; Sim.step(g); }
  const me = g.players[0], cpu = g.players[1];
  for (const p of [me, cpu]) for (let k = 0; k < 4; k++) g.items.push({ id: 9000 + k + p.slot * 10, kind: 'power', pt: 0, x: p.x, y: p.y, z: 0 });
  me.in = { l: 0, r: 0, u: 0, d: 0, a: 0, j: 0, s: 0, p: 0 }; Sim.step(g);
  assert(me.powers.length === 3, 'a human holds at most 3 power-ups');
  assert(cpu.powers.length === 0, 'CPU Sprotos do not pick up power-ups');
  g.enemies.length = 0; g.items = g.items.filter(i => i.kind !== 'power');
  for (let k = 0; k < 8; k++) g.enemies.push({ id: 8000 + k, fid: 0, weapon: 0, x: g.camX + 120 + k * 50, y: me.y + (k % 3) * 20 - 20, z: 0, vx: 0, vy: 0, vz: 0, face: 1, hp: 50, maxHp: 50, st: 'walk', t: 0, cd: 999, inv: 0, offY: 0 });
  me.x = g.camX + 300; me.st = 'idle'; me.in = { l: 0, r: 0, u: 0, d: 0, a: 0, j: 0, s: 0, p: 1 }; Sim.step(g);
  const hit = g.enemies.filter(e => e.hp < 50).length;
  console.log('storm hit', hit, 'of 8 enemies; powers left', me.powers.length);
  assert(hit >= 7 && me.powers.length === 2, 'Sproto Storm hits a wide crowd');
  console.log('power-ups ok');
}

// Fighting mechanics: dash, block, parry, grab + throw, launcher + juggle, slam, weapon rules, hitstop.
{
  const N = { l: 0, r: 0, u: 0, d: 0, a: 0, j: 0, s: 0, p: 0 };
  const setup = (weapon = 0) => {
    const g = Sim.create(Array.from({ length: 6 }, (_, i) => ({ fid: i, weapon: i ? i : weapon, ctrl: i === 0 ? 'local' : 'cpu' })), 51);
    for (let i = 0; i < 60; i++) { g.players[0].in = { ...N }; Sim.step(g); }
    g.players.forEach((p, k) => { if (k) { p.st = 'dead'; } });
    g.enemies.length = 0; g.items.length = 0; g.stage.waves.forEach(w => (w.done = true)); g.lockX = g.camX;
    const me = g.players[0]; Object.assign(me, { x: g.camX + 200, y: 60, z: 0, st: 'idle', t: 0, inv: 0, hp: 100, face: 1, combo: 0 });
    return { g, me };
  };
  const enemy = (g, x, y, extra) => { const e = { id: 7000 + g.enemies.length, fid: 0, weapon: 0, x, y, z: 0, vx: 0, vy: 0, vz: 0, face: -1, hp: 200, maxHp: 200, st: 'walk', t: 0, cd: 999, inv: 0, offY: 0, ...extra }; g.enemies.push(e); return e; };
  const run = (g, me, seq) => { for (const inp of seq) { me.in = { ...N, ...inp }; Sim.step(g); g.events.length = 0; } };

  { // dash: double-tap right
    const { g, me } = setup(); const x0 = me.x;
    run(g, me, [{ r: 1 }, {}, {}, { r: 1 }, { r: 1 }, { r: 1 }, { r: 1 }, { r: 1 }]);
    assert(me.st === 'dash' && me.x - x0 > 15, 'double-tap dashes'); }
  { // block cuts damage, parry negates it and dazes the attacker
    const { g, me } = setup(); const e = enemy(g, g.camX + 230, 60, { st: 'attack' });
    run(g, me, Array(12).fill({ s: 1 })); assert(me.st === 'block', 'holding Special blocks');
    const g2 = setup(); const me2 = g2.me; const e2 = enemy(g2.g, g2.g.camX + 230, 60, { st: 'attack', t: 0 });
    run(g2.g, me2, Array(10).fill({ s: 1 }));
    me2.t = 2; me2.inv = 0; me2.face = 1;
    // call through the sim: a parry when the hit lands inside the window
    const hpP = me2.hp;
    g2.g.enemies[0].st = 'attack'; g2.g.enemies[0].t = 16;
    me2.in = { ...N, s: 1 }; Sim.step(g2.g);
    console.log('parry: hp', hpP, '->', me2.hp, 'attacker', g2.g.enemies[0].st, 'stun', g2.g.enemies[0].stun);
    assert(me2.hp === hpP && g2.g.enemies[0].st === 'hit' && g2.g.enemies[0].stun >= 2, 'a parry takes no damage and dazes the attacker'); }
  { // grab a dazed enemy, knee, throw it into another enemy
    const { g, me } = setup(); const e = enemy(g, g.camX + 222, 60, { st: 'hit', stun: 3, t: 0, cd: 999 }); const other = enemy(g, g.camX + 120, 60);
    run(g, me, [{ r: 1 }]); assert(me.st === 'grab', 'walking into a dazed enemy grabs it');
    run(g, me, [{ a: 1 }, {}, {}, {}, { a: 1 }, {}, {}, {}, { l: 1, a: 1 }, ...Array(30).fill({})]);
    console.log('throw: thrown hp', e.hp, 'other', other.st, other.hp);
    assert(other.hp < 200, 'a thrown enemy bowls over the enemy it hits'); }
  { // launcher + juggle
    const { g, me } = setup(); const e = enemy(g, g.camX + 230, 60, { cd: 999 });
    run(g, me, [{ u: 1, a: 1 }, ...Array(12).fill({})]);
    console.log('launch: enemy z', e.z.toFixed(1), e.st);
    assert(e.st === 'knock' && e.z > 20, 'Up + Attack launches an enemy into the air'); }
  { // slam hits enemies lying down
    const { g, me } = setup(); const e = enemy(g, g.camX + 210, 60, { st: 'lying', t: 0 });
    run(g, me, [{ j: 1 }, ...Array(10).fill({}), { d: 1, a: 1 }, ...Array(20).fill({})]);
    assert(e.hp < 200, 'a ground slam hits enemies on the floor'); }
  { // katana has a 4-hit combo; hitstop freezes on impact
    const { g, me } = setup(0); const e = enemy(g, g.camX + 230, 60, { hp: 999, maxHp: 999, cd: 999 });
    let maxCombo = 0, sawStop = false;
    for (let i = 0; i < 90; i++) { me.in = { ...N, a: i % 4 === 0 ? 1 : 0 }; Sim.step(g); g.events.length = 0; maxCombo = Math.max(maxCombo, me.combo); if (me.hs > 0) sawStop = true; e.x = me.x + 30; e.st = e.st === 'knock' || e.st === 'lying' ? 'walk' : e.st; e.z = 0; }
    assert(maxCombo === 4, 'katana combos up to 4 hits'); assert(sawStop, 'hits cause hitstop'); }
  console.log('fighting mechanics ok');
}

// Six-seat hashes: two local devices plus four CPU, then six scripted local devices.
{
  const expected = gameplay.mixedSeed7Tick1800;
  const g = Sim.create(Array.from({ length: 6 }, (_, i) => ({ fid: i % MANIFEST.fighters.length, weapon: i, ctrl: i < 2 ? 'local' : 'cpu', name: 'P' + (i + 1) })), expected.seed);
  for (let i = 0; i < expected.ticks; i++) {
    for (const p of g.players) if (p.ctrl === 'local') p.in = { l: 0, r: i % 100 < 70 ? 1 : 0, u: 0, d: 0, a: i % 10 === 0 ? 1 : 0, j: i % 45 === 0 ? 1 : 0, s: 0, p: 0 };
    Sim.step(g);
    g.events.length = 0;
  }
  assert.strictEqual(g.players.length, 6);
  assert.strictEqual(g.mode, expected.mode);
  assert.strictEqual(g.stageIdx + 1, expected.stageReached);
  assert.strictEqual(g.t, expected.t);
  assert.strictEqual(snapHash(g), expected.snapSha256);
  console.log('mixed gameplay hash', expected.snapSha256);
}
{
  const expected = gameplay.sixLocalSeed99Tick1800;
  const g = Sim.create(Array.from({ length: 6 }, (_, i) => ({ fid: i % MANIFEST.fighters.length, weapon: i, ctrl: 'local', name: 'P' + (i + 1) })), expected.seed);
  for (let i = 0; i < expected.ticks; i++) {
    g.players.forEach((p, slot) => {
      p.in = { l: 0, r: i % 100 < 70 ? 1 : 0, u: slot % 2 === 0 && i % 30 < 8 ? 1 : 0, d: slot % 2 === 1 && i % 30 < 8 ? 1 : 0, a: i % 12 === slot ? 1 : 0, j: i % 80 === slot * 3 ? 1 : 0, s: 0, p: 0 };
    });
    Sim.step(g);
    g.events.length = 0;
  }
  assert.strictEqual(g.players.length, 6);
  assert.strictEqual(g.mode, expected.mode);
  assert.strictEqual(g.stageIdx + 1, expected.stageReached);
  assert.strictEqual(g.t, expected.t);
  assert.strictEqual(snapHash(g), expected.snapSha256);
  console.log('six-local gameplay hash', expected.snapSha256);
}

// ---------- gameplay improvement plan (docs/gameplay-improvement-plan.md) ----------
const PN = { l: 0, r: 0, u: 0, d: 0, a: 0, j: 0, s: 0, p: 0 };
// One human (seat 0) on an empty, locked screen. opts.cpus keeps the five CPU seats alive.
function arena(opts) {
  const o = opts || {};
  const g = Sim.create(Array.from({ length: 6 }, (_, i) => ({ fid: i, weapon: i ? i : (o.weapon || 0), ctrl: i < (o.humans || 1) ? 'local' : 'cpu' })), o.seed || 61, o.stage || 0);
  for (let i = 0; i < 60; i++) { g.players.forEach(p => { if (p.ctrl !== 'cpu') p.in = { ...PN }; }); Sim.step(g); }
  if (!o.cpus) g.players.forEach(p => { if (p.ctrl === 'cpu') { p.st = 'dead'; p.dead = true; } });
  g.enemies.length = 0; g.items.length = 0; g.projs.length = 0; g.stage.waves.forEach(w => (w.done = true)); g.lockX = g.camX;
  const me = g.players[0];
  Object.assign(me, { x: g.camX + 200, y: 60, z: 0, st: 'idle', t: 0, inv: 0, hp: 100, face: 1, combo: 0 });
  return { g, me };
}
function foe(g, x, y, extra) {
  const e = { id: 7000 + g.enemies.length, fid: 0, weapon: 0, x, y, z: 0, vx: 0, vy: 0, vz: 0, face: -1, hp: 200, maxHp: 200, st: 'walk', t: 0, cd: 999, inv: 0, offY: 0, offX: 0, ...extra };
  g.enemies.push(e); return e;
}
function drive(g, me, seq) { for (const inp of seq) { me.in = { ...PN, ...inp }; Sim.step(g); g.events.length = 0; } }

// A1: a grab that ends because the grabber is hit must free the enemy, or the wave never clears.
{
  for (const how of ['hit', 'knock', 'down']) {
    const { g, me } = arena();
    const held = foe(g, g.camX + 222, 60, { st: 'hit', stun: 3, hp: 30, maxHp: 30 });
    drive(g, me, [{ r: 1 }]);
    assert(me.st === 'grab' && held.st === 'grabbed', 'setup: the enemy is grabbed');
    // Something hits the grabber from behind.
    me.inv = 0; if (how === 'down') me.hp = 1;
    // A knife in the back, or (for the knockdown) a heavy boss shot.
    const striker = foe(g, me.x - 22, 60, { st: 'attack', t: how === 'knock' ? 99 : 10, face: 1, weapon: 1 });
    if (how === 'knock') g.projs.push({ id: 9100, kind: 'boss', row: 2, x: me.x - 12, y: 60, z: 16, vx: 3.8, vy: 0, vz: 0, dmg: 10, t: 0, life: 260, enemy: true, phase: 0, bi: 0 });
    drive(g, me, [{}]);
    if (how === 'down') assert.strictEqual(me.lives, 1, 'down: the hit downed the solo human, who came back on the spare life (A3)');
    else assert.strictEqual(me.st, how, how + ': setup lands the hit');
    assert(me.st !== 'grab', how + ': the hit broke the grab (' + me.st + ')');
    assert.strictEqual(me.grab, null, how + ': the grab is cleared');
    assert.notStrictEqual(held.st, 'grabbed', how + ': the enemy is free in the same tick');
    g.enemies.splice(g.enemies.indexOf(striker), 1);
    if (how === 'down') continue;
    // It can now be killed with ordinary attacks.
    me.hp = 100; me.st = 'idle'; me.inv = 9999; me.face = 1; held.cd = 999;
    for (let i = 0; i < 400 && !held.dead; i++) { held.x = me.x + 30; held.y = me.y; if (held.st === 'lying' || held.st === 'knock') { held.st = 'walk'; held.z = 0; } drive(g, me, [{ a: i % 4 === 0 ? 1 : 0 }]); }
    assert(held.dead, how + ': the freed enemy can be killed');
  }
  // The second guard: even if the grabber's state is changed from outside, nobody stays frozen.
  const { g, me } = arena();
  const held = foe(g, g.camX + 222, 60, { st: 'hit', stun: 3 });
  drive(g, me, [{ r: 1 }]);
  assert(held.st === 'grabbed');
  me.st = 'lying'; me.t = 0;
  drive(g, me, [{}]);
  assert.notStrictEqual(held.st, 'grabbed', 'an enemy nobody holds walks again');
  // The plan's reproduction: wave with one grabbed enemy left, grabber hit, wave must clear.
  const r = arena();
  const wave = r.g.stage.waves[0]; wave.done = false; wave.active = true; wave.left = 0;
  const last = foe(r.g, r.g.camX + 222, 60, { st: 'hit', stun: 3, hp: 20, maxHp: 20 });
  drive(r.g, r.me, [{ r: 1 }]);
  assert(r.me.st === 'grab');
  r.me.inv = 0; foe(r.g, r.me.x - 22, 60, { st: 'attack', t: 10, face: 1, weapon: 1, hp: 1, maxHp: 1 });
  drive(r.g, r.me, [{}]);
  r.me.inv = 99999;
  for (let i = 0; i < 1800 && !wave.done; i++) {
    for (const e of r.g.enemies) { e.cd = 999; if (!e.dead && e.st !== 'knock' && e.st !== 'lying') { e.x = r.me.x + r.me.face * 30; e.y = r.me.y; } }
    r.me.st = r.me.st === 'hit' || r.me.st === 'knock' || r.me.st === 'lying' ? 'idle' : r.me.st;
    drive(r.g, r.me, [{ a: i % 4 === 0 ? 1 : 0 }]);
  }
  assert(wave.done, 'the wave clears after the grabber was hit');
  console.log('A1 grab release ok');
}

// A2: a dead boss cannot end the run. Its shots vanish and nobody can be hurt while it explodes.
{
  const { g, me } = arena();
  g.boss = { bi: 0, phase: 1, hp: 5, maxHp: 2600, x: g.camX + 420, y: 60, z: 0, face: -1, st: 'idle', t: 0, row: 0, w: 150, cycle: 0, flash: 0, tx: 0, ty: 0, hitCd: 0, adds: 0 };
  me.hp = 1; me.lives = 1; me.x = g.boss.x - 110; me.inv = 0;
  // Shots one tick from the last standing Sproto, a missile, and a Shadow Sproto mid-swing.
  g.projs.push({ id: 9001, kind: 'boss', row: 0, x: me.x + 10, y: 60, z: 16, vx: -3.8, vy: 0, vz: 0, dmg: 20, t: 0, life: 260, enemy: true, phase: 1, bi: 0 });
  g.projs.push({ id: 9002, kind: 'boss', row: 3, x: me.x + 8, y: 60, z: 20, vx: -1.6, vy: 0, vz: 0, dmg: 30, t: 0, life: 300, enemy: true, homing: true, boom: true, phase: 1, bi: 0 });
  const add = foe(g, me.x - 22, 60, { st: 'attack', t: 16, face: 1, hp: 80, maxHp: 80 });
  // The katana swing is on its first active frame: the killing blow, both shots and the club all
  // land on this very tick.
  Object.assign(me, { st: 'attack', t: 4, combo: 1, launch: false, hitDone: new Set() });
  drive(g, me, [{}]);
  assert.strictEqual(g.boss.st, 'dead', 'setup: the boss just died');
  assert.strictEqual(g.projs.filter(pr => pr.enemy).length, 0, 'enemy shots are gone the moment the boss dies');
  assert(add.dead, 'its Shadow Sprotos fall with it');
  assert(me.inv >= 100, 'survivors are safe during the explosion');
  for (let i = 0; i < 400 && g.mode === 'play'; i++) drive(g, me, [{}]);
  assert.strictEqual(g.mode, 'clear', 'the stage clears instead of GAME OVER (' + g.mode + ')');
  assert.strictEqual(me.hp, 1, 'the last Sproto was not hurt');
  console.log('A2 dead boss ok');
}

// A3: every Sproto down, but a human still holds a spare life: it is used instead of GAME OVER.
{
  const { g, me } = arena(); // the five CPUs are dead
  assert.strictEqual(me.lives, 2);
  me.hp = 0; me.st = 'down'; me.downT = Sim.DOWN_TICKS; // freshly downed: ten seconds on the clock
  drive(g, me, [{}]);
  assert.strictEqual(g.mode, 'play', 'first down with a spare life is not game over');
  assert.strictEqual(me.lives, 1, 'the spare life was spent');
  assert(Sim.alive(me) && me.hp === Sim.MAX_HP, 'the human is back at once, not after the 10 s timer');
  for (let i = 0; i < 60; i++) drive(g, me, [{}]);
  me.hp = 0; me.st = 'down'; me.downT = Sim.DOWN_TICKS; me.z = 0;
  drive(g, me, [{}]);
  assert.strictEqual(g.mode, 'gameover', 'the second time, with no life left, the run ends');
  // Two humans both down, one with a spare life: that one returns and can revive the other.
  const two = arena({ humans: 2 });
  const a = two.g.players[0], b = two.g.players[1];
  b.lives = 1;
  for (const p of [a, b]) { p.hp = 0; p.st = 'down'; p.downT = Sim.DOWN_TICKS; p.z = 0; }
  two.g.players.forEach(p => (p.in = { ...PN })); Sim.step(two.g);
  assert.strictEqual(two.g.mode, 'play');
  assert(Sim.alive(a) && a.lives === 1 && b.st === 'down' && b.lives === 1, 'only the spare life is spent; the other stays down to be revived');
  console.log('A3 spare life ok');
}

// Run totals for the end-of-run panel: KOs, revives and parries are counted per Sproto.
{
  const { g, me } = arena();
  const e = foe(g, g.camX + 230, 60, { hp: 5, maxHp: 5 });
  drive(g, me, [{ a: 1 }, ...Array(8).fill({})]);
  assert(e.dead && me.kills === 1, 'a kill is counted for the Sproto that landed it');
  const snap = Sim.snapshot(g).players[0];
  assert.deepStrictEqual([snap.k, snap.rvn, snap.pa], [1, 0, 0], 'the snapshot carries the totals');
  const two = arena({ humans: 2 });
  const a = two.g.players[0], b = two.g.players[1];
  Object.assign(b, { x: a.x + 5, y: a.y, hp: 0, st: 'down', downT: Sim.DOWN_TICKS, revive: 0, z: 0 });
  for (let i = 0; i < Sim.REVIVE_TICKS + 2; i++) { two.g.players.forEach(p => (p.in = { ...PN })); Sim.step(two.g); }
  assert(Sim.alive(b) && a.revs === 1, 'a revive is counted for the helper');
  console.log('run totals ok');
}
