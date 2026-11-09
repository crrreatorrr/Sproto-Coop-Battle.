// Device layer (public/js/input.js): keyboard layouts, menu vs battle edges, pads through PadMap,
// muting while a device drives the pause menu. Fake key events and fake Gamepad objects only.
'use strict';

const assert = require('assert');
const path = require('path');
globalThis.PadMap = require(path.join(__dirname, '..', 'public', 'js', 'gamepad.js'));
const pads = [];
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads }, configurable: true });
const I = require(path.join(__dirname, '..', 'public', 'js', 'input.js'));

const down = code => I.keyDown({ code, repeat: false, target: null });
const up = code => I.keyUp({ code });
const frame = () => I.endFrame();

// ---- keyboard battle layout: unchanged keys plus Space as the WASD player's jump ----
{
  const k1 = { KeyA: 'l', KeyD: 'r', KeyW: 'u', KeyS: 'd', KeyF: 'a', KeyG: 'j', Space: 'j', KeyH: 's', KeyR: 'p' };
  for (const [code, bit] of Object.entries(k1)) {
    down(code);
    assert.strictEqual(I.read('k1')[bit], 1, 'k1 ' + code + ' -> ' + bit);
    up(code);
  }
  const k2 = { ArrowLeft: 'l', ArrowRight: 'r', ArrowUp: 'u', ArrowDown: 'd', Comma: 'a', KeyK: 'a', Numpad1: 'a', Period: 'j', KeyL: 'j', Slash: 's', Semicolon: 's', Quote: 'p', Numpad4: 'p' };
  for (const [code, bit] of Object.entries(k2)) {
    down(code);
    assert.strictEqual(I.read('k2')[bit], 1, 'k2 ' + code + ' -> ' + bit);
    assert.strictEqual(I.pack(I.read('k1')), 0, code + ' is not a WASD-side key');
    up(code);
  }
  down('Space');
  assert.strictEqual(I.read('k2').j, 0, 'Space belongs to the WASD player');
  assert.strictEqual(I.read('k1').start, 0, 'Space is not START in battle');
  up('Space');
  frame();
}

// ---- menu edges: Space and Enter confirm, Jump backs out, a held key is one edge ----
{
  I.pressed('k1'); I.pressed('k2'); frame(); // settle edge state
  down('Space');
  let p = I.pressed('k1');
  assert.strictEqual(p.start, 1, 'Space confirms in menus');
  assert.strictEqual(p.j, 0, 'Space is not back in menus');
  assert.strictEqual(p.back, 0);
  frame();
  assert.strictEqual(I.pressed('k1').start, 0, 'held Space is one press');
  up('Space'); I.pressed('k1'); frame();

  down('Enter');
  assert.strictEqual(I.pressed('k1').start, 1, 'Enter is START for the WASD layout');
  assert.strictEqual(I.pressed('k2').start, 1, 'and for the arrows layout in the same frame');
  frame(); up('Enter'); I.pressed('k1'); I.pressed('k2'); frame();

  down('KeyF'); p = I.pressed('k1');
  assert.strictEqual(p.ok, 1, 'Attack confirms');
  up('KeyF'); frame(); I.pressed('k1');
  down('KeyG'); p = I.pressed('k1');
  assert.strictEqual(p.back, 1, 'Jump backs out');
  up('KeyG'); frame(); I.pressed('k1');

  down('ArrowDown'); p = I.pressed('k2');
  assert.strictEqual(p.d, 1, 'arrows move the menu');
  up('ArrowDown'); frame(); I.pressed('k2');
  down('KeyW'); assert.strictEqual(I.pressed('k1').u, 1, 'W moves the menu'); up('KeyW'); frame(); I.pressed('k1');
}

// ---- battle edges: Space is a jump, never START; switching layouts invents no press ----
{
  down('Space');
  let p = I.pressed('k1', 'game');
  assert.strictEqual(p.j, 1);
  assert.strictEqual(p.start, 0, 'jumping at game over does not skip the screen');
  frame();
  p = I.pressed('k1', 'menu');
  assert.strictEqual(p.start, 0, 'Space held from battle does not confirm the next menu');
  up('Space'); frame(); I.pressed('k1');
  down('Enter');
  assert.strictEqual(I.pressed('k1', 'game').start, 1, 'Enter is START in battle');
  up('Enter'); frame(); I.pressed('k1', 'game');
  // A tap shorter than a frame still counts.
  down('KeyF'); up('KeyF');
  assert.strictEqual(I.pressed('k1', 'game').a, 1, 'quick tap between frames');
  frame();
}

// ---- text fields keep their keys ----
{
  I.keyDown({ code: 'KeyF', repeat: false, target: { tagName: 'INPUT' } });
  assert.strictEqual(I.read('k1').a, 0, 'typing a room code does not attack');
  assert.strictEqual(I.lastKind(), 'keys');
}

// ---- muting while a device drives the pause menu ----
{
  down('KeyD');
  I.setMuted('k1', true);
  assert.strictEqual(I.pack(I.read('k1')), 0, 'muted keyboard reads idle');
  I.setMuted('k1', false);
  assert.strictEqual(I.read('k1').r, 1);
  up('KeyD'); frame();
}

// ---- pads through the device layer: hot-plug, latch on connect, latch after a join ----
function pad(down) {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: (down || []).includes(i), value: (down || []).includes(i) ? 1 : 0 }));
  return { id: 'Fake (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', buttons, axes: [0, 0, 0, 0] };
}
{
  assert.deepStrictEqual(I.devices(), ['k1', 'k2'], 'no pad yet');
  pads[0] = pad([0]); // arrives from the hub with A still held
  I.poll(0);
  assert.deepStrictEqual(I.devices(), ['k1', 'k2', 'gp0']);
  assert.strictEqual(I.pressed('gp0').ok, 0, 'the hub A press does not leak in');
  assert.strictEqual(I.read('gp0').j, 0);
  pads[0] = pad([]); I.poll(16); I.pressed('gp0');
  pads[0] = pad([0]); I.poll(32);
  assert.strictEqual(I.lastKind(), 'pad', 'a pad press switches prompts to pad');
  let p = I.pressed('gp0');
  assert.strictEqual(p.ok, 1, 'a new A press confirms');
  assert.strictEqual(I.pressed('gp0').ok, 0, 'an edge is consumed once per frame');
  I.latch('gp0'); // joined with that press
  pads[0] = pad([0]); I.poll(48);
  assert.strictEqual(I.read('gp0').j, 0, 'the join press does not also jump');
  pads[0] = pad([]); I.poll(64);
  pads[0] = pad([0]); I.poll(80);
  assert.strictEqual(I.read('gp0').j, 1, 'A jumps once released and pressed again');
  I.setMuted('gp0', true);
  assert.strictEqual(I.read('gp0').j, 0, 'muted pad reads idle');
  I.setMuted('gp0', false);
  pads[0] = null; I.poll(96);
  assert.deepStrictEqual(I.devices(), ['k1', 'k2'], 'unplugged');
  assert.strictEqual(I.pack(I.read('gp0')), 0);
}

// ---- the online mask is unchanged: 8 bits, START is never sent ----
assert.strictEqual(I.pack({ l: 1, r: 0, u: 0, d: 0, a: 1, j: 1, s: 0, p: 1, start: 1 }), 1 | 16 | 32 | 128);
assert.deepStrictEqual(I.unpack(1 | 16 | 32 | 128), { l: 1, r: 0, u: 0, d: 0, a: 1, j: 1, s: 0, p: 1 });

console.log('input ok');
