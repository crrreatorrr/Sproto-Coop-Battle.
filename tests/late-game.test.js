// The late-game ramp, the idle-reviver rule, the CPU crate rule and the Down + Special buffer.
'use strict';
globalThis.window = globalThis;
require('../public/js/manifest.js');
const Sim = require('../public/js/sim.js');
const AI = require('../public/js/ai.js');
const assert = require('node:assert/strict');

const humans = n => Sim.partySlots().map((slot, i) => ({ ...slot, ctrl: i < n ? 'local' : 'cpu' }));
const rest = state => { for (const p of state.players) p.in = { l: 0, r: 0, u: 0, d: 0, a: 0, j: 0, s: 0, p: 0 }; };

// Stages 1 to 6 keep the full ramp; later stages add 30% of a step each.
{
  for (let s = 0; s <= Sim.LATE_FROM; s++) {
    assert.equal(Sim.ramp(s), s);
    assert.equal(Sim.ENEMY_HP(s), 1.5 + 0.08 * s);
    assert.equal(Sim.ENEMY_DMG(s), 0.8 + 0.1 * s);
  }
  assert.equal(Sim.LATE_FROM, 5);
  for (let s = Sim.LATE_FROM + 1; s < 13; s++) {
    assert.ok(Sim.ramp(s) > Sim.ramp(s - 1), 'every stage is still harder than the one before');
    assert.ok(Sim.ramp(s) - Sim.ramp(s - 1) < 0.5, 'but by much less than a full step');
  }
  assert.ok(Math.abs(Sim.ramp(12) - 7.1) < 1e-9, 'stage 13 plays about like the old stage 8');
  const waveSizes = stage => Sim.create(humans(1), 5, stage, { cpuParty: true }).stage.waves.map(w => w.count);
  assert.deepEqual(waveSizes(5), [15, 18, 19, 21], 'stage 6 waves are unchanged');
  assert.deepEqual(waveSizes(12), [17, 20, 21, 23], 'stage 13 waves (they were 22, 25, 26, 28)');
  // A late summoner calls less often, and only with more room on the floor.
  assert.ok(Sim.LATE_SUMMON_EVERY > Sim.SUMMON_EVERY && Sim.LATE_SUMMON_ROOM < Sim.SUMMON_ROOM);
}

// A human who went idle does not revive anyone, so idle seats cannot keep each other up forever.
{
  const lay = idle => {
    const state = Sim.create(humans(4), 11, 5, { cpuParty: true });
    rest(state);
    for (const p of state.players) Object.assign(p, { x: 200, y: 40, inv: 0, idle });
    Object.assign(state.players[0], { hp: 0, st: 'down', downT: Sim.DOWN_TICKS, revive: 0 });
    return state;
  };
  const idleParty = lay(Sim.IDLE_AFTER);
  for (let i = 0; i < Sim.REVIVE_TICKS + 5; i++) Sim.step(idleParty);
  assert.equal(idleParty.players[0].st, 'down', 'idle humans revive nobody');
  assert.equal(idleParty.players[0].revive, 0);
  for (let i = 0; i < Sim.DOWN_TICKS; i++) Sim.step(idleParty);
  assert.notEqual(idleParty.players[0].st, 'down', 'so the downed Sproto runs out its clock');
  assert.equal(idleParty.players[0].lives, 1);

  const awake = lay(0); // standing still for a moment is not idle
  for (let i = 0; i < Sim.REVIVE_TICKS + 5; i++) Sim.step(awake);
  assert.equal(awake.players[0].st, 'idle', 'a human who was just playing still revives by standing close');

  // The stalemate itself: idle seats standing together, and one Shadow Sproto's worth of hits that
  // puts one of them down whenever all four are up. They used to revive each other for ever.
  const stuck = lay(Sim.IDLE_AFTER);
  stuck.players.forEach(p => { p.hp = 100; p.st = 'idle'; });
  let downs = 0;
  for (let i = 0; i < 60 * 60 * 3 && stuck.mode === 'play'; i++) {
    const up = stuck.players.filter(Sim.alive);
    if (up.length && !stuck.players.some(p => p.st === 'down')) { Object.assign(up[downs++ % up.length], { hp: 0, st: 'down', downT: Sim.DOWN_TICKS, revive: 0, inv: 0 }); }
    Sim.step(stuck); stuck.events.length = 0;
  }
  assert.equal(stuck.mode, 'gameover', 'an all-idle party loses instead of stalling');
  assert.equal(downs, 8, 'each idle Sproto fell once per life');
}

// A CPU does not walk into the left screen edge for a crate whose hit spot is off screen.
{
  const setup = crateX => {
    const state = Sim.create(humans(1), 9, 0, { cpuParty: true });
    rest(state);
    state.camX = 600; state.lockX = 600;
    state.items = [{ id: 9001, kind: 'crate', x: crateX, y: 40, z: 0, hp: 12 }];
    const [human, cpu] = state.players;
    Object.assign(human, { x: 900, y: 40 });
    Object.assign(cpu, { x: 640, y: 40 });
    AI.think(state, cpu);
    return cpu.in;
  };
  const offScreen = setup(630); // its hit spot (x - 30) is left of the camera
  assert.equal(offScreen.l, 0, 'no walking into the left edge');
  assert.equal(offScreen.r, 1, 'the CPU follows the team instead');
  const onScreen = setup(700);
  assert.equal(onScreen.l, 0);
  assert.equal(onScreen.r, 1, 'a crate whose hit spot is on screen is still fetched');
}

// Special a tick or two before Down is still Down + Special: the saved power-up fires.
{
  const press = (lead, hold = 12) => {
    const state = Sim.create(humans(1), 21, 0, { cpuParty: true });
    rest(state);
    const p = state.players[0];
    p.powers.push(0);
    p.in.s = 1;
    for (let i = 0; i < lead; i++) Sim.step(state);
    p.in.d = 1;
    for (let i = 0; i < hold; i++) Sim.step(state);
    return p;
  };
  assert.equal(press(0).powers.length, 0, 'Down + Special on the same tick');
  assert.equal(press(1).powers.length, 0, 'Special one tick before Down');
  assert.equal(press(1).st, 'special');
  assert.equal(press(Sim.POWER_BUFFER).powers.length, 0, 'the edge of the buffer');
  const late = press(Sim.POWER_BUFFER + 4);
  assert.equal(late.powers.length, 1, 'a block that is already up stays a block');
  assert.equal(late.st, 'block');
}

console.log('ok');
