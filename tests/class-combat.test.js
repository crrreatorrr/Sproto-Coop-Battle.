'use strict';

const assert = require('node:assert/strict');
globalThis.window = globalThis;
require('../public/js/manifest.js');
const Sim = require('../public/js/sim.js');
const Protocol = require('../public/js/net-protocol.js');

function match(classes, weapons = []) {
  const slots = Array.from({ length: Sim.SLOTS }, (_, i) => ({
    fid: i === 0 ? 0 : 1,
    ctrl: i < classes.length ? 'local' : 'none',
    classId: classes[i],
    weapon: weapons[i],
  }));
  const game = Sim.create(slots, 42);
  game.items = [];
  for (const p of game.players) Object.assign(p, { x: 80 + p.slot * 30, y: 50, inv: 0 });
  return game;
}

function advance(game, ticks) {
  for (let i = 0; i < ticks; i++) Sim.step(game);
}

function press(game, player, buttons) {
  player.in = buttons;
  Sim.step(game);
  player.in = {};
}

function enemy(game, distance, depth = 0) {
  const source = game.players[0];
  const e = { id: game.nextId++, x: source.x + distance, y: source.y + depth, z: 0,
    hp: 200, maxHp: 200, fid: 0, weapon: 0, st: 'idle', t: 0, vx: 0, vy: 0, vz: 0, face: -1, hs: 600 };
  game.enemies.push(e);
  return e;
}

{
  assert.deepEqual(Sim.WEAPONS.slice(0, 6).map(w => w.id), ['katana', 'bo', 'hammer', 'spear', 'axe', 'flail']);
  assert.deepEqual(Sim.CLASSES.map(role => role.id), ['fighter', 'mage', 'healer', 'ranged']);
  const all = [];
  for (const role of Sim.CLASSES) {
    for (let tier = 1; tier <= 13; tier++) {
      const choices = Sim.weaponChoices(role.id, tier);
      assert.equal(choices.length, tier, `${role.id} gains one weapon per clear`);
      const weapon = Sim.WEAPONS[choices[tier - 1]];
      assert.equal(weapon.classId, role.id);
      assert.equal(weapon.tier, tier);
      assert.equal(Sim.weaponFor(role.id, choices[tier - 1], tier), choices[tier - 1]);
      if (tier > 1) assert.equal(Sim.weaponFor(role.id, choices[tier - 1], tier - 1), choices[0]);
      all.push(weapon.id);
    }
  }
  assert.equal(new Set(all).size, 52);
  const mage = Sim.weaponChoices('mage', 1)[0];
  assert.equal(Sim.weaponFor('mage', Sim.weaponChoices('ranged', 1)[0]), mage);
  const game = match(['fighter'], [2]);
  const p = game.players[0];
  assert.equal(p.weapon, 2, 'the old numeric weapon IDs still load');
  p.hp = 50;
  assert.equal(Sim.setClass(p, 'mage'), true);
  assert.equal(p.weapon, mage);
  assert.equal(p.hp, 33, 'a lobby class switch scales current HP');
  assert.equal(Sim.setClass(p, 'unknown'), false);
}

{
  const damage = {};
  for (const classId of ['mage', 'healer', 'ranged']) {
    const game = match([classId, 'fighter']);
    const [p, teammate] = game.players;
    const target = enemy(game, 150, 15);
    press(game, p, { a: 1 });
    advance(game, 45);
    assert.equal(teammate.hp, 100, 'a shot passes through a teammate');
    damage[classId] = 200 - target.hp;
  }
  assert.deepEqual(damage, { mage: 19, healer: 4, ranged: 11 });
  const solo = match(['healer']);
  const target = enemy(solo, 150);
  press(solo, solo.players[0], { a: 1 });
  advance(solo, 45);
  assert.equal(target.hp, 194, 'solo Healer gets a small shot damage bonus');
}

{
  const game = match(['mage', 'healer', 'ranged']);
  assert.deepEqual(game.players.slice(0, 3).map(p => p.hp), [65, 80, 90]);
  for (const p of [game.players[0], game.players[2]]) {
    game.projs.push({ id: game.nextId++, kind: 'boss', x: p.x, y: p.y, z: 20,
      vx: 1, vy: 0, vz: 0, t: 0, life: 30, enemy: true, dmg: 10 });
  }
  Sim.step(game);
  assert.equal(game.players[0].hp, 52, 'Mage takes more of the same hit');
  assert.equal(game.players[2].hp, 80);
}

