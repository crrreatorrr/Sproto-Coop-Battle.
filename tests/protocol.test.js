// Seat ownership, banked rejects, and ingress limits. No Ticket mint path.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

globalThis.window = globalThis;
require('../public/js/manifest.js');
const Sim = require('../public/js/sim.js');
require('../public/js/ai.js');
require('../public/js/net-protocol.js');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'net-protocol.js'), 'utf8');
assert.ok(!/earnTickets|apply_event|mintTicket|score\.submit/.test(src));
assert.ok(!CoopProtocol.earn && !CoopProtocol.mint && !CoopProtocol.settle);
assert.strictEqual(CoopProtocol.LIMITS.loopHz, 20);
assert.strictEqual(CoopProtocol.LIMITS.substeps, 3);
assert.strictEqual(CoopProtocol.LIMITS.simHz, 60);
assert.strictEqual(CoopProtocol.LIMITS.snapshotHz, 10);
assert.ok(CoopProtocol.LIMITS.snapshotMaxHz <= 15 && CoopProtocol.LIMITS.snapshotMaxHz >= 10);
assert.strictEqual(CoopProtocol.LIMITS.maxStateBytes, Sim.MAX_STATE_BYTES);
assert.strictEqual(CoopProtocol.LIMITS.maxSeats, 6);
assert.strictEqual(CoopProtocol.LIMITS.reconnectGraceMs, 15000);

const manifest = CoopProtocol.contentManifest(MANIFEST);
assert.strictEqual(manifest.stages.length, 12);
assert.ok(manifest.stages.every(stage => stage.oneClear && stage.phaseCount === 2 && stage.canonicalBossId && stage.length > 0));
assert.deepStrictEqual(manifest.stages.map(stage => stage.canonicalBossId).filter((id, i, all) => all.indexOf(id) === i).length, 12);
assert.strictEqual(manifest.gameId, 'sproto-coop-battle');

function banked(seed) {
  const made = CoopProtocol.createMatch({ mode: 'banked', seed: seed || 42, matchId: 'm' });
  assert.strictEqual(made.ok, true);
  return made.session;
}
function buttons(mask) {
  return CoopProtocol.unpackMask(mask);
}

{
  const session = banked();
  assert.strictEqual(session.state.stageIdx, 0);
  assert.strictEqual(session.state.god, false);
  assert.deepStrictEqual(CoopProtocol.command(session, { t: 'god' }, 0), { ok: false, reason: 'rejected' });
  assert.strictEqual(session.state.god, false);
  assert.deepStrictEqual(CoopProtocol.command(session, { t: 'stage', index: 5 }, 0), { ok: false, reason: 'rejected' });
  assert.strictEqual(session.state.stageIdx, 0);
  assert.deepStrictEqual(CoopProtocol.command(session, { t: 'state', state: { mode: 'victory' } }, 0), { ok: false, reason: 'rejected' });
  assert.deepStrictEqual(CoopProtocol.command(session, { t: 'earn', amount: 20 }, 0), { ok: false, reason: 'rejected' });
  assert.deepStrictEqual(CoopProtocol.command(session, { t: 'score', value: 1 }, 0), { ok: false, reason: 'rejected' });
  assert.strictEqual(session.state.mode, 'play');
  assert.deepStrictEqual(CoopProtocol.createMatch({ mode: 'banked', seed: 5, stage: 4 }), { ok: false, reason: 'stage' });
  const facts = CoopProtocol.terminalFacts(session);
  assert.strictEqual(facts.tickets, 0);
  assert.strictEqual(facts.scoreSubmitted, 0);
  assert.strictEqual(facts.canonicalBossId, manifest.stages[0].canonicalBossId);
  console.log('banked rejects god, stage select, state writes, earn, and score');
}

{
  const made = CoopProtocol.createMatch({ mode: 'practice', seed: 9, stage: 2, matchId: 'practice' });
  assert.strictEqual(made.ok, true);
  assert.strictEqual(made.session.state.stageIdx, 2);
  const on = CoopProtocol.command(made.session, { t: 'god' }, 0);
  assert.strictEqual(on.ok, true);
  assert.strictEqual(made.session.state.god, true);
  CoopProtocol.command(made.session, { t: 'god' }, 0);
  assert.strictEqual(made.session.state.god, false);
  const staged = CoopProtocol.command(made.session, { t: 'stage', index: 7 }, 0);
  assert.strictEqual(staged.ok, true);
  assert.strictEqual(made.session.state.stageIdx, 7);
  assert.deepStrictEqual(CoopProtocol.command(made.session, { t: 'state', state: { hp: 1 } }, 0), { ok: false, reason: 'rejected' });
  const direct = Sim.create([{ fid: 0, weapon: 0, ctrl: 'local' }, { fid: 1, weapon: 1, ctrl: 'cpu' }, { fid: 2, weapon: 2, ctrl: 'cpu' }, { fid: 3, weapon: 3, ctrl: 'cpu' }, { fid: 4, weapon: 4, ctrl: 'cpu' }, { fid: 5, weapon: 5, ctrl: 'cpu' }], 3);
  Sim.toggleGod(direct);
  assert.strictEqual(direct.god, true);
  console.log('practice god and stage select still apply; state replacement does not');
}

