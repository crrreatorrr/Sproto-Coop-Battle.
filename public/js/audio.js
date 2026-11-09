// Tiny synthesized sound effects (WebAudio), keyed by sim event names.
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
  bossin: () => { tone(110, 0.8, 'sawtooth', 0.5, 0.35); }, transform: () => tone(90, 1.2, 'sawtooth', 3, 0.35), bossdown: () => noise(1.2, 0.8, 500),
  clear: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.18), i * 120)), stage: () => tone(440, 0.2, 'square', 1.5, 0.2),
  charge: () => tone(80, 0.6, 'sawtooth', 2, 0.35), throw: () => noise(0.05, 0.15, 3000), victory: () => [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.25), i * 150)),
  menu: () => tone(700, 0.05, 'square', 1, 0.2), join: () => tone(500, 0.15, 'square', 2, 0.3),
};
let budget = 0, last = 0;
function play(name) {
  const now = performance.now();
  if (now - last > 16) { budget = 0; last = now; }
  if (budget++ > 5) return; // avoid stacking dozens of hits on one frame
  const fn = SFX[name.split(':')[0]]; if (fn) fn();
}
root.Audio2 = { play, ensure, toggle: () => (muted = !muted), isMuted: () => muted };
})(window);
