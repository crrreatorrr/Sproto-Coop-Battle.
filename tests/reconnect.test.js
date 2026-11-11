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
  // The match keeps running for those 15 s and the team may take hits in its first wave, so the
  // check is that nothing was refilled: no life or health went up when the AI took the seat.
  const after = match.life();
  after.lives.forEach((n, i) => assert.ok(n <= before.lives[i], 'lives were not refilled'));
  after.hp.forEach((n, i) => assert.ok(n <= before.hp[i], 'health was not refilled'));
  assert.strictEqual(after.hp[0] > 0 && after.lives[0], before.lives[0], 'the parked seat kept its lives');
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

// ZK-02: a hub deploy restarts Nakama. The client keeps retrying coop.resume with backoff
// instead of one try against the server that is going down, honours a maintenance retryAt,
// ends a timed-out reconnect cleanly, and does not let a late WELCOME/RESUME rewind `ended`.
{
  const state = NetHub.createState();
  state.phase = 'playing';
  NetHub.applyMessage(state, OP.END, { t: 'end', reason: 'clear' }, 10);
  assert.strictEqual(state.phase, 'ended');
  NetHub.applyMessage(state, OP.WELCOME, { t: 'welcome', phase: 'playing', generation: 3, yours: ['k1'], seats: [] }, 20);
  assert.strictEqual(state.phase, 'ended', 'late WELCOME must not rewind ended');
  NetHub.applyMessage(state, OP.RESUME, { t: 'resume', phase: 'playing', generation: 4, yours: ['k1'], seats: [] }, 30);
  assert.strictEqual(state.phase, 'ended', 'late RESUME must not rewind ended');
  NetHub.applyMessage(state, OP.START, { t: 'start', seats: [] }, 40);
  assert.strictEqual(state.phase, 'ended', 'late START must not rewind ended');
  assert.notStrictEqual(state.generation, 4);
  console.log('a late WELCOME/RESUME/START does not rewind an ended phase');
}

{
  const delays = [0, 1, 2, 3, 4, 5, 9].map(n => NetHub.resumeDelay(n));
  assert.deepStrictEqual(delays, [1000, 2000, 4000, 8000, 15000, 15000, 15000]);
  assert.strictEqual(NetHub.RESUME_WINDOW_MS, 180000);
}

function rtError(code, extra) {
  const err = new Error(code);
  err.code = code;
  return Object.assign(err, extra || {});
}

