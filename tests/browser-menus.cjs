// Browser check for the full-window canvas, the shared menu options (MAIN MENU, RETURN TO BAR,
// CONTROLLER SETTINGS, FULL SCREEN) and the controller settings screen: no page scroll at two
// window sizes, every menu lists the options, a keyboard key and a pad button can be rebound and
// take effect in a run, and FULL SCREEN is requested from the key press itself.
// Usage: node tests/browser-menus.cjs [screenshot dir]
'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(__dirname, 'artifacts', 'menus'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const SHARED = ['CONTROLLER SETTINGS', 'FULL SCREEN'];

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { cwd: root, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('server start timeout\n' + buf)); }, 10000);
    const onData = chunk => {
      buf += chunk.toString();
      const m = buf.match(/http:\/\/localhost:(\d+)/);
      if (m) { clearTimeout(timer); resolve({ child, port: Number(m[1]) }); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
  });
}

// A fake standard pad in slot 0, driven from the test through window.__pad.
function fakePad() {
  const pad = { id: 'Test pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  window.__pad = pad;
  window.__press = (i, on) => { pad.buttons[i] = { pressed: on, value: on ? 1 : 0 }; };
  navigator.getGamepads = () => [pad, null, null, null];
}

// Wait for the game to run n more frames, so input lands however loaded the machine is.
async function frames(page, n) {
  const t = await page.evaluate(() => window.SprotoApp.t);
  await page.waitForFunction(([t0, k]) => window.SprotoApp.t >= t0 + k, [t, n || 3], { timeout: 10000 });
}
async function tap(page, code) { await page.keyboard.down(code); await frames(page, 2); await page.keyboard.up(code); await frames(page, 2); }
async function padTap(page, button) {
  await page.evaluate(b => window.__press(b, true), button); await frames(page, 3);
  await page.evaluate(b => window.__press(b, false), button); await frames(page, 3);
}
const state = page => page.evaluate(() => {
  const a = window.SprotoApp, el = document.scrollingElement, cv = document.getElementById('game').getBoundingClientRect();
  return {
    screen: a.screen, paused: a.paused, menu: !!a.pauseMenu, controls: !!a.controls, confirm: a.confirmMain, fsCalls: a.fsCalls,
    scroll: { h: el.scrollHeight, w: el.scrollWidth, ih: innerHeight, iw: innerWidth }, canvas: { w: cv.width, h: cv.height, x: cv.left, y: cv.top },
  };
});
// The labels a menu shows right now, read from the same functions that draw it.
const items = page => page.evaluate(() => window.SprotoApp.menuItems());

async function check(browser, base, size, shots) {
  const ctx = await browser.newContext({ viewport: size });
  await ctx.addInitScript(fakePad);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(base + '/');
  await page.waitForFunction(() => window.SprotoApp && window.SprotoApp.screen === 'title', null, { timeout: 30000 });
  await page.evaluate(() => { try { localStorage.clear(); } catch (err) { /* none */ } });
  const tag = size.width + 'x' + size.height;
  const shot = async name => { if (shots) await page.screenshot({ path: path.join(out, tag + '-' + name + '.png') }); };
  const fits = async where => {
    const s = await state(page);
    assert.ok(s.scroll.h <= s.scroll.ih && s.scroll.w <= s.scroll.iw, where + ': page scrolls ' + JSON.stringify(s.scroll));
    const fill = Math.max(s.canvas.w / s.scroll.iw, s.canvas.h / s.scroll.ih);
    assert.ok(fill > 0.99, where + ': canvas does not fill the window ' + JSON.stringify(s));
    assert.ok(Math.abs(s.canvas.w / s.canvas.h - 16 / 9) < 0.01, where + ': canvas is stretched');
    return s;
  };
  const hasShared = (list, where, main) => {
    for (const want of SHARED) assert.ok(list.some(s => s.startsWith(want)), where + ' lacks ' + want + ': ' + list.join(','));
    assert.ok(list.includes('RETURN TO BAR'), where + ' lacks the hub return');
    assert.strictEqual(list.includes('MAIN MENU'), main, where + ' MAIN MENU');
  };

  // ---- title ----
  await fits('title');
  hasShared(await items(page), 'title', false);
  await shot('title');

  // ---- controller settings from the title: rebind WASD attack F -> J ----
  const titleList = await items(page);
  await page.evaluate(i => { window.SprotoApp.menu = i; }, titleList.indexOf('CONTROLLER SETTINGS'));
  await tap(page, 'Enter');
  assert.ok((await state(page)).controls, 'controller settings opened');
  await fits('controls');
  await shot('controls-keys');
  for (let i = 0; i < 4; i++) await tap(page, 'ArrowDown'); // LEFT RIGHT UP DOWN ATTACK
  await tap(page, 'Enter');
  assert.ok(await page.evaluate(() => !!window.SprotoApp.controls.cap), 'press-to-bind started');
  await shot('controls-capture');
  await tap(page, 'KeyJ');
  const bound = await page.evaluate(() => ({ k1: window.Input.LAYOUTS.k1.a, saved: JSON.parse(localStorage.getItem(window.Input.Controls.STORE_KEY)).keys.k1.a }));
  assert.deepStrictEqual(bound.k1, ['KeyJ'], 'k1 attack is J');
  assert.deepStrictEqual(bound.saved, ['KeyJ'], 'saved to localStorage');
  // A reserved key is refused and the capture stays open; Esc cancels it.
  await tap(page, 'Enter'); await tap(page, 'KeyM');
  assert.deepStrictEqual(await page.evaluate(() => window.Input.LAYOUTS.k1.a), ['KeyJ'], 'M is reserved');
  await tap(page, 'Escape');
  assert.ok(await page.evaluate(() => !window.SprotoApp.controls.cap), 'Esc cancels the capture');
  // Pad 1 tab: rebind jump A -> Y with the pad itself.
  await tap(page, 'ArrowRight'); await tap(page, 'ArrowRight');
  assert.strictEqual(await page.evaluate(() => window.SprotoApp.controls.tab), 2, 'pad 1 tab');
  await tap(page, 'ArrowDown'); // JUMP is row 5
  await tap(page, 'Enter');
  await frames(page, 3);
  await padTap(page, 3); // Y
  const jump = await page.evaluate(() => window.Input.Controls.get().pads[0]);
  assert.deepStrictEqual(jump.j, [3], 'pad 1 jump is Y');
  assert.ok(!jump.p.includes(3), 'Y left POWER (swap or warn): ' + JSON.stringify(jump));
  await shot('controls-pad');
  await tap(page, 'Escape');
  assert.strictEqual((await state(page)).controls, false, 'Esc closes the controller settings');

  // ---- full screen from the title, inside the key press ----
  await page.evaluate(i => { window.SprotoApp.menu = i; }, (await items(page)).findIndex(s => s.startsWith('FULL SCREEN')));
  const before = (await state(page)).fsCalls;
  await tap(page, 'Enter');
  await delay(300);
  const fs1 = await page.evaluate(() => ({ calls: window.SprotoApp.fsCalls, active: window.SprotoApp.fsActive, on: !!document.fullscreenElement, label: window.SprotoApp.menuItems().find(s => s.startsWith('FULL SCREEN')) }));
  assert.strictEqual(fs1.calls, before + 1, 'FULL SCREEN called once');
  assert.notStrictEqual(fs1.active, false, 'called with user activation');
  assert.strictEqual(fs1.label, 'FULL SCREEN: ' + (fs1.on ? 'ON' : 'OFF'), 'label follows document.fullscreenElement');
  assert.strictEqual((await state(page)).screen, 'title', 'the key did not also pick another item');
  console.log('  full screen: ' + JSON.stringify(fs1));
  if (fs1.on) { await tap(page, 'Enter'); await delay(300); assert.ok(!(await page.evaluate(() => !!document.fullscreenElement)), 'FULL SCREEN toggles off'); }

  // ---- lobby and its menu (Tab), stage select and its menu (pad View) ----
  await page.evaluate(() => { window.SprotoApp.menu = 0; });
  await tap(page, 'Enter');
  await page.waitForFunction(() => window.SprotoApp.screen === 'lobby');
  await fits('lobby');
  await shot('lobby');
  await tap(page, 'Tab');
  assert.ok((await state(page)).menu, 'Tab opens the lobby menu');
  hasShared(await items(page), 'lobby menu', true);
  await shot('lobby-menu');
  await tap(page, 'Escape');
  assert.strictEqual((await state(page)).screen, 'lobby', 'Esc closes the menu, not the lobby');
  await tap(page, 'Enter');
  await page.waitForFunction(() => window.SprotoApp.screen === 'stages');
  await shot('stages');
  await padTap(page, 8); // View
  assert.ok((await state(page)).menu, 'pad View opens the stage menu');
  hasShared(await items(page), 'stage menu', true);
  await shot('stages-menu');
  await padTap(page, 1); // B closes it
  assert.ok(!(await state(page)).menu, 'B closes the menu');

  // ---- a run: the rebound keys drive the sim ----
  await tap(page, 'Enter');
  await page.waitForFunction(() => window.SprotoApp.screen === 'game');
  await delay(1500);
  await fits('game');
  await shot('game');
  const read = () => page.evaluate(() => ({ a: window.SprotoApp.sim.players[0].in.a, j: window.SprotoApp.sim.players[0].in.j }));
  await page.keyboard.down('KeyJ'); await frames(page, 4);
  assert.strictEqual((await read()).a, 1, 'J attacks after the remap');
  await page.keyboard.up('KeyJ'); await page.keyboard.down('KeyF'); await frames(page, 4);
  assert.strictEqual((await read()).a, 0, 'F no longer attacks');
  await page.keyboard.up('KeyF'); await frames(page, 3);

  // ---- pause menu, MAIN MENU asks first, mouse picks ----
  await tap(page, 'Escape');
  const paused = await state(page);
  assert.ok(paused.menu && paused.paused, 'Esc pauses with the menu');
  hasShared(await items(page), 'pause menu', true);
  await shot('pause');
  await page.evaluate(() => { const m = window.SprotoApp.pauseMenu; m.sel = window.SprotoApp.menuItems().indexOf('CONTROLLER SETTINGS'); });
  await tap(page, 'Enter');
  assert.ok((await state(page)).controls && (await state(page)).paused, 'controller settings over a paused run');
  await shot('pause-controls');
  await tap(page, 'Escape');
  assert.ok((await state(page)).menu && !(await state(page)).controls, 'back to the pause menu');
  await page.evaluate(() => { const m = window.SprotoApp.pauseMenu; m.sel = window.SprotoApp.menuItems().indexOf('MAIN MENU'); });
  await tap(page, 'Enter');
  assert.ok((await state(page)).confirm, 'MAIN MENU asks in a live run');
  await shot('main-menu-confirm');
  await tap(page, 'Escape');
  const kept = await state(page);
  assert.ok(!kept.confirm && kept.menu && kept.paused && kept.screen === 'game', 'Esc keeps the run');
  // Close the menu and reopen it with the mouse box, then pick MAIN MENU and YES with the mouse.
  await tap(page, 'Escape');
  const box = await page.evaluate(() => document.getElementById('game').getBoundingClientRect().toJSON());
  const at = (x, y) => [box.x + x * box.width / 640, box.y + y * box.height / 360];
  await page.mouse.move(...at(320, 200)); await frames(page, 2);
  await page.mouse.click(...at(620, 60)); await frames(page, 2);
  assert.ok((await state(page)).menu, 'the MENU box opens the menu');
  const list = await items(page), y0 = (360 - (64 + list.length * 18)) / 2;
  await page.mouse.click(...at(320, y0 + 50 + list.indexOf('MAIN MENU') * 18)); await frames(page, 2);
  assert.ok((await state(page)).confirm, 'mouse MAIN MENU asks');
  await page.mouse.click(...at(290, 194)); await frames(page, 2);
  assert.strictEqual((await state(page)).screen, 'title', 'YES goes to the title');

  // ---- game over: the summary keeps the menu ----
  await page.evaluate(() => { window.SprotoApp.menu = 0; });
  await tap(page, 'Enter'); await tap(page, 'Enter');
  await page.waitForFunction(() => window.SprotoApp.screen === 'stages');
  await tap(page, 'Enter');
  await page.waitForFunction(() => window.SprotoApp.screen === 'game');
  await page.evaluate(() => { window.SprotoApp.sim.mode = 'gameover'; });
  await delay(400);
  await shot('gameover');
  await tap(page, 'Escape');
  hasShared(await items(page), 'game over menu', true);
  await shot('gameover-menu');
  await page.evaluate(() => { const m = window.SprotoApp.pauseMenu; m.sel = window.SprotoApp.menuItems().indexOf('MAIN MENU'); });
  await tap(page, 'Enter');
  assert.strictEqual((await state(page)).screen, 'title', 'a finished run leaves without asking');

  // ---- pad remap in a run: Y jumps on pad 1 ----
  await page.evaluate(() => { window.SprotoApp.menu = 0; });
  await padTap(page, 0); // A on the title: LOCAL PLAY, pad 1 is P1
  await page.waitForFunction(() => window.SprotoApp.screen === 'lobby');
  await padTap(page, 9); await padTap(page, 0); // Start: stages, A: fight
  await page.waitForFunction(() => window.SprotoApp.screen === 'game');
  await delay(300);
  await page.evaluate(() => window.__press(3, true)); await frames(page, 4);
  assert.strictEqual((await read()).j, 1, 'pad Y jumps after the remap');
  await page.evaluate(() => window.__press(3, false)); await frames(page, 3);
  await page.evaluate(() => window.__press(0, true)); await frames(page, 4);
  assert.strictEqual((await read()).j, 0, 'pad A no longer jumps');
  await page.evaluate(() => window.__press(0, false)); await frames(page, 3);

  assert.deepStrictEqual(errors, [], 'page errors');
  await ctx.close();
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    for (const size of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 900, height: 560 }]) {
      await check(browser, 'http://127.0.0.1:' + server.port, size, true);
      console.log('menus ok at ' + size.width + 'x' + size.height);
    }
  } finally {
    await browser.close().catch(() => {});
    server.child.kill('SIGKILL');
  }
  console.log('browser menus ok, shots in ' + out);
})().catch(err => { console.error(err); process.exit(1); });
