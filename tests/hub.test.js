// C1 hub session: redeem once, balance, return, and the pinned SDK.
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const IIFE = path.join(root, 'vendor/hub-sdk/dist/hub-sdk.iife.js');
const PIN = path.join(root, 'vendor/hub-sdk/SOURCE.pin.json');
const EXPECTED = '092603b61a3511fbbcaa3b674b16f02b24d581752e1fa1dc69eeb577bc5ae5e8';
const SIM = '28f9236d0df78c62cf600ad08c9924f8dd260b6948d7a73baf60230936934fac';

function memory() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
  };
}

function emitter() {
  const map = new Map();
  return {
    addEventListener(type, fn) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      const set = map.get(type);
      if (set) set.delete(fn);
    },
    size(type) { return map.has(type) ? map.get(type).size : 0; },
  };
}

function loadSdk() {
  const context = {
    console, crypto, TextEncoder, TextDecoder, URL, URLSearchParams, atob, btoa,
    performance, setTimeout, clearTimeout, queueMicrotask, Buffer,
  };
  context.window = context;
  context.globalThis = context;
  context.self = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(IIFE, 'utf8'), context, { filename: 'hub-sdk.iife.js' });
  return context.HubSDK;
}

function loadLink() {
  vm.runInThisContext(fs.readFileSync(path.join(root, 'public/js/hub-config.js'), 'utf8'), { filename: 'hub-config.js' });
  vm.runInThisContext(fs.readFileSync(path.join(root, 'public/js/hub-link.js'), 'utf8'), { filename: 'hub-link.js' });
  return globalThis.CoopHub;
}

function jwt(payload) {
  return 'h.' + Buffer.from(JSON.stringify(payload)).toString('base64url') + '.s';
}

function deferred() {
  let resolve;
  const promise = new Promise(ok => { resolve = ok; });
  return { promise, resolve };
}