{
  const mask = CoopProtocol.packMask({ l: 1, r: 0, u: 1, d: 0, a: 1, j: 0, s: 1, p: 1 });
  assert.strictEqual(mask, 1 | 4 | 16 | 64 | 128);
  assert.deepStrictEqual(buttons(mask), { l: 1, r: 0, u: 1, d: 0, a: 1, j: 0, s: 1, p: 1 });
}

function seat(session, slot, device, generation) {
  const result = CoopProtocol.assignSeat(session, { accountId: 'ken', generation: generation || 1, device: device, slot: slot });
  assert.strictEqual(result.ok, true, result.reason);
  return result;
}

{
  const session = banked(11);
  const player = session.state.players[2];
  player.hp = 17;
  player.lives = 1;
  player.powers = [0, 1];
  player.st = 'down';
  player.downT = 400;
  const items = session.state.items.map(item => item.id);
  seat(session, 2, 'k1');
  assert.strictEqual(player.ctrl, 'local');
  assert.strictEqual(player.hp, 17);
  assert.strictEqual(player.lives, 1);
  assert.deepStrictEqual(player.powers, [0, 1]);
  assert.strictEqual(player.downT, 400);
  assert.deepStrictEqual(session.state.items.map(item => item.id), items);
  const stale = CoopProtocol.releaseSeat(session, { accountId: 'ken', generation: 9, slot: 2 });
  assert.strictEqual(stale.ok, false);
  assert.strictEqual(player.ctrl, 'local');
  assert.strictEqual(player.lives, 1);
  const released = CoopProtocol.releaseSeat(session, { accountId: 'ken', generation: 1, slot: 2 });
  assert.strictEqual(released.ok, true);
  assert.strictEqual(player.ctrl, 'cpu');
  assert.strictEqual(player.hp, 17);
  assert.strictEqual(player.lives, 1);
  assert.deepStrictEqual(player.powers, [0, 1]);
  assert.deepStrictEqual(session.state.items.map(item => item.id), items);
  seat(session, 2, 'k1', 2);
  assert.strictEqual(player.hp, 17);
  assert.strictEqual(player.lives, 1);
  assert.strictEqual(player.ctrl, 'local');
  const old = CoopProtocol.acceptInput(session, input(session, 1, 1, 1), 10);
  assert.strictEqual(old.reason, 'owner');
  const fresh = CoopProtocol.acceptInput(session, input(session, 1, 2, 1), 10);
  assert.strictEqual(fresh.ok, true);
  console.log('join, release, and generation takeover keep lives and items');
}

function input(session, seq, generation, mask, extra) {
  return Object.assign({
    t: 'input',
    accountId: 'ken',
    generation: generation,
    seq: seq,
    frame: session.state.t + 1,
    seats: [{ slot: 2, device: 'k1', mask: mask }],
  }, extra || {});
}

{
  const session = banked(15);
  seat(session, 2, 'k1');
  const t0 = session.state.t;
  assert.strictEqual(CoopProtocol.acceptInput(session, input(session, 1, 1, NaN), 20).reason, 'nan');
  assert.strictEqual(CoopProtocol.acceptInput(session, input(session, 1, 1, 1, { frame: NaN }), 20).reason, 'nan');
  assert.strictEqual(CoopProtocol.acceptInput(session, input(session, 1, 1, 1, { frame: t0 }), 20).reason, 'stale');
  assert.strictEqual(CoopProtocol.acceptInput(session, input(session, 1, 1, 1, { frame: t0 + 4 }), 20).reason, 'future');
  assert.strictEqual(CoopProtocol.acceptInput(session, input(session, 1, 1, 1, { accountId: 'other' }), 20).reason, 'owner');
  assert.strictEqual(CoopProtocol.acceptInput(session, input(session, 1, 1, 1, { seats: [{ slot: 1, device: 'k1', mask: 1 }] }), 20).reason, 'owner');
  const fat = input(session, 1, 1, 1, { pad: 'x'.repeat(900) });
  assert.strictEqual(CoopProtocol.acceptInput(session, fat, 20).reason, 'oversized');
  assert.strictEqual(session.state.t, t0);
  assert.strictEqual(session.state.players[2].lives, 2);
  const badLoop = CoopProtocol.stepLoop(session, [input(session, 1, 1, 1, { frame: 9 }), null, null], 30);
  assert.strictEqual(badLoop.ok, false);
  assert.strictEqual(session.state.t, t0);
  let now = 1000;
  for (let n = 1; n <= 12; n++) {
    const stepped = CoopProtocol.stepLoop(session, [input(session, n, 1, n % 2), null, null], now);
    assert.strictEqual(stepped.ok, true, stepped.reason);
  }
  const limited = CoopProtocol.stepLoop(session, [input(session, 13, 1, 1), null, null], now);
  assert.strictEqual(limited.reason, 'rate');
  const dup = CoopProtocol.stepLoop(session, [input(session, 12, 1, 1), null, null], now + 1000);
  assert.strictEqual(dup.reason, 'duplicate');
  const next = CoopProtocol.stepLoop(session, [input(session, 13, 1, 1), null, null], now + 1000);
  assert.strictEqual(next.ok, true, next.reason);
  console.log('rejected nan, stale, future, owner, oversized, rate, and duplicate');
}

