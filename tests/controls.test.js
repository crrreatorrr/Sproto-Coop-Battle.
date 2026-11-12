// Controller settings (Input.Controls in public/js/input.js): defaults match the shipped layouts,
// press-to-bind swaps or warns on conflicts, reserved keys are refused, storage round-trips and
// survives junk, and applied bindings change what the input layer reports (keys and pads). The
// sim is not involved: it still receives the same l/r/u/d/a/j/s/p bits.
'use strict';

const assert = require('assert');
const path = require('path');
globalThis.PadMap = require(path.join(__dirname, '..', 'public', 'js', 'gamepad.js'));
const pads = [];
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads }, configurable: true });
const I = require(path.join(__dirname, '..', 'public', 'js', 'input.js'));
const C = I.Controls, P = PadMap;

const down = code => I.keyDown({ code, repeat: false, target: null });
const up = code => I.keyUp({ code });
function memStore() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; }
function pad(pressed) {
  return { id: 'pad', connected: true, axes: [0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) };
}

// ---- defaults are the shipped layouts ----
{
  const d = C.defaults();
  assert.deepStrictEqual(d.keys.k1, { l: ['KeyA'], r: ['KeyD'], u: ['KeyW'], d: ['KeyS'], a: ['KeyF'], j: ['KeyG'], s: ['KeyH'], p: ['KeyR'], start: ['Enter', 'Space'] });
  assert.deepStrictEqual(d.keys.k2.a, ['Comma', 'Numpad1', 'KeyK']);
  assert.deepStrictEqual(d.pads[0].a, [P.BTN.X, P.BTN.RB]);
  assert.deepStrictEqual(d.pads[3].l, [P.BTN.LEFT]);
  assert.deepStrictEqual(d.dz, [0.2, 0.2, 0.2, 0.2]);
  assert.deepStrictEqual(C.get(), d, 'no storage in Node: defaults applied');
  assert.deepStrictEqual(I.GAME_LAYOUTS.k1.j, ['KeyG', 'Space'], 'Space jumps in battle');
  assert.deepStrictEqual(I.GAME_LAYOUTS.k1.start, ['Enter']);
}

// ---- keyboard binding: replace the main key, keep alternates, swap or warn ----
{
  let r = C.bindKey(C.defaults(), 'k1', 'a', 'KeyJ');
  assert.deepStrictEqual(r.cfg.keys.k1.a, ['KeyJ']);
  assert.deepStrictEqual(r.moved, []);
  r = C.bindKey(C.defaults(), 'k2', 'a', 'KeyJ');
  assert.deepStrictEqual(r.cfg.keys.k2.a, ['KeyJ', 'Numpad1', 'KeyK'], 'alternates stay');
  // Taking a key from the other layout warns (that action keeps its other keys)...
  r = C.bindKey(C.defaults(), 'k1', 'a', 'KeyK');
  assert.deepStrictEqual(r.cfg.keys.k2.a, ['Comma', 'Numpad1']);
  assert.deepStrictEqual(r.moved, [{ dev: 'k2', action: 'a', to: 'Comma' }]);
  // ...and a single-key action left empty gets the old key: a swap.
  r = C.bindKey(C.defaults(), 'k1', 'a', 'KeyH');
  assert.deepStrictEqual(r.cfg.keys.k1.a, ['KeyH']);
  assert.deepStrictEqual(r.cfg.keys.k1.s, ['KeyF'], 'special took F: swapped');
  // Both layouts may share a START key; any other use of Enter is taken from both.
  r = C.bindKey(C.defaults(), 'k1', 'start', 'NumpadEnter');
  assert.deepStrictEqual(r.cfg.keys.k2.start, ['Enter', 'NumpadEnter'], 'START keys may be shared');
  r = C.bindKey(C.defaults(), 'k1', 'p', 'Enter');
  assert.deepStrictEqual(r.cfg.keys.k1.start, ['Space']);
  assert.deepStrictEqual(r.cfg.keys.k2.start, ['NumpadEnter']);
  // Reserved keys are refused and change nothing.
  for (const code of ['Escape', 'Tab', 'KeyP', 'KeyB', 'KeyM', 'KeyN', 'Digit9', 'Numpad9', 'F11']) {
    r = C.bindKey(C.defaults(), 'k1', 'a', code);
    assert.strictEqual(r.error, 'reserved', code);
    assert.deepStrictEqual(r.cfg, C.defaults());
  }
  // Every key appears at most once on the keyboard (START aside) after a run of binds.
  let cfg = C.defaults();
  for (const [dev, act, code] of [['k1', 'a', 'KeyK'], ['k2', 'j', 'KeyF'], ['k1', 'l', 'ArrowLeft'], ['k2', 's', 'KeyA'], ['k1', 'j', 'Period']]) cfg = C.bindKey(cfg, dev, act, code).cfg;
  const seen = new Map();
  for (const dev of ['k1', 'k2']) for (const a of C.ACTIONS) for (const k of cfg.keys[dev][a]) {
    if (a !== 'start') { assert.ok(!seen.has(k), k + ' bound twice'); seen.set(k, dev + a); }
  }
}

// ---- pad binding: per pad, swap inside that pad ----
{
  let r = C.bindPad(C.defaults(), 1, 'j', P.BTN.Y);
  assert.deepStrictEqual(r.cfg.pads[1].j, [P.BTN.Y]);
  assert.deepStrictEqual(r.cfg.pads[1].p, [P.BTN.LT, P.BTN.RT], 'Y left POWER');
  assert.deepStrictEqual(r.cfg.pads[0], C.defaults().pads[0], 'other pads untouched');
  r = C.bindPad(C.defaults(), 0, 'j', P.BTN.START);
  assert.deepStrictEqual(r.cfg.pads[0].start, [P.BTN.A], 'START left empty takes A: swapped');
}

