// Browser check: host + guest over the relay. Requires `npm start` running (PORT 8080 by default).
// Usage: node tests/browser-online.cjs [outDir]
const { chromium } = require('playwright');
const out = process.argv[2] || '.';
const URL = process.env.URL || 'http://localhost:8080/';
(async () => {
  const b = await chromium.launch();
  const errs = [];
  const mk = async () => { const p = await b.newPage({ viewport: { width: 1280, height: 720 } }); p.on('pageerror', e => errs.push(e.message)); await p.goto(URL); await p.waitForFunction(() => window.SprotoApp.screen === 'title', null, { timeout: 30000 }); return p; };
  const host = await mk(), guest = await mk();
  await host.keyboard.press('ArrowDown'); await host.waitForTimeout(150); await host.keyboard.press('KeyF');
  await host.waitForFunction(() => window.SprotoApp.code, null, { timeout: 10000 });
  const code = await host.evaluate(() => window.SprotoApp.code);
  for (const k of ['ArrowDown', 'ArrowDown', 'KeyF']) { await guest.keyboard.press(k); await guest.waitForTimeout(150); }
  await guest.fill('#code', code); await guest.fill('#name', 'Tester'); await guest.click('#joinForm button[type=submit]');
  await guest.waitForFunction(() => window.SprotoApp.myId > 0, null, { timeout: 10000 });
  await guest.waitForTimeout(300);
  await guest.keyboard.press('Comma'); // arrows layout joins a slot
  await host.waitForFunction(() => window.SprotoApp.slots.some(s => s.ctrl === 'remote'), null, { timeout: 10000 });
  await guest.waitForTimeout(400);
  await guest.screenshot({ path: out + '/online-lobby-guest.png' });
  await host.keyboard.press('Enter');
  await guest.waitForFunction(() => window.SprotoApp.screen === 'game' && window.SprotoApp.snap, null, { timeout: 10000 });
  await guest.keyboard.down('ArrowRight'); await guest.waitForTimeout(1200); await guest.keyboard.up('ArrowRight');
  const r = await host.evaluate(() => { const a = window.SprotoApp; const i = a.slots.findIndex(s => s.ctrl === 'remote'); return { slot: i, x: a.sim.players[i].x, ctrl: a.sim.players[i].ctrl, start: 60 + i * 16 }; });
  console.log('remote player', r);
  if (!(r.x > r.start + 20)) throw new Error('guest input did not move the remote Sproto');
  await guest.waitForTimeout(2500);
  await guest.screenshot({ path: out + '/online-game-guest.png' });
  await host.screenshot({ path: out + '/online-game-host.png' });
  console.log('page errors:', errs.length ? errs : 'none');
  if (errs.length) process.exitCode = 1;
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
