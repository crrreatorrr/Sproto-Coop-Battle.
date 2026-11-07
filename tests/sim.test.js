// Headless checks: six CPU Sprotos play the campaign; the sim must progress and stay sane.
'use strict';
globalThis.window = globalThis;
require('../public/js/manifest.js');
const Sim = require('../public/js/sim.js');
require('../public/js/ai.js');
const assert = require('assert');

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
