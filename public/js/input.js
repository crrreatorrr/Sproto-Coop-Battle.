// Local input devices: two keyboard layouts and up to four gamepads.
(function (root) {
'use strict';
const keys = new Set();
const tapped = new Set(); // keydowns since the last menu poll, so quick taps between frames still count
addEventListener('keydown', e => {
  if (e.target && (e.target.tagName === 'INPUT')) return;
  keys.add(e.code); if (!e.repeat) tapped.add(e.code);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Slash'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const LAYOUTS = {
  k1: { l: ['KeyA'], r: ['KeyD'], u: ['KeyW'], d: ['KeyS'], a: ['KeyF'], j: ['KeyG'], s: ['KeyH'], p: ['KeyR'], start: ['Enter', 'Space'] },
  k2: { l: ['ArrowLeft'], r: ['ArrowRight'], u: ['ArrowUp'], d: ['ArrowDown'], a: ['Comma', 'Numpad1', 'KeyK'], j: ['Period', 'Numpad2', 'KeyL'], s: ['Slash', 'Numpad3', 'Semicolon'], p: ['Quote', 'Numpad4'], start: ['Enter', 'NumpadEnter'] },
};
const DEVICE_NAMES = { k1: 'Keys WASD', k2: 'Keys Arrows', gp0: 'Pad 1', gp1: 'Pad 2', gp2: 'Pad 3', gp3: 'Pad 4' };

function readKeys(layout) {
  const o = {};
  for (const k in layout) o[k] = layout[k].some(c => keys.has(c)) ? 1 : 0;
  return o;
}
function readPad(i) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const p = pads && pads[i];
  if (!p || !p.connected) return null;
  const b = n => (p.buttons[n] && p.buttons[n].pressed ? 1 : 0);
  const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
  return {
    l: ax < -0.4 || b(14) ? 1 : 0, r: ax > 0.4 || b(15) ? 1 : 0, u: ay < -0.4 || b(12) ? 1 : 0, d: ay > 0.4 || b(13) ? 1 : 0,
    a: b(2) || b(5) ? 1 : 0, j: b(0) ? 1 : 0, s: b(1) || b(4) ? 1 : 0, p: b(3) || b(6) || b(7) ? 1 : 0, start: b(9) ? 1 : 0,
  };
}
const EMPTY = { l: 0, r: 0, u: 0, d: 0, a: 0, j: 0, s: 0, p: 0, start: 0 };
function read(dev) {
  if (LAYOUTS[dev]) return readKeys(LAYOUTS[dev]);
  if (dev.startsWith('gp')) return readPad(+dev.slice(2)) || EMPTY;
  return EMPTY;
}
function endFrame() { tapped.clear(); }
function devices() {
  const list = ['k1', 'k2'];
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (let i = 0; i < 4; i++) if (pads && pads[i] && pads[i].connected) list.push('gp' + i);
  return list;
}
// Edge detection per device for menus.
const prevState = {};
function pressed(dev) {
  const cur = read(dev), prev = prevState[dev] || EMPTY, out = {};
  for (const k in cur) out[k] = cur[k] && !prev[k] ? 1 : 0;
  prevState[dev] = cur;
  const lay = LAYOUTS[dev];
  if (lay) for (const k in lay) for (const c of lay[k]) if (tapped.has(c)) { out[k] = 1; if (k !== 'start') tapped.delete(c); }
  return out;
}
const pack = i => (i.l) | (i.r << 1) | (i.u << 2) | (i.d << 3) | (i.a << 4) | (i.j << 5) | (i.s << 6) | ((i.p | 0) << 7);
const unpack = n => ({ l: n & 1, r: (n >> 1) & 1, u: (n >> 2) & 1, d: (n >> 3) & 1, a: (n >> 4) & 1, j: (n >> 5) & 1, s: (n >> 6) & 1, p: (n >> 7) & 1 });
root.Input = { endFrame, read, devices, pressed, pack, unpack, keys, DEVICE_NAMES };
})(window);