// ---- reset: keyboard tabs reset both layouts, pad tabs one pad ----
{
  let cfg = C.bindKey(C.defaults(), 'k2', 'a', 'KeyJ').cfg;
  cfg = C.bindPad(cfg, 2, 'a', P.BTN.Y).cfg;
  cfg.dz[2] = 0.35;
  const k = C.reset(cfg, 'k1');
  assert.deepStrictEqual(k.keys, C.defaults().keys);
  assert.deepStrictEqual(k.pads[2].a, [P.BTN.Y, P.BTN.RB], 'keyboard reset leaves pads');
  const p = C.reset(cfg, 'gp2');
  assert.deepStrictEqual(p.pads[2], C.defaults().pads[2]);
  assert.strictEqual(p.dz[2], 0.2);
  assert.deepStrictEqual(p.keys.k2.a, ['KeyJ', 'Numpad1', 'KeyK'], 'pad reset leaves keys');
}

// ---- storage: round trip, junk, throwing storage ----
{
  const store = memStore();
  let cfg = C.bindKey(C.defaults(), 'k1', 'a', 'KeyJ').cfg;
  cfg = C.bindPad(cfg, 0, 'j', P.BTN.Y).cfg;
  cfg.dz[0] = 0.3;
  assert.strictEqual(C.save(cfg, store), true);
  assert.ok(store.m.has('sproto-coop-battle.controls.v1'), 'game-specific key');
  assert.deepStrictEqual(C.load(store), cfg);
  store.setItem(C.STORE_KEY, '{not json');
  assert.deepStrictEqual(C.load(store), C.defaults());
  store.setItem(C.STORE_KEY, JSON.stringify({ keys: { k1: { a: ['Escape'] }, k2: 7 }, pads: [{ a: [99] }, 'x'], dz: [9, 0.1, -1, 'a'] }));
  const junk = C.load(store);
  assert.deepStrictEqual(junk.keys, C.defaults().keys);
  assert.deepStrictEqual(junk.pads, C.defaults().pads);
  assert.deepStrictEqual(junk.dz, [0.2, 0.1, 0.2, 0.2]);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepStrictEqual(C.load(broken), C.defaults());
  assert.strictEqual(C.save(cfg, broken), false);
  assert.strictEqual(C.save(cfg, null), false);
}

// ---- applied live: the input layer reports the new bindings ----
{
  C.apply(C.bindKey(C.defaults(), 'k1', 'a', 'KeyJ').cfg);
  down('KeyJ'); assert.strictEqual(I.read('k1').a, 1, 'J attacks'); up('KeyJ');
  down('KeyF'); assert.strictEqual(I.read('k1').a, 0, 'F does not'); up('KeyF');
  I.endFrame();
  down('KeyJ'); assert.strictEqual(I.pressed('k1').ok, 1, 'J confirms in menus too'); up('KeyJ');
  I.endFrame();

  let cfg = C.bindPad(C.defaults(), 0, 'j', P.BTN.Y).cfg;
  cfg.dz[0] = 0.5;
  C.apply(cfg);
  pads[0] = pad([]); I.poll(0); // connect (latch)
  pads[0] = pad([P.BTN.Y]); I.poll(16);
  assert.strictEqual(I.read('gp0').j, 1, 'Y jumps on pad 1');
  pads[0] = pad([P.BTN.A]); I.poll(32);
  assert.strictEqual(I.read('gp0').j, 0, 'A no longer jumps');
  assert.strictEqual(I.pressed('gp0').ok, 1, 'A is still OK in menus');
  pads[0] = Object.assign(pad([]), { axes: [0.45, 0] }); I.poll(48);
  assert.strictEqual(I.read('gp0').r, 0, 'inside the 50% dead zone');
  C.apply(C.defaults());
  I.poll(64);
  assert.strictEqual(I.read('gp0').r, 1, 'the default 20% dead zone moves');

  // Press-to-bind reads raw pad edges; a button held when capture starts does not count.
  pads[0] = pad([P.BTN.A]); I.poll(80);
  assert.strictEqual(C.rawEdge(0), -1, 'priming');
  pads[0] = pad([P.BTN.A, P.BTN.LB]); I.poll(96);
  assert.strictEqual(C.rawEdge(0), P.BTN.LB);
  assert.strictEqual(C.rawEdge(0), -1, 'one edge');

  // A key swallowed after binding is ignored until released, auto-repeat included.
  down('KeyF'); I.swallow('KeyF');
  I.keyDown({ code: 'KeyF', repeat: true, target: null });
  assert.strictEqual(I.read('k1').a, 0, 'swallowed');
  up('KeyF'); down('KeyF');
  assert.strictEqual(I.read('k1').a, 1, 'works again after release');
  up('KeyF');
}

assert.strictEqual(C.keyLabel('KeyF'), 'F');
assert.strictEqual(C.keyLabel('Comma'), ',');
assert.strictEqual(C.keyLabel('Numpad1'), 'NUM 1');
assert.strictEqual(C.keyLabel('ArrowLeft'), 'LEFT');
assert.strictEqual(C.padLabel(P.BTN.RB), 'RB');
console.log('controls ok');
