// Crash guard: one throw never freezes the loop, the panel opens after 3 failing frames,
// the console is not flooded, and error text is rendered as text.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const C = require(path.join(root, 'public/js/crash.js'));

function fakeRaf() {
  const queue = [];
  const r = {
    scheduled: 0,
    raf: cb => { r.scheduled++; queue.push(cb); },
    pump: n => { for (let i = 0; i < n; i++) { const cb = queue.shift(); if (cb) cb(i * 16); } },
    pending: () => queue.length,
  };
  return r;
}

function counter() {
  const f = function () { f.calls.push(Array.from(arguments)); };
  f.calls = [];
  return f;
}

// A frame like main.js frameStep: fixed steps through every system; physics throws.
{
  const log = counter();
  const guard = C.create({ threshold: 3, log: log, surface: null });
  const fatal = [];
  guard.onFatal(r => fatal.push(r));
  const r = fakeRaf();
  let calls = 0;
  const systems = { input() {}, physics() { throw new TypeError("Cannot read properties of undefined (reading 'x')"); }, draw() {} };
  const step = () => { calls++; systems.input(); systems.physics(); systems.draw(); };
  C.frameLoop(step, guard, r.raf)(0);
  r.pump(20);
  assert.strictEqual(r.pending(), 1, 'the loop is still scheduled');
  assert.strictEqual(r.scheduled, 21);
  assert.strictEqual(calls, 3, 'paused after the third failing frame');
  assert.strictEqual(guard.paused, true);
  assert.strictEqual(fatal.length, 1);
  assert.strictEqual(fatal[0].source, 'frame');
  assert.strictEqual(fatal[0].fatal, true);
  assert.strictEqual(fatal[0].count, 3);
  assert.strictEqual(log.calls.length, 1, 'the same error is logged once, not every frame');
}

// A throw inside a fixed step stops the remaining steps of that frame.
{
  const guard = C.create({ log: () => {}, surface: null });
  const r = fakeRaf();
  const ran = [];
  let acc = 3;
  const step = () => {
    while (acc >= 1) {
      const n = 4 - acc;
      if (n === 2) throw new Error('hostStep threw');
      ran.push(n);
      acc -= 1;
    }
  };
  C.frameLoop(step, guard, r.raf)(0);
  assert.deepStrictEqual(ran, [1]);
  assert.strictEqual(guard.errors, 1);
  assert.strictEqual(r.pending(), 1);
}

// A good frame resets the run of failures.
{
  const guard = C.create({ threshold: 3, log: () => {}, surface: null });
  const r = fakeRaf();
  let n = 0;
  C.frameLoop(() => { if (++n % 3 !== 0) throw new Error('flaky'); }, guard, r.raf)(0);
  r.pump(30);
  assert.strictEqual(guard.paused, false);
  assert.ok(guard.errors > 10);
}

// At most maxLogs distinct errors reach the console.
{
  const log = counter();
  const guard = C.create({ threshold: 1000, maxLogs: 2, log: log, surface: null });
  for (let i = 0; i < 10; i++) guard.report(new Error('e' + i), 'frame');
  assert.strictEqual(log.calls.length, 2);
  assert.strictEqual(guard.suppressed, 8);
}

// Page error and unhandledrejection feed the same counter and the onCrash hook; a frame error
// handed to the browser once is not counted twice.
{
  const log = counter();
  const target = new EventTarget();
  const surface = counter();
  const guard = C.create({ threshold: 100, log: log, surface: err => { surface(err); target.dispatchEvent(Object.assign(new Event('error'), { error: err, message: String(err) })); } });
  const seen = [];
  guard.onCrash(r => seen.push(r));
  const uninstall = guard.install(target);
  const err = new Error('async boom');
  target.dispatchEvent(Object.assign(new Event('error'), { error: err, message: err.message }));
  target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'nope' }));
  target.dispatchEvent(Object.assign(new Event('error'), { error: null, message: 'ResizeObserver loop completed' }));
  assert.strictEqual(guard.errors, 2);
  assert.deepStrictEqual(seen.map(r => r.source), ['error', 'unhandledrejection']);
  assert.ok(seen[0].stack.includes('async boom'));
  const frameErr = new Error('frame boom');
  for (let i = 0; i < 4; i++) guard.report(frameErr, 'frame');
  assert.strictEqual(surface.calls.length, 1);
  assert.strictEqual(guard.errors, 6);
  uninstall();
  target.dispatchEvent(Object.assign(new Event('error'), { error: err, message: err.message }));
  assert.strictEqual(guard.errors, 6);
}

