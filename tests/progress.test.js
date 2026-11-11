// Local progress (public/js/progress.js): best run, stage unlocks, free play, damaged saves.
'use strict';

const assert = require('assert');
const path = require('path');
const P = require(path.join(__dirname, '..', 'public', 'js', 'progress.js'));

function fakeStore(initial) {
  const map = new Map(initial ? [[P.KEY, initial]] : []);
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
}

// ---- a fresh browser: stage 1 only, no best, free play off ----
{
  const d = P.load(fakeStore());
  assert.deepStrictEqual(d, { unlocked: 1, freePlay: false, best: null });
  assert.strictEqual(P.isOpen(d, 0), true);
  assert.strictEqual(P.isOpen(d, 1), false);
  assert.deepStrictEqual(P.load(null), P.blank(), 'no storage at all still plays');
}

// ---- clearing stage N opens N + 1, once, and never past 12 ----
{
  const d = P.blank();
  assert.strictEqual(P.clearStage(d, 1), true);
  assert.strictEqual(d.unlocked, 2);
  assert.strictEqual(P.clearStage(d, 1), false, 'clearing it again opens nothing new');
  assert.strictEqual(P.clearStage(d, 5), true, 'a free-play clear of stage 5 opens stage 6');
  assert.strictEqual(d.unlocked, 6);
  assert.strictEqual(P.clearStage(d, 3), false, 'unlocks never go backwards');
  assert.strictEqual(P.clearStage(d, 12), true);
  assert.strictEqual(d.unlocked, 12);
  for (let i = 0; i < 12; i++) assert.strictEqual(P.isOpen(d, i), true);
}

// ---- free play opens everything without touching the unlock count ----
{
  const d = P.blank();
  d.freePlay = true;
  assert.strictEqual(P.isOpen(d, 11), true);
  assert.strictEqual(d.unlocked, 1);
}

// ---- best run: victory, then stage, then score; God Mode never counts ----
{
  const d = P.blank();
  let r = P.recordRun(d, { stage: 3, score: 5000, ticks: 9000, victory: false }, false);
  assert.strictEqual(r.newBest, true);
  r = P.recordRun(d, { stage: 3, score: 4000, ticks: 100, victory: false }, false);
  assert.strictEqual(r.newBest, false, 'same stage, lower score');
  assert.strictEqual(r.best.score, 5000);
  r = P.recordRun(d, { stage: 2, score: 99999, ticks: 100, victory: false }, false);
  assert.strictEqual(r.newBest, false, 'an earlier stage never beats a later one');
  r = P.recordRun(d, { stage: 4, score: 10, ticks: 100, victory: false }, false);
  assert.strictEqual(r.newBest, true);
  r = P.recordRun(d, { stage: 12, score: 1, ticks: 100, victory: true }, true);
  assert.strictEqual(r.newBest, false, 'God Mode run is not recorded');
  assert.strictEqual(d.best.stage, 4);
  r = P.recordRun(d, { stage: 12, score: 1, ticks: 100, victory: true }, false);
  assert.strictEqual(r.newBest, true, 'a win beats any loss');
  r = P.recordRun(d, { stage: 12, score: 900000, ticks: 100, victory: false }, false);
  assert.strictEqual(r.newBest, false);
}

// ---- save and load round-trip; damaged saves fall back instead of throwing ----
{
  const st = fakeStore();
  const d = P.blank();
  P.clearStage(d, 4); d.freePlay = true;
  P.recordRun(d, { stage: 5, score: 1234, ticks: 7200, victory: false }, false);
  assert.strictEqual(P.save(d, st), true);
  assert.deepStrictEqual(P.load(st), d);
  assert.deepStrictEqual(P.load(fakeStore('not json{')), P.blank());
  assert.deepStrictEqual(P.load(fakeStore('{"unlocked":99,"freePlay":"yes","best":{"stage":"x"}}')), P.blank());
  assert.deepStrictEqual(P.load(fakeStore('{"unlocked":-3,"best":{"stage":40,"score":-1,"ticks":1.5}}')), { unlocked: 1, freePlay: false, best: { stage: 1, score: 0, ticks: 0, victory: false } });
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.deepStrictEqual(P.load(broken), P.blank());
  assert.strictEqual(P.save(d, broken), false);
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
