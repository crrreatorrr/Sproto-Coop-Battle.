// Host + guest practice-relay smoke, the four-seat party lobby, and the all-CPU attract game.
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
    if (localSlots.length !== 4 || localSlots.filter(ctrl => ctrl === 'local').length !== 1 || localSlots.filter(ctrl => ctrl === 'cpu').length !== 3) {
      throw new Error('local lobby is not one human plus three CPU teammates: ' + localSlots.join(','));
    }
    await local.screenshot({ path: path.join(out, 'local-lobby-four-slots.png') });
    summary.screenshots.push('local-lobby-four-slots.png');
    await local.waitForFunction(() => window.PartyPicker);
    await local.keyboard.press('KeyH');
    await local.waitForFunction(() => window.SprotoApp.roster?.slot === 0);
    await local.keyboard.press('KeyH');
    await local.waitForFunction(() => window.SprotoApp.roster?.slot === 1);
    for (const fid of [5, 9]) {
      await local.keyboard.press('KeyS');
      await local.waitForFunction(index => window.SprotoApp.roster?.fid === index, fid);
    }
    await local.keyboard.press('KeyF');
    await local.keyboard.press('KeyR');
    await local.waitForFunction(() => {
      const { slots } = window.SprotoApp;
      return slots[1].ctrl === 'cpu' && slots[1].fid === 9 && slots[1].classId === 'healer' && slots[0].fid === 0;
    });
    await local.screenshot({ path: path.join(out, 'cpu-roster.png') });
    summary.screenshots.push('cpu-roster.png');
    await local.keyboard.press('Escape');
    await local.waitForFunction(() => !window.SprotoApp.roster);
    const equipped = page => page.evaluate(() => {
      const slot = window.SprotoApp.slots[0];
      return { classId: slot.classId, tier: Sim.WEAPONS[slot.weapon].tier };
    });
    await local.keyboard.press('KeyS');
    if ((await equipped(local)).tier !== 1) throw new Error('a fresh local lobby can equip a locked tier');
    await local.keyboard.press('Enter');
    await local.waitForFunction(() => window.SprotoApp.screen === 'stages');
    await local.keyboard.press('KeyF');
    await local.waitForFunction(() => window.SprotoApp.screen === 'game' && window.SprotoApp.sim);
    const cpuLoaded = await local.evaluate(() => {
      const p = window.SprotoApp.sim.players[1];
      return p.ctrl === 'cpu' && p.fid === 9 && p.classId === 'healer';
    });
    if (!cpuLoaded) throw new Error('the configured CPU did not enter the battle with its loadout');
    summary.cpuLoadoutInBattle = true;
    await local.evaluate(() => { window.SprotoApp.sim.mode = 'clear'; });
    await local.waitForFunction(() => Progress.weaponTier(window.SprotoApp.progress.get()) === 2);
    await local.evaluate(() => { window.SprotoApp.sim.mode = 'gameover'; });
    await local.keyboard.press('Enter');
    await local.waitForFunction(() => window.SprotoApp.screen === 'lobby');
    for (const [i, id] of ['fighter', 'mage', 'healer', 'ranged'].entries()) {
      if (i) await local.keyboard.press('KeyR');
      await local.waitForFunction(role => window.SprotoApp.slots[0].classId === role, id);
      await local.keyboard.press('KeyS');
      await local.waitForFunction(() => Sim.WEAPONS[window.SprotoApp.slots[0].weapon].tier === 2);
    }
    summary.universalWeaponUnlock = true;

    const demo = await mk(acquired.url + '?demo=1');
    await demo.waitForFunction(() => window.SprotoApp.screen === 'game' && window.SprotoApp.sim && window.SprotoApp.sim.players.length === 4, null, { timeout: 45000 });
    const demoCtrls = await demo.evaluate(() => window.SprotoApp.sim.players.map(player => player.ctrl));
    summary.demoCtrls = demoCtrls;
    if (demoCtrls.some(ctrl => ctrl !== 'cpu')) throw new Error('demo was not four CPU: ' + demoCtrls.join(','));
    await demo.waitForTimeout(800);
    await demo.screenshot({ path: path.join(out, 'demo-four-cpu.png') });
    summary.screenshots.push('demo-four-cpu.png');

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
    if (onlineSlots.length !== 4) throw new Error('online room lost a seat');
    const remoteClass = () => host.evaluate(() => window.SprotoApp.slots.find(slot => slot.ctrl === 'remote').classId);
    for (let i = 0; i < 4 && await remoteClass() !== 'healer'; i++) {
      const role = await remoteClass();
      await guest.keyboard.press('Quote');
      await host.waitForFunction(previous => window.SprotoApp.slots.some(slot => slot.ctrl === 'remote' && slot.classId !== previous), role);
    }
    if (await remoteClass() !== 'healer') throw new Error('the remote player could not choose Healer');
    await guest.waitForTimeout(400);
    await guest.screenshot({ path: path.join(out, 'online-lobby-guest.png') });
    summary.screenshots.push('online-lobby-guest.png');
    await host.keyboard.press('Enter');
    await host.waitForFunction(() => window.SprotoApp.screen === 'stages', null, { timeout: 5000 });
    await host.keyboard.press('KeyF');
    await guest.waitForFunction(() => window.SprotoApp.screen === 'game' && window.SprotoApp.snap, null, { timeout: 10000 });
    await host.evaluate(() => {
      const sim = window.SprotoApp.sim;
      sim.players[0].hp = 30;
      sim.players[1].x = sim.players[0].x + 12;
      sim.players[1].y = sim.players[0].y;
      for (const p of sim.players) if (p.ctrl === 'cpu') p.abilityCd = 300;
    });
    await guest.keyboard.down('Quote');
    await guest.waitForFunction(() => {
      const snap = window.SprotoApp.snap;
      return snap.players[0].hp > 30 && snap.players[1].ac > 0 && snap.fx.some(f => f.k === 'class-heal');
    }, null, { timeout: 5000 });
    await guest.keyboard.up('Quote');
    summary.relayHeal = true;
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
    if (moved.players !== 4) throw new Error('host sim does not have four players');
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
