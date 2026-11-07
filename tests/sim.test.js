// Headless checks: six CPU Sprotos play the campaign; the sim must progress and stay sane.
'use strict';
globalThis.window = globalThis;
require('../public/js/manifest.js');
const Sim = require('../public/js/sim.js');
require('../public/js/ai.js');
const assert = require('assert');

const slots = Array.from({ length: 6 }, (_, i) => ({ fid: i % 3, weapon: i, ctrl: 'cpu', name: 'CPU' + (i + 1) }));
const s = Sim.create(slots, 42);
let maxStage = 0, bossSeen = 0, ufoRides = 0, stageTicks = [0], last = 0;
for (let i = 0; i < 60 * 60 * 40 && s.mode !== 'victory' && s.mode !== 'gameover'; i++) {
  Sim.step(s);
  if (s.boss) bossSeen = Math.max(bossSeen, s.stageIdx + 1);
  if (s.players.some(p => p.st === 'ufo')) ufoRides++;
  if (s.stageIdx !== last) { stageTicks.push(i); last = s.stageIdx; }
  maxStage = Math.max(maxStage, s.stageIdx);
  for (const p of s.players) assert(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), 'player position finite');
  assert(s.players.length === 6, 'always six players');
  s.events.length = 0;
}
const snap = JSON.stringify(Sim.snapshot(s));
console.log({ mode: s.mode, stageReached: maxStage + 1, bossSeen, ufoTicks: ufoRides, snapshotBytes: snap.length,
  stageMinutes: stageTicks.slice(1).map((t, k) => ((t - stageTicks[k]) / 3600).toFixed(1)) });
assert(maxStage >= 2, 'CPU team clears at least two stages');
assert(ufoRides > 0, 'the UFO gets used');
console.log('ok');