// A boot failure opens the panel at once; resume lifts it for a retry; a broken listener is harmless.
{
  const guard = C.create({ log: () => {}, surface: null });
  guard.onCrash(() => { throw new Error('listener'); });
  const fatal = [];
  guard.onFatal(r => fatal.push(r));
  guard.report(new Error('404 assets/fighters/vela/atlas.png'), 'boot');
  assert.strictEqual(guard.paused, true);
  assert.strictEqual(fatal.length, 1);
  assert.strictEqual(fatal[0].message, '404 assets/fighters/vela/atlas.png');
  guard.resume();
  assert.strictEqual(guard.paused, false);
}

// The panel: text only, Reload for a crash, Retry (calling onRetry) for a boot failure.
function fakeDocument() {
  const byId = new Map();
  function el(tag) {
    const node = {
      tagName: tag.toUpperCase(), children: [], attrs: {}, listeners: {}, textContent: '', id: '', className: '', type: '',
      setAttribute(k, v) { node.attrs[k] = v; },
      appendChild(child) { node.children.push(child); child.parent = node; if (child.id) byId.set(child.id, child); return child; },
      addEventListener(k, fn) { node.listeners[k] = fn; },
      click() { if (node.listeners.click) node.listeners.click(); },
      remove() { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); byId.delete(node.id); },
      set innerHTML(v) { throw new Error('innerHTML must not be used'); },
    };
    return node;
  }
  const body = el('body');
  return { body, createElement: el, getElementById: id => byId.get(id) || null };
}
{
  const doc = fakeDocument();
  const payload = '<img src=x onerror=alert(1)>';
  const box = C.showPanel({ source: 'frame', message: payload, stack: '', count: 3, fatal: true }, { document: doc });
  const panel = box.children[0];
  assert.strictEqual(panel.children[0].textContent, 'SOMETHING BROKE');
  assert.strictEqual(panel.children[2].textContent, payload);
  assert.strictEqual(panel.children[3].textContent, 'RELOAD');
  let retried = 0;
  const boot = C.showPanel({ source: 'boot', message: 'b', stack: '', count: 1, fatal: true }, { document: doc, onRetry: () => retried++ });
  assert.strictEqual(doc.body.children.length, 1, 'a new panel replaces the old one');
  const button = boot.children[0].children[3];
  assert.strictEqual(button.textContent, 'RETRY');
  button.click();
  assert.strictEqual(retried, 1);
  assert.strictEqual(doc.body.children.length, 0);
}

