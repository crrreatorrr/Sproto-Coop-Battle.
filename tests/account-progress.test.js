// Progress per hub account (hub SDK 0.8.0): stage unlocks and the best run belong to the hub player
// who earned them and load on any device; play outside the hub stays with this browser.
// Runs the real vendored SDK store (HubSDK.createProgressStore) behind Progress.createStore
// (public/js/audio.js) and the session wiring in public/js/hub-link.js.
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const P = require(path.join(root, 'public', 'js', 'audio.js'));

function loadSdk() {
  const context = {
    console, crypto, TextEncoder, TextDecoder, URL, URLSearchParams, atob, btoa,
    performance, setTimeout, clearTimeout, queueMicrotask, Buffer,
  };
  context.window = context;
  context.globalThis = context;
  context.self = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'vendor/hub-sdk/dist/hub-sdk.iife.js'), 'utf8'), context, { filename: 'hub-sdk.iife.js' });
  return context.HubSDK;
}
const HubSDK = loadSdk();

function loadLink() {
  vm.runInThisContext(fs.readFileSync(path.join(root, 'public/js/hub-link.js'), 'utf8'), { filename: 'hub-link.js' });
  return globalThis.CoopHub;
}

// One browser's localStorage.
function memory() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    keys: () => [...map.keys()],
    map,
  };
}

