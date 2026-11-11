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

// Death rules: no auto revive; 10 s to revive; a human's second death puts them out for the stage;
// the run is lost when no human is left or the whole team is down.
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
  // B4: a human's second death puts that human out; the run goes on while another human is left.
  const kill = p => { p.inv = 0; p.hp = 0; p.st = 'down'; p.downT = 1; g.enemies.length = 0; for (let i = 0; i < 3; i++) { freeze(); Sim.step(g); } };
  const me = g.players[0];
  kill(me);
  assert(Sim.alive(me) && me.lives === 1 && g.mode === 'play', 'the first death drops the human back in on the last life');
  kill(me);
  assert(me.st === 'dead' && me.lives === 0, 'the second death puts that human out');
  assert.strictEqual(g.mode, 'play', 'one human out does not end the run for the others');
  for (const k of [1, 2, 4]) { kill(g.players[k]); kill(g.players[k]); assert.strictEqual(g.mode, 'play'); }
  kill(g.players[5]); kill(g.players[5]);
  assert.strictEqual(g.mode, 'gameover', 'the run ends when the last human is out');
  assert(/No human/.test(g.banner.sub), 'and says why');
  // Humans who were put out return for the next stage on one life, like dead CPUs do.
  {
    const n = Sim.create(cfg.map((c, i) => ({ ...c, ctrl: i < 2 ? 'local' : 'cpu' })), 12);
    const out = n.players[0];
    for (let i = 0; i < 60; i++) Sim.step(n);
    for (const round of [1, 2]) { out.inv = 0; out.hp = 0; out.st = 'down'; out.downT = 1; out.x = n.camX + 600; out.y = 0; n.players.forEach((q, k) => { if (k) { q.x = n.camX + 40; q.y = 110; } }); for (let i = 0; i < 3; i++) Sim.step(n); }
    assert(out.st === 'dead' && n.mode === 'play');
    Sim.startStage(n, 1);
    assert(Sim.alive(out) && out.lives === 1 && out.hp >= 60, 'back for the next stage on a last life');
  }
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

