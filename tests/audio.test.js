// Synthesized music and the boss klaxon (public/js/audio.js), against a fake WebAudio clock.
// No sound is checked, only scheduling: nothing before a user gesture, a steady look-ahead,
// silence when muted or stopped, and no burst of notes after a stall.
'use strict';

const assert = require('assert');
const path = require('path');

let made = [], clock = 0, timers = [], contexts = 0;
const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
const node = kind => ({ kind, type: '', frequency: param(), gain: param(), connect() {}, stop() {}, start(at) { made.push({ kind, at: at === undefined ? clock : at }); } });
class FakeContext {
  constructor() { contexts++; this.state = 'running'; this.sampleRate = 8000; this.destination = {}; }
  get currentTime() { return clock; }
  resume() { this.state = 'running'; }
  createOscillator() { return node('osc'); }
  createGain() { return node('gain'); }
  createBiquadFilter() { return node('filter'); }
  createBuffer(ch, n) { const d = new Float32Array(n); return { getChannelData: () => d }; }
  createBufferSource() { return node('noise'); }
}
globalThis.window = { AudioContext: FakeContext };
const realSet = globalThis.setInterval, realClear = globalThis.clearInterval;
globalThis.setInterval = fn => { timers.push(fn); return timers.length; };
globalThis.clearInterval = id => { timers[id - 1] = null; };
require(path.join(__dirname, '..', 'public', 'js', 'audio.js'));
const A = globalThis.window.Audio2;
const pump = () => timers.forEach(fn => fn && fn());

// ---- choosing a track never creates the audio context: that needs a key or button press ----
A.music('menu');
pump();
assert.strictEqual(contexts, 0, 'no AudioContext before a user gesture');
assert.strictEqual(made.length, 0);

// ---- after a gesture the loop is scheduled a little ahead of the clock, never behind it ----
A.ensure();
assert.strictEqual(contexts, 1);
pump();
assert.ok(made.length > 0, 'notes are scheduled');
assert.ok(made.every(n => n.at >= clock && n.at <= clock + 0.2), 'only the next few steps are scheduled');
const perPump = made.length;

// ---- a steady clock keeps a steady stream; a 30 s stalled tab does not dump 30 s of notes ----
made = [];
for (let i = 0; i < 100; i++) { clock += 0.04; pump(); }
const steady = made.length;
assert.ok(steady > 20 && steady < 200, 'steady stream: ' + steady);
made = []; clock += 30; pump();
assert.ok(made.length <= perPump + 2, 'no burst after a stall: ' + made.length);
assert.ok(made.every(n => n.at >= clock), 'nothing is scheduled in the past');

// ---- the boss loop is busier than the menu loop, and stages change key without restarting it ----
const count = name => { A.music(name, 0); made = []; for (let i = 0; i < 100; i++) { clock += 0.04; pump(); } return made.length; };
const menu = count('menu'), stage = count('stage'), boss = count('boss');
assert.ok(boss > stage && stage > menu, 'intensity rises: ' + [menu, stage, boss]);
const liveTimers = () => timers.filter(Boolean).length;
assert.strictEqual(liveTimers(), 1, 'one timer however often the track changes');
A.music('boss', 0); A.music('boss', 0);
assert.strictEqual(liveTimers(), 1);

// ---- mute silences music and effects; unmuting resumes without a burst ----
A.toggle();
made = []; for (let i = 0; i < 20; i++) { clock += 0.04; pump(); }
A.play('warn');
assert.strictEqual(made.length, 0, 'muted: nothing scheduled');
A.toggle();
pump();
assert.ok(made.length > 0 && made.length <= perPump + 4, 'unmuted: resumes from now');

// ---- silence stops the timer; the klaxon and unknown events are safe ----
A.music('');
assert.strictEqual(liveTimers(), 0, 'no timer while silent');
made = []; clock += 1; pump();
assert.strictEqual(made.length, 0);
A.play('warn');
assert.ok(made.filter(n => n.kind === 'osc').length >= 1, 'the boss klaxon plays');
A.play('no-such-event'); A.play('hit:120');
A.music('nonsense');
assert.strictEqual(liveTimers(), 0, 'an unknown track is silence');

globalThis.setInterval = realSet; globalThis.clearInterval = realClear;
console.log('audio ok');