{
  const game = match(['mage']);
  const p = game.players[0];
  const targets = [enemy(game, 75), enemy(game, 125), enemy(game, 170), enemy(game, 210)];
  press(game, p, { p: 1 });
  advance(game, 62);
  assert.deepEqual(targets.map(e => e.hp), [164, 164, 164, 200], 'Arcane Orb pierces three distinct targets');
  assert.ok(p.abilityCd > 0);
  press(game, p, { p: 1 });
  assert.equal(p.st, 'idle', 'the ability cannot start during cooldown');
  p.powers.push(0);
  press(game, p, { d: 1, s: 1 });
  assert.equal(p.powers.length, 0, 'Down + Special still uses a saved power');
}

{
  const game = match(['ranged']);
  const p = game.players[0];
  const targets = [enemy(game, 75), enemy(game, 125), enemy(game, 170)];
  press(game, p, { p: 1 });
  advance(game, 11);
  const loaded = Sim.importState(Sim.exportState(game));
  advance(game, 40);
  advance(loaded, 40);
  assert.deepEqual(Sim.snapshot(loaded), Sim.snapshot(game), 'rollback preserves the shot windup and cooldown');
  assert.deepEqual(targets.map(e => e.hp), [179, 179, 200], 'Power Shot pierces two targets');
}

{
  const { session } = Protocol.createMatch({ mode: 'banked', seed: 16 });
  const healerSeat = { slot: 0, accountId: 'healer', generation: 1, device: 'k1' };
  const allySeat = { slot: 1, accountId: 'ally', generation: 1, device: 'gp0' };
  assert.equal(Protocol.assignSeat(session, healerSeat).ok, true);
  assert.equal(Protocol.assignSeat(session, allySeat).ok, true);
  assert.equal(Protocol.selectLoadout(session, { ...healerSeat, classId: 'healer' }, 1).ok, true);
  assert.equal(Protocol.selectLoadout(session, { ...allySeat, classId: 'mage' }, 1).ok, true);
  const [healer, ally] = session.state.players;
  healer.hp = 40;
  ally.hp = 53;
  const ability = { t: 'input', frame: 1, accountId: healerSeat.accountId, generation: 1, seq: 1,
    seats: [{ slot: healerSeat.slot, device: healerSeat.device, mask: Protocol.packMask({ p: 1 }) }] };
  const spoof = { ...ability, seats: [{ slot: 1, device: 'gp0', mask: 128 }] };
  assert.equal(Protocol.stepLoop(session, [spoof, null, null], 0).reason, 'owner');
  assert.equal(Protocol.stepLoop(session, [ability, null, null], 0).ok, true);
  for (let i = 1; i < 5; i++) assert.equal(Protocol.stepLoop(session, [null, null, null], i * 50).ok, true);
  assert.equal(ally.hp, 65, 'the authoritative sim heals a different account and caps at max HP');
  assert.equal(healer.hp, 40, 'a wounded ally takes priority over self heal');
  assert.equal(healer.abilityCd, 300);
  const view = Protocol.snapshotEnvelope(session).state;
  assert.equal(view.players[0].cl, 'healer');
  assert.equal(view.players[0].ac, 300);
  assert.ok(view.fx.some(f => f.k === 'class-heal'));
}

{
  const game = match(['healer', 'fighter']);
  const [p, ally] = game.players;
  p.hp = 32;
  Object.assign(ally, { x: p.x + 80, hp: 0, st: 'down', downT: 300 });
  press(game, p, { p: 1 });
  advance(game, 16);
  assert.equal(p.hp, 56, 'Healer can self-heal when no living ally needs it');
  assert.equal(ally.hp, 0, 'Mend cannot stand up a downed ally');
}

{
  const hit = id => {
    const equipped = Sim.WEAPONS.findIndex(w => w.id === id);
    const game = match(['fighter'], [equipped]);
    const target = enemy(game, 24);
    press(game, game.players[0], { a: 1 });
    while (target.hp === 200 && game.t < 20) Sim.step(game);
    return { tick: game.t, damage: 200 - target.hp };
  };
  const scimitar = hit('scimitar');
  const mace = hit('mace');
  assert.ok(scimitar.tick < mace.tick);
  assert.ok(scimitar.damage < mace.damage);
}

console.log('class combat, 52 weapon tiers, deterministic shots, and authoritative co-op healing ok');
