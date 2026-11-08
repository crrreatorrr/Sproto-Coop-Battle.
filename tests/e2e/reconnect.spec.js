// C5: bad networks, expired sessions, stale clients, server restart, and
// outcome retries. Six-player latency and egress are measured here.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createAuthorityMatch, createStandin, OP, FINGERPRINT, PROTOCOL, startStatic, stopChild, delay, openPlayer } = require('../browser-hub-online.cjs');
const { root, artifactDir, hardware, launch, shot, writeSummary } = require('../fixtures/c5-browser.cjs');

const out = artifactDir();

function loadLink() {
  const context = { console, URL, URLSearchParams, atob, btoa, Date };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'public/js/hub-config.js'), 'utf8'), context, { filename: 'hub-config.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'public/js/hub-link.js'), 'utf8'), context, { filename: 'hub-link.js' });
  return context.CoopHub;
}

function memory() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
  };
}

function failures() {
  const who = { userId: 'acct-ada', sessionId: 's1', username: 'ada' };
  const match = createAuthorityMatch({ id: 'net', privateRoom: true, seed: 3 });
  match.hello(who, { t: 'hello', protocol: 0, fingerprint: FINGERPRINT, devices: ['k1'] });
  assert.ok(match.drain().some(row => row.body && row.body.reason === 'version_mismatch'));
  match.hello(who, { t: 'hello', protocol: PROTOCOL, fingerprint: FINGERPRINT, devices: ['k1'] });
  match.ready(who);
  match.loop(1000);
  assert.strictEqual(match.state.phase, 'playing');
  const huge = { t: 'input', frame: match.state.session.state.t + 1, seq: 1, seats: [{ slot: 0, device: 'k1', mask: 1 }], pad: 'x'.repeat(3000) };
  match.input(who, huge, 1100, JSON.stringify(huge).length);
  assert.ok(match.drain().some(row => row.body && row.body.reason === 'rejected' || row.body.reason === 'oversized'));
  const before = match.life();
  const saved = match.shutdown();
  assert.strictEqual(saved.events.some(row => row.op === OP.END && row.body.hostTakeover === 0 && row.body.rewards === 0), true);
  const restored = createAuthorityMatch({ id: 'net', privateRoom: true, seed: 3, restore: saved.saved });
  assert.deepStrictEqual(restored.life().hp, before.hp);
  assert.deepStrictEqual(restored.life().lives, before.lives);
  assert.deepStrictEqual(restored.life().powers, before.powers);
  const next = { userId: 'acct-ada', sessionId: 's2', username: 'ada' };
  restored.hello(next, { t: 'hello', protocol: PROTOCOL, fingerprint: FINGERPRINT, devices: ['k1'] });
  const resume = restored.drain().find(row => row.op === OP.RESUME);
  assert.ok(resume);
  assert.strictEqual(resume.body.generation, 2);
  assert.strictEqual(resume.body.acceptClientState, 0);
  assert.strictEqual(resume.body.rewards, 0);
  const stale = { t: 'input', frame: restored.state.session.state.t + 1, seq: 1, seats: [{ slot: 0, device: 'k1', mask: 2 }] };
  restored.input(who, stale, 2000, 80);
  assert.ok(restored.drain().some(row => row.body && row.body.reason === 'stale-socket'));

  const CoopHub = loadLink();
  const now = 1_700_000_000_000;
  const expired = CoopHub.createSession({
    location: { protocol: 'http:', hostname: '127.0.0.1', port: '8080', hash: '', pathname: '/', search: '' },
    config: {},
    local: memory(),
    session: memory(),
    now: () => now,
    readHash: () => '',
    writeHash() {},
    assign() {},
    sdk: {
      async init() { return { serverTime: 1 }; },
      getSession() { return { token: 'h.' + Buffer.from(JSON.stringify({ usn: 'ken' })).toString('base64url') + '.s', playerId: 'acct-ken', expiresAt: now - 1 }; },
      getTicketBalance() { throw new Error('balance after expiry'); },
    },
  });
  return expired.connect().then(state => {
    assert.strictEqual(state.kind, 'offline');
    assert.strictEqual(state.message, 'Hub session expired');
    assert.strictEqual(state.balance, null);
    assert.strictEqual(state.playerId, null);
    console.log('stale client, restart checkpoint, and expired session stay unpaid');
  });
}