// B1: waves, Shadow Sproto health and boss health scale with the number of human seats, counted
// when the stage's first fight starts.
{
  const make = (h, stage, seed) => Sim.create(Array.from({ length: 6 }, (_, i) => ({ fid: i, weapon: i, ctrl: i < h ? 'local' : 'cpu' })), seed || 71, stage || 0);
  const firstWave = g => { g.camX = g.stage.waves[0].x; g.players.forEach(p => { p.in = { ...PN }; p.x = g.camX + 100; p.inv = 9999; }); Sim.step(g); return g.stage.waves[0]; };
  assert.strictEqual(Sim.WAVE_SCALE(1), 0.6); assert.strictEqual(Sim.WAVE_SCALE(5), 1);
  for (const [h, want] of [[0, 1], [1, 1], [2, 2], [3, 3], [4, 4], [6, 6]]) {
    for (const stage of [0, 5, 11]) {
      const g = make(h, stage);
      assert.strictEqual(g.humans, 0, 'not counted before the first fight');
      const w = firstWave(g);
      assert.strictEqual(g.humans, want, h + ' human seats count as ' + want);
      // The first Shadow Sproto of the wave may already have been spawned by this tick.
      const spawned = g.enemies.length;
      assert.strictEqual(w.left + spawned, Math.round(w.count * Sim.WAVE_SCALE(want)), 'wave size for ' + h + ' humans on stage ' + (stage + 1));
      // Health: let a few of the wave walk on and compare each with the formula for its kit.
      for (let i = 0; i < 200 && g.enemies.length < 4; i++) { g.players.forEach(p => { p.in = { ...PN }; p.inv = 9999; }); Sim.step(g); }
      assert(g.enemies.length >= 4);
      for (const e of g.enemies) {
        const base = (26 + stage * 4 + (e.weapon === 0 ? 14 : 0)) * (1 + 0.09 * stage);
        assert.strictEqual(e.maxHp, Math.round(base * Sim.GRUNT_HP_SCALE(want)), 'Shadow Sproto health for ' + h + ' humans on stage ' + (stage + 1));
      }
      g.enemies.length = 0; g.stage.waves.forEach(x => (x.done = true));
      g.camX = g.stage.len; g.lockX = null;
      for (let i = 0; i < 400 && !g.boss; i++) { g.players.forEach(p => { p.in = { ...PN }; p.inv = 9999; }); Sim.step(g); }
      assert.strictEqual(g.boss.maxHp, Math.round((2600 + 480 * stage) * Sim.BOSS_HP_SCALE(want)), 'boss health for ' + h + ' humans on stage ' + (stage + 1));
    }
  }
  // Fewer humans means smaller waves and softer enemies; six humans face the largest of everything.
  for (const f of [Sim.WAVE_SCALE, Sim.GRUNT_HP_SCALE, Sim.BOSS_HP_SCALE]) for (let h = 1; h < 6; h++) assert(f(h) < f(h + 1));
  assert(Sim.BOSS_HP_SCALE(1) < 0.6 && Sim.BOSS_HP_SCALE(6) >= 1 && Sim.GRUNT_HP_SCALE(6) >= 1);
  // A drop-in mid-stage does not change the stage in progress; the next stage counts again.
  const g = make(1);
  firstWave(g);
  g.players[1].ctrl = 'local'; g.players[2].ctrl = 'local';
  for (let i = 0; i < 30; i++) { g.players.forEach(p => { p.in = { ...PN }; p.inv = 9999; }); Sim.step(g); }
  assert.strictEqual(g.humans, 1, 'locked for the stage in progress');
  Sim.startStage(g, 1);
  firstWave(g);
  assert.strictEqual(g.humans, 3, 'counted again on the next stage');
  // CPU teammates: 75% dealt / 115% taken with one or two humans, 55% / 135% with more.
  for (const [h, dealt, taken] of [[1, 0.75, 1.15], [2, 0.75, 1.15], [3, 0.55, 1.35], [6, 0.55, 1.35]]) {
    const c = arena({ humans: Math.min(h, 5), cpus: true });
    c.g.humans = h;
    const cpu = c.g.players[5];
    Object.assign(cpu, { x: c.g.camX + 300, y: 100, st: 'attack', t: 4, combo: 1, launch: false, hitDone: new Set(), face: 1, weapon: 0, inv: 0, hp: 100 });
    const e = foe(c.g, cpu.x + 30, 100, { hp: 500, maxHp: 500 });
    c.g.players.forEach((p, k) => { if (k !== 5) { p.x = c.g.camX + 30; p.y = 10; } p.in = { ...PN }; });
    Sim.step(c.g); // the swing is on its first active frame
    assert.strictEqual(500 - e.hp, Math.ceil(9 * dealt), 'CPU katana hit with ' + h + ' humans');
    const hit = foe(c.g, cpu.x - 22, 100, { st: 'attack', t: 10, face: 1, weapon: 1 });
    cpu.inv = 0; cpu.hp = 100; cpu.st = 'idle'; c.g.enemies.splice(c.g.enemies.indexOf(e), 1);
    Sim.step(c.g);
    assert.strictEqual(100 - cpu.hp, Math.ceil(Math.round(5 * 0.8) * taken), 'CPU damage taken with ' + h + ' humans');
  }
  // CPUs are revived like humans: by a human as often as needed, by another CPU once per life and stage.
  const r = arena({ cpus: true });
  const a = r.g.players[4], b = r.g.players[5];
  r.g.players.forEach((p, k) => { if (k < 4) { p.x = r.g.camX + 30; p.y = 5; if (k) { p.st = 'dead'; p.dead = true; } } });
  r.me.x = r.g.camX + 30; r.me.y = 5;
  const down = () => Object.assign(b, { x: r.g.camX + 400, y: 100, hp: 0, st: 'down', downT: Sim.DOWN_TICKS, revive: 0, z: 0 });
  down(); a.x = b.x - 200; a.y = 40;
  let ticks = 0;
  for (; ticks < Sim.DOWN_TICKS && b.st === 'down'; ticks++) { r.me.in = { ...PN }; Sim.step(r.g); r.g.events.length = 0; }
  assert(Sim.alive(b) && b.npcRevived, 'a CPU Sproto runs over and revives a downed CPU (' + (ticks / 60).toFixed(1) + ' s)');
  assert.strictEqual(a.revs, 1);
  down(); a.x = b.x - 200; a.y = 40;
  for (ticks = 0; ticks < Sim.DOWN_TICKS + 5 && b.st === 'down'; ticks++) { r.me.in = { ...PN }; Sim.step(r.g); r.g.events.length = 0; }
  assert.strictEqual(b.st, 'dead', 'but only once: the second time only a human can help');
  Sim.startStage(r.g, 1);
  assert(Sim.alive(b) && !b.npcRevived, 'the CPU revive is available again on the next stage');
  console.log('B1 scaling ok');
}

