// C4 seat ownership: a client submits only its devices, and the server keeps lives.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createAuthorityMatch, OP, FINGERPRINT, PROTOCOL } = require('./browser-hub-online.cjs');

const root = path.join(__dirname, '..');
global.window = global;
const NetHub = require(path.join(root, 'public/js/net-hub.js'));

function presence(id, session, name) { return { userId: id, sessionId: session, username: name || id }; }
function hello(match, who, devices, extra) {
  const msg = Object.assign({ t: 'hello', protocol: PROTOCOL, fingerprint: FINGERPRINT, devices: devices }, extra || {});
  match.hello(who, msg);
  return match.drain();
}

{
  const src = fs.readFileSync(path.join(root, 'public/js/net-hub.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'public/js/main.js'), 'utf8');
  assert.ok(!src.includes('importState'));
  assert.ok(!src.includes('earnTickets') && !src.includes('reportEvent') && !src.includes('submitScore') && !src.includes('tickets.earn'));
  assert.ok(!main.includes('earnTickets') && !main.includes('reportEvent') && !main.includes('submitScore'));
  assert.ok(main.includes("['LOCAL PLAY', 'HOST ONLINE', 'JOIN ONLINE']"));
  assert.strictEqual(NetHub.FINGERPRINT, FINGERPRINT);
  assert.strictEqual(NetHub.PROTOCOL, PROTOCOL);
  console.log('client has no restart import and no economy RPC');
}

{
  const state = NetHub.createState();
  state.accountId = 'acct-ada';
  state.yours = ['k1', 'k2'];
  state.seats = [
    { slot: 0, accountId: 'acct-ada', device: 'k1', human: 1, generation: 1, fighter: 0, weapon: 0, ctrl: 'local', lives: 2, hp: 90, name: 'ada' },
    { slot: 1, accountId: 'acct-ada', device: 'k2', human: 1, generation: 1, fighter: 1, weapon: 1, ctrl: 'local', lives: 2, hp: 80, name: 'ada' },
    { slot: 2, accountId: 'acct-bea', device: 'k1', human: 1, generation: 1, fighter: 2, weapon: 2, ctrl: 'local', lives: 2, hp: 70, name: 'bea' },
  ];
  const body = NetHub.buildInput(state, 4, { k1: 2, k2: 16, gp0: 1 });
  assert.deepStrictEqual(body.seats.map(row => row.slot), [0, 1]);
  assert.ok(!body.seats.some(row => row.slot === 2));
  assert.strictEqual(body.seq, 1);
  assert.strictEqual(body.t, 'input');
  const forged = NetHub.buildInput(state, 5, { k1: 999 });
  assert.strictEqual(forged.seats[0].mask, 0);
  console.log('client input keeps owned seats and clamps the mask');
}

{
  const match = createAuthorityMatch({ id: 'own', privateRoom: true, seed: 3 });
  const ada = presence('acct-ada', 's1', 'ada');
  const bea = presence('acct-bea', 's2', 'bea');
  const before = JSON.stringify(match.life());
  hello(match, ada, ['k1', 'k2'], { fighter: 'sproto3106', weapon: 'katana' });
  hello(match, bea, ['k1']);
  assert.strictEqual(JSON.stringify(match.life()), before);
  assert.strictEqual(match.seatView().filter(seat => seat.human).length, 3);
  match.ready(ada);
  match.ready(bea);
  match.loop(1000);
  assert.strictEqual(match.state.phase, 'playing');
  const forged = { t: 'input', frame: match.state.session.state.t + 1, seq: 1, seats: [{ slot: 2, device: 'k1', mask: 1 }] };
  match.input(ada, forged, 1100, JSON.stringify(forged).length);
  const stepped = match.loop(1100);
  const reasons = stepped.filter(row => row.op === OP.REJECT).map(row => row.body.reason);
  assert.ok(reasons.indexOf('owner') >= 0, 'forged seat should be owner, got ' + reasons.join(','));
  match.command(ada);
  assert.strictEqual(match.state.session.state.god, false);
  const command = match.drain();
  assert.ok(command.some(row => row.body && row.body.reason === 'rejected'));
  assert.ok(command.every(row => row.body.rewards === 0));
  console.log('server rejects a foreign seat and god, and does not refill lives');
}

{
  const match = createAuthorityMatch({ id: 'full', privateRoom: true, seed: 4 });
  const ada = presence('acct-ada', 's1', 'ada');
  hello(match, ada, ['k1', 'k2', 'gp0', 'gp1']);
  assert.strictEqual(match.seatView().filter(seat => seat.human).length, 4);
  const bea = presence('acct-bea', 's2', 'bea');
  const rejected = hello(match, bea, ['k1']).some(row => row.body && row.body.reason === 'match_full');
  assert.strictEqual(rejected, true);
  assert.strictEqual(match.seatView().filter(seat => seat.human).length, 4);
  console.log('four seats stay four when another account arrives');
}

{
  const state = NetHub.createState();
  const now = 5000;
  NetHub.applyMessage(state, OP.SNAPSHOT, { kind: 'sproto-coop-battle-snapshot', restart: 1, tick: 9, state: { players: [{ s: 0 }], si: 3 } }, now);
  assert.strictEqual(state.snapshot, null);
  assert.strictEqual(state.importedRestart, 1);
  NetHub.applyMessage(state, OP.RESUME, {
    t: 'resume', generation: 2, phase: 'playing', yours: ['k1'], tick: 12, acceptClientState: 0,
    full: { kind: 'sproto-coop-battle-state', version: 1, state: { players: [] } },
    seats: [{ slot: 0, accountId: 'acct-ada', device: 'k1', human: 1, generation: 2, ctrl: 'local', fighter: 0, weapon: 0, lives: 1, hp: 40, name: 'ada' }],
    snapshot: { kind: 'sproto-coop-battle-snapshot', restart: 0, tick: 12, state: { players: [{ s: 0, hp: 40, l: 1 }], si: 0, mode: 'play' } },
    rewards: 20, hostTakeover: 1,
  }, now);
  assert.strictEqual(state.sawFull, true);
  assert.strictEqual(state.importedRestart, 1);
  assert.strictEqual(state.rewards, 0);
  assert.strictEqual(state.hostTakeover, 0);
  assert.strictEqual(state.acceptClientState, 0);
  assert.strictEqual(state.snapshot.players[0].hp, 40);
  console.log('resume full state is ignored and rewards stay 0');
}
