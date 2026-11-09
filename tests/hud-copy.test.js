// Banked HUD names a server receipt only when one is actually supplied.
// The live match does not send one, so the screen stays on the neutral line.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const NetHub = require(path.join(root, 'public/js/net-hub.js'));
const main = fs.readFileSync(path.join(root, 'public/js/main.js'), 'utf8');
const hub = fs.readFileSync(path.join(root, 'public/js/net-hub.js'), 'utf8');
const NEUTRAL = 'TICKETS PAID BY SERVER, SEE BALANCE';

assert.strictEqual(NetHub.payoutCopy(null), NEUTRAL);
assert.strictEqual(NetHub.payoutCopy(undefined), NEUTRAL);
assert.strictEqual(NetHub.payoutCopy({ paid: true, tickets: 20, reason: 'clear' }), '+20 TICKETS');
assert.strictEqual(NetHub.payoutCopy({ paid: false, tickets: 0, reason: 'already_paid' }), 'ALREADY CLAIMED TODAY');
assert.strictEqual(NetHub.payoutCopy({ paid: true, tickets: 20, reason: 'already_paid' }), 'ALREADY CLAIMED TODAY');
assert.strictEqual(NetHub.payoutCopy({ paid: false, tickets: 0, reason: 'afk' }), '0 TICKETS');
assert.strictEqual(NetHub.payoutCopy({ paid: false, tickets: 0, reason: 'god_mode' }), '0 TICKETS');
assert.strictEqual(NetHub.payoutCopy({ paid: false, tickets: 0, reason: 'practice' }), '0 TICKETS');
assert.strictEqual(NetHub.payoutCopy({ paid: true, tickets: 120, reason: 'clear' }), NEUTRAL);

const state = NetHub.createState();
state.banked = true;
NetHub.applyMessage(state, NetHub.OP.END, { t: 'end', reason: 'clear', rewards: 20, receipt: { paid: true, tickets: 20, reason: 'clear' } }, 1);
const view = NetHub.viewOf(state, 1);
assert.strictEqual(view.rewards, 0);
assert.strictEqual(view.receipt, null);
assert.strictEqual(view.payout, NEUTRAL);
assert.strictEqual(state.receipt, null);

assert.ok(main.includes('PRACTICE — NO TICKETS'));
assert.ok(!main.includes('NO HUB REWARDS'));
assert.ok(main.includes(NEUTRAL));
assert.ok(!main.includes('NO PAYOUT UNTIL H3-C'));
assert.ok(!main.includes('REWARDS 0'));
assert.ok(hub.includes('God Mode is practice only'));
assert.ok(!hub.includes('Rewards 0'));
assert.ok(!hub.includes('rewards 0'));
assert.ok(!main.includes('earnTickets') && !hub.includes('tickets.earn'));

console.log('hud copy ok');

async function shot() {
  const { createStandin, startStatic, stopChild, delay, openPlayer } = require('./browser-hub-online.cjs');
  const { launch } = require('./fixtures/c5-browser.cjs');
  const { chromium } = require('playwright');
  const standin = createStandin();
  const port = await standin.listen();
  const staticServer = await startStatic();
  const browser = await launch({ chromium }, 'chromium');
  const out = path.join(root, 'tests', 'artifacts', 'hud-ticket-copy.png');
  try {
    const page = await openPlayer(browser, staticServer.url, 'http://127.0.0.1:' + port, { id: 'acct-ada', name: 'ada' }, []);
    await page.evaluate(() => { window.SprotoApp.menu = 4; });
    await page.keyboard.press('KeyF');
    await page.waitForFunction(() => window.SprotoApp.screen === 'lobby' && window.SprotoApp.role === 'banked', null, { timeout: 15000 });
    await delay(400);
    const line = await page.evaluate(() => {
      const view = window.SprotoApp.authority.view();
      return { payout: view.payout, rewards: view.rewards, receipt: view.receipt, message: view.message };
    });
    assert.strictEqual(line.payout, NEUTRAL);
    assert.strictEqual(line.rewards, 0);
    assert.strictEqual(line.receipt, null);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out, animations: 'disabled' });
    console.log('hud shot', out, JSON.stringify(line));
  } finally {
    await browser.close().catch(() => {});
    await standin.close();
    await stopChild(staticServer.child);
  }
}

if (process.argv.includes('--shot')) {
  shot().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