{
  const session = banked(19);
  const devices = ['k1', 'k2', 'gp0', 'gp1', 'gp2', 'gp3'];
  for (let i = 0; i < 6; i++) seat(session, i, devices[i]);
  assert.strictEqual(CoopProtocol.beginEncounter(session).ok, true);
  const seats = devices.map((device, slot) => ({ slot: slot, device: device, mask: 1 }));
  const stepped = CoopProtocol.stepLoop(session, [{
    t: 'input', accountId: 'ken', generation: 1, seq: 1, frame: 1, seats: seats,
  }, null, null], 50);
  assert.strictEqual(stepped.ok, true, stepped.reason);
  let facts = CoopProtocol.participationFacts(session);
  assert.strictEqual(facts.accounts.length, 1);
  assert.strictEqual(facts.accounts[0].slots.length, 6);
  assert.strictEqual(facts.accounts[0].eligible, 1);
  assert.strictEqual(facts.accounts[0].presentAtStart, 1);
  assert.strictEqual(facts.tickets, 0);
  const phase = session.state.boss;
  facts = CoopProtocol.participationFacts(session);
  assert.strictEqual(facts.canonicalBossId, manifest.stages[0].canonicalBossId);
  assert.ok(!phase || facts.accounts.length === 1);
  console.log('one account on six seats is one participation row');
}

{
  const session = banked(23);
  CoopProtocol.beginEncounter(session);
  for (let n = 0; n < 8; n++) {
    const stepped = CoopProtocol.stepLoop(session, [null, null, null], 10 + n);
    assert.strictEqual(stepped.ok, true);
  }
  seat(session, 0, 'k1');
  CoopProtocol.stepLoop(session, [{
    t: 'input', accountId: 'ken', generation: 1, seq: 1, frame: session.state.t + 1,
    seats: [{ slot: 0, device: 'k1', mask: 1 }],
  }, null, null], 80);
  const facts = CoopProtocol.participationFacts(session);
  assert.strictEqual(facts.accounts[0].presentAtStart, 0);
  assert.strictEqual(facts.accounts[0].eligible, 0);
  console.log('late join is not present at encounter start');
}

{
  const session = banked(29);
  seat(session, 0, 'k1');
  CoopProtocol.beginEncounter(session);
  const player = session.state.players[0];
  session.state.enemies = [];
  session.state.stage.waves.forEach(wave => { wave.done = true; wave.active = false; });
  session.state.players.forEach(other => { if (other.slot !== 0) { other.st = 'dead'; other.dead = true; } });
  player.st = 'down';
  player.hp = 0;
  player.downT = 8000;
  for (let n = 0; n < 200; n++) {
    const stepped = CoopProtocol.stepLoop(session, [null, null, null], 200 + n);
    assert.strictEqual(stepped.ok, true);
  }
  const downed = CoopProtocol.participationFacts(session).accounts[0];
  assert.strictEqual(downed.afk, 0);
  assert.strictEqual(downed.eligible, 1);
  assert.ok(downed.downTicks > 0);
  console.log('a downed player is not marked AFK');
}

{
  const session = banked(31);
  seat(session, 0, 'k1');
  CoopProtocol.beginEncounter(session);
  session.state.enemies = [];
  session.state.stage.waves.forEach(wave => { wave.done = true; wave.active = false; });
  session.state.players.forEach(other => { if (other.slot !== 0) { other.st = 'dead'; other.dead = true; } });
  for (let n = 0; n < 200; n++) {
    const stepped = CoopProtocol.stepLoop(session, [null, null, null], 1);
    assert.strictEqual(stepped.ok, true, stepped.reason);
  }
  const idle = CoopProtocol.participationFacts(session).accounts[0];
  assert.strictEqual(idle.afk, 1);
  assert.strictEqual(idle.eligible, 0);
  assert.strictEqual(idle.nonNeutral, 0);
  const ended = CoopProtocol.endEncounter(session);
  assert.strictEqual(ended.tickets, 0);
  assert.strictEqual(session.encounter, null);
  console.log('sustained neutral input is AFK and ends with zero tickets');
}

{
  const cpu = banked(37);
  CoopProtocol.beginEncounter(cpu);
  CoopProtocol.stepLoop(cpu, [null, null, null], 1);
  assert.deepStrictEqual(CoopProtocol.participationFacts(cpu).accounts, []);
  console.log('cpu-only encounter has no eligible account');
}

console.log('protocol ok');
