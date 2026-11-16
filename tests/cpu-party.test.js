'use strict';

const assert = require('node:assert/strict');
globalThis.window = globalThis;
require('../public/js/manifest.js');
const Sim = require('../public/js/sim.js');
require('../public/js/ai.js');
const Protocol = require('../public/js/net-protocol.js');

{
  const { session } = Protocol.createMatch({ mode: 'banked', seed: 14 });
  const { players } = session.state;
  assert.deepEqual(players.map(player => player.ctrl), ['cpu', 'cpu', 'cpu', 'cpu']);
  assert.deepEqual(players.map(player => player.classId), ['fighter', 'mage', 'healer', 'ranged']);
  const leader = { accountId: 'leader', device: 'k1', generation: 3 };
  const guest = { accountId: 'guest', device: 'k1', generation: 3 };
  assert.ok(Protocol.assignSeat(session, { ...leader, slot: 0 }).ok);
  assert.ok(Protocol.assignSeat(session, { ...guest, slot: 3 }).ok);

  const config = { slot: 1, classId: 'ranged', fighter: globalThis.MANIFEST.fighters[4].id };
  assert.equal(Protocol.selectCpuLoadout(session, { ...guest, ...config }, 1).reason, 'owner');
  assert.equal(Protocol.selectCpuLoadout(session, { ...leader, ...config, generation: 2 }, 1).reason, 'owner');
  assert.equal(Protocol.selectCpuLoadout(session, { ...leader, ...config, slot: 3 }, 1).reason, 'occupied');
  assert.equal(Protocol.parseCpuLoadouts({ 1: { classId: 'ranged', hp: 900 } }).reason, 'loadout');
  assert.equal(Protocol.parseCpuLoadouts({ 4: { classId: 'ranged' } }).reason, 'loadout');
  const locked = Sim.WEAPONS[Sim.weaponChoices('ranged', 2)[1]].id;
  assert.equal(Protocol.selectCpuLoadout(session, { ...leader, ...config, weapon: locked }, 1).reason, 'weapon_locked');
  assert.ok(Protocol.selectCpuLoadout(session, { ...leader, ...config, weapon: locked }, 2).ok);
  assert.equal(players[1].classId, 'ranged');
  assert.equal(players[1].fid, 4);
  assert.equal(players[1].hp, Sim.maxHp(players[1]));

  Sim.step(session.state);
  assert.equal(Protocol.selectCpuLoadout(session, { ...leader, ...config }, 2).reason, 'phase');
  Object.assign(players[1], { hp: 27, lives: 1, abilityCd: 72, inv: 0 });
  const dropIn = { accountId: 'drop-in', device: 'k1', generation: 1, slot: 1 };
  assert.ok(Protocol.assignSeat(session, dropIn, 1).ok);
  assert.equal(players[1].ctrl, 'local');
  assert.equal(Sim.WEAPONS[players[1].weapon].tier, 1);
  assert.ok(Protocol.releaseSeat(session, dropIn).ok);
  assert.equal(players[1].ctrl, 'cpu');
  assert.deepEqual([players[1].hp, players[1].lives, players[1].abilityCd, players[1].inv], [27, 1, 72, 0]);
}

{
  const slots = Sim.partySlots();
  slots[0].ctrl = 'local';
  const state = Sim.create(slots, 16, 0, { cpuParty: true });
  state.stage.waves = [];
  state.items = [];
  const [human, mage, healer, ranged] = state.players;
  Object.assign(human, { x: 96, y: 55, hp: 38 });
  Object.assign(healer, { x: 180, y: 55 });
  for (const shooter of [mage, ranged]) Object.assign(shooter, { x: 140, y: 55 });
  state.enemies.push({
    id: state.nextId++, x: 245, y: 55, z: 0, vx: 0, vy: 0, vz: 0, face: -1,
    fid: 0, weapon: 0, st: 'idle', t: 0, hp: 1000, maxHp: 1000, hs: 1000,
  });
  const casts = new Set();
  for (let i = 0; i < 160; i++) {
    Sim.step(state);
    for (const projectile of state.projs) casts.add(projectile.owner);
  }
  assert.ok(human.hp > 38 && healer.abilityCd > 0, 'the CPU healer treats the wounded human');
  assert.ok(casts.has(mage.slot) && casts.has(ranged.slot), 'ranged CPUs use their class projectiles');
  assert.equal(Sim.humansOf(state), 1, 'teammates do not increase encounter difficulty');
  human.idle = Sim.IDLE_AFTER;
  for (let i = 0; i < 100; i++) Sim.step(state);
  assert.ok(state.players.slice(1).every(p => !p.in.a && !p.in.p && !p.in.l && !p.in.r), 'CPU teammates stop fighting or advancing for an idle human');
  Object.assign(human, { hp: 0, lives: 0, st: 'dead', dead: true });
  Sim.step(state);
  assert.equal(state.mode, 'gameover', 'standing CPUs cannot keep the run alive after the last human runs out of lives');
}

console.log('CPU party selection, seat transfers, and class behavior ok');