async function pick(page, item) {
  const index = ['LOCAL PLAY', 'HOST ONLINE', 'JOIN ONLINE', 'HUB QUICK', 'HUB ROOM', 'JOIN HUB', 'RETURN TO BAR'].indexOf(item);
  if (index < 0) throw new Error('missing menu ' + item);
  await page.bringToFront();
  for (let attempt = 0; attempt < 4; attempt++) {
    const screen = await page.evaluate(i => {
      if (window.SprotoApp.screen === 'title') window.SprotoApp.menu = i;
      return window.SprotoApp.screen;
    }, index);
    if (screen !== 'title') return;
    await page.keyboard.press('KeyF');
    await delay(150);
  }
}

async function sixPlayer() {
  const { chromium } = require('playwright');
  const standin = createStandin();
  const port = await standin.listen();
  const nakama = 'http://127.0.0.1:' + port;
  const staticServer = await startStatic();
  const browser = await launch({ chromium }, 'chromium');
  const pages = [];
  let sent = 0;
  let received = 0;
  try {
    const host = await openPlayer(browser, staticServer.url, nakama, { id: 'six-ada', name: 'ada' }, []);
    pages.push(host);
    const client = await host.context().newCDPSession(host);
    await client.send('Network.enable');
    client.on('Network.webSocketFrameSent', event => { sent += Buffer.byteLength(event.response.payloadData || ''); });
    client.on('Network.webSocketFrameReceived', event => { received += Buffer.byteLength(event.response.payloadData || ''); });
    await pick(host, 'HUB ROOM');
    await host.waitForFunction(() => window.SprotoApp.code && window.SprotoApp.code.length === 12, null, { timeout: 15000 });
    const code = await host.evaluate(() => window.SprotoApp.code);
    const names = ['bea', 'cy', 'dee', 'eli', 'fay'];
    for (const name of names) {
      const page = await openPlayer(browser, staticServer.url, nakama, { id: 'six-' + name, name }, []);
      pages.push(page);
      await pick(page, 'JOIN HUB');
      await page.waitForFunction(() => window.SprotoApp.screen === 'join' && !document.getElementById('join').hidden, null, { timeout: 10000 });
      await page.fill('#code', code);
      await page.click('#joinForm button[type=submit]');
      await page.waitForFunction(() => window.SprotoApp.authority && window.SprotoApp.authority.view().phase === 'lobby', null, { timeout: 15000 });
    }
    for (const page of pages) await page.keyboard.press('Enter');
    await host.waitForFunction(() => window.SprotoApp.authority && window.SprotoApp.authority.view().phase === 'playing', null, { timeout: 10000 });
    sent = 0;
    received = 0;
    await host.evaluate(() => { window.SprotoApp.authority.state.rttSamples = []; window.SprotoApp.authority.state.rtt = null; });
    const sampleMs = 2500;
    const started = Date.now();
    await host.keyboard.down('KeyD');
    await delay(sampleMs);
    await host.keyboard.up('KeyD');
    const elapsed = Date.now() - started;
    const view = await host.evaluate(() => {
      const row = window.SprotoApp.authority.view();
      return {
        humans: row.seats.filter(seat => seat.human).length,
        accounts: Object.keys(row.seats.reduce((ids, seat) => { if (seat.human && seat.accountId) ids[seat.accountId] = 1; return ids; }, {})),
        rtt: row.rtt,
        rewards: row.rewards,
        ledger: row.ledgerCalls,
        phase: row.phase,
      };
    });
    assert.strictEqual(view.humans, 6);
    assert.strictEqual(view.accounts.length, 6);
    assert.strictEqual(view.rewards, 0);
    assert.strictEqual(view.ledger, 0);
    assert.strictEqual(view.phase, 'playing');
    assert.strictEqual(standin.ledgerWrites.n, 0);
    const shotName = await shot(host, path.join(out, 'c5-six-player.png'));
    return {
      shot: shotName,
      rtt: view.rtt,
      sampleMs: elapsed,
      sentBytes: sent,
      receivedBytes: received,
      sentPerSec: Math.round(sent / (elapsed / 1000)),
      receivedPerSec: Math.round(received / (elapsed / 1000)),
      humans: view.humans,
      accounts: view.accounts.length,
      ledgerWrites: standin.ledgerWrites.n,
    };
  } finally {
    await browser.close().catch(() => {});
    await standin.close();
    await stopChild(staticServer.child);
  }
}

