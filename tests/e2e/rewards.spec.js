// C5: one account is one award. The client cannot mint. Live Nakama checks
// the balance and rejects a forged boss clear. C5_LIVE=1 talks to NAKAMA_URL.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { root, artifactDir, hardware, writeSummary } = require('../fixtures/c5-browser.cjs');

const out = artifactDir();
const REASON = 'srv_coop_boss_clear';
const PAY = 20;

function loadProtocol() {
  const sandbox = { console: { log() {} } };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const file of ['public/js/manifest.js', 'public/js/sim.js', 'public/js/ai.js', 'public/js/net-protocol.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
  }
  return sandbox.CoopProtocol;
}

function clientCannotMint() {
  const files = ['public/js/main.js', 'public/js/hub-link.js', 'public/js/net-hub.js', 'public/js/net.js', 'public/js/net-protocol.js'];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(!text.includes('earnTickets'), file);
    // The one allowed event is the Marina Anchor Relic report in hub-link.js. It pays no Tickets.
    const events = text.split('reportEvent').length - 1;
    const relic = text.split("reportEvent('coop.stage_clear', body, key)").length - 1;
    assert.strictEqual(events, file === 'public/js/hub-link.js' ? 1 : 0, file);
    assert.strictEqual(relic, events, file);
    assert.ok(!text.includes('submitScore'), file);
    assert.ok(!text.includes('tickets.earn'), file);
    assert.ok(!text.includes(REASON), file);
  }
  const CoopProtocol = loadProtocol();
  const session = CoopProtocol.createMatch({ mode: 'banked', seed: 3, matchId: 'four-seats' }).session;
  const devices = ['k1', 'k2', 'gp0', 'gp1'];
  for (let slot = 0; slot < 4; slot++) {
    assert.strictEqual(CoopProtocol.assignSeat(session, { slot, accountId: 'acct-ada', device: devices[slot], generation: 1 }).ok, true);
  }
  assert.strictEqual(CoopProtocol.beginEncounter(session).ok, true);
  const moved = CoopProtocol.stepLoop(session, [{
    t: 'input', accountId: 'acct-ada', generation: 1, frame: 1, seq: 1,
    seats: devices.map((device, slot) => ({ slot, device, mask: slot === 0 ? 2 : 0 })),
  }, null, null], 1000);
  assert.strictEqual(moved.ok, true, moved.reason);
  const facts = CoopProtocol.participationFacts(session);
  assert.strictEqual(facts.accounts.length, 1);
  assert.strictEqual(facts.accounts[0].slots.length, 4);
  assert.strictEqual(facts.tickets, 0);
  assert.strictEqual(facts.scoreSubmitted, 0);
  const again = CoopProtocol.endEncounter(session);
  const retry = CoopProtocol.endEncounter(session);
  assert.strictEqual(again.accounts.length, 1);
  assert.strictEqual(retry.accounts.length, 1);
  assert.strictEqual(retry.accounts[0].accountId, 'acct-ada');
  assert.strictEqual(CoopProtocol.command(session, { t: 'earn', amount: PAY * 4, reason: REASON }, 1).reason, 'rejected');
  assert.strictEqual(CoopProtocol.command(session, { t: 'score', value: 1 }, 1).reason, 'rejected');
  const practice = CoopProtocol.createMatch({ mode: 'practice', seed: 9, matchId: 'practice-clear', stage: 0 }).session;
  CoopProtocol.assignSeat(practice, { slot: 0, accountId: 'acct-ada', device: 'k1', generation: 1 });
  CoopProtocol.command(practice, { t: 'god' }, 1);
  assert.strictEqual(practice.state.god, true);
  assert.strictEqual(CoopProtocol.terminalFacts(practice).tickets, 0);
  console.log('one account is one participation row and the client has no earn call');
  return { slots: 4, accounts: 1, tickets: 0 };
}