// B2: block on press, parry from the press, spin on a quick tap, and a short attack buffer.
{
  // Block is up on the very tick Special is pressed (it used to need a 9-tick hold).
  let { g, me } = arena();
  drive(g, me, [{ s: 1 }]);
  assert.strictEqual(me.st, 'block', 'block rises on press');
  // A hit 3 ticks after the press is parried: the parry window is the first 8 ticks from the press.
  const parryAt = n => {
    const a = arena(); const e = foe(a.g, a.me.x + 28, 60, { st: 'attack', t: 10 - n + 1, face: -1, weapon: 1 }); // knife lands on tick n
    drive(a.g, a.me, Array(n).fill({ s: 1 }));
    return { hp: a.me.hp, dazed: e.st === 'hit' && e.stun >= 2, parries: a.me.parries };
  };
  for (const n of [1, 3, Sim.PARRY_WINDOW]) { const r = parryAt(n); assert(r.hp === 100 && r.dazed && r.parries === 1, 'parry ' + n + ' ticks after the press'); }
  const late = parryAt(Sim.PARRY_WINDOW + 3);
  assert(late.hp < 100 && late.hp >= 99 && !late.dazed, 'after the window it is a plain block: 75% less damage (' + late.hp + ')');
  // A quick tap is still the spin attack, and costs health; holding then releasing is not.
  ({ g, me } = arena());
  drive(g, me, [{ s: 1 }, { s: 1 }, { s: 1 }, {}]);
  assert(me.st === 'special' && me.hp === 94, 'tap Special: spin (' + me.st + ', ' + me.hp + ')');
  ({ g, me } = arena());
  drive(g, me, [...Array(Sim.SPIN_TAP + 2).fill({ s: 1 }), {}]);
  assert(me.st === 'idle' && me.hp === 100, 'a held block released does not spin');
  // A tap that blocked or parried something does not turn into a spin.
  ({ g, me } = arena());
  foe(g, me.x + 28, 60, { st: 'attack', t: 9, face: -1, weapon: 1 });
  drive(g, me, [{ s: 1 }, { s: 1 }, {}]);
  for (let i = 0; i < 12; i++) drive(g, me, [{}]); // let the parry hitstop pass
  assert(me.st !== 'special' && me.hp === 100, 'a successful parry tap is not followed by a spin');
  // Parries cannot be mashed: a block raised right after the last one blocks but does not parry.
  ({ g, me } = arena());
  drive(g, me, [...Array(8).fill({ s: 1 }), {}, {}]);
  const e2 = foe(g, me.x + 28, 60, { st: 'attack', t: 9, face: -1, weapon: 1 });
  drive(g, me, [{ s: 1 }, { s: 1 }]);
  assert(me.hp < 100 && e2.st === 'attack', 're-raised within ' + Sim.PARRY_LOCK + ' ticks: blocked, not parried');
  ({ g, me } = arena());
  drive(g, me, [...Array(8).fill({ s: 1 }), ...Array(Sim.PARRY_LOCK + 1).fill({})]);
  const e3 = foe(g, me.x + 28, 60, { st: 'attack', t: 9, face: -1, weapon: 1 });
  drive(g, me, [{ s: 1 }, { s: 1 }]);
  assert(me.hp === 100 && e3.st === 'hit', 'after the lock a fresh block parries again');
  // Special held through a swing blocks on the first free tick.
  ({ g, me } = arena());
  drive(g, me, [{ a: 1 }, ...Array(20).fill({ s: 1 })]);
  assert.strictEqual(me.st, 'block', 'held Special blocks as soon as the swing ends');
  // Down + Special still fires a saved power-up instead of blocking.
  ({ g, me } = arena());
  me.powers.push(0);
  drive(g, me, [{ d: 1, s: 1 }]);
  assert(me.st === 'special' && me.powers.length === 0, 'Down + Special fires the power-up');
  // Attack buffer: a press during the swing's startup comes out as the next combo hit.
  const combo = withBuffer => { const a = arena(); drive(a.g, a.me, [{ a: 1 }, {}, { a: 1 }, ...Array(withBuffer ? 5 : 0).fill({}), ...Array(14).fill({})]); return a.me; };
  // katana: startup 4, active 4 -> chaining opens at t 9. The second press is at t 2.
  const noChain = (() => { const a = arena(); drive(a.g, a.me, [{ a: 1 }, {}, { a: 1 }, ...Array(4).fill({})]); return a.me.combo; })();
  assert.strictEqual(noChain, 1, 'a press ' + (Sim.ATTACK_BUFFER + 1) + ' ticks early is not held that long');
  const chained = (() => { const a = arena(); drive(a.g, a.me, [{ a: 1 }, {}, {}, {}, { a: 1 }, ...Array(6).fill({})]); return a.me.combo; })();
  assert.strictEqual(chained, 2, 'a press up to ' + Sim.ATTACK_BUFFER + ' ticks early chains the combo');
  // ... and a press late in a finisher's recovery starts the next string on the first free tick.
  ({ g, me } = arena());
  Object.assign(me, { st: 'land', t: 3 });
  drive(g, me, [{ a: 1 }, {}, {}, {}, {}]);
  assert.strictEqual(me.st, 'attack', 'a press during landing recovery is buffered');
  ({ g, me } = arena());
  drive(g, me, [{ a: 1 }, ...Array(40).fill({})]);
  assert.strictEqual(me.st, 'idle', 'one press is one attack: the buffer never repeats it');
  console.log('B2 block and buffer ok');
}

