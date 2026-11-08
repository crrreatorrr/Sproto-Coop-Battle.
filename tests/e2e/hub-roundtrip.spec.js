// C5: Bar entry, login chip, Ticket balance, and return.
// The deterministic half runs in CI. C5_BAR=1 drives the real hub cabinet.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { startStatic, stopChild, delay } = require('../browser-hub-online.cjs');
const { root, artifactDir, hardware, browserVersion, launch, shot, writeSummary } = require('../fixtures/c5-browser.cjs');

const MENU = ['LOCAL PLAY', 'HOST ONLINE', 'JOIN ONLINE', 'HUB QUICK', 'HUB ROOM', 'JOIN HUB', 'RETURN TO BAR'];
const out = artifactDir();

function loadLink() {
  const context = { console, URL, URLSearchParams, atob, btoa };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'public/js/hub-config.js'), 'utf8'), context, { filename: 'hub-config.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'public/js/hub-link.js'), 'utf8'), context, { filename: 'hub-link.js' });
  return context.CoopHub;
}

function nodeContract() {
  const main = fs.readFileSync(path.join(root, 'public/js/main.js'), 'utf8');
  const link = fs.readFileSync(path.join(root, 'public/js/hub-link.js'), 'utf8');
  assert.ok(main.includes(JSON.stringify(MENU.slice(0, 3)).replace(/"/g, "'")) || main.includes("['LOCAL PLAY', 'HOST ONLINE', 'JOIN ONLINE']"));
  for (const item of ['HUB QUICK', 'HUB ROOM', 'JOIN HUB', 'RETURN TO BAR']) assert.ok(main.includes(item), item);
  assert.ok(link.includes("#from=' + GAME_ID") || link.includes('#from='));
  assert.ok(!main.includes('earnTickets') && !main.includes('reportEvent') && !main.includes('submitScore'));
  const CoopHub = loadLink();
  const loc = { protocol: 'http:', hostname: '127.0.0.1', port: '8080', hash: '', pathname: '/', search: '' };
  const session = CoopHub.createSession({
    location: loc,
    config: { hubUrl: 'http://127.0.0.1:5173/hub/', serverUrl: 'http://127.0.0.1:7350', serverKey: 'defaultkey' },
    local: memory(),
    session: memory(),
    readHash: () => '',
    writeHash() {},
    assign() {},
    loadSdk: async () => null,
  });
  assert.strictEqual(session.exitUrl(), 'http://127.0.0.1:5173/hub/#from=sproto-coop-battle');
  const ignored = CoopHub.createSession({
    location: loc,
    config: { hubUrl: 'javascript:alert(1)' },
    local: memory(),
    session: memory(),
    readHash: () => '',
    writeHash() {},
    assign() {},
    loadSdk: async () => null,
  });
  assert.strictEqual(ignored.exitUrl(), '/hub/#from=sproto-coop-battle');
  console.log('return target is the Bar hash and a script URL is ignored');
}

function memory() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
  };
}

async function openTitle(browser, base) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.SprotoApp && window.SprotoApp.screen === 'title', null, { timeout: 45000 });
  return { page, errors };
}

async function pressMenu(page, item) {
  const index = MENU.indexOf(item);
  assert.ok(index >= 0, item);
  await page.bringToFront();
  for (let attempt = 0; attempt < 4; attempt++) {
    const screen = await page.evaluate(i => {
      if (window.SprotoApp.screen === 'title') window.SprotoApp.menu = i;
      return window.SprotoApp.screen;
    }, index);
    if (screen !== 'title') return;
    await page.keyboard.press('KeyF');
    await delay(150);
  }
}

async function profileLoads(browser, base) {
  async function once(context, label) {
    const page = await context.newPage();
    const started = Date.now();
    await page.goto(base + '?' + label, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.SprotoApp && window.SprotoApp.screen === 'title', null, { timeout: 45000 });
    const elapsed = Date.now() - started;
    const traffic = await page.evaluate(() => {
      const rows = performance.getEntriesByType('resource');
      return {
        requests: rows.length + 1,
        transfer: rows.reduce((sum, row) => sum + (row.transferSize || 0), 0),
      };
    });
    await page.close();
    return { ms: elapsed, requests: traffic.requests, transfer: traffic.transfer };
  }
  const coldContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const cold = await once(coldContext, 'cold=1');
  await coldContext.close();
  const warmContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await once(warmContext, 'prime=1');
  const warm = await once(warmContext, 'warm=1');
  await warmContext.close();
  assert.ok(cold.ms < 8000, 'cold title ' + cold.ms);
  assert.ok(warm.ms < 8000, 'warm title ' + warm.ms);
  return { cold, warm };
}