function restartHarness(rpcImpl, opts) {
  opts = opts || {};
  const h = { clock: 0, wall: 1800000000000, timers: [], calls: [], handles: [] };
  const fakeHandle = matchId => {
    const handle = { matchId: matchId, sent: [], left: 0 };
    handle.onMessage = fn => { handle.deliver = (op, body) => fn(Object.assign({ op: op }, body)); };
    handle.onClose = fn => { handle.close = fn; };
    handle.onRejoin = () => {};
    handle.send = (op, body) => handle.sent.push({ op: op, body: body });
    handle.leave = async () => { handle.left += 1; };
    return handle;
  };
  const transport = {
    rpc: (id, body) => {
      h.calls.push({ id: id, body: body, at: h.clock });
      return Promise.resolve().then(() => rpcImpl(id, body, h.calls.filter(c => c.id === id).length, h));
    },
    joinMatch: async matchId => {
      if (opts.joinFails && opts.joinFails(matchId, h)) throw rtError('match_not_found');
      const handle = fakeHandle(matchId);
      h.handles.push(handle);
      return handle;
    },
    disconnect: () => {},
  };
  h.ctl = NetHub.create({
    now: () => h.clock,
    wallNow: () => h.wall + h.clock,
    transport: transport,
    keepSocket: true,
    setTimeout: (fn, ms) => { const t = { at: h.clock + Math.max(0, ms | 0), fn: fn, dead: false }; h.timers.push(t); return t; },
    clearTimeout: t => { if (t) t.dead = true; },
  });
  h.flush = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
  h.advance = async ms => {
    const end = h.clock + ms;
    for (;;) {
      const due = h.timers.filter(t => !t.dead && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.dead = true;
      h.clock = Math.max(h.clock, due.at);
      due.fn();
      await h.flush();
    }
    h.clock = end;
    await h.flush();
  };
  h.rpcTimes = () => h.calls.filter(c => c.id === 'coop.resume').map(c => c.at);
  h.start = async () => {
    h.ctl.claim('k1');
    h.ctl.state.matchId = 'm1';
    await h.ctl.rejoin();
    const handle = h.handles[h.handles.length - 1];
    handle.deliver(OP.WELCOME, { t: 'welcome', phase: 'playing', generation: 1, yours: ['k1'], seats: [{ slot: 0, accountId: 'acct-ada', device: 'k1', human: 1, ctrl: 'local' }] });
    assert.strictEqual(h.ctl.view().phase, 'playing');
    return handle;
  };
  return h;
}

(async () => {
  {
    // Server-shutdown END: back off 1s, 2s, 4s, 8s until the restarted server answers.
    const h = restartHarness((id, body, n) => {
      if (id !== 'coop.resume') return {};
      assert.strictEqual(body.matchId, 'm1');
      if (n < 4) throw rtError('rt_disconnected');
      return { matchId: 'm2', rewards: 0, hostTakeover: 0 };
    });
    const first = await h.start();
    first.deliver(OP.END, { t: 'end', reason: 'server_shutdown', resume: 'server', matchId: 'm1' });
    await h.flush();
    assert.deepStrictEqual(h.rpcTimes(), [], 'no resume against the server that is going down');
    let view = h.ctl.view();
    assert.strictEqual(view.phase, 'reconnecting');
    assert.strictEqual(view.restarting, true);
    assert.ok(/Server restarting/.test(view.message), view.message);
    assert.strictEqual(view.resumeMs, 1000);
    await h.advance(500);
    assert.strictEqual(h.ctl.view().resumeMs, 500, 'countdown to the next try');
    await h.advance(20000);
    assert.deepStrictEqual(h.rpcTimes(), [1000, 3000, 7000, 15000]);
    view = h.ctl.view();
    assert.strictEqual(view.restarting, false);
    assert.strictEqual(view.matchId, 'm2');
    assert.strictEqual(h.handles.length, 2);
    h.handles[1].deliver(OP.RESUME, { t: 'resume', phase: 'playing', generation: 2, yours: ['k1'], seats: [] });
    assert.strictEqual(h.ctl.view().phase, 'playing', 'the resumed match is not blocked by the old END');
    // The old match's socket close arrives late. It must not clobber the new match.
    first.close('rejoin_failed');
    await h.advance(30000);
    assert.strictEqual(h.rpcTimes().length, 4);
    assert.strictEqual(h.ctl.view().phase, 'playing');
    console.log('server restart: coop.resume backs off 1/2/4/8 s and rejoins');
  }

  {
    // The restart never finishes: give up after the window with the existing message.
    const h = restartHarness(id => { if (id === 'coop.resume') throw rtError('rt_disconnected'); return {}; });
    const first = await h.start();
    first.deliver(OP.END, { t: 'end', reason: 'server_shutdown', resume: 'server', matchId: 'm1' });
    await h.advance(240000);
    const times = h.rpcTimes();
    assert.deepStrictEqual(times.slice(0, 6), [1000, 3000, 7000, 15000, 30000, 45000]);
    assert.ok(times[times.length - 1] <= 180000, 'no try after the window: ' + times);
    assert.ok(times.length >= 14 && times.length <= 15, 'tries ' + times.length);
    const view = h.ctl.view();
    assert.strictEqual(view.restarting, false);
    assert.strictEqual(view.phase, 'ended');
    assert.strictEqual(view.message, 'Server checkpoint could not resume. This tab did not become host.');
    assert.strictEqual(view.offerPractice, true);
    console.log('server restart: gives up after ' + times.length + ' tries in 3 minutes');
  }

  {
    // While the hub drains, coop.resume says maintenance with retryAt: wait until then.
    const h = restartHarness((id, body, n, hh) => {
      if (id !== 'coop.resume') return {};
      if (n === 1) throw rtError('maintenance', { retryAt: hh.wall + hh.clock + 40000 });
      return { matchId: 'm3' };
    });
    const first = await h.start();
    first.deliver(OP.END, { t: 'end', reason: 'server_shutdown', resume: 'server', matchId: 'm1' });
    await h.advance(1000);
    assert.deepStrictEqual(h.rpcTimes(), [1000]);
    assert.strictEqual(h.ctl.view().resumeMs, 40000, 'waits for retryAt, not 2 s');
    await h.advance(39999);
    assert.deepStrictEqual(h.rpcTimes(), [1000]);
    await h.advance(1);
    assert.deepStrictEqual(h.rpcTimes(), [1000, 41000]);
    assert.strictEqual(h.ctl.view().matchId, 'm3');
    console.log('maintenance retryAt is honoured');
  }

  {
    // retryAt in unix seconds, past the 3 minute window: the window stretches to reach it.
    const h = restartHarness((id, body, n, hh) => {
      if (id !== 'coop.resume') return {};
      if (n === 1) throw rtError('maintenance', { retryAt: Math.floor((hh.wall + hh.clock) / 1000) + 300 });
      return { matchId: 'm4' };
    });
    const first = await h.start();
    first.deliver(OP.END, { t: 'end', reason: 'server_shutdown', resume: 'server', matchId: 'm1' });
    await h.advance(400000);
    assert.deepStrictEqual(h.rpcTimes(), [1000, 301000]);
    assert.strictEqual(h.ctl.view().matchId, 'm4');
    console.log('maintenance retryAt in seconds extends the window');
  }

  {
    // An explicit leave stops the retries.
    const h = restartHarness(id => { if (id === 'coop.resume') throw rtError('rt_disconnected'); return {}; });
    const first = await h.start();
    first.deliver(OP.END, { t: 'end', reason: 'server_shutdown', resume: 'server', matchId: 'm1' });
    await h.advance(1500);
    await h.ctl.leave();
    await h.advance(60000);
    assert.deepStrictEqual(h.rpcTimes(), [1000]);
    assert.strictEqual(h.ctl.view().restarting, false);
    assert.notStrictEqual(h.ctl.view().phase, 'reconnecting');
    console.log('leave stops the resume retries');
  }

  {
    // A final answer from the server (the run cannot resume) stops at once.
    const h = restartHarness(id => { if (id === 'coop.resume') throw rtError('match_finished'); return {}; });
    const first = await h.start();
    first.deliver(OP.END, { t: 'end', reason: 'server_shutdown', resume: 'server', matchId: 'm1' });
    await h.advance(60000);
    assert.deepStrictEqual(h.rpcTimes(), [1000]);
    assert.strictEqual(h.ctl.view().phase, 'ended');
    assert.strictEqual(h.ctl.view().message, 'Server checkpoint could not resume. This tab did not become host.');
    console.log('a final resume error stops the retries');
  }

  {
    // The SDK reconnects but the match is gone (match_not_found -> rejoin_failed): resume it.
    let joins = 0;
    const h = restartHarness((id, body) => {
      if (id !== 'coop.resume') return {};
      assert.strictEqual(body.matchId, 'm1');
      return { matchId: 'm5' };
    }, { joinFails: () => { joins += 1; return joins === 2; } });
    const first = await h.start();
    first.close('rejoin_failed');
    await h.flush();
    let view = h.ctl.view();
    assert.strictEqual(view.phase, 'reconnecting');
    assert.strictEqual(view.restarting, true);
    assert.strictEqual(view.reconnectMs, 0);
    await h.advance(1000);
    assert.deepStrictEqual(h.rpcTimes(), [1000]);
    // join of the resumed match fails once with match_not_found; the next try succeeds.
    assert.strictEqual(h.ctl.view().restarting, true);
    await h.advance(2000);
    assert.deepStrictEqual(h.rpcTimes(), [1000, 3000]);
    view = h.ctl.view();
    assert.strictEqual(view.restarting, false);
    assert.strictEqual(view.matchId, 'm5');
    console.log('rejoin_failed after a reconnect resumes the last match');
  }

  {
    // A plain drop: the 15 s hold expires, and the session ends instead of RECONNECTING 0s forever.
    const h = restartHarness(() => ({}));
    const first = await h.start();
    h.clock = 100;
    first.close('socket');
    await h.flush();
    assert.strictEqual(h.ctl.view().phase, 'reconnecting');
    assert.strictEqual(h.ctl.view().reconnectMs, 15000);
    await h.advance(15000);
    const view = h.ctl.view();
    assert.strictEqual(view.phase, 'ended');
    assert.strictEqual(view.endReason, 'reconnect_timeout');
    assert.strictEqual(view.reconnectMs, 0);
    assert.strictEqual(view.offerPractice, true);
    assert.deepStrictEqual(h.rpcTimes(), []);
    console.log('reconnect expiry ends the session cleanly');
  }

  {
    // Same expiry when timers are throttled: pump notices it.
    const h = restartHarness(() => ({}));
    const first = await h.start();
    first.close('socket');
    h.timers.forEach(t => { t.dead = true; });
    h.clock = 15001;
    h.ctl.pump(15001);
    assert.strictEqual(h.ctl.view().phase, 'ended');
    console.log('pump ends an expired reconnect');
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
