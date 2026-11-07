// Host + guest practice-relay smoke, plus local six-slot and all-CPU screenshots.
// Starts the practice server when nothing is already healthy on :8080.
// Usage: node tests/browser-online.cjs [outDir]
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const out = path.resolve(process.argv[2] || path.join(__dirname, 'artifacts'));
const root = path.join(__dirname, '..');

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function probe(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (res.ok && (await res.text()) === 'ok') return true;
    } catch (err) { /* not up yet */ }
    await delay(100);
  }
  return false;
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'server', 'server.js')], {
      cwd: root,
      env: { ...process.env, PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('server start timeout\n' + buf));
    }, 10000);
    const onData = chunk => {
      buf += chunk.toString();
      const match = buf.match(/http:\/\/localhost:(\d+)/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ child, port: Number(match[1]) });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', code => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error('server exited ' + code + '\n' + buf));
      }
    });
  });
}

async function stopServer(child) {
  if (!child || child.killed || child.exitCode != null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    delay(2000).then(() => { child.kill('SIGKILL'); }),
  ]);
}

async function acquire() {
  if (process.env.URL) {
    const health = new URL('/healthz', process.env.URL).toString();
    if (!await probe(health, 8000)) throw new Error('URL is set but /healthz did not become ok: ' + health);
    return { url: process.env.URL.endsWith('/') ? process.env.URL : process.env.URL + '/', child: null };
  }
  if (await probe('http://127.0.0.1:8080/healthz', 400)) {
    return { url: 'http://127.0.0.1:8080/', child: null };
  }
  const started = await startServer();
  const url = 'http://127.0.0.1:' + started.port + '/';
  if (!await probe(url + 'healthz', 8000)) {
    await stopServer(started.child);
    throw new Error('spawned server did not pass /healthz');
  }
  return { url, child: started.child };
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const acquired = await acquire();
  const errs = [];
  let browser;
  const summary = { url: acquired.url, ownedServer: !!acquired.child, screenshots: [], practice: true, economy: 'none' };
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const mk = async target => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      page.setDefaultTimeout(20000);
      page.on('pageerror', err => errs.push(err.message));
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return page;
    };

    const title = await mk(acquired.url);
    await title.waitForFunction(() => window.SprotoApp && window.SprotoApp.screen === 'title', null, { timeout: 45000 });
    await title.screenshot({ path: path.join(out, 'title.png') });
    summary.screenshots.push('title.png');

    const local = await mk(acquired.url);
    await local.waitForFunction(() => window.SprotoApp.screen === 'title', null, { timeout: 45000 });
    await local.keyboard.press('KeyF');
    await local.waitForFunction(() => window.SprotoApp.screen === 'lobby', null, { timeout: 10000 });
    const localSlots = await local.evaluate(() => window.SprotoApp.slots.map(slot => slot.ctrl));
    summary.localSlots = localSlots;
    if (localSlots.length !== 6 || localSlots.filter(ctrl => ctrl === 'local').length !== 1 || localSlots.filter(ctrl => ctrl === 'cpu').length !== 5) {
      throw new Error('local lobby is not one human plus five CPU: ' + localSlots.join(','));
    }
    await local.screenshot({ path: path.join(out, 'local-lobby-six-slots.png') });
    summary.screenshots.push('local-lobby-six-slots.png');

    const demo = await mk(acquired.url + '?demo=1');
    await demo.waitForFunction(() => window.SprotoApp.screen === 'game' && window.SprotoApp.sim && window.SprotoApp.sim.players.length === 6, null, { timeout: 45000 });
    const demoCtrls = await demo.evaluate(() => window.SprotoApp.sim.players.map(player => player.ctrl));
    summary.demoCtrls = demoCtrls;
    if (demoCtrls.some(ctrl => ctrl !== 'cpu')) throw new Error('demo was not six CPU: ' + demoCtrls.join(','));
    await demo.waitForTimeout(800);
    await demo.screenshot({ path: path.join(out, 'demo-six-cpu.png') });
    summary.screenshots.push('demo-six-cpu.png');

    const host = await mk(acquired.url);
    const guest = await mk(acquired.url);
    await host.waitForFunction(() => window.SprotoApp.screen === 'title', null, { timeout: 45000 });
    await guest.waitForFunction(() => window.SprotoApp.screen === 'title', null, { timeout: 45000 });
    await host.keyboard.press('ArrowDown');
    await host.waitForTimeout(150);
    await host.keyboard.press('KeyF');
    await host.waitForFunction(() => window.SprotoApp.code, null, { timeout: 10000 });
    const code = await host.evaluate(() => window.SprotoApp.code);
    summary.room = code;
    for (const key of ['ArrowDown', 'ArrowDown', 'KeyF']) {
      await guest.keyboard.press(key);
      await guest.waitForTimeout(150);
    }
    await guest.fill('#code', code);
    await guest.fill('#name', 'Tester');
    await guest.click('#joinForm button[type=submit]');
    await guest.waitForFunction(() => window.SprotoApp.myId > 0, null, { timeout: 10000 });
    await guest.waitForTimeout(300);
    await guest.keyboard.press('Comma');
    await host.waitForFunction(() => window.SprotoApp.slots.some(slot => slot.ctrl === 'remote'), null, { timeout: 10000 });
    const onlineSlots = await host.evaluate(() => window.SprotoApp.slots.map(slot => slot.ctrl));
    summary.onlineSlots = onlineSlots;
    if (onlineSlots.length !== 6) throw new Error('online room lost a seat');
    await guest.waitForTimeout(400);
    await guest.screenshot({ path: path.join(out, 'online-lobby-guest.png') });
    summary.screenshots.push('online-lobby-guest.png');
    await host.keyboard.press('Enter');
    await host.waitForFunction(() => window.SprotoApp.screen === 'stages', null, { timeout: 5000 });
    await host.keyboard.press('KeyF');
    await guest.waitForFunction(() => window.SprotoApp.screen === 'game' && window.SprotoApp.snap, null, { timeout: 10000 });
    await guest.keyboard.down('ArrowRight');
    await guest.waitForTimeout(1200);
    await guest.keyboard.up('ArrowRight');
    const moved = await host.evaluate(() => {
      const app = window.SprotoApp;
      const i = app.slots.findIndex(slot => slot.ctrl === 'remote');
      return { slot: i, x: app.sim.players[i].x, ctrl: app.sim.players[i].ctrl, start: 60 + i * 16, players: app.sim.players.length };
    });
    summary.remote = moved;
    console.log('remote player', moved);
    if (moved.players !== 6) throw new Error('host sim does not have six players');
    if (!(moved.x > moved.start + 20)) throw new Error('guest input did not move the remote Sproto');
    await guest.waitForTimeout(800);
    await guest.screenshot({ path: path.join(out, 'online-game-guest.png') });
    await host.screenshot({ path: path.join(out, 'online-game-host.png') });
    summary.screenshots.push('online-game-guest.png', 'online-game-host.png');
    const health = await fetch(acquired.url + 'healthz');
    summary.health = { status: health.status, body: await health.text(), relay: health.headers.get('x-sproto-relay') };
    if (summary.health.status !== 200 || summary.health.body !== 'ok') throw new Error('healthz failed during the smoke');
    console.log('page errors:', errs.length ? errs : 'none');
    if (errs.length) throw new Error('page errors: ' + errs.join(' | '));
    fs.writeFileSync(path.join(out, 'browser-summary.json'), JSON.stringify(summary, null, 2) + '\n');
    console.log('browser smoke ok', summary.screenshots.join(', '));
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopServer(acquired.child);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
