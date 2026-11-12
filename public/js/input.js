// Local input devices: two keyboard layouts and up to four gamepads.
// Pads go through PadMap (gamepad.js): polled once a frame by poll(), latched on connect.
(function (root) {
'use strict';
const P = root.PadMap;
const keys = new Set();
const tapped = new Set(); // keydowns since the last menu poll, so quick taps between frames still count
const ignored = new Set(); // keys just bound in the controller settings: ignored until released
let lastKind = 'keys'; // which device family the player used last, for on-screen prompts
function keyDown(e) {
  lastKind = 'keys';
  if (e.target && (e.target.tagName === 'INPUT')) return;
  if (ignored.has(e.code)) { if (e.preventDefault) e.preventDefault(); return; }
  keys.add(e.code); if (!e.repeat) tapped.add(e.code);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Slash'].includes(e.code) && e.preventDefault) e.preventDefault();
}
function keyUp(e) { keys.delete(e.code); ignored.delete(e.code); }
// Drop a key that the controller settings just captured, so it does not also act as a menu press.
function swallow(code) { keys.delete(code); tapped.delete(code); ignored.add(code); }
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
const DEFAULT_KEYS = JSON.parse(JSON.stringify(LAYOUTS)); // before any saved controller settings
const DEVICE_NAMES = { k1: 'Keys WASD', k2: 'Keys Arrows', gp0: 'Pad 1', gp1: 'Pad 2', gp2: 'Pad 3', gp3: 'Pad 4' };
const codesOf = layout => Object.keys(layout).reduce((all, k) => all.concat(layout[k]), []);
const DEVICE_CODES = {};
const deviceCodes = () => { for (const dev in LAYOUTS) DEVICE_CODES[dev] = Array.from(new Set(codesOf(LAYOUTS[dev]).concat(codesOf(GAME_LAYOUTS[dev])))); };
deviceCodes();

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
// ---------- controller settings ----------
// Bindings per device: the two keyboard layouts (one shared keyboard) and one button map per pad
// slot, plus each pad's left-stick dead zone. Saved in localStorage and applied live by rewriting
// LAYOUTS / GAME_LAYOUTS in place and each pad tracker's map. This is the input layer only: the
// sim still receives the same l/r/u/d/a/j/s/p bits, so no pinned file changes.
const ACTIONS = ['l', 'r', 'u', 'd', 'a', 'j', 's', 'p', 'start'];
const STORE_KEY = 'sproto-coop-battle.controls.v1';
// Esc / Tab / P menus, B Bar, M mute, N feedback, 9 God Mode, and the browser's own keys.
const RESERVED = /^(Escape|Tab|KeyP|KeyB|KeyM|KeyN|Digit9|Numpad9|F\d+|Meta\w*|OS\w*|ContextMenu|Unidentified)?$/;
const DZ = { min: 0.05, max: 0.5, step: 0.05 };
const clone = o => JSON.parse(JSON.stringify(o));
const uniq = list => Array.from(new Set(list));
let config = null;
function defaults() {
  return { keys: clone(DEFAULT_KEYS), pads: Array.from({ length: PADS }, () => clone(P.DEFAULT_MAP)), dz: Array(PADS).fill(P.CONFIG.leftDeadzone) };
}
// Anything malformed in storage falls back to that device's defaults.
function sanitize(raw) {
  const c = defaults();
  if (!raw || typeof raw !== 'object') return c;
  const okList = (list, ok) => Array.isArray(list) && list.length > 0 && list.length <= 6 && list.every(ok);
  for (const dev of ['k1', 'k2']) {
    const src = raw.keys && raw.keys[dev];
    if (src && ACTIONS.every(a => okList(src[a], k => typeof k === 'string' && /^\w{1,24}$/.test(k) && !RESERVED.test(k)))) {
      for (const a of ACTIONS) c.keys[dev][a] = uniq(src[a]);
    }
  }
  for (let i = 0; i < PADS; i++) {
    const src = raw.pads && raw.pads[i];
    if (src && ACTIONS.every(a => okList(src[a], b => Number.isInteger(b) && b >= 0 && b < 16))) {
      for (const a of ACTIONS) c.pads[i][a] = uniq(src[a]);
    }
    const dz = raw.dz && +raw.dz[i];
    if (dz >= DZ.min && dz <= DZ.max) c.dz[i] = Math.round(dz * 100) / 100;
  }
  return c;
}
// In battle Space is the WASD player's second jump, not START (see GAME_LAYOUTS above).
function battleLayout(b) {
  if (!b.start.includes('Space')) return clone(b);
  return Object.assign(clone(b), { j: uniq(b.j.concat('Space')), start: b.start.filter(c => c !== 'Space') });
}
function apply(next) {
  config = sanitize(next);
  for (const dev of ['k1', 'k2']) { LAYOUTS[dev] = clone(config.keys[dev]); GAME_LAYOUTS[dev] = battleLayout(config.keys[dev]); }
  deviceCodes();
  for (let i = 0; i < PADS; i++) { trackers[i].map = clone(config.pads[i]); trackers[i].cfg.leftDeadzone = config.dz[i]; }
  return config;
}
const storage = () => { try { return root.localStorage || null; } catch (err) { return null; } };
function load(store) {
  try {
    const s = store === undefined ? storage() : store, raw = s && s.getItem(STORE_KEY);
    return sanitize(raw ? JSON.parse(raw) : null);
  } catch (err) { return defaults(); }
}
function save(c, store) {
  try { const s = store === undefined ? storage() : store; if (!s) return false; s.setItem(STORE_KEY, JSON.stringify(c)); return true; } catch (err) { return false; }
}
// Bind `code` as the main key of one action. Its other keys stay. A key may serve one action on
// the whole keyboard (both layouts), except that both layouts may share a START key (Enter). A key
// taken from another action is a swap: that action gets this one's old main key, unless the old
// key is still in use elsewhere, in which case it is left unbound. `moved` lists what changed.
function bindKey(cur, dev, action, code) {
  if (RESERVED.test(code)) return { cfg: cur, moved: [], error: 'reserved' };
  const c = clone(cur), list = c.keys[dev][action], old = list[0], moved = [];
  if (old === code) return { cfg: c, moved };
  const used = k => ['k1', 'k2'].some(d => ACTIONS.some(a => c.keys[d][a].includes(k)));
  c.keys[dev][action] = [code].concat(list.slice(1).filter(k => k !== code));
  for (const d of ['k1', 'k2']) for (const a of ACTIONS) {
    if ((d === dev && a === action) || (a === 'start' && action === 'start')) continue;
    const l = c.keys[d][a], at = l.indexOf(code);
    if (at < 0) continue;
    l.splice(at, 1);
    if (!l.length && !used(old)) l.push(old);
    moved.push({ dev: d, action: a, to: l[0] || '' });
  }
  return { cfg: c, moved };
}
// The same for one pad's buttons (a button serves one action on that pad).
function bindPad(cur, pad, action, btn) {
  const c = clone(cur), m = c.pads[pad], list = m[action], old = list[0], moved = [];
  if (old === btn) return { cfg: c, moved };
  m[action] = [btn].concat(list.slice(1).filter(b => b !== btn));
  for (const a of ACTIONS) {
    if (a === action) continue;
    const at = m[a].indexOf(btn);
    if (at < 0) continue;
    m[a].splice(at, 1);
    if (!m[a].length && !ACTIONS.some(x => m[x].includes(old))) m[a].push(old);
    moved.push({ dev: 'gp' + pad, action: a, to: m[a].length ? m[a][0] : -1 });
  }
  return { cfg: c, moved };
}
// Reset one tab: both keyboard layouts together (they share one keyboard), or one pad.
function reset(cur, dev) {
  const c = clone(cur), d = defaults();
  if (isPad(dev)) { const i = +dev.slice(2); c.pads[i] = d.pads[i]; c.dz[i] = d.dz[i]; } else c.keys = d.keys;
  return c;
}
const KEY_NAMES = { Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', NumpadEnter: 'NUM ENTER', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL', AltLeft: 'L-ALT', AltRight: 'R-ALT' };
function keyLabel(code) {
  if (!code) return '-';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  return code.replace(/^Key|^Digit|^Arrow/, '').replace(/^Numpad/, 'NUM ').toUpperCase();
}
const padLabel = b => (b >= 0 && P.BUTTON_NAMES[b]) || '-';
// A pad button that went down since the last call, for press-to-bind (-1: none). Reads the raw,
// unlatched state after poll(), so it also sees buttons the menu verbs ignore.
const rawPrev = [];
function rawEdge(i) {
  const tr = trackers[i];
  if (!tr || !tr.present) { rawPrev[i] = null; return -1; }
  const prev = rawPrev[i] || tr.raw;
  let hit = -1;
  for (let k = 0; k < tr.raw.length; k++) if (hit < 0 && tr.raw[k] && !prev[k] && !tr.latched[k]) hit = k;
  rawPrev[i] = tr.raw.slice();
  return hit;
}
const Controls = { ACTIONS, STORE_KEY, DZ, defaults, sanitize, load, save, apply, bindKey, bindPad, reset, keyLabel, padLabel, rawEdge, isReserved: code => RESERVED.test(code), get: () => clone(config), padPresent: i => !!(trackers[i] && trackers[i].present) };
apply(load());

const pack = i => (i.l) | (i.r << 1) | (i.u << 2) | (i.d << 3) | (i.a << 4) | (i.j << 5) | (i.s << 6) | ((i.p | 0) << 7);
const unpack = n => ({ l: n & 1, r: (n >> 1) & 1, u: (n >> 2) & 1, d: (n >> 3) & 1, a: (n >> 4) & 1, j: (n >> 5) & 1, s: (n >> 6) & 1, p: (n >> 7) & 1 });
const Input = { poll, endFrame, read, devices, pressed, pack, unpack, keys, DEVICE_NAMES, LAYOUTS, GAME_LAYOUTS, isPad, latch, setMuted, keyDown, keyUp, swallow, Controls, lastKind: () => lastKind };
root.Input = Input;
if (typeof module !== 'undefined' && module.exports) module.exports = Input;
})(typeof window !== 'undefined' ? window : globalThis);
