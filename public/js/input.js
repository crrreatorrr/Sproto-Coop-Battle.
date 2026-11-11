// Local input devices: two keyboard layouts and up to four gamepads.
// Pads go through PadMap (gamepad.js): polled once a frame by poll(), latched on connect.
(function (root) {
'use strict';
const P = root.PadMap;
const keys = new Set();
const tapped = new Set(); // keydowns since the last menu poll, so quick taps between frames still count
let lastKind = 'keys'; // which device family the player used last, for on-screen prompts
function keyDown(e) {
  lastKind = 'keys';
  if (e.target && (e.target.tagName === 'INPUT')) return;
  keys.add(e.code); if (!e.repeat) tapped.add(e.code);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Slash'].includes(e.code) && e.preventDefault) e.preventDefault();
}
function keyUp(e) { keys.delete(e.code); }
if (typeof addEventListener === 'function') {
  addEventListener('keydown', keyDown);
  addEventListener('keyup', keyUp);
  addEventListener('blur', () => keys.clear());
}

// Menu layouts: what each key means on the title, lobby, stage select and pause menu.
// Enter (and Space on the WASD side) confirms, Attack also confirms, Jump backs out.
const LAYOUTS = {
  k1: { l: ['KeyA'], r: ['KeyD'], u: ['KeyW'], d: ['KeyS'], a: ['KeyF'], j: ['KeyG'], s: ['KeyH'], p: ['KeyR'], start: ['Enter', 'Space'] },
  k2: { l: ['ArrowLeft'], r: ['ArrowRight'], u: ['ArrowUp'], d: ['ArrowDown'], a: ['Comma', 'Numpad1', 'KeyK'], j: ['Period', 'Numpad2', 'KeyL'], s: ['Slash', 'Numpad3', 'Semicolon'], p: ['Quote', 'Numpad4'], start: ['Enter', 'NumpadEnter'] },
};
// In battle Space is the WASD player's second jump key (G still works), so it is not START there:
// mashing jump as a run ends must not skip the game-over screen. Enter stays START.
const GAME_LAYOUTS = {
  k1: Object.assign({}, LAYOUTS.k1, { j: ['KeyG', 'Space'], start: ['Enter'] }),
  k2: LAYOUTS.k2,
};
const DEVICE_NAMES = { k1: 'Keys WASD', k2: 'Keys Arrows', gp0: 'Pad 1', gp1: 'Pad 2', gp2: 'Pad 3', gp3: 'Pad 4' };
const codesOf = layout => Object.keys(layout).reduce((all, k) => all.concat(layout[k]), []);
const DEVICE_CODES = {};
for (const dev in LAYOUTS) DEVICE_CODES[dev] = Array.from(new Set(codesOf(LAYOUTS[dev]).concat(codesOf(GAME_LAYOUTS[dev]))));

function readKeys(layout) {
  const o = {};
  for (const k in layout) o[k] = layout[k].some(c => keys.has(c)) ? 1 : 0;
  return o;
}
// ---------- gamepads ----------
const PADS = 4;
const trackers = Array.from({ length: PADS }, () => P.createTracker());
const padGame = Array.from({ length: PADS }, () => P.EMPTY_GAME);
const padEdges = Array.from({ length: PADS }, () => P.EMPTY_EDGES);
const muted = new Set();
const getPads = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []) || [];
// Call once at the top of every frame. Hot-plug and unplug are picked up here.
function poll(now) {
  const pads = getPads();
  for (let i = 0; i < PADS; i++) {
    const res = P.update(trackers[i], pads[i], now);
    padGame[i] = res.game; padEdges[i] = res.edges;
    if (res.active) lastKind = 'pad';
  }
}
const isPad = dev => typeof dev === 'string' && dev.startsWith('gp');
const EMPTY = { l: 0, r: 0, u: 0, d: 0, a: 0, j: 0, s: 0, p: 0, start: 0 };
// Held gameplay bits for one device (the sim and the online input mask read this).
function read(dev) {
  if (muted.has(dev)) return Object.assign({}, EMPTY);
  if (GAME_LAYOUTS[dev]) return readKeys(GAME_LAYOUTS[dev]);
  if (isPad(dev)) return Object.assign({}, padGame[+dev.slice(2)] || EMPTY);
  return Object.assign({}, EMPTY);
}
// While a device drives the pause menu its gameplay bits read as idle.
function setMuted(dev, on) { if (on) muted.add(dev); else muted.delete(dev); }
// Ignore whatever this pad holds now until it is released (after closing a menu, after joining).
function latch(dev) { if (isPad(dev) && trackers[+dev.slice(2)]) P.latch(trackers[+dev.slice(2)]); }
// End of frame: forget taps and settle keyboard edges for every layout, polled or not. A menu
// action often returns before the other layout is polled; without this, that layout would report
// the same held Enter as a fresh press on the next frame and skip a whole screen.
function endFrame() {
  tapped.clear();
  for (const dev in DEVICE_CODES) prevKeys[dev] = new Set(DEVICE_CODES[dev].filter(c => keys.has(c)));
}
function devices() {
  const list = ['k1', 'k2'];
  const pads = getPads();
  for (let i = 0; i < PADS; i++) if (pads[i] && pads[i].connected) list.push('gp' + i);
  return list;
}
// Edge detection per device. ctx 'game' reads the battle layout, anything else the menu layout.
// ok / back are the menu verbs: A / B on a pad, Attack / Jump on a keyboard. Keyboard edges are
// tracked per key code, so switching layouts never invents a press. Pad edges are consumed once.
const prevKeys = {};
function pressed(dev, ctx) {
  if (isPad(dev)) {
    const i = +dev.slice(2), e = padEdges[i] || P.EMPTY_EDGES;
    padEdges[i] = P.EMPTY_EDGES;
    return Object.assign({}, e);
  }
  const out = Object.assign({}, EMPTY, { ok: 0, back: 0, view: 0 });
  const lay = (ctx === 'game' ? GAME_LAYOUTS : LAYOUTS)[dev];
  if (!lay) return out;
  const prev = prevKeys[dev] || new Set();
  for (const k in lay) for (const c of lay[k]) if ((keys.has(c) && !prev.has(c)) || tapped.has(c)) out[k] = 1;
  // A tap is reported once; Enter is shared by both layouts, so START taps stay for the other one.
  for (const k in lay) if (k !== 'start') for (const c of lay[k]) tapped.delete(c);
  prevKeys[dev] = new Set(DEVICE_CODES[dev].filter(c => keys.has(c)));
  out.ok = out.a; out.back = out.j;
  return out;
}
const pack = i => (i.l) | (i.r << 1) | (i.u << 2) | (i.d << 3) | (i.a << 4) | (i.j << 5) | (i.s << 6) | ((i.p | 0) << 7);
const unpack = n => ({ l: n & 1, r: (n >> 1) & 1, u: (n >> 2) & 1, d: (n >> 3) & 1, a: (n >> 4) & 1, j: (n >> 5) & 1, s: (n >> 6) & 1, p: (n >> 7) & 1 });
const Input = { poll, endFrame, read, devices, pressed, pack, unpack, keys, DEVICE_NAMES, LAYOUTS, GAME_LAYOUTS, isPad, latch, setMuted, keyDown, keyUp, lastKind: () => lastKind };
root.Input = Input;
if (typeof module !== 'undefined' && module.exports) module.exports = Input;
})(typeof window !== 'undefined' ? window : globalThis);