// The hub's save.get / save.put, one save per player, with the server's size check.
function cloudServer() {
  const saves = new Map();
  return {
    saves,
    as(playerId) {
      return {
        async loadSave() {
          return saves.has(playerId) ? { data: JSON.parse(saves.get(playerId)), updatedAt: 1 } : { data: null, updatedAt: 0 };
        },
        async writeSave(data) {
          saves.set(playerId, HubSDK.encodeSave(data)); // throws save_too_large like the server
          return { data, updatedAt: 2 };
        },
      };
    },
  };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
// The SDK runs in its own vm realm: compare its objects by value.
const own = s => JSON.parse(JSON.stringify(s.owner()));
const run = (stage, score, ticks, victory) => ({ stage, score, ticks, victory: !!victory });

// The game's store with the SDK loaded, as hub-link.js leaves it on a hub visit.
function store(storage, hubVisit) {
  const s = P.createStore({ storage, hubVisit });
  assert.strictEqual(s.useSdk(HubSDK), true);
  return s;
}
function clear(s, stage) { return s.update(d => P.clearStage(d, stage).data); }
function best(s, r) { return s.update(d => P.recordRun(d, r, false).data); }

async function main() {
  // ---- the model: merge keeps every unlock and the better run, in any order ----
  {
    const runs = [null, run(3, 500, 900), run(3, 500, 800), run(3, 900, 900), run(5, 1, 1), run(5, 1, 1, true), run(12, 0, 99999, true), run(12, 0, 5000, true)];
    const values = [];
    for (const unlocked of [1, 4, 12]) for (const b of runs) values.push({ unlocked, best: b });
    const same = (a, b) => assert.deepStrictEqual(a, b);
    for (const a of values) {
      same(P.merge(a, a), a); // idempotent
      for (const b of values) {
        same(P.merge(a, b), P.merge(b, a)); // commutative, ties included
        const m = P.merge(a, b);
        assert.ok(m.unlocked >= a.unlocked && m.unlocked >= b.unlocked, 'unlocks never go back');
        for (const c of values) same(P.merge(P.merge(a, b), c), P.merge(a, P.merge(b, c))); // associative
      }
    }
    // The order: a win, then the furthest stage, then the score, then the faster run.
    assert.ok(P.compare(run(1, 0, 9, true), run(12, 1e9, 1)) > 0);
    assert.ok(P.compare(run(6, 0, 9), run(5, 1e9, 1)) > 0);
    assert.ok(P.compare(run(5, 10, 9), run(5, 9, 1)) > 0);
    assert.ok(P.compare(run(5, 10, 8), run(5, 10, 9)) > 0);
    assert.strictEqual(P.compare(run(5, 10, 8), run(5, 10, 8)), 0);
    // The model's empty, normalize and merge are what the SDK store gets.
    assert.deepStrictEqual(P.model.empty(), { unlocked: 1, best: null });
    assert.deepStrictEqual(P.model.normalize({ unlocked: 7, freePlay: true, best: run(4, 10, 5) }), { unlocked: 7, best: run(4, 10, 5) });
  }

  // ---- account isolation: a new account on a used browser starts empty ----
  {
    const cloud = cloudServer();
    const browser = memory();
    const a = store(browser, true);
    await a.attach(cloud.as('player-a'), 'player-a');
    clear(a, 7);
    best(a, run(9, 4000, 7000));
    await a.flush();
    assert.strictEqual(a.get().unlocked, 8);

    // Same browser, a different hub account: nothing of player-a's.
    const b = store(browser, true);
    await b.attach(cloud.as('player-b'), 'player-b');
    assert.deepStrictEqual(b.get(), P.blank(), 'a new account starts from its own empty save');
    assert.strictEqual(cloud.saves.has('player-b'), false, 'nothing earned: no cloud write');
    // And the switch inside one store (hub-link re-attaches on an account change) does the same.
    await a.attach(cloud.as('player-b'), 'player-b');
    assert.deepStrictEqual(a.get(), P.blank());
    await a.attach(cloud.as('player-a'), 'player-a');
    assert.strictEqual(a.get().unlocked, 8, 'switching back finds player-a again');
  }

  // ---- device progress never reaches an account ----
  {
    const cloud = cloudServer();
    const browser = memory();
    const offline = P.createStore({ storage: browser }); // no hub visit, no SDK: the fallback store
    assert.deepStrictEqual(own(offline), { kind: 'device' });
    clear(offline, 11);
    best(offline, run(12, 99, 99, true));
    assert.strictEqual(JSON.parse(browser.getItem(P.KEY)).unlocked, 12, 'device copy under the old key');

    const visit = store(browser, true);
    assert.deepStrictEqual(visit.get(), P.blank(), 'a hub visit does not show device progress while pending');
    await visit.attach(cloud.as('player-c'), 'player-c');
    assert.deepStrictEqual(visit.get(), P.blank(), 'the account does not get the device progress');
    clear(visit, 1);
    await visit.flush();
    assert.deepStrictEqual(JSON.parse(cloud.saves.get('player-c')), { unlocked: 2, best: null });
    assert.strictEqual(JSON.parse(browser.getItem(P.KEY)).unlocked, 12, 'the device copy is untouched');
    // Back to play outside the hub: the device progress is all there, the account's is not added.
    visit.release();
    assert.strictEqual(visit.get().unlocked, 12);
    assert.deepStrictEqual(visit.get().best, run(12, 99, 99, true));
  }

  // ---- a second device loads the account's cloud save ----
  {
    const cloud = cloudServer();
    const laptop = store(memory(), true);
    await laptop.attach(cloud.as('player-d'), 'player-d');
    clear(laptop, 4);
    best(laptop, run(5, 1234, 7200));
    await laptop.flush();

    const phone = store(memory(), true);
    await phone.attach(cloud.as('player-d'), 'player-d');
    assert.deepStrictEqual(phone.get(), { unlocked: 5, best: run(5, 1234, 7200) });
    // Each device earns something; both end up with all of it, nothing overwritten.
    clear(phone, 8);
    await phone.flush();
    best(laptop, run(6, 10, 10));
    await laptop.flush();
    await phone.attach(cloud.as('player-d'), 'player-d');
    assert.deepStrictEqual(phone.get(), { unlocked: 9, best: run(6, 10, 10) });
    assert.deepStrictEqual(JSON.parse(cloud.saves.get('player-d')), { unlocked: 9, best: run(6, 10, 10) });
  }

  // ---- pending wins go to the account ----
  {
    const cloud = cloudServer();
    const browser = memory();
    // A run finished before the SDK even loaded (fallback store holding a hub visit).
    const s = P.createStore({ storage: browser, hubVisit: true });
    assert.deepStrictEqual(own(s), { kind: 'pending' });
    clear(s, 2);
    assert.strictEqual(browser.getItem(P.KEY), null, 'pending progress is not written to the device');
    s.useSdk(HubSDK);
    assert.deepStrictEqual(own(s), { kind: 'pending' });
    assert.strictEqual(s.get().unlocked, 3, 'the SDK store took the held progress');
    best(s, run(3, 50, 600)); // and one more while init is still running
    await s.attach(cloud.as('player-e'), 'player-e');
    assert.deepStrictEqual(JSON.parse(cloud.saves.get('player-e')), { unlocked: 3, best: run(3, 50, 600) });
    assert.strictEqual(browser.getItem(P.KEY), null, 'still nothing on the device');
    assert.ok(browser.getItem(P.KEY + '@player-e'), 'the account copy in this browser');

    // A visit that turns out standalone gives its pending progress to the device.
    const lone = memory();
    const t = P.createStore({ storage: lone, hubVisit: true });
    clear(t, 5);
    t.release();
    assert.deepStrictEqual(own(t), { kind: 'device' });
    assert.strictEqual(JSON.parse(lone.getItem(P.KEY)).unlocked, 6);
  }

  // ---- legacy keys stay on the device ----
  {
    const cloud = cloudServer();
    const browser = memory();
    // A browser from before this change: progress and the free-play setting in one record.
    browser.setItem(P.KEY, JSON.stringify({ unlocked: 10, freePlay: true, best: run(10, 777, 9000) }));
    assert.deepStrictEqual(P.loadSettings(browser), { freePlay: true }, 'free play moves to the settings key');
    assert.deepStrictEqual(JSON.parse(browser.getItem(P.SETTINGS_KEY)), { freePlay: true });
    const device = P.createStore({ storage: browser });
    assert.deepStrictEqual(device.get(), { unlocked: 10, best: run(10, 777, 9000) }, 'the old record is the device copy');
    clear(device, 1);
    assert.deepStrictEqual(P.loadSettings(browser), { freePlay: true }, 'free play survives the device copy being rewritten');

    const visit = store(browser, true);
    await visit.attach(cloud.as('player-f'), 'player-f');
    assert.deepStrictEqual(visit.get(), P.blank(), 'an account never starts from the legacy record');
    clear(visit, 1);
    await visit.flush();
    assert.deepStrictEqual(JSON.parse(cloud.saves.get('player-f')).unlocked, 2);
    visit.release();
    assert.strictEqual(visit.get().unlocked, 10, 'the legacy progress is still the device copy');
  }

  // ---- the largest possible save fits under SAVE_MAX_BYTES with room to spare ----
  {
    const biggest = { unlocked: P.STAGES, best: { stage: P.STAGES, score: 1e12, ticks: 1e9, victory: false } };
    assert.deepStrictEqual(P.normalize(biggest), biggest, 'these are the largest values normalize keeps');
    const bytes = Buffer.byteLength(HubSDK.encodeSave(P.normalize(biggest)), 'utf8');
    assert.strictEqual(HubSDK.SAVE_MAX_BYTES, 16384);
    assert.ok(bytes * 20 < HubSDK.SAVE_MAX_BYTES, `largest save is ${bytes} bytes`);
    // Junk in a cloud save is normalized away, never grown into a bigger save.
    assert.deepStrictEqual(P.normalize({ unlocked: 12, best: biggest.best, extra: 'x'.repeat(20000) }), biggest);
  }

  // ---- tabs: the storage event brings in what another tab saved ----
  {
    const cloud = cloudServer();
    const browser = memory();
    const one = store(browser, true);
    const two = store(browser, true);
    await one.attach(cloud.as('player-g'), 'player-g');
    await two.attach(cloud.as('player-g'), 'player-g');
    clear(one, 6);
    assert.strictEqual(two.watches(P.KEY + '@player-g'), true);
    assert.strictEqual(two.watches(P.KEY), false, 'the device key is not this account');
    assert.strictEqual(two.watches(P.SETTINGS_KEY), false);
    two.refresh();
    assert.strictEqual(two.get().unlocked, 7);
    // The fallback store watches the device key the same way.
    const dev = P.createStore({ storage: browser });
    assert.strictEqual(dev.watches(P.KEY), true);
    assert.strictEqual(dev.watches(P.KEY + '@player-g'), false);
  }

  // ---- hub-link.js: attach to the live player, re-attach on a switch, release on sign-out ----
  {
    const CoopHub = loadLink();
    assert.strictEqual(CoopHub.visitStarting('#t=abc', memory()), true);
    const withSession = memory();
    withSession.setItem(CoopHub.SESSION_KEY, '{}');
    assert.strictEqual(CoopHub.visitStarting('', withSession), true);
    assert.strictEqual(CoopHub.visitStarting('#from=hub', memory()), false);

    const cloud = cloudServer();
    const browser = memory();
    let live = { playerId: 'player-h', token: 'x.' + Buffer.from(JSON.stringify({ usn: 'ken' })).toString('base64url') + '.y', expiresAt: 0 };
    let current = cloud.as('player-h');
    const sdk = {
      init: async () => ({ playerId: live && live.playerId, serverTime: 1 }),
      getSession: () => live,
      getTicketBalance: async () => ({ balance: 0 }),
      loadSave: () => current.loadSave(),
      writeSave: data => current.writeSave(data),
      exit() {},
    };
    const progress = P.createStore({ storage: browser, hubVisit: true });
    clear(progress, 3); // won before the session resolved
    const link = CoopHub.createSession({
      sdk, HubSDK, progress,
      location: { protocol: 'https:', hostname: 'play.example.com', hash: '' },
      config: {}, local: memory(), session: memory(), readHash: () => '', writeHash() {},
    });
    await link.connect();
    await settle();
    assert.strictEqual(link.state.kind, 'account');
    assert.deepStrictEqual(own(progress), { kind: 'account', playerId: 'player-h' });
    assert.strictEqual(progress.get().unlocked, 4);
    await progress.flush();
    assert.strictEqual(JSON.parse(cloud.saves.get('player-h')).unlocked, 4);

    // The hub account changes in this tab: the new player's progress, not player-h's.
    live = { playerId: 'player-i', token: 'guest', expiresAt: 0 };
    current = cloud.as('player-i');
    link.checkSession();
    await settle();
    assert.strictEqual(link.state.kind, 'guest');
    assert.deepStrictEqual(own(progress), { kind: 'account', playerId: 'player-i' }, 'guests have their own progress too');
    assert.deepStrictEqual(progress.get(), P.blank());

    // Signed out: play from here on is this browser's.
    live = null;
    link.checkSession();
    assert.deepStrictEqual(own(progress), { kind: 'device' });
    clear(progress, 1);
    assert.strictEqual(JSON.parse(browser.getItem(P.KEY)).unlocked, 2);
    assert.strictEqual(JSON.parse(cloud.saves.get('player-h')).unlocked, 4, 'device play did not reach player-h');
    assert.strictEqual(cloud.saves.has('player-i'), false);

    // A visit with no ticket and no saved session stays on the device, SDK never loaded.
    const plain = P.createStore({ storage: memory() });
    const off = CoopHub.createSession({
      progress: plain, loadSdk: async () => { throw new Error('must not load'); },
      location: { protocol: 'https:', hostname: 'play.example.com', hash: '' },
      config: {}, local: memory(), session: memory(), readHash: () => '', writeHash() {},
    });
    await off.connect();
    assert.strictEqual(off.state.kind, 'offline');
    assert.deepStrictEqual(own(plain), { kind: 'device' });
    assert.strictEqual(plain.sdkLoaded(), false);

    // A ticket whose SDK fails to load: the held progress goes to the device.
    const held = P.createStore({ storage: memory(), hubVisit: true });
    clear(held, 2);
    const broken = CoopHub.createSession({
      progress: held, loadSdk: async () => null,
      location: { protocol: 'https:', hostname: 'play.example.com', hash: '#t=abc' },
      config: {}, local: memory(), session: memory(), readHash: () => '#t=abc', writeHash() {},
    });
    await broken.connect();
    assert.deepStrictEqual(own(held), { kind: 'device' });
    assert.strictEqual(held.get().unlocked, 3);
  }

  console.log('account progress ok');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