// B3: every Shadow Sproto keeps its own stand-off, and all of them can still reach their target.
{
  for (const weapon of [0, 1, 2]) for (const offX of [-28, 0, 28]) {
    const { g, me } = arena();
    me.inv = 0; me.hp = 100;
    const e = foe(g, me.x + 140, 60, { weapon, cd: 0, offX, offY: 0, hp: 500, maxHp: 500 });
    let swung = false;
    for (let i = 0; i < 400 && !swung; i++) { drive(g, me, [{}]); me.hp = 100; me.st = me.st === 'hit' || me.st === 'knock' || me.st === 'lying' ? 'idle' : me.st; me.inv = 0; if (e.st === 'attack') swung = true; }
    assert(swung, 'weapon ' + weapon + ' with stand-off ' + offX + ' still attacks');
    assert(Math.abs(e.x - me.x) < Sim.ENEMY_WEAPONS[weapon].reach, 'and does so inside its reach');
  }
  // Spawned stand-offs differ, and two Shadow Sprotos on one target do not stand in each other.
  const { g, me } = arena();
  me.inv = 99999;
  const a = foe(g, me.x + 100, 60, { weapon: 0, offX: 0, offY: 0 }), b = foe(g, me.x + 104, 60, { weapon: 0, offX: 0, offY: 0 });
  for (let i = 0; i < 300; i++) drive(g, me, [{}]);
  assert(Math.abs(a.x - b.x) > 16 || Math.abs(a.y - b.y) > 5, 'two on one target stand apart: ' + [a.x - me.x, a.y, b.x - me.x, b.y].map(Math.round));
  console.log('B3 spread ok');
}

