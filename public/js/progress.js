// Sproto Coop Battle — player progress (stage unlocks, best run, settings). Split out of audio.js,
// where it used to sit only to stay under the startup request cap; dist/ bundles both anyway.
// Progress: stage unlocks and the best run. It belongs to whoever earned it:
// - device: play outside a hub session, kept in this browser under KEY (as before this change);
// - account: a hub player (account or guest), kept under KEY@<playerId> and in the player's hub
//   cloud save, so it follows the player to any device;
// - pending: a hub visit whose player is not known yet, kept in memory until the visit resolves.
// Progress never moves from the device into an account, nor from one account into another.
// The hub SDK's createProgressStore does the owning, merging and syncing (hub SDK 0.8.0). The SDK
// is a 234 KB script that only a hub visit loads (hub-link.js), so until it loads, and on every
// visit without the hub, createStore below keeps the same device copy and pending hold itself.
// Free play is a setting, not progress: it can be switched off again, so it stays per device
// under SETTINGS_KEY. Nothing here sends Tickets or scores anywhere.
(function (root) {
'use strict';
const KEY = 'sproto-coop-progress-v1';
const SETTINGS_KEY = 'sproto-coop-settings-v1';
const STAGES = root.MANIFEST ? root.MANIFEST.bosses.length : 13;
const int = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);
const ALL_CLEARS = (1 << STAGES) - 1;
// Old saves only tracked the deepest stage reached and the best run.
const legacyClears = data => data.best && data.best.victory ? (1 << Math.min(STAGES, data.best.stage)) - 1 : (1 << (data.unlocked - 1)) - 1;
const weaponClears = data => int(data.weaponClears, 0, ALL_CLEARS, legacyClears(data));
function withClears(data, cleared) {
  if (cleared === legacyClears(data)) delete data.weaponClears;
  else data.weaponClears = cleared;
  return data;
}
function blank() { return { unlocked: 1, best: null }; }
function defaultStore() { try { return root.localStorage || null; } catch (err) { return null; } }
function readJson(store, key) {
  try { return store ? JSON.parse(store.getItem(key) || 'null') : null; } catch (err) { return null; }
}
// Anything unreadable or out of range falls back to a fresh record: a bad save never blocks play.
// A record from before this change also carries freePlay; that is a setting and is dropped here.
function normalize(raw) {
  const out = blank();
  if (!raw || typeof raw !== 'object') return out;
  out.unlocked = int(raw.unlocked, 1, STAGES, 1);
  const b = raw.best;
  if (b && typeof b === 'object' && Number.isInteger(b.stage)) {
    out.best = { stage: int(b.stage, 1, STAGES, 1), score: int(b.score, 0, 1e12, 0), ticks: int(b.ticks, 0, 1e9, 0), victory: b.victory === true };
  }
  if (out.best && out.best.victory) out.unlocked = Math.max(out.unlocked, Math.min(STAGES, out.best.stage + 1));
  return withClears(out, int(raw.weaponClears, 0, ALL_CLEARS, legacyClears(out)));
}
// Orders two runs, positive when a is the better one: a win beats any loss, then the furthest
// stage, then the higher score, then the faster run. Zero only when all four are equal, so the
// two records are the same and picking either gives one answer, in any order.
function compare(a, b) {
  if (a.victory !== b.victory) return a.victory ? 1 : -1;
  if (a.stage !== b.stage) return a.stage - b.stage;
  if (a.score !== b.score) return a.score - b.score;
  return b.ticks - a.ticks;
}
// True when run a is strictly better than the record b (or there is none): a new best run.
function better(a, b) { return !b || compare(a, b) > 0; }
function bestOf(a, b) { return !a ? b : !b ? a : compare(a, b) >= 0 ? a : b; }
// Combines two copies of progress without losing anything either earned. Commutative,
// associative and idempotent, so tabs, devices and the cloud copy merge in any order.
function merge(a, b) {
  return withClears({ unlocked: Math.max(a.unlocked, b.unlocked), best: bestOf(a.best, b.best) }, weaponClears(a) | weaponClears(b));
}
const model = { empty: blank, normalize, merge };

// Records a finished run on a copy of data. God Mode runs are shown but never become the best.
function recordRun(data, run, god) {
  const mine = { stage: run.stage, score: run.score, ticks: run.ticks, victory: !!run.victory };
  const isBest = !god && better(mine, data.best);
  const next = isBest ? withClears({ ...data, best: mine }, weaponClears(data)) : data;
  return { data: next, best: next.best, newBest: isBest, counted: !god };
}
// Clearing stage N (1-based) opens stage N + 1. opened is true when that opened a new stage.
function clearStage(data, stageNumber) {
  if (!Number.isInteger(stageNumber) || stageNumber < 1 || stageNumber > STAGES) return { data, opened: false, weaponOpened: false, recorded: false };
  const previous = weaponClears(data);
  const cleared = previous | (1 << (stageNumber - 1));
  const next = withClears({ ...data, unlocked: Math.max(data.unlocked, Math.min(STAGES, stageNumber + 1)) }, cleared);
  const opened = next.unlocked > data.unlocked;
  const weaponOpened = weaponTier(next) > weaponTier(data);
  const recorded = previous !== cleared;
  return { data: opened || recorded ? next : data, opened, weaponOpened, recorded };
}
// A Free Play clear is remembered, but it does not grant the earlier weapons.
function weaponTier(data) {
  const combat = root.CombatKernel || require('./combat.js');
  return combat.unlockedTier(weaponClears(data), 13);
}
const isOpen = (data, index, freePlay) => !!freePlay || index < data.unlocked;

// Settings stay on this device. Before this change free play sat inside the progress record, so
// a browser without the settings key takes it from there once, and keeps it from then on.
function loadSettings(store) {
  const st = store === undefined ? defaultStore() : store;
  const saved = readJson(st, SETTINGS_KEY);
  if (saved && typeof saved === 'object') return { freePlay: saved.freePlay === true };
  const legacy = readJson(st, KEY);
  const out = { freePlay: !!(legacy && legacy.freePlay === true) };
  if (out.freePlay) saveSettings(out, st);
  return out;
}
function saveSettings(settings, store) {
  const st = store === undefined ? defaultStore() : store;
  try { if (st) st.setItem(SETTINGS_KEY, JSON.stringify({ freePlay: settings.freePlay === true })); return true; } catch (err) { return false; }
}

// The game's one progress store. Every change goes through update(). Before the hub SDK loads it
// keeps the device copy (same key, same model, same merge as the SDK store's device owner) or,
// when hubVisit is true, holds progress in memory. useSdk(HubSDK) hands everything, pending
// progress included, to HubSDK.createProgressStore; from then on attach/release/flush are the SDK's.
// opts: { storage (KeyValue, null for memory only; default localStorage), hubVisit, onError }
function createStore(opts) {
  opts = opts || {};
  const storage = opts.storage === undefined ? defaultStore() : opts.storage;
  const listeners = new Set();
  let sdkStore = null;
  let pending = !!opts.hubVisit;
  let persistent = !!storage;
  const readDevice = () => normalize(readJson(storage, KEY));
  function writeDevice(value) {
    try { if (!storage) throw new Error('no storage'); storage.setItem(KEY, JSON.stringify(value)); persistent = true; } catch (err) { persistent = false; }
  }
  let value = pending ? blank() : readDevice();
  const emit = () => { listeners.forEach(fn => { try { fn(); } catch (err) { /* a listener never blocks progress */ } }); };
  return {
    get: () => (sdkStore ? sdkStore.get() : value),
    owner: () => (sdkStore ? sdkStore.owner() : { kind: pending ? 'pending' : 'device' }),
    sync: () => (sdkStore ? sdkStore.sync() : 'local'),
    persistent: () => (sdkStore ? sdkStore.persistent() : persistent),
    sdkLoaded: () => !!sdkStore,
    update(advance) {
      if (sdkStore) return sdkStore.update(advance);
      if (!pending) value = merge(value, readDevice());
      value = merge(value, normalize(advance(value)));
      if (!pending) writeDevice(value);
      emit();
      return value;
    },
    refresh() {
      if (sdkStore) { sdkStore.refresh(); return; }
      if (pending) return;
      value = merge(value, readDevice());
      emit();
    },
    watches(key) {
      if (sdkStore) return sdkStore.watches(key);
      return !pending && (key === null || key === KEY);
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    hold() {
      if (sdkStore) { sdkStore.hold(); return; }
      if (pending) return;
      pending = true;
      value = blank();
      emit();
    },
    release() {
      if (sdkStore) { sdkStore.release(); return; }
      const earned = pending ? value : null;
      pending = false;
      value = readDevice();
      if (earned) { value = merge(value, earned); writeDevice(value); }
      emit();
    },
    // Only the SDK store can hold an account's progress: without it there is nothing to attach to.
    attach(sdk, playerId) { return sdkStore ? sdkStore.attach(sdk, playerId) : Promise.resolve(); },
    flush() { return sdkStore ? sdkStore.flush() : Promise.resolve(); },
    useSdk(HubSDK) {
      if (sdkStore || !HubSDK || typeof HubSDK.createProgressStore !== 'function') return !!sdkStore;
      const options = { key: KEY, model };
      if (opts.storage !== undefined) options.storage = opts.storage;
      if (opts.onError) options.onError = opts.onError;
      const next = HubSDK.createProgressStore(options);
      if (pending) {
        const earned = value;
        next.hold();
        next.update(() => earned); // while held, update only merges in memory
      }
      sdkStore = next;
      next.subscribe(emit);
      emit();
      return true;
    },
  };
}

// Totals for the end-of-run panel, from a render snapshot. Kills, revives and parries are per
// player counters in the snapshot (k, rvn, pa); a snapshot without them shows dashes.
function summarize(snap) {
  // A seat nobody took has nothing to show. A player who left keeps the row for what they earned.
  const rows = (snap.players || []).filter(p => p.c !== 'none' || (p.sc | 0) || p.k || p.rvn || p.pa).map(p => ({ slot: p.s, name: p.n, cpu: p.c === 'cpu', score: p.sc | 0, kills: p.k, revives: p.rvn, parries: p.pa }));
  return { stage: (snap.si | 0) + 1, ticks: snap.t | 0, victory: snap.mode === 'victory', score: rows.reduce((s, r) => s + r.score, 0), rows: rows };
}
function clock(ticks) {
  const s = Math.floor(ticks / 60);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
const Progress = { KEY, SETTINGS_KEY, STAGES, blank, normalize, merge, model, compare, better, recordRun, clearStage, weaponTier, isOpen, loadSettings, saveSettings, createStore, summarize, clock };
root.Progress = Progress;
if (typeof module !== 'undefined' && module.exports) module.exports = Progress;
})(typeof window !== 'undefined' ? window : globalThis);
