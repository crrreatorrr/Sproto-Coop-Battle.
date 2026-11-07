// Browser proof: atlas cells match the pose PNGs, pose files are not requested,
// and a stage-1 boss plus projectile still paints. Three cold loads record medians.
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(__dirname, 'artifacts'));

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function probe(url) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (res.ok && (await res.text()) === 'ok') return true;
    } catch (err) { /* starting */ }
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
      if (!match || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ child, port: Number(match[1]) });
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
    delay(2000).then(() => child.kill('SIGKILL')),
  ]);
}

async function coldPage(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const client = await page.context().newCDPSession(page);
  await client.send('Network.setCacheDisabled', { cacheDisabled: true });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.SprotoApp && window.SprotoApp.screen === 'title', null, { timeout: 20000 });
  return { page, errors };
}

async function measure(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    const same = resources.filter(entry => entry.name.startsWith(location.origin) && !entry.name.endsWith('/favicon.ico'));
    const transfer = same.reduce((sum, entry) => sum + (entry.transferSize || 0), 0) + (nav && nav.transferSize ? nav.transferSize : 0);
    const names = same.map(entry => new URL(entry.name).pathname);
    if (nav) names.unshift(new URL(nav.name).pathname);
    return { transfer, duration: nav ? nav.duration : 0, requests: names.length, names };
  });
}

async function compareCells(page) {
  return page.evaluate(async () => {
    const load = src => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(src));
      image.src = src;
    });
    let checked = 0;
    let bad = 0;
    let first = '';
    for (let fid = 0; fid < MANIFEST.fighters.length; fid++) {
      const id = MANIFEST.fighters[fid].id;
      for (let i = 0; i < 40; i++) {
        const name = i < 32 ? String(i).padStart(2, '0') : 'w0' + (i - 32);
        const pose = i < 32 ? i : name;
        const png = await load('assets/fighters/' + id + '/' + name + '.png');
        const cell = Render.frameCanvas(fid, pose, 0);
        checked++;
        if (!cell) { bad++; first = first || id + ' ' + name + ' missing'; continue; }
        const got = cell.getContext('2d').getImageData(0, 0, 128, 128).data;
        const refc = document.createElement('canvas');
        refc.width = refc.height = 128;
        const g = refc.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.drawImage(png, 0, 0);
        const want = g.getImageData(0, 0, 128, 128).data;
        for (let p = 0; p < got.length; p++) {
          if (got[p] !== want[p]) { bad++; first = first || id + ' ' + name + ' byte ' + p; break; }
        }
      }
    }
    return { checked, bad, first };
  });
}

async function paintBoss(page) {
  return page.evaluate(async () => {
    const plan = AssetLoader.groups(MANIFEST);
    await AssetLoader.shared().preload(plan.firstBoss);
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const snap = {
      camX: 0, sk: 0, si: 0, t: 12, items: [], players: [], enemies: [], fx: [], banner: null,
      boss: { bi: 0, ph: 0, x: 420, y: 36, z: 0, t: 12, st: 'idle', fc: -1, fl: 0, mi: 0, row: 0, hp: 1800, mh: 2600 },
      projs: [{ k: 'boss', bi: 0, ph: 0, r: 0, t: 8, x: 220, y: 48, z: 16, vx: -4 }],
    };
    Render.drawWorld(ctx, snap);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let i = 3; i < data.length; i += 16) if (data[i] > 16) ink++;
    const sheet = plan.firstBoss[0];
    const image = Render.img(sheet);
    return { ink, ready: Render.ready(image), width: image.naturalWidth, errors: Render.loadStatus().errors, png: canvas.toDataURL('image/png') };
  });
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const started = await startServer();
  const url = 'http://127.0.0.1:' + started.port + '/';
  if (!await probe(url + 'healthz')) {
    await stopServer(started.child);
    throw new Error('healthz failed');
  }
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const runs = [];
  try {
    for (let i = 0; i < 3; i++) {
      const opened = await coldPage(browser, url);
      if (opened.errors.length) throw new Error('page errors: ' + opened.errors.join(' | '));
      const sample = await measure(opened.page);
      const poses = sample.names.filter(name => /\/fighters\/[^/]+\/(?:\d\d|w0\d)\.png$/.test(name));
      if (poses.length) throw new Error('startup requested pose pngs: ' + poses.join(','));
      runs.push(sample);
      if (i === 0) {
        await opened.page.screenshot({ path: path.join(out, 'c2-title.png') });
        const cells = await compareCells(opened.page);
        if (cells.bad || cells.checked !== 240) throw new Error('atlas cells differ from poses: ' + JSON.stringify(cells));
        const boss = await paintBoss(opened.page);
        if (!boss.ready || boss.width !== 1024) throw new Error('boss sheet was not ready: ' + JSON.stringify(boss));
        if (boss.errors.length) throw new Error('boss load errors: ' + boss.errors.join(','));
        if (boss.ink < 1000) throw new Error('boss frame did not paint: ' + boss.ink);
        fs.writeFileSync(path.join(out, 'c2-boss-phase.png'), Buffer.from(boss.png.replace(/^data:image\/png;base64,/, ''), 'base64'));
      }
      await opened.page.close();
    }
    const titleCap = Math.round(1.5 * 1024 * 1024);
    for (const run of runs) {
      if (run.transfer > titleCap) throw new Error('title transfer ' + run.transfer + ' exceeds ' + titleCap);
      if (run.requests > 30) throw new Error('title requests ' + run.requests);
    }
    const throttled = [];
    for (let i = 0; i < 3; i++) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const client = await page.context().newCDPSession(page);
      await client.send('Network.setCacheDisabled', { cacheDisabled: true });
      await client.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 100,
        downloadThroughput: (10 * 1000 * 1000) / 8,
        uploadThroughput: (10 * 1000 * 1000) / 8,
      });
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForFunction(() => window.SprotoApp && window.SprotoApp.screen === 'title', null, { timeout: 20000 });
      throttled.push(await measure(page));
      await page.close();
    }
    const transfers = runs.map(run => run.transfer);
    const durations = runs.map(run => run.duration);
    const summary = {
      browser: 'playwright-chromium',
      url: 'localhost',
      runs: runs.map(run => ({ transfer: run.transfer, duration: run.duration, requests: run.requests })),
      medianTransfer: median(transfers),
      medianDurationMs: median(durations),
      throttled: throttled.map(run => ({ transfer: run.transfer, duration: run.duration, requests: run.requests })),
      medianThrottledMs: median(throttled.map(run => run.duration)),
      throttle: '10 Mbps, 100 ms RTT, cache disabled, no CPU throttle',
      poseRequests: 0,
      cells: 240,
    };
    fs.writeFileSync(path.join(out, 'c2-load-medians.json'), JSON.stringify(summary, null, 2) + '\n');
    if (process.env.C2_SAVE_FIXTURES === '1') {
      const shots = path.join(root, 'tests', 'fixtures', 'screenshots');
      fs.copyFileSync(path.join(out, 'c2-title.png'), path.join(shots, 'c2-title.png'));
      fs.copyFileSync(path.join(out, 'c2-boss-phase.png'), path.join(shots, 'c2-boss-phase.png'));
      fs.copyFileSync(path.join(out, 'c2-load-medians.json'), path.join(root, 'tests', 'fixtures', 'c2-load-medians.json'));
    }
    console.log('atlas visual ok', JSON.stringify(summary));
  } finally {
    await browser.close().catch(() => {});
    await stopServer(started.child);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
