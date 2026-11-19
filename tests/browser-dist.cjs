// The built dist/ page in real Chromium: one minified startup bundle reaches the title, and the
// first stage pulls the in-game scripts as one fx bundle. No page errors either way.
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.txt': 'text/plain',
};

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(String(req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(dist, rel);
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  const { buildDist, APP_BUNDLE, FX_BUNDLE } = await import('../scripts/build.mjs');
  buildDist();
  const server = await serve();
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [], scripts = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('request', req => { if (req.resourceType() === 'script') scripts.push(new URL(req.url()).pathname.slice(1)); });
    page.on('requestfailed', req => errors.push('failed ' + req.url()));
    await page.goto(url);
    await page.waitForFunction(() => window.SprotoApp && window.SprotoApp.screen === 'title', null, { timeout: 20000 });
    assert.deepStrictEqual(scripts, [APP_BUNDLE], 'the title needs one script request');
    const globals = await page.evaluate(() => ['Sim', 'Render', 'Input', 'Audio2', 'Progress', 'AssetLoader', 'CoopHub', 'NetHub', 'SprotoApp']
      .filter(name => !window[name]));
    assert.deepStrictEqual(globals, [], 'every startup global is defined');
    await page.evaluate(() => window.Render.enterStage(0));
    await page.waitForFunction(() => ['CoopSpriteTimeline', 'CoopSpriteClipPlayer', 'CoopBossActionSelection', 'CoopBossActionPlayer',
      'CoopBossFxSelection', 'CoopBossTransformPlayer', 'CoopBossMorphField', 'CoopBossMorph', 'RenderFx'].every(name => window[name]),
    null, { timeout: 20000 });
    assert.ok(scripts.includes(FX_BUNDLE), 'the in-game scripts come as one bundle');
    assert.ok(!scripts.some(src => /^js\/(render-fx|boss-morph|sprite-timeline)\.js$/.test(src)), 'no separate in-game script requests');
    // Draw a frame of the first stage through the bundled renderer.
    const drawn = await page.evaluate(() => {
      const sim = window.Sim.create([{ fid: 0, weapon: 0, ctrl: 'local' }, { fid: 1, weapon: 0, ctrl: window.Sim.EMPTY },
        { fid: 2, weapon: 0, ctrl: window.Sim.EMPTY }, { fid: 3, weapon: 0, ctrl: window.Sim.EMPTY }], 7, 0);
      for (let i = 0; i < 60; i++) window.Sim.step(sim);
      const canvas = document.createElement('canvas'); canvas.width = window.Sim.W; canvas.height = window.Sim.H;
      window.Render.drawWorld(canvas.getContext('2d'), window.Sim.snapshot(sim), {});
      return canvas.toDataURL().length;
    });
    assert.ok(drawn > 1000, 'the bundled renderer draws a stage');
    assert.deepStrictEqual(errors, []);
    console.log('browser dist ok', JSON.stringify({ scripts }));
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
