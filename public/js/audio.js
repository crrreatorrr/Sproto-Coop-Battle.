// Tiny synthesized sound effects (WebAudio), keyed by sim event names, and three synthesized
// music loops. Nothing is loaded: the asset budget has no room for audio files.
(function (root) {
'use strict';
let ctx = null, master = null, muted = false;
function ensure() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = 0.22; master.connect(ctx.destination); } catch (e) { return null; } }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function tone(freq, dur, type, slide, vol) {
  const c = ensure(); if (!c || muted) return;
  const o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
  o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  g.gain.setValueAtTime(vol || 0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur);
}
function noise(dur, vol, hp) {
  const c = ensure(); if (!c || muted) return;
  const n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = hp || 1800; s.buffer = buf; g.gain.value = vol || 0.6;
  s.connect(f); f.connect(g); g.connect(master); s.start();
}
const SFX = {
  swing: () => noise(0.07, 0.25, 4000), eswing: () => noise(0.06, 0.12, 2500), hit: () => { tone(180, 0.08, 'square', 0.5, 0.35); noise(0.05, 0.3); },
  hurt: () => tone(140, 0.15, 'sawtooth', 0.5, 0.35), ko: () => tone(300, 0.25, 'square', 0.3, 0.3), jump: () => tone(300, 0.1, 'square', 2, 0.15),
  special: () => tone(200, 0.35, 'sawtooth', 4, 0.3), bosshit: () => noise(0.06, 0.35, 900), bossfire: () => tone(500, 0.2, 'sawtooth', 0.3, 0.25),
  boom: () => noise(0.4, 0.7, 600), heal: () => { tone(600, 0.1); setTimeout(() => tone(900, 0.12), 80); }, coin: () => { tone(988, 0.08); setTimeout(() => tone(1319, 0.2), 70); },
  ufo: () => tone(400, 0.6, 'sine', 3, 0.4), laser: () => tone(1200, 0.08, 'square', 0.4, 0.12), ball: () => tone(250, 0.2, 'sine', 2, 0.3),
  shield: () => tone(800, 0.1, 'triangle', 0.5, 0.3), down: () => tone(400, 0.6, 'triangle', 0.25, 0.4), revive: () => { tone(500, 0.1); setTimeout(() => tone(750, 0.1), 90); setTimeout(() => tone(1000, 0.2), 180); },
  respawn: () => tone(300, 0.3, 'triangle', 3, 0.3), crate: () => noise(0.15, 0.5, 1200), wave: () => tone(220, 0.3, 'square', 1.5, 0.2), go: () => { tone(660, 0.1); setTimeout(() => tone(880, 0.15), 120); },
  bossin: () => { tone(110, 0.8, 'sawtooth', 0.5, 0.4); [0, 220, 440].forEach(d => setTimeout(() => tone(740, 0.16, 'square', 0.8, 0.3), d)); }, transform: () => tone(90, 1.2, 'sawtooth', 3, 0.35), bossdown: () => noise(1.2, 0.8, 500),
  clear: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.18), i * 120)), stage: () => tone(440, 0.2, 'square', 1.5, 0.2),
  charge: () => { tone(80, 0.6, 'sawtooth', 2, 0.4); tone(330, 0.5, 'square', 2.2, 0.28); },
  // Boss telegraph: a two-tone klaxon, louder than anything else, when lanes light up or a missile locks.
  warn: () => { tone(932, 0.13, 'square', 1, 0.5); setTimeout(() => tone(698, 0.2, 'square', 1, 0.5), 140); }, throw: () => noise(0.05, 0.15, 3000), victory: () => [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.25), i * 150)),
  menu: () => tone(700, 0.05, 'square', 1, 0.2), join: () => tone(500, 0.15, 'square', 2, 0.3),
};
let budget = 0, last = 0;
function play(name) {
  const now = performance.now();
  if (now - last > 16) { budget = 0; last = now; }
  if (budget++ > 5) return; // avoid stacking dozens of hits on one frame
  const fn = SFX[name.split(':')[0]]; if (fn) fn();
}