async function main() {
  for (const file of ['public/js/hub-config.js', 'public/js/hub-link.js', 'public/js/main.js', 'tests/hub.test.js']) {
    const checked = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
    assert.strictEqual(checked.status, 0, checked.stderr || file);
  }

  const pin = JSON.parse(fs.readFileSync(PIN, 'utf8'));
  const iife = fs.readFileSync(IIFE);
  const hash = crypto.createHash('sha256').update(iife).digest('hex');
  assert.strictEqual(pin.version, '0.7.0');
  assert.strictEqual(pin.global, 'HubSDK');
  assert.strictEqual(pin.iifeSha256, EXPECTED);
  assert.strictEqual(hash, EXPECTED);
  const text = iife.toString('utf8');
  assert.ok(text.includes('Not a CDN import'));
  assert.ok(text.includes('sproto-coop-battle'));
  assert.ok(!/NAKAMA_HTTP_KEY/i.test(text));
  assert.ok(!/https?:\/\/(cdn\.|unpkg\.com|cdnjs\.|jsdelivr\.)/i.test(text));
  const simHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'build/coop-sim.js'))).digest('hex');
  assert.strictEqual(simHash, SIM);

  const mainJs = fs.readFileSync(path.join(root, 'public/js/main.js'), 'utf8');
  assert.ok(mainJs.includes("['LOCAL PLAY', 'HOST ONLINE', 'JOIN ONLINE']"));
  assert.ok(mainJs.includes('length: 6'));
  assert.ok(!mainJs.includes('earnTickets') && !mainJs.includes('reportEvent'));
  assert.ok(mainJs.includes('hub.reportStageClear('));
  // The only event write is the Marina Anchor stage clear in hub-link.js. No earn, no score.
  const linkJs = fs.readFileSync(path.join(root, 'public/js/hub-link.js'), 'utf8');
  assert.ok(!linkJs.includes('earnTickets') && !linkJs.includes('submitScore') && !linkJs.includes('tickets.earn'));
  assert.strictEqual(linkJs.split('reportEvent').length - 1, 1);
  assert.strictEqual(linkJs.split("sdk.reportEvent('coop.stage_clear', body, key)").length - 1, 1);

  const HubSDK = loadSdk();
  const CoopHub = loadLink();
  assert.strictEqual(CoopHub.GAME_ID, 'sproto-coop-battle');
  assert.strictEqual(CoopHub.usernameFromToken(jwt({ usn: 'ken' })), 'ken');
  assert.strictEqual(CoopHub.usernameFromToken('mock.device'), '');
  assert.strictEqual(CoopHub.trustedHubPage({ protocol: 'https:', hostname: 'play.example.com' }, 'https://evil.example/hub/'), 'https://example.com/hub/');
  assert.strictEqual(CoopHub.trustedHubPage({ protocol: 'https:', hostname: 'play.example.com' }, 'javascript:alert(1)'), 'https://example.com/hub/');
  assert.strictEqual(CoopHub.exitUrl({ protocol: 'http:', hostname: 'localhost', port: '8080' }, ''), '/hub/#from=sproto-coop-battle');
  assert.strictEqual(
    CoopHub.exitUrl({ protocol: 'http:', hostname: 'localhost', port: '8080' }, 'http://127.0.0.1:5173/hub/'),
    'http://127.0.0.1:5173/hub/#from=sproto-coop-battle',
  );

  async function openReal(loc, ticket) {
    const local = memory();
    const sessionStore = memory();
    const events = emitter();
    const hash = { value: '' };
    const assigned = [];
    let released = 0;
    let link;
    function assign(url) {
      if (link) link.markNavigated();
      if (assigned[assigned.length - 1] !== url) assigned.push(url);
    }
    if (ticket) hash.value = '#t=' + ticket;
    const sdk = HubSDK.createHubSdk({
      useMock: true,
      hubUrl: CoopHub.trustedHubPage(loc, loc.hubUrl || ''),
      local,
      session: sessionStore,
      now: () => loc.now || Date.now(),
      readHash: () => hash.value,
      writeHash: (value) => { hash.value = value || ''; },
      assign,
    });
    const earns = { n: 0 };
    const relics = [];
    const origEarn = sdk.earnTickets.bind(sdk);
    sdk.earnTickets = function () { earns.n += 1; return origEarn.apply(sdk, arguments); };
    const origEvent = sdk.reportEvent.bind(sdk);
    // The Marina Anchor stage clear is the one allowed event; anything else counts as an earn.
    sdk.reportEvent = function (eventId, data, key) {
      if (eventId === 'coop.stage_clear') relics.push(JSON.parse(JSON.stringify([eventId, data, key])));
      else earns.n += 1;
      return origEvent.apply(sdk, arguments);
    };
    link = CoopHub.createSession({
      sdk,
      location: loc,
      config: { hubUrl: loc.hubUrl || '', serverUrl: '', serverKey: '' },
      local,
      session: sessionStore,
      readHash: () => hash.value,
      writeHash: (value) => { hash.value = value || ''; },
      assign,
      events,
      release: () => { released += 1; },
      now: () => loc.now || Date.now(),
    });
    await link.connect();
    return { link, assigned, hash, sdk, earns, relics, released: () => released, events, sessionStore };
  }

  const now = Date.now();
  const play = { protocol: 'https:', hostname: 'play.example.com', search: '?return=https://evil.example/steal', now };
  const ticket = await HubSDK.mintMockTicket({ game: 'sproto-coop-battle', playerId: 'player-a', now });
  const hub = await openReal(play, ticket);
  assert.strictEqual(hub.hash.value.includes('t='), false);
  assert.strictEqual(hub.link.state.kind, 'guest');
  assert.strictEqual(hub.link.state.playerId, 'player-a');
  assert.notStrictEqual(hub.link.state.label, hub.link.state.playerId);
  assert.strictEqual(hub.link.state.practice, true);
  assert.strictEqual(hub.link.state.bankedWrites, 0);
  const balanceA = hub.link.refreshBalance();
  const balanceB = hub.link.refreshBalance();
  assert.strictEqual(balanceA, balanceB);
  assert.strictEqual(await balanceA, 0);
  assert.strictEqual(hub.link.state.balance, 0);
  hub.link.requestReturn(false);
  assert.deepStrictEqual(hub.assigned, ['https://example.com/hub/#from=sproto-coop-battle']);
  assert.strictEqual(hub.earns.n, 0);
  assert.strictEqual(hub.released(), 1);
  assert.strictEqual(hub.events.size('storage'), 0);

  const again = await HubSDK.mintMockTicket({ game: 'sproto-coop-battle', playerId: 'player-a', now, jti: 'again' });
  const first = await openReal(play, again);
  first.hash.value = '#t=' + again;
  const replaySdk = HubSDK.createHubSdk({
    useMock: true,
    hubUrl: CoopHub.trustedHubPage(play, ''),
    local: memory(),
    session: first.sessionStore,
    now: () => now,
    readHash: () => first.hash.value,
    writeHash: (value) => { first.hash.value = value || ''; },
    assign: () => {},
  });
  const replay = CoopHub.createSession({
    sdk: replaySdk,
    location: play,
    config: { hubUrl: '' },
    session: first.sessionStore,
    readHash: () => first.hash.value,
    writeHash: (value) => { first.hash.value = value || ''; },
    assign: () => {},
    events: emitter(),
    now: () => now,
  });
  await replay.connect();
  assert.strictEqual(first.hash.value.includes('t='), false);
  assert.strictEqual(replay.state.ticketError, 'ticket_used');
  assert.strictEqual(replay.state.playable, true);
  assert.strictEqual(replay.state.playerId, 'player-a');

  const expired = await HubSDK.mintMockTicket({ game: 'sproto-coop-battle', playerId: 'old', now, ttlSeconds: -30 });
  const expiredRun = await openReal(play, expired);
  assert.strictEqual(expiredRun.hash.value.includes('t='), false);
  assert.strictEqual(expiredRun.link.state.ticketError, 'ticket_expired');
  assert.strictEqual(expiredRun.link.state.kind, 'offline');
  assert.strictEqual(expiredRun.link.state.playerId, null);
  assert.strictEqual(expiredRun.link.state.playable, true);

  const wrong = await HubSDK.mintMockTicket({ game: 'sproto-fighter', playerId: 'other', now });
  const wrongRun = await openReal(play, wrong);
  assert.strictEqual(wrongRun.hash.value.includes('t='), false);
  assert.strictEqual(wrongRun.link.state.ticketError, 'ticket_game');
  assert.strictEqual(wrongRun.link.state.kind, 'offline');
  assert.strictEqual(wrongRun.link.state.playable, true);

  const alone = await openReal({ protocol: 'http:', hostname: '127.0.0.1', port: '8080', now });
  assert.strictEqual(alone.link.state.kind, 'offline');
  assert.strictEqual(alone.link.state.playerId, null);
  assert.strictEqual(alone.link.state.label, 'OFFLINE');
  assert.strictEqual(alone.link.state.balance, null);
  alone.link.requestReturn(false);
  assert.deepStrictEqual(alone.assigned, ['/hub/#from=sproto-coop-battle']);
  assert.strictEqual(alone.link.state.confirmCount, 0);

  // Marina Anchor: a stage 1 clear (stageIdx 0) reports once per run, God Mode included.
  const clearTicket = await HubSDK.mintMockTicket({ game: 'sproto-coop-battle', playerId: 'relic-a', now, jti: 'relic-a' });
  const clearRun = await openReal(play, clearTicket);
  assert.strictEqual(clearRun.link.state.kind, 'guest');
  assert.strictEqual(await clearRun.link.reportStageClear(1, false, 'run-1'), null);
  assert.strictEqual(await clearRun.link.reportStageClear(0, false, ''), null);
  assert.deepStrictEqual(clearRun.relics, []);
  const firstClear = clearRun.link.reportStageClear(0, false, 'run-1');
  assert.strictEqual(clearRun.link.reportStageClear(0, false, 'run-1'), firstClear);
  assert.strictEqual((await firstClear).granted, 'marina_anchor');
  assert.deepStrictEqual(clearRun.relics, [['coop.stage_clear', { stage: 1, godMode: false }, 'coop.stage_clear:1:run-1']]);
  const ownedClear = await clearRun.link.reportStageClear(0, true, 'run-2');
  assert.strictEqual(ownedClear.granted, undefined);
  assert.deepStrictEqual(clearRun.relics[1], ['coop.stage_clear', { stage: 1, godMode: true }, 'coop.stage_clear:1:run-2']);
  assert.strictEqual(clearRun.earns.n, 0);
  const godTicket = await HubSDK.mintMockTicket({ game: 'sproto-coop-battle', playerId: 'relic-god', now, jti: 'relic-god' });
  const godRun = await openReal(play, godTicket);
  assert.strictEqual((await godRun.link.reportStageClear(0, true, 'run-god')).granted, 'marina_anchor');
  assert.deepStrictEqual(godRun.relics, [['coop.stage_clear', { stage: 1, godMode: true }, 'coop.stage_clear:1:run-god']]);
  const standalone = await openReal({ protocol: 'http:', hostname: '127.0.0.1', port: '8080', now });
  assert.strictEqual(standalone.link.state.kind, 'offline');
  assert.strictEqual(await standalone.link.reportStageClear(0, false, 'run-solo'), null);
  assert.deepStrictEqual(standalone.relics, []);
  clearRun.link.leave();
  assert.strictEqual(await clearRun.link.reportStageClear(0, false, 'run-3'), null);
  assert.strictEqual(clearRun.relics.length, 2);

  const events = emitter();
  const pending = [];
  let session = {
    token: jwt({ usn: 'ken', uid: 'acct-a', exp: Math.floor(now / 1000) + 3600 }),
    playerId: 'acct-a',
    game: 'sproto-coop-battle',
    ranked: true,
    expiresAt: now + 3600000,
  };
  const calls = { balance: 0, earn: 0, event: 0, score: 0, exit: 0 };
  const fake = {
    init: async () => ({ playerId: session.playerId, ranked: true, relics: [], effects: {}, ticketsCapLeft: 0, serverTime: 50 }),
    getSession: () => session,
    getTicketBalance: () => {
      calls.balance += 1;
      const box = deferred();
      pending.push(box);
      return box.promise;
    },
    earnTickets: () => { calls.earn += 1; return Promise.reject(new Error('no earn')); },
    reportEvent: () => { calls.event += 1; return Promise.reject(new Error('no event')); },
    submitScore: () => { calls.score += 1; return Promise.reject(new Error('no score')); },
    exit: () => { calls.exit += 1; },
  };
  const assigned = [];
  let released = 0;
  const account = CoopHub.createSession({
    sdk: fake,
    location: { protocol: 'https:', hostname: 'play.example.com', search: '?return=https://evil.example' },
    config: { hubUrl: '' },
    local: memory(),
    session: memory(),
    events,
    release: () => { released += 1; },
    assign: (url) => assigned.push(url),
    now: () => now,
    readHash: () => '',
    writeHash: () => {},
  });
  await account.connect();
  assert.strictEqual(account.state.kind, 'account');
  assert.strictEqual(account.state.label, 'ken');
  assert.strictEqual(calls.balance, 1);
  const one = account.refreshBalance();
  const two = account.refreshBalance();
  assert.strictEqual(one, two);
  assert.strictEqual(calls.balance, 1);
  session = {
    token: jwt({ usn: 'ada', uid: 'acct-b', exp: Math.floor(now / 1000) + 3600 }),
    playerId: 'acct-b',
    game: 'sproto-coop-battle',
    ranked: true,
    expiresAt: now + 3600000,
  };
  account.checkSession();
  assert.strictEqual(account.state.playerId, 'acct-b');
  assert.strictEqual(account.state.label, 'ada');
  assert.strictEqual(account.state.balance, null);
  pending[0].resolve({ balance: 40 });
  assert.strictEqual(await one, null);
  assert.notStrictEqual(account.state.balance, 40);
  pending[1].resolve({ balance: 7 });
  await account.refreshBalance();
  assert.strictEqual(account.state.balance, 7);
  assert.strictEqual(calls.earn + calls.event + calls.score, 0);
  // A failing report resolves null and never throws into the game loop.
  assert.strictEqual(await account.reportStageClear(0, false, 'run-fail'), null);
  assert.strictEqual(calls.event, 1);
  assert.strictEqual(calls.earn + calls.score, 0);

  const asked = account.requestReturn(true);
  assert.strictEqual(asked.confirm, true);
  assert.strictEqual(account.state.confirmCount, 1);
  assert.strictEqual(assigned.length, 0);
  const left = account.requestReturn(true);
  assert.strictEqual(left.left, true);
  assert.strictEqual(account.state.confirmCount, 1);
  assert.deepStrictEqual(assigned, ['https://example.com/hub/#from=sproto-coop-battle']);
  account.requestReturn(true);
  assert.strictEqual(assigned.length, 1);
  assert.strictEqual(released, 1);
  assert.strictEqual(events.size('focus'), 0);
  assert.strictEqual(calls.exit, 1);

  account.notifyStorage({ key: CoopHub.TAB_KEY, newValue: JSON.stringify({ tabId: 'other-tab', playerId: 'acct-b' }) });
  assert.strictEqual(account.state.playerId, 'acct-b');
  account.notifyStorage({ key: CoopHub.TAB_KEY, newValue: JSON.stringify({ tabId: 'other-tab', playerId: 'acct-c' }) });
  assert.strictEqual(account.state.kind, 'offline');
  assert.strictEqual(account.state.balance, null);
  assert.strictEqual(account.state.playerId, null);
  session = {
    token: jwt({ uid: 'acct-d' }),
    playerId: 'acct-d',
    game: 'sproto-coop-battle',
    ranked: false,
    expiresAt: now - 1,
  };
  const expiredSession = CoopHub.createSession({
    sdk: fake,
    location: { protocol: 'https:', hostname: 'play.example.com' },
    config: {},
    local: memory(),
    session: memory(),
    events: emitter(),
    assign: () => {},
    now: () => now,
    readHash: () => '',
    writeHash: () => {},
  });
  await expiredSession.connect();
  assert.strictEqual(expiredSession.state.kind, 'offline');
  assert.strictEqual(expiredSession.state.message, 'Hub session expired');
  session = null;
  const signedOut = CoopHub.createSession({
    sdk: {
      init: async () => ({ playerId: 'acct-a', serverTime: 10, ranked: true, relics: [], effects: {}, ticketsCapLeft: 0 }),
      getSession: () => ({ token: jwt({ usn: 'ken' }), playerId: 'acct-a', expiresAt: now + 1000 }),
      getTicketBalance: () => Promise.resolve({ balance: 3 }),
      exit: () => {},
    },
    location: { protocol: 'https:', hostname: 'play.example.com' },
    config: {},
    events: emitter(),
    assign: () => {},
    now: () => now,
    readHash: () => '',
    writeHash: () => {},
  });
  await signedOut.connect();
  assert.strictEqual(signedOut.state.kind, 'account');
  const logoutSdk = {
    current: { token: jwt({ usn: 'ken' }), playerId: 'acct-a', expiresAt: now + 5000 },
  };
  const logout = CoopHub.createSession({
    sdk: {
      init: async () => ({ playerId: 'acct-a', serverTime: 10, ranked: true, relics: [], effects: {}, ticketsCapLeft: 0 }),
      getSession: () => logoutSdk.current,
      getTicketBalance: () => Promise.resolve({ balance: 3 }),
      exit: () => {},
    },
    location: { protocol: 'https:', hostname: 'play.example.com' },
    config: {},
    events: emitter(),
    assign: () => {},
    now: () => now,
    readHash: () => '',
    writeHash: () => {},
  });
  await logout.connect();
  assert.strictEqual(await logout.refreshBalance(), 3);
  assert.strictEqual(logout.state.balance, 3);
  logoutSdk.current = null;
  logout.checkSession();
  assert.strictEqual(logout.state.kind, 'offline');
  assert.strictEqual(logout.state.balance, null);
  assert.strictEqual(logout.state.message, 'Hub signed out');

  const broken = CoopHub.createSession({
    sdk: { init: async () => { throw Object.assign(new Error('down'), { code: 'init_failed' }); }, getSession: () => null },
    location: { protocol: 'http:', hostname: 'localhost' },
    config: {},
    readHash: () => '',
    writeHash: () => {},
    assign: () => {},
    events: emitter(),
  });
  await broken.connect();
  assert.strictEqual(broken.state.kind, 'error');
  assert.strictEqual(broken.state.playable, true);
  const quiet = broken.requestReturn(false);
  assert.strictEqual(quiet.confirm, false);
  assert.strictEqual(broken.state.confirmCount, 0);

  const stale = CoopHub.createSession({
    sdk: {
      init: async () => ({ playerId: 'cached', serverTime: 0, ranked: false, relics: [], effects: {}, ticketsCapLeft: 0 }),
      getSession: () => ({ token: jwt({ uid: 'cached' }), playerId: 'cached', expiresAt: now + 1000 }),
      getTicketBalance: () => { throw new Error('should not read a dead profile'); },
      exit: () => {},
    },
    location: { protocol: 'https:', hostname: 'play.example.com' },
    config: {},
    readHash: () => '',
    writeHash: () => {},
    assign: () => {},
    events: emitter(),
    now: () => now,
  });
  await stale.connect();
  assert.strictEqual(stale.state.kind, 'error');
  assert.strictEqual(stale.state.balance, null);
  assert.strictEqual(stale.state.playerId, null);
  assert.strictEqual(stale.state.playable, true);

  const build = await import('../scripts/build.mjs');
  const assets = await import('../scripts/check-assets.mjs');
  const built = build.buildDist();
  assert.ok(built.distFiles.includes('vendor/hub-sdk/dist/hub-sdk.iife.js'));
  assert.ok(built.distFiles.includes('js/hub-link.js'));
  const distScan = assets.scanTree(path.join(root, 'dist'));
  assert.deepStrictEqual(distScan.hits, []);
  assert.deepStrictEqual(distScan.forbidden, []);
  const distSdk = fs.readFileSync(path.join(root, 'dist/vendor/hub-sdk/dist/hub-sdk.iife.js'));
  assert.strictEqual(crypto.createHash('sha256').update(distSdk).digest('hex'), EXPECTED);

  console.log('hub ok');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