function nakamaUrl() {
  return (process.env.NAKAMA_URL || 'http://127.0.0.1:7350').replace(/\/$/, '');
}

async function rpc(base, name, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(base + '/v2/rpc/' + encodeURIComponent(name) + '?unwrap=true', {
    method: 'POST', headers, body: JSON.stringify(body == null ? {} : body),
  });
  const text = await response.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch (err) { parsed = { raw: text }; }
  return { status: response.status, body: parsed };
}

async function portalSession(base, label) {
  const auth = await fetch(base + '/v2/account/authenticate/device?create=true', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from((process.env.NAKAMA_SERVER_KEY || 'defaultkey') + ':').toString('base64'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'c5-six-' + label + '-' + Date.now().toString(36) }),
  });
  const authBody = await auth.json();
  if (!auth.ok || !authBody.token) throw new Error('device auth ' + auth.status);
  const opened = await rpc(base, 'portal.enter', { game: 'sproto-coop-battle', ranked: false }, authBody.token);
  if (!opened.body.ticket) throw new Error('portal.enter ' + opened.status + ' ' + JSON.stringify(opened.body).slice(0, 160));
  const redeemed = await fetch(base + '/v2/account/authenticate/custom?create=false', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from((process.env.NAKAMA_SERVER_KEY || 'defaultkey') + ':').toString('base64'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 't:' + opened.body.ticket, vars: { game: 'sproto-coop-battle' } }),
  });
  const game = await redeemed.json();
  if (!redeemed.ok || !game.token) throw new Error('redeem ' + redeemed.status);
  const before = await rpc(base, 'tickets.balance', { game: 'sproto-coop-battle' }, game.token);
  return { id: label, name: label, token: game.token, reconnect: false, balance: before.body.balance };
}

