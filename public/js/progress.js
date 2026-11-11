// Local progress: best run and stage unlocks, kept in this browser's localStorage only.
// Nothing here talks to the hub: no Tickets, no scores sent anywhere.
(function (root) {
'use strict';
const KEY = 'sproto-coop-progress-v1';
const STAGES = 12;
const int = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);
function blank() { return { unlocked: 1, freePlay: false, best: null }; }
function defaultStore() { try { return root.localStorage || null; } catch (err) { return null; } }
// Anything unreadable or out of range falls back to a fresh record: a bad save never blocks play.
function clean(raw) {
  const out = blank();
  if (!raw || typeof raw !== 'object') return out;
  out.unlocked = int(raw.unlocked, 1, STAGES, 1);
  out.freePlay = raw.freePlay === true;
  const b = raw.best;
  if (b && typeof b === 'object' && Number.isInteger(b.stage)) {
    out.best = { stage: int(b.stage, 1, STAGES, 1), score: int(b.score, 0, 1e12, 0), ticks: int(b.ticks, 0, 1e9, 0), victory: b.victory === true };
  }
  return out;
}
function load(store) {
  const st = store === undefined ? defaultStore() : store;
  try { return clean(st ? JSON.parse(st.getItem(KEY) || 'null') : null); } catch (err) { return blank(); }
}
function save(data, store) {
  const st = store === undefined ? defaultStore() : store;
  try { if (st) st.setItem(KEY, JSON.stringify(clean(data))); return true; } catch (err) { return false; }
}
// A win beats any loss, then the furthest stage, then the score.
function better(a, b) {
  if (!b) return true;
  if (a.victory !== b.victory) return a.victory;
  if (a.stage !== b.stage) return a.stage > b.stage;
  return a.score > b.score;
}
// Totals for the end-of-run panel, from a render snapshot. Kills, revives and parries are per
// player counters in the snapshot (k, rvn, pa); a snapshot without them shows dashes.
function summarize(snap) {
  const rows = (snap.players || []).map(p => ({ slot: p.s, name: p.n, cpu: p.c === 'cpu', score: p.sc | 0, kills: p.k, revives: p.rvn, parries: p.pa }));
  return { stage: (snap.si | 0) + 1, ticks: snap.t | 0, victory: snap.mode === 'victory', score: rows.reduce((s, r) => s + r.score, 0), rows: rows };
}
// Records a finished run. God Mode runs are shown but never become the best.
function recordRun(data, run, god) {
  const prev = data.best;
  const mine = { stage: run.stage, score: run.score, ticks: run.ticks, victory: !!run.victory };
  const isBest = !god && better(mine, prev);
  if (isBest) data.best = mine;
  return { best: data.best, newBest: isBest, counted: !god };
}
// Clearing stage N (1-based) opens stage N + 1. Returns true when that opened a new stage.
function clearStage(data, stageNumber) {
  const next = Math.min(STAGES, (stageNumber | 0) + 1);
  if (next <= data.unlocked) return false;
  data.unlocked = next;
  return true;
}
const isOpen = (data, index) => data.freePlay || index < data.unlocked;
function clock(ticks) {
  const s = Math.floor(ticks / 60);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
const Progress = { KEY, STAGES, blank, load, save, summarize, recordRun, clearStage, isOpen, better, clock };
root.Progress = Progress;
if (typeof module !== 'undefined' && module.exports) module.exports = Progress;
})(typeof window !== 'undefined' ? window : globalThis);
