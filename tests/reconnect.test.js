// C4 reconnect: 15s AI hold, generation bump, and input lead at 100/200 ms RTT.
'use strict';

const assert = require('assert');
const path = require('path');
const { createAuthorityMatch, OP, FINGERPRINT, PROTOCOL } = require('./browser-hub-online.cjs');

const root = path.join(__dirname, '..');
global.window = global;
const NetHub = require(path.join(root, 'public/js/net-hub.js'));

function presence(id, session, name) { return { userId: id, sessionId: session, username: name || id }; }
function hello(match, who, devices) {
  match.hello(who, { t: 'hello', protocol: PROTOCOL, fingerprint: FINGERPRINT, devices: devices, fighter: 'vamp', weapon: 'bo' });
  return match.drain();
}

{
  const match = createAuthorityMatch({ id: 'grace', privateRoom: true, seed: 7 });
  const ada = presence('acct-ada', 's1', 'ada');
  hello(match, ada, ['k1']);
  match.ready(ada);
  match.loop(1000);
  assert.strictEqual(match.state.phase, 'playing');
  const before = match.life();
  match.leave(ada);
  const parked = match.seatView()[0];
  assert.strictEqual(parked.human, 1);
  assert.strictEqual(parked.ctrl, 'cpu');
  assert.deepStrictEqual(match.life().lives, before.lives);
  assert.deepStrictEqual(match.life().hp, before.hp);
  assert.deepStrictEqual(match.life().powers, before.powers);
  for (let i = 0; i < 299; i++) match.loop(2000 + i * 50);
  assert.strictEqual(match.seatView()[0].human, 1);
  match.loop(2000 + 299 * 50);
  assert.strictEqual(match.seatView()[0].human, 0);
  assert.strictEqual(match.seatView()[0].ctrl, 'cpu');
  const after = match.life();
  assert.deepStrictEqual(after.lives, before.lives);
  assert.deepStrictEqual(after.hp, before.hp);
  assert.deepStrictEqual(after.powers, before.powers);
  console.log('15s grace parks the seat, then AI takes it without a life reset');
}

{
  const match = createAuthorityMatch({ id: 'gen', privateRoom: true, seed: 8 });
  const first = presence('acct-ada', 's1', 'ada');
  hello(match, first, ['k1', 'gp0']);
  match.ready(first);
  match.loop(1000);
  const before = JSON.stringify(match.life());
  match.leave(first);
  const second = presence('acct-ada', 's2', 'ada');
  match.hello(second, { t: 'hello', protocol: PROTOCOL, fingerprint: FINGERPRINT, devices: ['k1', 'gp0'] });
  const events = match.drain();
  const resume = events.find(row => row.op === OP.RESUME);
  assert.ok(resume, 'rejoin should resume');
  assert.strictEqual(resume.body.generation, 2);
  assert.strictEqual(resume.body.acceptClientState, 0);
  assert.strictEqual(resume.body.hostTakeover, 0);
  assert.ok(resume.body.full && resume.body.full.kind === 'sproto-coop-battle-state');
  assert.strictEqual(JSON.stringify(match.life()), before);
  match.drain();
  const stale = { t: 'input', frame: match.state.session.state.t + 1, seq: 1, seats: [{ slot: 0, device: 'k1', mask: 2 }] };
  match.input(first, stale, 1200, 80);
  const rejected = match.drain().some(row => row.body && row.body.reason === 'stale-socket');
  assert.strictEqual(rejected, true);
  console.log('a new socket bumps generation and drops the old socket');
}

{
  const match = createAuthorityMatch({ id: 'late', privateRoom: true, seed: 9 });
  const ada = presence('acct-ada', 's1', 'ada');
  hello(match, ada, ['k1']);
  match.ready(ada);
  match.loop(1000);
  for (let i = 0; i < 10; i++) match.loop(1100 + i * 50);
  const before = JSON.stringify(match.life());
  const bea = presence('acct-bea', 's2', 'bea');
  match.hello(bea, { t: 'hello', protocol: PROTOCOL, fingerprint: FINGERPRINT, devices: ['k2'] });
  match.drain();
  assert.strictEqual(JSON.stringify(match.life()), before);
  assert.strictEqual(match.seatView().filter(seat => seat.human).length, 2);
  console.log('a late join does not refill lives or items');
}