// main.js runs its loop through the guard and reports boot failures to it; crash.js loads first.
{
  const main = fs.readFileSync(path.join(root, 'public/js/main.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.ok(/const frame = C\.frameLoop\(frameStep, crash\);/.test(main));
  assert.strictEqual((main.match(/requestAnimationFrame\(/g) || []).length, 1, 'only the first frame is scheduled by hand');
  assert.ok(/crash\.report\(err, 'boot'\)/.test(main));
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.strictEqual(scripts[0], 'js/crash.js');
}

// Review fixes: a throwing fixed step drops the backlog instead of rerunning on a half-applied tick.
{
  const app = { acc: 0 };
  let ticks = 0, throwing = true;
  const hostStep = () => { ticks++; if (throwing) throw new Error('boss AI threw'); };
  assert.throws(() => C.fixedSteps(app, 1000 / 60, 60, hostStep), /boss AI threw/);
  assert.strictEqual(ticks, 1, 'the rest of that frame does not run');
  assert.strictEqual(app.acc, 0, 'the backlog is dropped');
  throwing = false;
  assert.strictEqual(C.fixedSteps(app, 1000 / 60, 8, hostStep), 0, 'the failed tick is not rerun at once');
  assert.strictEqual(C.fixedSteps(app, 1000 / 60, 10, hostStep), 1);
  // main.js steps the host sim through it and returns whether the frame counts as good.
  const main = fs.readFileSync(path.join(root, 'public/js/main.js'), 'utf8');
  assert.ok(/C\.fixedSteps\(app, STEP, dt, hostStep\) > 0/.test(main));
  assert.ok(/return judged;\n}/.test(main));
}

// A step that always throws still trips the panel at 144 Hz, where most frames run no step.
{
  const guard = C.create({ threshold: 3, log: () => {}, surface: null });
  const app = { acc: 0 };
  const queue = [];
  C.frameLoop(() => C.fixedSteps(app, 1000 / 60, 1000 / 144, () => { throw new Error('step'); }) > 0, guard, cb => queue.push(cb))(0);
  for (let i = 0; i < 200 && !guard.paused; i++) queue.shift()(i);
  assert.strictEqual(guard.paused, true);
}

// A step that returns false neither grows nor resets the streak.
{
  const guard = C.create({ threshold: 3, log: () => {}, surface: null });
  const queue = [];
  let n = 0;
  C.frameLoop(() => { n++; if (n % 10 === 0) throw new Error('step'); return false; }, guard, cb => queue.push(cb))(0);
  for (let i = 0; i < 25; i++) queue.shift()(i);
  assert.strictEqual(guard.consecutive, 2);
  assert.strictEqual(guard.paused, false);
  for (let i = 0; i < 5; i++) queue.shift()(i);
  assert.strictEqual(guard.paused, true);
}

const errorEvent = init => Object.assign(new Event('error'), init);
const rejection = reason => Object.assign(new Event('unhandledrejection'), { reason });

// Page errors with no failing frame never pause the game (boot, hidden tab).
{
  const guard = C.create({ threshold: 3, log: () => {}, surface: null, origin: 'https://game.test' });
  const fatal = [];
  guard.onFatal(r => fatal.push(r));
  const target = new EventTarget();
  guard.install(target);
  for (let i = 0; i < 10; i++) {
    target.dispatchEvent(errorEvent({ error: new Error('e' + i), message: 'e' + i }));
    target.dispatchEvent(rejection('r' + i));
  }
  assert.strictEqual(guard.errors, 20, 'still counted');
  assert.strictEqual(guard.consecutive, 0);
  assert.strictEqual(fatal.length, 0);
  guard.report(new Error('frame'), 'frame');
  assert.strictEqual(guard.consecutive, 1, 'one failing frame after them is one, not a pause');
  assert.strictEqual(guard.paused, false);
}

// Page errors extend a streak that a failing frame started.
{
  const guard = C.create({ threshold: 3, log: () => {}, surface: null, origin: 'https://game.test' });
  const target = new EventTarget();
  guard.install(target);
  guard.report(new Error('frame'), 'frame');
  target.dispatchEvent(rejection('a'));
  assert.strictEqual(guard.paused, false);
  target.dispatchEvent(rejection('b'));
  assert.strictEqual(guard.paused, true);
}

// Cross-origin and muted errors are ignored.
{
  const guard = C.create({ log: () => {}, surface: null, origin: 'https://game.test' });
  const target = new EventTarget();
  guard.install(target);
  target.dispatchEvent(errorEvent({ error: null, message: 'Script error.' }));
  target.dispatchEvent(errorEvent({ error: new Error('ext'), message: 'ext', filename: 'chrome-extension://abc/content.js' }));
  target.dispatchEvent(errorEvent({ error: new Error('ad'), message: 'ad', filename: 'https://ads.example/x.js' }));
  assert.strictEqual(guard.errors, 0);
  target.dispatchEvent(errorEvent({ error: new Error('ours'), message: 'ours', filename: 'https://game.test/js/main.js' }));
  assert.strictEqual(guard.errors, 1);
  target.dispatchEvent(errorEvent({ error: new Error('inline'), message: 'inline', filename: '' }));
  assert.strictEqual(guard.errors, 2);
}

// AbortError and NotAllowedError rejections are ignored.
{
  const guard = C.create({ log: () => {}, surface: null });
  const target = new EventTarget();
  guard.install(target);
  target.dispatchEvent(rejection(new DOMException('The user aborted a request.', 'AbortError')));
  target.dispatchEvent(rejection(new DOMException('play() failed', 'NotAllowedError')));
  assert.strictEqual(guard.errors, 0);
  target.dispatchEvent(rejection(new DOMException('bad', 'NotFoundError')));
  assert.strictEqual(guard.errors, 1);
}

// A visibility change resets the streak.
{
  const guard = C.create({ threshold: 3, log: () => {}, surface: null });
  const target = new EventTarget();
  const doc = new EventTarget();
  const uninstall = guard.install(target, doc);
  guard.report(new Error('a'), 'frame');
  guard.report(new Error('b'), 'frame');
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.strictEqual(guard.consecutive, 0);
  guard.report(new Error('c'), 'frame');
  assert.strictEqual(guard.paused, false);
  uninstall();
  guard.report(new Error('d'), 'frame');
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.strictEqual(guard.consecutive, 2);
}

console.log('crash guard ok');