async function browserRoundtrip(playwright, names, base) {
  const shots = [];
  const browsers = {};
  try {
    for (const name of names) {
      const browser = await launch(playwright, name);
      browsers[name] = { browser, ua: await browserVersion(browser) };
      const opened = await openTitle(browser, base);
      const chip = await opened.page.evaluate(() => ({
        kind: window.SprotoApp.hub.kind,
        label: window.SprotoApp.hub.label,
        balance: window.SprotoApp.hub.balance,
        screen: window.SprotoApp.screen,
      }));
      assert.strictEqual(chip.kind, 'offline');
      assert.strictEqual(chip.balance, null);
      shots.push(await shot(opened.page, path.join(out, 'c5-title-' + name + '.png')));
      await opened.page.route('**/hub/**', route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>bar return</title><p id="landed"></p><script>document.getElementById("landed").textContent=location.hash</script>',
      }));
      await pressMenu(opened.page, 'LOCAL PLAY');
      await opened.page.waitForFunction(() => window.SprotoApp.screen === 'lobby', null, { timeout: 10000 });
      const practice = await opened.page.evaluate(() => window.SprotoApp.role);
      assert.strictEqual(practice, 'local');
      shots.push(await shot(opened.page, path.join(out, 'c5-practice-lobby-' + name + '.png')));
      await opened.page.keyboard.press('Enter');
      await opened.page.waitForFunction(() => window.SprotoApp.screen === 'stages', null, { timeout: 10000 });
      await opened.page.keyboard.press('KeyF');
      await opened.page.waitForFunction(() => window.SprotoApp.screen === 'game' && window.SprotoApp.sim, null, { timeout: 10000 });
      await opened.page.keyboard.press('KeyB');
      await opened.page.waitForFunction(() => window.SprotoApp.hub.confirming, null, { timeout: 5000 });
      shots.push(await shot(opened.page, path.join(out, 'c5-return-confirm-' + name + '.png')));
      await opened.page.keyboard.press('KeyF');
      await opened.page.waitForSelector('#landed', { timeout: 10000 });
      const landed = await opened.page.evaluate(() => ({ href: location.href, hash: location.hash, text: document.getElementById('landed').textContent }));
      assert.strictEqual(landed.hash, '#from=sproto-coop-battle');
      shots.push(await shot(opened.page, path.join(out, 'c5-return-landed-' + name + '.png')));
      const pageErrors = opened.errors.filter(msg => !/Closed before resume|control thread state is "closed"/i.test(msg));
      if (pageErrors.length) throw new Error(name + ' ' + pageErrors.join(' | '));
      browsers[name].landed = landed;
      await opened.page.close();
    }
    return { browsers, shots };
  } finally {
    for (const row of Object.values(browsers)) {
      if (row.browser) await row.browser.close().catch(() => {});
    }
  }
}

function hubBase() {
  const raw = process.env.HUB_URL || 'http://127.0.0.1:5173/hub/';
  return raw.endsWith('/') ? raw : raw + '/';
}