async function liveSix(base) {
  const { chromium } = require('playwright');
  const staticServer = await startStatic();
  const browser = await launch({ chromium }, 'chromium');
  const names = ['ada', 'bea', 'cy', 'dee', 'eli', 'fay'];
  const sessions = [];
  for (const name of names) sessions.push(await portalSession(base, name));
  const pages = [];
  let sent = 0;
  let received = 0;
  try {
    const host = await openPlayer(browser, staticServer.url, base, sessions[0], []);
    pages.push(host);
    const client = await host.context().newCDPSession(host);
    await client.send('Network.enable');
    client.on('Network.webSocketFrameSent', event => { sent += Buffer.byteLength(event.response.payloadData || ''); });
    client.on('Network.webSocketFrameReceived', event => { received += Buffer.byteLength(event.response.payloadData || ''); });
    await pick(host, 'HUB ROOM');
    await host.waitForFunction(() => window.SprotoApp.code && window.SprotoApp.code.length === 12, null, { timeout: 20000 });
    const code = await host.evaluate(() => window.SprotoApp.code);
    for (let i = 1; i < sessions.length; i++) {
      const page = await openPlayer(browser, staticServer.url, base, sessions[i], []);
      pages.push(page);
      await pick(page, 'JOIN HUB');
      await page.waitForFunction(() => window.SprotoApp.screen === 'join' && !document.getElementById('join').hidden, null, { timeout: 10000 });
      await page.fill('#code', code);
      await page.click('#joinForm button[type=submit]');
      await page.waitForFunction(() => window.SprotoApp.authority && window.SprotoApp.authority.view().phase === 'lobby', null, { timeout: 20000 });
    }
    for (const page of pages) {
      await page.bringToFront();
      await page.keyboard.press('Enter');
    }
    await host.waitForFunction(() => window.SprotoApp.authority && window.SprotoApp.authority.view().phase === 'playing', null, { timeout: 20000 });
    sent = 0;
    received = 0;
    await host.evaluate(() => { window.SprotoApp.authority.state.rttSamples = []; window.SprotoApp.authority.state.rtt = null; });
    const sampleMs = 2500;
    const started = Date.now();
    await host.keyboard.down('KeyD');
    await delay(sampleMs);
    await host.keyboard.up('KeyD');
    const elapsed = Date.now() - started;
    const view = await host.evaluate(() => {
      const row = window.SprotoApp.authority.view();
      const ids = {};
      row.seats.forEach(seat => { if (seat.human && seat.accountId) ids[seat.accountId] = 1; });
      return { humans: row.seats.filter(seat => seat.human).length, accounts: Object.keys(ids).length, rtt: row.rtt, rewards: row.rewards, ledger: row.ledgerCalls, phase: row.phase };
    });
    if (view.humans !== 6 || view.accounts !== 6 || view.rewards !== 0 || view.phase !== 'playing') {
      throw new Error('live six-player ' + JSON.stringify(view));
    }
    const after = [];
    for (const session of sessions) {
      const balance = await rpc(base, 'tickets.balance', { game: 'sproto-coop-battle' }, session.token);
      after.push(balance.body.balance);
      if (balance.body.balance !== session.balance) throw new Error('balance moved for ' + session.name);
    }
    const shotName = await shot(host, path.join(out, 'c5-six-player-nakama.png'));
    return {
      shot: shotName,
      rtt: view.rtt,
      sampleMs: elapsed,
      sentBytes: sent,
      receivedBytes: received,
      sentPerSec: Math.round(sent / (elapsed / 1000)),
      receivedPerSec: Math.round(received / (elapsed / 1000)),
      humans: view.humans,
      accounts: view.accounts,
      balances: after,
      code,
    };
  } finally {
    await browser.close().catch(() => {});
    await stopChild(staticServer.child);
  }
}

async function live() {
  const base = nakamaUrl();
  const auth = await fetch(base + '/v2/account/authenticate/device?create=true&username=c5live', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from((process.env.NAKAMA_SERVER_KEY || 'defaultkey') + ':').toString('base64'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'c5-live-' + Date.now().toString(36) }),
  });
  const authBody = await auth.json();
  if (!auth.ok) throw new Error('device auth ' + auth.status);
  const opened = await rpc(base, 'portal.enter', { game: 'sproto-coop-battle', ranked: false }, authBody.token);
  const redeemed = await fetch(base + '/v2/account/authenticate/custom?create=false', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from((process.env.NAKAMA_SERVER_KEY || 'defaultkey') + ':').toString('base64'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 't:' + opened.body.ticket, vars: { game: 'sproto-coop-battle' } }),
  });
  const game = await redeemed.json();
  const version = await rpc(base, 'coop.version', {}, game.token);
  const created = await rpc(base, 'coop.room_create', {}, game.token);
  const bad = await rpc(base, 'coop.resume', { matchId: created.body.matchId, state: { hp: 1, lives: 9 } }, game.token);
  const missing = await rpc(base, 'tickets.balance', { game: 'sproto-coop-battle' }, 'not-a-token');
  const six = await liveSix(base);
  return {
    version: version.body,
    room: created.body && created.body.code,
    rewards: created.body && created.body.rewards,
    hostTakeover: created.body && created.body.hostTakeover,
    resumeClientState: bad.body && (bad.body.error || bad.body.reason || bad.status),
    expiredStatus: missing.status,
    six,
  };
}

async function main() {
  await failures();
  const summary = { hardware: hardware(), six: null, live: null };
  if (process.env.C5_NODE_ONLY !== '1') summary.six = await sixPlayer();
  if (process.env.C5_LIVE === '1') summary.live = await live();
  writeSummary(out, 'c5-reconnect-summary.json', summary);
  console.log('reconnect ok', JSON.stringify(summary.six || { node: true }));
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { failures };
