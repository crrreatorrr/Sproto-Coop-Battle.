// Optional wire savings in net-protocol.js: snapshot deltas and input batches. A delta applied to
// its base must give exactly the full envelope's JSON, on real fights, after a JSON round trip.
// The client's own patcher (net-hub.js) must agree with the bundle's.
'use strict';

const assert = require('assert');
const path = require('path');

global.window = globalThis;
const pub = path.join(__dirname, '..', 'public', 'js');
for (const file of ['manifest', 'combat', 'sim', 'ai', 'net-protocol']) require(path.join(pub, file + '.js'));
const Sim = globalThis.Sim, P = globalThis.CoopProtocol;
const NetHub = require(path.join(pub, 'net-hub.js'));
const json = v => JSON.parse(JSON.stringify(v));

function envelope(state, loop) {
  return { kind: P.SNAPSHOT_KIND, protocol: P.PROTOCOL_VERSION, gameId: P.GAME_ID, matchId: 'm1',
    tick: state.t, loop, hz: P.LIMITS.snapshotHz, restart: 0, state: Sim.snapshot(state) };
}
function drive(state, t) {
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    if (p.ctrl === 'cpu') continue;
    p.in = { l: 0, r: t % 100 < 70 ? 1 : 0, u: i % 2 === 0 && t % 30 < 8 ? 1 : 0, d: i % 2 === 1 && t % 30 < 8 ? 1 : 0,
      a: t % 12 === i ? 1 : 0, j: t % 80 === i * 3 ? 1 : 0, s: t % 200 === i ? 1 : 0, p: 0 };
  }
}

{
  let pairs = 0, full = 0, delta = 0;
  for (const [kind, stage, seed] of [['local', 0, 3], ['mixed', 4, 5], ['local', 8, 9], ['local', 12, 11]]) {
    const slots = [0, 1, 2, 3].map(i => ({ fid: i, weapon: i, ctrl: kind === 'local' || i < 2 ? 'local' : 'cpu', name: 'P' + (i + 1) }));
    const state = Sim.create(slots, seed, stage, { cpuParty: true });
    let prev = null;
    for (let t = 0; t < 4000 && state.mode !== 'gameover' && state.mode !== 'victory'; t++) {
      drive(state, t);
      Sim.step(state);
      if (t % 6) continue;
      const next = json(envelope(state, t / 3));
      if (prev) {
        const made = P.snapshotDelta(prev, next);
        assert.strictEqual(made.ok, true);
        const wire = json(made.delta);
        const back = P.applySnapshotDelta(json(prev), wire);
        assert.strictEqual(back.ok, true, back.reason);
        assert.deepStrictEqual(back.envelope, next, 'stage ' + (stage + 1) + ' tick ' + state.t);
        assert.strictEqual(JSON.stringify(back.envelope.state), JSON.stringify(next.state), 'same JSON, same key order');
        const client = NetHub.applySnapshotDelta(json(prev.state), wire.d);
        assert.deepStrictEqual(client, next.state, 'client patcher agrees');
        full += JSON.stringify(next).length;
        delta += JSON.stringify(wire).length;
        pairs++;
      }
      prev = next;
    }
  }
  assert.ok(pairs > 1500, 'pairs ' + pairs);
  const ratio = delta / full;
  assert.ok(ratio < 0.5, 'deltas are under half of full snapshots: ' + ratio.toFixed(3));
  console.log('snapshot deltas exact over ' + pairs + ' real snapshot pairs; ' + (100 * ratio).toFixed(1) + '% of full bytes');
}

{
  // Raw sim snapshots (not JSON round-tripped) diff to the same JSON as their wire form.
  const state = Sim.create(Sim.partySlots(globalThis.MANIFEST), 21, 0, { cpuParty: true });
  const a = envelope(state, 2);
  for (let i = 0; i < 30; i++) Sim.step(state);
  const b = envelope(state, 4);
  const back = P.applySnapshotDelta(json(a), json(P.snapshotDelta(a, b).delta));
  assert.deepStrictEqual(back.envelope, json(b));
  // Unchanged state is a null delta.
  assert.strictEqual(P.snapshotDelta(b, b).delta.d, null);
  assert.deepStrictEqual(P.applySnapshotDelta(json(b), json(P.snapshotDelta(b, b).delta)).envelope, json(b));
  // A wrong or missing base is refused, never guessed.
  const d = json(P.snapshotDelta(a, b).delta);
  assert.strictEqual(P.applySnapshotDelta(json(b), d).reason, 'base');
  assert.strictEqual(P.applySnapshotDelta(Object.assign(json(a), { matchId: 'm2' }), d).reason, 'base');
  assert.strictEqual(P.snapshotDelta(a, Object.assign(json(b), { matchId: 'm2' })).reason, 'base');
  assert.strictEqual(P.applySnapshotDelta(json(a), Object.assign({}, d, { d: { o: { __proto__x: 1 } } })).reason, 'delta');
  assert.strictEqual(P.applySnapshotDelta(json(a), JSON.parse('{"kind":"' + P.DELTA_KIND + '","matchId":"m1","base":2,"baseTick":' + a.tick + ',"d":{"o":{"__proto__":{"r":{"polluted":1}}}}}')).reason, 'delta');
  assert.strictEqual({}.polluted, undefined);
  assert.strictEqual(P.applySnapshotDelta(json(a), Object.assign({}, d, { d: { a: { 0: { r: 1 } } } })).reason, 'delta', 'array patch on an object');
  assert.strictEqual(P.applySnapshotDelta(json(a), Object.assign({}, d, { d: { o: { players: { a: { 9: { r: 1 } } } } } })).reason, 'delta', 'index past the length');
  // The base is never mutated (the client keeps it for interpolation).
  const base = json(a), frozen = JSON.stringify(base);
  P.applySnapshotDelta(base, d);
  assert.strictEqual(JSON.stringify(base), frozen);
  console.log('snapshot delta refuses wrong bases and malformed patches, and never mutates the base');
}