function playDelayed(oneWay) {
  const match = createAuthorityMatch({ id: 'lag-' + oneWay, privateRoom: true, seed: 11 });
  const ada = presence('acct-ada', 's1', 'ada');
  const opened = [];
  match.hello(ada, { t: 'hello', protocol: PROTOCOL, fingerprint: FINGERPRINT, devices: ['k1'], fighter: 'vamp', weapon: 'bo' });
  opened.push.apply(opened, match.drain());
  match.ready(ada);
  let clock = 0;
  let events = opened.concat(match.loop(clock));
  const outbound = [];
  const ctl = NetHub.create({
    now: () => clock,
    readMask: () => 2,
    onSend: (op, body) => { outbound.push({ at: clock + oneWay, op: op, body: body }); },
  });
  const inbound = [];
  ctl.claim('k1');
  for (const ev of events) if (ev.op === OP.WELCOME || ev.op === OP.START || ev.op === OP.SEATS || ev.op === OP.SNAPSHOT) ctl.apply(ev.op, ev.body, clock);
  ctl.apply(OP.PONG, { t: 'pong', c: clock - oneWay * 2, s: 1 }, clock);
  let accepted = 0;
  let rejected = 0;
  const reasons = {};
  for (let step = 0; step < 40; step++) {
    clock += 50;
    const due = outbound.filter(row => row.at <= clock && !row.done);
    for (const row of due) {
      row.done = true;
      if (row.op === OP.INPUT) {
        const before = match.state.out.length;
        match.input(ada, row.body, clock, JSON.stringify(row.body).length);
        const fresh = match.state.out.slice(before);
        if (fresh.some(item => item.op === OP.REJECT)) {
          rejected++;
          reasons[fresh.find(item => item.op === OP.REJECT).body.reason] = (reasons[fresh.find(item => item.op === OP.REJECT).body.reason] || 0) + 1;
        } else accepted++;
      }
    }
    events = match.loop(clock);
    for (const ev of events) inbound.push({ at: clock + oneWay, op: ev.op, body: ev.body });
    for (const ev of inbound) {
      if (ev.done || ev.at > clock) continue;
      ev.done = true;
      ctl.apply(ev.op, ev.body, clock);
    }
    ctl.pump(clock);
  }
  const slot = match.seatView().findIndex(seat => seat.device === 'k1');
  const x = match.state.session.state.players[slot].x;
  return { accepted: accepted, rejected: rejected, reasons: reasons, x: Math.round(x), tick: match.state.session.state.t, bias: ctl.state.bias, rtt: ctl.state.rtt, lead: NetHub.leadTicks(ctl.state) };
}

{
  for (const oneWay of [0, 50, 100]) {
    const result = playDelayed(oneWay);
    assert.ok(result.accepted > result.rejected, JSON.stringify(result));
    assert.ok(result.x > 80, 'expected movement at ' + oneWay + ' ms one way, got ' + JSON.stringify(result));
    console.log('input lead at ' + (oneWay * 2) + ' ms rtt', result);
  }
}

{
  const state = NetHub.createState();
  state.phase = 'playing';
  state.banked = true;
  state.serverTick = 30;
  state.serverTickAt = 1000;
  state.rtt = 200;
  state.lastSentFrame = 30;
  const frames = NetHub.planFrames(state, 1000);
  assert.strictEqual(NetHub.leadTicks(state), Math.round(200 / (1000 / 60)) - 3);
  assert.ok(frames[0] > 30);
  assert.ok(frames.length <= 3);
  console.log('200 ms plan', frames);
}