function nakamaUrl() {
  return (process.env.NAKAMA_URL || 'http://127.0.0.1:7350').replace(/\/$/, '');
}

function basicAuth() {
  return 'Basic ' + Buffer.from((process.env.NAKAMA_SERVER_KEY || 'defaultkey') + ':').toString('base64');
}

async function rpc(base, name, body, token) {
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
  const response = await fetch(base + '/v2/rpc/' + encodeURIComponent(name) + '?unwrap=true', {
    method: 'POST', headers, body: JSON.stringify(body || {}),
  });
  const text = await response.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch (err) { parsed = { raw: text }; }
  return { status: response.status, body: parsed, text };
}

async function gameLogin(base, label) {
  const auth = await fetch(base + '/v2/account/authenticate/email?create=true', {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: label + '@example.com', password: 'c5-accept-pass', username: label }),
  });
  const authBody = await auth.json();
  if (!auth.ok || !authBody.token) throw new Error('email auth ' + auth.status + ' ' + JSON.stringify(authBody).slice(0, 180));
  const opened = await rpc(base, 'portal.enter', { game: 'sproto-coop-battle', ranked: false }, authBody.token);
  if (!opened.body.ticket) throw new Error('portal.enter ' + opened.status + ' ' + opened.text.slice(0, 180));
  const redeemed = await fetch(base + '/v2/account/authenticate/custom?create=false', {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 't:' + opened.body.ticket, vars: { game: 'sproto-coop-battle' } }),
  });
  const game = await redeemed.json();
  if (!redeemed.ok || !game.token) throw new Error('redeem ' + redeemed.status);
  const payload = JSON.parse(Buffer.from(game.token.split('.')[1], 'base64url').toString());
  return { id: payload.uid, name: label, token: game.token, hubToken: authBody.token };
}

async function live() {
  const base = nakamaUrl();
  const label = 'c5' + Date.now().toString(36);
  const session = await gameLogin(base, label.slice(0, 16));
  const version = await rpc(base, 'coop.version', {}, session.token);
  assert.strictEqual(version.body.enabled, true, JSON.stringify(version.body));
  assert.strictEqual(version.body.match, 'sproto_coop');
  assert.strictEqual(version.body.protocol, 1);
  assert.strictEqual(version.body.rewards, 0);
  const before = await rpc(base, 'tickets.balance', { game: 'sproto-coop-battle' }, session.token);
  assert.strictEqual(typeof before.body.balance, 'number');
  const forged = await rpc(base, 'tickets.earn', { amount: PAY * 4, reason: REASON, key: 'c5-four-' + label }, session.token);
  assert.notStrictEqual(forged.body.error, undefined);
  const event = await rpc(base, 'session.event', { event: 'coop.boss_clear', key: 'c5-event-' + label, data: { boss: '01-marina-bront', slots: 4 } }, session.token);
  const score = await rpc(base, 'score.submit', { board: 'coop_stage_clear_ms_v1', score: 1, key: 'c5-score-' + label }, session.token);
  const after = await rpc(base, 'tickets.balance', { game: 'sproto-coop-battle' }, session.token);
  assert.strictEqual(after.body.balance, before.body.balance, JSON.stringify({ before: before.body, after: after.body, forged, event, score }));
  return {
    nakama: base,
    version: { enabled: version.body.enabled, protocol: version.body.protocol, fingerprint: version.body.fingerprint, match: version.body.match, rewards: version.body.rewards },
    balance: after.body.balance,
    forged: forged.body.error || forged.status,
    event: event.body.error || event.status,
    score: score.body.error || score.status,
    account: session.id,
  };
}

async function main() {
  const facts = clientCannotMint();
  const summary = { hardware: hardware(), facts, pay: PAY, reason: REASON, live: null };
  if (process.env.C5_LIVE === '1') summary.live = await live();
  writeSummary(out, 'c5-rewards-summary.json', summary);
  console.log('rewards ok', JSON.stringify({ facts, live: summary.live }));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