{
  const one = { t: 'input', accountId: 'ken', generation: 1, seq: 1, frame: 5, seats: [{ slot: 0, device: 'k1', mask: 2 }] };
  const two = Object.assign({}, one, { seq: 2, frame: 6 });
  const three = Object.assign({}, one, { seq: 3, frame: 7 });
  const split = P.splitInputBatch({ t: 'inputs', batch: [one, two, three] });
  assert.strictEqual(split.ok, true);
  assert.deepStrictEqual(split.inputs, [one, two, three]);
  assert.strictEqual(P.splitInputBatch({ t: 'inputs', batch: [] }).reason, 'batch');
  assert.strictEqual(P.splitInputBatch({ t: 'inputs', batch: [one, two, three, Object.assign({}, one, { frame: 8 })] }).reason, 'batch');
  assert.strictEqual(P.splitInputBatch({ t: 'inputs', batch: [two, one] }).reason, 'frame');
  assert.strictEqual(P.splitInputBatch({ t: 'inputs', batch: [Object.assign({}, one, { t: 'god' })] }).reason, 'schema');
  assert.strictEqual(P.splitInputBatch({ t: 'inputs', batch: [one], pad: 'x'.repeat(2100) }).reason, 'oversized');
  assert.strictEqual(P.splitInputBatch({ t: 'input' }).reason, 'schema');
  // Each split item still goes through acceptInput as if sent alone.
  const session = P.createMatch({ mode: 'banked', seed: 9, matchId: 'm' }).session;
  assert.strictEqual(P.assignSeat(session, { accountId: 'ken', generation: 1, device: 'k1', slot: 0 }).ok, true);
  const frames = [1, 2, 3].map(i => Object.assign({}, one, { seq: i, frame: session.state.t + i }));
  const loop = P.stepLoop(session, P.splitInputBatch({ t: 'inputs', batch: frames }).inputs, 1000);
  assert.strictEqual(loop.ok, true, loop.reason);
  const replay = P.stepLoop(session, P.splitInputBatch({ t: 'inputs', batch: frames }).inputs, 2000);
  assert.strictEqual(replay.ok, false, 'a replayed batch is refused by the same frame and seq checks');
  console.log('input batches split into ordinary per-substep input messages');
}

{
  // The client takes a delta only on top of the exact snapshot it was made from.
  const state = Sim.create(Sim.partySlots(globalThis.MANIFEST), 33, 0, { cpuParty: true });
  const a = json(envelope(state, 2));
  for (let i = 0; i < 6; i++) Sim.step(state);
  const b = json(envelope(state, 4));
  for (let i = 0; i < 6; i++) Sim.step(state);
  const c = json(envelope(state, 6));
  const view = NetHub.createState();
  NetHub.applyMessage(view, NetHub.OP.SNAPSHOT, a, 100);
  NetHub.applyMessage(view, NetHub.OP.SNAPSHOT, json(P.snapshotDelta(a, b).delta), 200);
  assert.deepStrictEqual(view.snapshot, b.state);
  assert.deepStrictEqual(view.prevSnapshot, a.state, 'the previous render is kept, unpatched, for interpolation');
  assert.strictEqual(view.serverTick, b.tick);
  // A delta from a snapshot this client never had (a missed message, a late join) is dropped.
  NetHub.applyMessage(view, NetHub.OP.SNAPSHOT, json(P.snapshotDelta(a, c).delta), 300);
  assert.strictEqual(view.deltaMisses, 1);
  assert.deepStrictEqual(view.snapshot, b.state);
  NetHub.applyMessage(view, NetHub.OP.SNAPSHOT, json(P.snapshotDelta(b, c).delta), 400);
  assert.deepStrictEqual(view.snapshot, c.state);
  const bad = json(P.snapshotDelta(c, c).delta);
  bad.d = { o: { players: { a: { 99: { r: 1 } } } } };
  NetHub.applyMessage(view, NetHub.OP.SNAPSHOT, bad, 500);
  assert.strictEqual(view.deltaMisses, 2, 'a malformed delta is dropped');
  assert.deepStrictEqual(view.snapshot, c.state);
  console.log('client applies deltas on their exact base only and waits for a full snapshot otherwise');
}