// ---- music ----
// Each track is 32 sixteenth-note steps of MIDI notes (0 = rest). A timer schedules the next few
// steps just ahead of the audio clock. The audio context is never created here: browsers only
// allow sound after a key or button press, and ensure() runs on those.
const TRACKS = {
  menu: { bpm: 100, hat: 4, kick: 0, wave: 'triangle',
    bass: [48, 0, 0, 0, 55, 0, 0, 0, 45, 0, 0, 0, 52, 0, 0, 0, 41, 0, 0, 0, 48, 0, 0, 0, 43, 0, 0, 0, 43, 0, 47, 0],
    lead: [72, 0, 76, 0, 79, 0, 76, 0, 72, 0, 76, 0, 81, 0, 79, 0, 69, 0, 72, 0, 77, 0, 72, 0, 71, 0, 74, 0, 79, 0, 74, 0] },
  stage: { bpm: 132, hat: 2, kick: 8, wave: 'square',
    bass: [45, 0, 45, 0, 45, 0, 57, 0, 43, 0, 43, 0, 43, 0, 55, 0, 41, 0, 41, 0, 41, 0, 53, 0, 43, 0, 43, 0, 47, 0, 52, 0],
    lead: [69, 0, 72, 0, 76, 0, 72, 0, 67, 0, 71, 0, 74, 0, 71, 0, 65, 0, 69, 0, 72, 0, 69, 0, 67, 0, 71, 0, 74, 0, 76, 0] },
  boss: { bpm: 156, hat: 2, kick: 4, wave: 'sawtooth',
    bass: [40, 40, 52, 40, 40, 40, 52, 40, 41, 41, 53, 41, 41, 41, 53, 41, 40, 40, 52, 40, 40, 40, 52, 40, 43, 43, 55, 43, 41, 41, 53, 47],
    lead: [76, 0, 0, 0, 79, 0, 77, 0, 76, 0, 0, 0, 72, 0, 74, 0, 76, 0, 0, 0, 79, 0, 77, 0, 83, 0, 81, 0, 79, 0, 77, 0] },
};
const KEYS = [0, 2, -2, 3, -3, 5]; // stages rotate through keys so twelve stages do not sound identical
const AHEAD = 0.12;
const mus = { name: '', key: 0, step: 0, next: 0, timer: null, gain: null, hiss: null };
function note(midi, at, dur, type, vol) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(440 * Math.pow(2, (midi - 69) / 12), at);
  g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.001, at + dur);
  o.connect(g); g.connect(mus.gain); o.start(at); o.stop(at + dur);
}
function drum(at, kick) {
  if (kick) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(130, at); o.frequency.exponentialRampToValueAtTime(40, at + 0.11);
    g.gain.setValueAtTime(0.9, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.12);
    o.connect(g); g.connect(mus.gain); o.start(at); o.stop(at + 0.12);
    return;
  }
  if (!mus.hiss) { // one shared buffer of noise for every hi-hat
    const n = Math.floor(ctx.sampleRate * 0.03); mus.hiss = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = mus.hiss.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  }
  const s = ctx.createBufferSource(), g = ctx.createGain();
  s.buffer = mus.hiss; g.gain.value = 0.16; s.connect(g); g.connect(mus.gain); s.start(at);
}
function pump() {
  const tr = TRACKS[mus.name];
  if (!tr || !ctx || muted || ctx.state !== 'running') return;
  if (!mus.gain) { mus.gain = ctx.createGain(); mus.gain.gain.value = 0.42; mus.gain.connect(master); }
  const now = ctx.currentTime, len = 15 / tr.bpm; // one sixteenth note
  if (mus.next < now) mus.next = now + 0.03; // first run, or after a mute or a stalled tab: never a burst
  while (mus.next < now + AHEAD) {
    const i = mus.step, at = mus.next;
    if (tr.bass[i]) note(tr.bass[i] + mus.key, at, len * 1.8, 'triangle', 0.5);
    if (tr.lead[i]) note(tr.lead[i] + mus.key, at, len * 1.6, tr.wave, 0.14);
    if (tr.kick && i % tr.kick === 0) drum(at, true);
    if (i % tr.hat === 0) drum(at, false);
    mus.step = (i + 1) % tr.bass.length; mus.next += len;
  }
}
// Pick the loop: 'menu', 'stage', 'boss' or '' for silence. Safe to call every frame.
function music(name, stage) {
  const key = name === 'menu' ? 0 : KEYS[(stage | 0) % KEYS.length];
  if (name === mus.name && key === mus.key) return;
  mus.name = TRACKS[name] ? name : ''; mus.key = key; mus.step = 0; mus.next = 0;
  if (mus.name && !mus.timer) mus.timer = setInterval(pump, 40);
  if (!mus.name && mus.timer) { clearInterval(mus.timer); mus.timer = null; }
}
root.Audio2 = { play, ensure, music, toggle: () => (muted = !muted), isMuted: () => muted };
})(window);
