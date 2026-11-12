// Gamepad mapping for Sproto Coop Battle. Pure: no DOM, no navigator, so Node tests can drive it
// with fake Gamepad objects. input.js polls navigator.getGamepads() once a frame and feeds each pad
// through update(); the rest of the game only sees the same l/r/u/d/a/j/s/p/start bits as a keyboard.
// W3C "standard" mapping, Xbox names (PlayStation / Switch work by position).
(function (root) {
'use strict';

const CONFIG = {
  leftDeadzone: 0.2,      // radial, rescaled so travel starts from 0 at the edge of the deadzone
  moveThreshold: 0.25,    // rescaled stick component that counts as a direction (about 0.4 raw on one axis)
  menuThreshold: 0.5,     // menus need a firmer push than movement
  triggerThreshold: 0.5,  // LT / RT are analog
  repeatDelay: 350,       // menu auto-repeat: first repeat after this many ms
  repeatRate: 120,        // then every this many ms
};

const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const TRACKED = 16; // 16 (Home) is never read: the OS / browser owns it

// Gameplay bits, the same names the sim reads from a keyboard layout.
// a = attack, j = jump, s = special (tap) / block (hold), p = fire a saved power-up.
const GAME = {
  a: [BTN.X, BTN.RB],
  j: [BTN.A],
  s: [BTN.B, BTN.LB],
  p: [BTN.Y, BTN.LT, BTN.RT],
  start: [BTN.START],
};
// The full default map for one pad, directions included (the stick always moves as well).
// Controller settings swap button lists per pad through tracker.map; menus keep A = OK, B = back.
const DEFAULT_MAP = Object.freeze({ l: [BTN.LEFT], r: [BTN.RIGHT], u: [BTN.UP], d: [BTN.DOWN], a: GAME.a, j: GAME.j, s: GAME.s, p: GAME.p, start: GAME.start });
const BUTTON_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'VIEW', 'START', 'LS', 'RS', 'D-UP', 'D-DOWN', 'D-LEFT', 'D-RIGHT'];
const EMPTY_GAME = Object.freeze({ l: 0, r: 0, u: 0, d: 0, a: 0, j: 0, s: 0, p: 0, start: 0 });
const EMPTY_EDGES = Object.freeze({ l: 0, r: 0, u: 0, d: 0, a: 0, j: 0, s: 0, p: 0, start: 0, ok: 0, back: 0, view: 0 });
const DIRS = ['l', 'r', 'u', 'd'];

function buttonDown(pad, i, cfg) {
  const b = pad && pad.buttons ? pad.buttons[i] : null;
  if (b == null) return false;
  if (typeof b === 'number') return b > cfg.triggerThreshold;
  if (i === BTN.LT || i === BTN.RT) return typeof b.value === 'number' ? b.value > cfg.triggerThreshold : !!b.pressed;
  return !!b.pressed || (typeof b.value === 'number' && b.value > cfg.triggerThreshold);
}

function radial(x, y, dz) {
  x = +x || 0; y = +y || 0;
  const m = Math.hypot(x, y);
  if (m <= dz) return { x: 0, y: 0 };
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return { x: x * k, y: y * k };
}

function createTracker(cfg, map) {
  return {
    cfg: Object.assign({}, CONFIG, cfg || {}),
    map: map || DEFAULT_MAP,
    present: false, id: '',
    raw: new Array(TRACKED).fill(false),
    latched: new Array(TRACKED).fill(false),
    prev: new Array(TRACKED).fill(false),
    rep: { l: { held: false, next: 0 }, r: { held: false, next: 0 }, u: { held: false, next: 0 }, d: { held: false, next: 0 } },
  };
}

function reset(tr) {
  tr.present = false; tr.id = '';
  tr.raw.fill(false); tr.latched.fill(false); tr.prev.fill(false);
  for (const k of DIRS) { tr.rep[k].held = false; tr.rep[k].next = 0; }
}

// Ignore every button that is held right now until it is released.
function latch(tr) {
  for (let i = 0; i < TRACKED; i++) if (tr.raw[i]) tr.latched[i] = true;
}

// One poll of one pad slot. Returns the held gameplay bits, this frame's menu edges
// (with auto-repeat on directions), and whether the player touched the pad this frame.
function update(tr, pad, now) {
  const cfg = tr.cfg;
  if (!pad || pad.connected === false) {
    reset(tr);
    return { connected: false, fresh: false, game: EMPTY_GAME, edges: EMPTY_EDGES, active: false };
  }
  const id = String(pad.id || '');
  const fresh = !tr.present || tr.id !== id;
  for (let i = 0; i < TRACKED; i++) tr.raw[i] = buttonDown(pad, i, cfg);
  if (fresh) {
    // A new pad (page load, travel from the hub, replug): whatever is held now belongs to the
    // previous screen, such as the A press that confirmed the hub portal.
    reset(tr);
    tr.present = true; tr.id = id;
    for (let i = 0; i < TRACKED; i++) tr.raw[i] = buttonDown(pad, i, cfg);
    latch(tr);
  }
  const b = new Array(TRACKED);
  for (let i = 0; i < TRACKED; i++) {
    if (tr.latched[i] && !tr.raw[i]) tr.latched[i] = false;
    b[i] = tr.raw[i] && !tr.latched[i];
  }
  const axes = pad.axes || [];
  const st = radial(axes[0], axes[1], cfg.leftDeadzone);
  const map = tr.map || DEFAULT_MAP;
  const any = list => list.some(i => b[i]) ? 1 : 0;
  const mv = cfg.moveThreshold, mn = cfg.menuThreshold;
  const game = {
    l: st.x < -mv || any(map.l) ? 1 : 0,
    r: st.x > mv || any(map.r) ? 1 : 0,
    u: st.y < -mv || any(map.u) ? 1 : 0,
    d: st.y > mv || any(map.d) ? 1 : 0,
    a: any(map.a), j: any(map.j), s: any(map.s), p: any(map.p), start: any(map.start),
  };
  const held = {
    l: st.x < -mn || !!any(map.l), r: st.x > mn || !!any(map.r),
    u: st.y < -mn || !!any(map.u), d: st.y > mn || !!any(map.d),
  };
  const edge = i => b[i] && !tr.prev[i];
  const edgeAny = list => list.some(edge) ? 1 : 0;
  const edges = {
    l: 0, r: 0, u: 0, d: 0,
    a: edgeAny(map.a), j: edgeAny(map.j), s: edgeAny(map.s), p: edgeAny(map.p), start: edgeAny(map.start),
    ok: edge(BTN.A) ? 1 : 0, back: edge(BTN.B) ? 1 : 0, view: edge(BTN.VIEW) ? 1 : 0,
  };
  let active = false;
  for (let i = 0; i < TRACKED; i++) if (edge(i)) active = true;
  for (const k of DIRS) {
    const rep = tr.rep[k];
    if (!held[k]) { rep.held = false; continue; }
    if (!rep.held) { rep.held = true; rep.next = now + cfg.repeatDelay; edges[k] = 1; active = true; }
    else if (now >= rep.next) { rep.next = now + cfg.repeatRate; edges[k] = 1; }
  }
  for (let i = 0; i < TRACKED; i++) tr.prev[i] = b[i];
  return { connected: true, fresh, game, edges, active };
}

// Arcade-style code entry for the join dialog, so a pad can type a room code.
// UP / DOWN change the letter under the cursor, LEFT / RIGHT move, del removes it.
function editCode(value, cursor, e, alphabet, maxLen) {
  let v = String(value || '').toUpperCase().slice(0, maxLen);
  let c = Math.max(0, Math.min(cursor | 0, v.length, maxLen - 1));
  if (e.u || e.d) {
    const cur = c < v.length ? alphabet.indexOf(v.charAt(c)) : -1;
    const n = alphabet.length;
    const next = cur < 0 ? (e.u ? 0 : n - 1) : (cur + (e.u ? 1 : -1) + n) % n;
    v = v.slice(0, c) + alphabet.charAt(next) + v.slice(c + 1);
  }
  if (e.del && c < v.length) { v = v.slice(0, c) + v.slice(c + 1); c = Math.min(c, v.length); }
  if (e.l) c = Math.max(0, c - 1);
  if (e.r && c < v.length) c = Math.min(maxLen - 1, c + 1);
  return { value: v, cursor: Math.max(0, Math.min(c, maxLen - 1)) };
}

const PadMap = { CONFIG, BTN, GAME, DEFAULT_MAP, BUTTON_NAMES, EMPTY_GAME, EMPTY_EDGES, buttonDown, radial, createTracker, update, latch, editCode };
root.PadMap = PadMap;
if (typeof module !== 'undefined' && module.exports) module.exports = PadMap;
})(typeof window !== 'undefined' ? window : globalThis);
