// Progress (the Progress module at the end of public/js/audio.js): best run, stage unlocks, free play,
// damaged saves. tests/account-progress.test.js covers owners, accounts and the cloud save.
'use strict';

const assert = require('assert');
const path = require('path');
const P = require(path.join(__dirname, '..', 'public', 'js', 'audio.js'));

function fakeStore(initial) {
  const map = new Map(initial ? [[P.KEY, initial]] : []);
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
}

// ---- a fresh browser: stage 1 only, no best, free play off ----
{
  const st = fakeStore();
  const d = P.createStore({ storage: st }).get();
  assert.deepStrictEqual(d, { unlocked: 1, best: null });
  assert.deepStrictEqual(P.loadSettings(st), { freePlay: false });
  assert.strictEqual(P.isOpen(d, 0, false), true);
  assert.strictEqual(P.isOpen(d, 1, false), false);
  assert.deepStrictEqual(P.createStore({ storage: null }).get(), P.blank(), 'no storage at all still plays');
  assert.deepStrictEqual(P.loadSettings(null), { freePlay: false });
}

// ---- clearing stage N opens N + 1, once, and never past 12 ----
{
  let d = P.blank();
  const step = n => { const c = P.clearStage(d, n); d = c.data; return c.opened; };
  assert.strictEqual(step(1), true);
  assert.strictEqual(d.unlocked, 2);
  assert.strictEqual(step(1), false, 'clearing it again opens nothing new');
  assert.strictEqual(step(5), true, 'a free-play clear of stage 5 opens stage 6');
  assert.strictEqual(d.unlocked, 6);
  assert.strictEqual(step(3), false, 'unlocks never go backwards');
  assert.strictEqual(step(12), true);
  assert.strictEqual(d.unlocked, 12);
  for (let i = 0; i < 12; i++) assert.strictEqual(P.isOpen(d, i, false), true);
  const before = P.blank();
  P.clearStage(before, 4);
  assert.deepStrictEqual(before, P.blank(), 'clearStage returns a copy, it never edits progress in place');
}

// ---- free play opens everything without touching the unlock count ----
{
  const d = P.blank();
  assert.strictEqual(P.isOpen(d, 11, true), true);
  assert.strictEqual(d.unlocked, 1);
  const st = fakeStore();
  assert.strictEqual(P.saveSettings({ freePlay: true }, st), true);
  assert.deepStrictEqual(P.loadSettings(st), { freePlay: true });
  assert.strictEqual(st.getItem(P.KEY), null, 'a setting is not progress');
}

// ---- best run: victory, then stage, then score; God Mode never counts ----
{
  let d = P.blank();
  const rec = (r, god) => { const res = P.recordRun(d, r, god); d = res.data; return res; };
  let r = rec({ stage: 3, score: 5000, ticks: 9000, victory: false }, false);
  assert.strictEqual(r.newBest, true);
  r = rec({ stage: 3, score: 4000, ticks: 100, victory: false }, false);
  assert.strictEqual(r.newBest, false, 'same stage, lower score');
  assert.strictEqual(r.best.score, 5000);
  r = rec({ stage: 2, score: 99999, ticks: 100, victory: false }, false);
  assert.strictEqual(r.newBest, false, 'an earlier stage never beats a later one');
  r = rec({ stage: 4, score: 10, ticks: 100, victory: false }, false);
  assert.strictEqual(r.newBest, true);
  r = rec({ stage: 12, score: 1, ticks: 100, victory: true }, true);
  assert.strictEqual(r.newBest, false, 'God Mode run is not recorded');
  assert.strictEqual(r.counted, false);
  assert.strictEqual(d.best.stage, 4);
  r = rec({ stage: 12, score: 1, ticks: 100, victory: true }, false);
  assert.strictEqual(r.newBest, true, 'a win beats any loss');
  r = rec({ stage: 12, score: 900000, ticks: 100, victory: false }, false);
  assert.strictEqual(r.newBest, false);
  r = rec({ stage: 12, score: 1, ticks: 100, victory: true }, false);
  assert.strictEqual(r.newBest, false, 'the same run again is not a new best');
  r = rec({ stage: 12, score: 1, ticks: 99, victory: true }, false);
  assert.strictEqual(r.newBest, true, 'the same result, faster');
}

// ---- the device store: save and load round-trip; damaged saves fall back instead of throwing ----
{
  const st = fakeStore();
  const s = P.createStore({ storage: st });
  s.update(d => P.clearStage(d, 4).data);
  s.update(d => P.recordRun(d, { stage: 5, score: 1234, ticks: 7200, victory: false }, false).data);
  assert.strictEqual(s.persistent(), true);
  assert.deepStrictEqual(P.createStore({ storage: st }).get(), s.get());
  assert.deepStrictEqual(JSON.parse(st.getItem(P.KEY)), { unlocked: 5, best: { stage: 5, score: 1234, ticks: 7200, victory: false } });
  // update can only advance: handing back less keeps what was there.
  s.update(() => P.blank());
  assert.strictEqual(s.get().unlocked, 5);
  const load = raw => P.createStore({ storage: fakeStore(raw) }).get();
  assert.deepStrictEqual(load('not json{'), P.blank());
  assert.deepStrictEqual(load('{"unlocked":99,"freePlay":"yes","best":{"stage":"x"}}'), P.blank());
  assert.deepStrictEqual(load('{"unlocked":-3,"best":{"stage":40,"score":-1,"ticks":1.5}}'), { unlocked: 1, best: { stage: 1, score: 0, ticks: 0, victory: false } });
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() {} };
  const b = P.createStore({ storage: broken });
  assert.deepStrictEqual(b.get(), P.blank());
  b.update(d => P.clearStage(d, 1).data);
  assert.strictEqual(b.get().unlocked, 2, 'progress lasts for this visit even when it cannot be saved');
  assert.strictEqual(b.persistent(), false);
  assert.strictEqual(P.saveSettings({ freePlay: true }, broken), false);
  assert.deepStrictEqual(P.loadSettings(broken), { freePlay: false });
}

// ---- the end-of-run totals come straight from a render snapshot ----
{
  const snap = { si: 4, t: 60 * 125, mode: 'gameover', players: [
    { s: 0, n: 'Sproto Sheriff', c: 'local', sc: 1200, k: 7, rvn: 1, pa: 2 },
    { s: 1, n: 'VAMP', c: 'cpu', sc: 300, k: 2, rvn: 0, pa: 0 },
  ] };
  const sum = P.summarize(snap);
  assert.strictEqual(sum.stage, 5);
  assert.strictEqual(sum.score, 1500);
  assert.strictEqual(sum.victory, false);
  assert.deepStrictEqual(sum.rows[0], { slot: 0, name: 'Sproto Sheriff', cpu: false, score: 1200, kills: 7, revives: 1, parries: 2 });
  assert.strictEqual(sum.rows[1].cpu, true);
  assert.strictEqual(P.clock(sum.ticks), '2:05');
  const old = P.summarize({ si: 0, t: 10, mode: 'victory', players: [{ s: 0, n: 'A', c: 'local', sc: 5 }] });
  assert.strictEqual(old.rows[0].kills, undefined, 'older snapshots without counters still summarize');
  assert.strictEqual(old.victory, true);
}

console.log('progress ok');