async function barEntry(playwright) {
  const base = hubBase();
  const probe = await fetch(base, { signal: AbortSignal.timeout(4000) }).then(res => res.ok).catch(() => false);
  if (!probe) throw new Error('hub is not reachable at ' + base);
  const browser = await launch(playwright, 'chromium');
  const shots = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  try {
    const stamp = Date.now().toString(36);
    const username = ('c5' + stamp).slice(0, 16);
    await page.goto(base + '#from=sproto-coop-battle', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#login-username', { timeout: 60000 });
    shots.push(await shot(page, path.join(out, 'c5-bar-login.png')));
    await page.fill('#login-username', username);
    await page.fill('#login-password', 'c5-accept-pass');
    await page.fill('#login-email', username + '@example.com');
    await page.click('#login-submit');
    await page.waitForFunction(() => {
      const login = document.getElementById('login');
      return login && (login.hidden || login.getAttribute('data-view') === 'done' || getComputedStyle(login).display === 'none' || login.classList.contains('left'));
    }, null, { timeout: 90000 }).catch(() => null);
    const loginError = await page.locator('#login-error').textContent().catch(() => '');
    await page.waitForFunction(() => {
      const hint = document.getElementById('hint');
      return hint && /Sproto Coop Battle|Press E/.test(hint.textContent || '');
    }, null, { timeout: 90000 });
    const hint = await page.locator('#hint').textContent();
    shots.push(await shot(page, path.join(out, 'c5-bar-cabinet.png')));
    await page.keyboard.press('KeyE');
    await page.waitForSelector('.arcade-picker', { timeout: 10000 });
    const choices = await page.locator('.arcade-picker button').allTextContents();
    shots.push(await shot(page, path.join(out, 'c5-bar-picker.png')));
    assert.ok(choices.some(text => text.includes('Sproto Coop Battle')), JSON.stringify(choices));
    assert.strictEqual(choices.length, 3, JSON.stringify(choices));
    await page.keyboard.press('Digit3');
    await page.waitForFunction(() => window.SprotoApp && window.SprotoApp.screen === 'title', null, { timeout: 60000 });
    await page.waitForFunction(() => {
      const hub = window.SprotoApp && window.SprotoApp.hub;
      return hub && (hub.kind === 'account' || hub.kind === 'guest') && typeof hub.balance === 'number';
    }, null, { timeout: 20000 });
    const entered = await page.evaluate(() => ({
      href: location.href,
      hash: location.hash,
      kind: window.SprotoApp.hub.kind,
      label: window.SprotoApp.hub.label,
      balance: window.SprotoApp.hub.balance,
    }));
    assert.ok(!entered.hash.includes('t='), 'ticket fragment was left in the URL');
    shots.push(await shot(page, path.join(out, 'c5-bar-entered.png')));
    await page.keyboard.press('KeyB');
    await page.waitForFunction(() => /#from=sproto-coop-battle/.test(location.hash) && document.getElementById('hint'), null, { timeout: 30000 });
    await page.waitForFunction(() => {
      const hint = document.getElementById('hint');
      return hint && /Sproto Coop Battle|Press E|Arcade/.test(hint.textContent || '');
    }, null, { timeout: 90000 });
    shots.push(await shot(page, path.join(out, 'c5-bar-returned.png')));
    const returned = await page.evaluate(() => ({ href: location.href, hash: location.hash, hint: document.getElementById('hint').textContent }));
    assert.ok(returned.hash.includes('from=sproto-coop-battle'), returned.href);
    if (errors.length) throw new Error(errors.join(' | '));
    return { username, hint, choices, entered, returned, shots, loginError: loginError || '' };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  nodeContract();
  if (process.env.C5_NODE_ONLY === '1') return;
  const { chromium, firefox } = require('playwright');
  const staticServer = await startStatic();
  const summary = { hardware: hardware(), screenshots: [], profile: null, browsers: {}, bar: null };
  try {
    const names = ['chromium'];
    try {
      const probeBrowser = await firefox.launch({ headless: true });
      await probeBrowser.close();
      names.push('firefox');
    } catch (err) {
      summary.firefox = 'unavailable: ' + err.message;
    }
    const round = await browserRoundtrip({ chromium, firefox }, names, staticServer.url);
    summary.screenshots.push(...round.shots);
    for (const name of names) {
      summary.browsers[name] = { ua: round.browsers[name].ua, landed: round.browsers[name].landed };
    }
    const profileBrowser = await launch({ chromium }, 'chromium');
    try {
      summary.profile = await profileLoads(profileBrowser, staticServer.url);
    } finally {
      await profileBrowser.close();
    }
    if (process.env.C5_BAR === '1') summary.bar = await barEntry({ chromium });
    if (summary.bar) summary.screenshots.push(...summary.bar.shots);
    writeSummary(out, 'c5-roundtrip-summary.json', summary);
    console.log('roundtrip ok', JSON.stringify({ browsers: Object.keys(summary.browsers), profile: summary.profile, bar: summary.bar && { username: summary.bar.username, kind: summary.bar.entered.kind, balance: summary.bar.entered.balance, hash: summary.bar.returned.hash } }));
  } finally {
    await stopChild(staticServer.child);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
