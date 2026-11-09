// Gamepad mapping: deadzone, latch on connect, edges, menu auto-repeat, hot-plug, code entry.
// Fake Gamepad objects only; no browser.
'use strict';

const assert = require('assert');
const path = require('path');
const P = require(path.join(__dirname, '..', 'public', 'js', 'gamepad.js'));
const B = P.BTN;

function pad(opts) {
  opts = opts || {};
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  for (const i of opts.down || []) buttons[i] = { pressed: true, value: 1 };
  for (const [i, v] of Object.entries(opts.values || {})) buttons[i] = { pressed: v > 0.1, value: v };
  return { id: opts.id || 'Fake pad (STANDARD GAMEPAD)', connected: opts.connected !== false, mapping: 'standard', buttons, axes: opts.axes || [0, 0, 0, 0] };
}

// ---- radial deadzone ----
assert.deepStrictEqual(P.radial(0.15, 0.1, 0.2), { x: 0, y: 0 }, 'inside the deadzone is still');
{
  const r = P.radial(1, 0, 0.2);
  assert.ok(Math.abs(r.x - 1) < 1e-9 && r.y === 0, 'full travel stays full');
  const h = P.radial(0.6, 0, 0.2);
  assert.ok(Math.abs(h.x - 0.5) < 1e-9, 'rescaled from the deadzone edge: 0.6 -> 0.5');
}

// ---- default gameplay layout ----
{
  const t = P.createTracker();
  P.update(t, pad(), 0); // connect with nothing held
  const cases = [
    [B.X, 'a'], [B.RB, 'a'], [B.A, 'j'], [B.B, 's'], [B.LB, 's'], [B.Y, 'p'], [B.START, 'start'],
  ];
  for (const [btn, bit] of cases) {
    const res = P.update(t, pad({ down: [btn] }), 16);
    assert.strictEqual(res.game[bit], 1, 'button ' + btn + ' -> ' + bit);
    P.update(t, pad(), 32);
  }
  assert.strictEqual(P.update(t, pad({ values: { [B.RT]: 0.4 } }), 40).game.p, 0, 'RT below half is not a press');
  assert.strictEqual(P.update(t, pad({ values: { [B.RT]: 0.7 } }), 48).game.p, 1, 'RT past half fires a power');
  P.update(t, pad(), 50);
  assert.strictEqual(P.update(t, pad({ down: [16] }), 52).active, false, 'Home is never read');
  // Movement: left stick and D-pad.
  assert.strictEqual(P.update(t, pad({ axes: [0.3, 0] }), 60).game.r, 0, 'drift-sized push does not move');
  assert.strictEqual(P.update(t, pad({ axes: [0.45, 0] }), 70).game.r, 1, 'about 0.4 raw moves, as before');
  assert.strictEqual(P.update(t, pad({ axes: [0, -1] }), 80).game.u, 1);
  assert.strictEqual(P.update(t, pad({ down: [B.LEFT] }), 90).game.l, 1);
  assert.strictEqual(P.update(t, pad({ down: [B.DOWN] }), 100).game.d, 1);
}

// ---- latch on connect: the hub's A press must not leak in ----
{
  const t = P.createTracker();
  let res = P.update(t, pad({ down: [B.A, B.START] }), 0);
  assert.strictEqual(res.fresh, true);
  assert.strictEqual(res.game.j, 0, 'A held at connect is ignored');
  assert.strictEqual(res.edges.ok, 0, 'no confirm edge at connect');
  assert.strictEqual(res.edges.start, 0);
  res = P.update(t, pad({ down: [B.A, B.START] }), 16);
  assert.strictEqual(res.game.j, 0, 'still held, still ignored');
  assert.strictEqual(res.edges.ok, 0);
  res = P.update(t, pad({ down: [B.START] }), 32); // A released, Start still held
  assert.strictEqual(res.game.start, 0, 'Start is latched until its own release');
  res = P.update(t, pad({ down: [B.A] }), 48);
  assert.strictEqual(res.edges.ok, 1, 'a fresh A press after release confirms');
  assert.strictEqual(res.game.j, 1);
  assert.strictEqual(res.active, true);
}

// ---- manual latch (after a menu closes) ----
{
  const t = P.createTracker();
  P.update(t, pad(), 0);
  P.update(t, pad({ down: [B.A] }), 16);
  P.latch(t);
  assert.strictEqual(P.update(t, pad({ down: [B.A] }), 32).game.j, 0, 'latched A no longer jumps');
  P.update(t, pad(), 48);
  assert.strictEqual(P.update(t, pad({ down: [B.A] }), 64).game.j, 1);
}

