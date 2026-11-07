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