// B5: the boss faces the fuller side, and Sprotos who stay behind it draw a rear sweep.
{
  const bossFight = () => {
    const a = arena({ humans: 6 });
    const g = a.g;
    g.boss = { bi: 0, phase: 0, hp: 9000, maxHp: 9000, x: g.camX + 320, y: 60, z: 0, face: -1, st: 'idle', t: 0, row: 0, w: 150, cycle: 0, flash: 0, tx: 0, ty: 0, hitCd: 0, adds: 0 };
    return a;
  };
  const place = (g, xs) => g.players.forEach((p, k) => { Object.assign(p, { x: g.boss.x + xs[k], y: 20 + k * 14, z: 0, st: 'idle', inv: 0, hp: 100, vx: 0 }); p.in = { ...PN }; });
  // Four on the left, two on the right: it faces left even though the average is to the right.
  let { g } = bossFight();
  place(g, [-100, -110, -120, -130, 300, 310]);
  Sim.step(g);
  assert.strictEqual(g.boss.face, -1, 'faces the side with more Sprotos, not the average position');
  // Two behind for three seconds: a sweep that hits them on the ground.
  const sweep = (xs, jumper) => {
    const a = bossFight(); const b = a.g.boss; let saw = 0, t = 0;
    for (; t < 900; t++) {
      if (b.st === 'idle') place(a.g, xs); // hold everyone in place (and at full health) until the sweep starts
      else a.g.players.forEach(p => (p.in = { ...PN }));
      if (b.st === 'fire' || b.st === 'charge') { b.st = 'idle'; b.t = 0; a.g.projs.length = 0; } // only the sweep is under test
      a.g.enemies.length = 0;
      if (b.st === 'sweep') {
        if (!saw) saw = t;
        if (jumper !== undefined && b.t === Sim.SWEEP_WARN - 6) a.g.players[jumper].in = { ...PN, j: 1 };
        if (b.t === Sim.SWEEP_WARN - 1) { Sim.step(a.g); break; } // this step lands the sweep
      }
      Sim.step(a.g);
      if (b.st === 'sweep' && b.t < Sim.SWEEP_WARN) a.g.players.forEach(p => assert.strictEqual(p.hp, 100, 'no damage during the warning'));
    }
    return { g: a.g, saw, hp: a.g.players.map(p => p.hp) };
  };
  const two = sweep([-120, -130, -140, -150, 120, 130]); // four in front (left), two behind
  assert(two.saw > 150 && two.saw < 320, 'two behind: swept after about 3 s (tick ' + two.saw + ')');
  assert(two.hp[4] < 100 && two.hp[5] < 100, 'the two behind are hit: ' + two.hp);
  assert.deepStrictEqual(two.hp.slice(0, 4), [100, 100, 100, 100], 'the four in front are not');
  const one = sweep([-120, -130, -140, -150, -160, 120]);
  assert(one.saw > two.saw + 60, 'one behind: it takes longer (tick ' + one.saw + ')');
  assert(one.hp[5] < 100, 'but the safe spot behind the boss is gone');
  const jumped = sweep([-120, -130, -140, -150, 120, 130], 5);
  assert(jumped.hp[4] < 100 && jumped.hp[5] === 100, 'a jump clears the sweep: ' + jumped.hp);
  const none = sweep([-120, -130, -140, -150, -160, -170]);
  assert.strictEqual(none.saw, 0, 'nobody behind, no sweep');
  console.log('B5 rear sweep ok');
}