// ---- edges fire once per press; menu verbs ----
{
  const t = P.createTracker();
  P.update(t, pad(), 0);
  let res = P.update(t, pad({ down: [B.B] }), 16);
  assert.strictEqual(res.edges.back, 1);
  assert.strictEqual(res.edges.s, 1);
  res = P.update(t, pad({ down: [B.B] }), 32);
  assert.strictEqual(res.edges.back, 0, 'held B is one edge');
  res = P.update(t, pad({ down: [B.VIEW] }), 48);
  assert.strictEqual(res.edges.view, 1);
}

// ---- menu auto-repeat: 350 ms first delay, 120 ms after; stick needs 0.5 ----
{
  const t = P.createTracker();
  P.update(t, pad(), 0);
  assert.strictEqual(P.update(t, pad({ axes: [0, 0.45] }), 10).edges.d, 0, 'menus ignore a light push');
  P.update(t, pad(), 20);
  const fired = [];
  for (let ms = 100; ms <= 800; ms += 10) if (P.update(t, pad({ axes: [0, 0.9] }), ms).edges.d) fired.push(ms);
  assert.deepStrictEqual(fired.slice(0, 4), [100, 450, 570, 690], 'first, then 350 ms, then every 120 ms: ' + fired.join(','));
  assert.strictEqual(P.update(t, pad(), 810).edges.d, 0);
  assert.strictEqual(P.update(t, pad({ down: [B.UP] }), 820).edges.u, 1, 'D-pad starts a fresh repeat');
}

// ---- hot-plug: unplug resets, replug latches again; id change counts as a new pad ----
{
  const t = P.createTracker();
  P.update(t, pad(), 0);
  let res = P.update(t, null, 16);
  assert.strictEqual(res.connected, false);
  assert.strictEqual(res.game.j, 0);
  res = P.update(t, pad({ down: [B.A] }), 32);
  assert.strictEqual(res.fresh, true);
  assert.strictEqual(res.edges.ok, 0, 'replug with A held is latched');
  P.update(t, pad(), 48);
  res = P.update(t, pad({ id: 'Other pad', down: [B.X] }), 64);
  assert.strictEqual(res.fresh, true, 'a different pad in the same slot is a new connection');
  assert.strictEqual(res.game.a, 0);
  res = P.update(t, pad({ connected: false }), 80);
  assert.strictEqual(res.connected, false, 'connected:false reads as unplugged');
}

// ---- tolerant of sparse pads (test stubs, odd browsers) ----
{
  const t = P.createTracker();
  const stub = { connected: true, buttons: Array.from({ length: 16 }, () => ({ pressed: false })), axes: [0.8, 0] };
  const res = P.update(t, stub, 0);
  assert.strictEqual(res.game.r, 1, 'stick movement is not latched');
  const stub2 = { connected: true, buttons: [], axes: [] };
  assert.deepStrictEqual(P.update(P.createTracker(), stub2, 0).game, P.EMPTY_GAME);
}

// ---- join code entry ----
{
  const AL = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = P.editCode('', 0, { u: 1 }, AL, 4);
  assert.deepStrictEqual(s, { value: 'A', cursor: 0 });
  s = P.editCode(s.value, s.cursor, { u: 1 }, AL, 4);
  assert.strictEqual(s.value, 'B');
  s = P.editCode('A', 0, { d: 1 }, AL, 4);
  assert.strictEqual(s.value, '9', 'down wraps to the end of the alphabet');
  s = P.editCode('AB', 1, { r: 1 }, AL, 4);
  assert.strictEqual(s.cursor, 2, 'right moves onto the next empty position');
  s = P.editCode('AB', 2, { r: 1 }, AL, 4);
  assert.strictEqual(s.cursor, 2, 'no further than one past the end');
  s = P.editCode('ABCD', 3, { r: 1 }, AL, 4);
  assert.strictEqual(s.cursor, 3, 'never past the max length');
  s = P.editCode('ABCD', 1, { del: 1 }, AL, 4);
  assert.deepStrictEqual(s, { value: 'ACD', cursor: 1 });
  s = P.editCode('ab', 0, { l: 1 }, AL, 4);
  assert.deepStrictEqual(s, { value: 'AB', cursor: 0 });
}

console.log('gamepad ok');
