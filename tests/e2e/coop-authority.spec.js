// C5: six humans, one account, mixed seats, twelve stages, UFO/revive/powers,
// downed lives, AFK, late joins, and God Mode / practice isolation.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createAuthorityMatch, OP, FINGERPRINT, PROTOCOL, startStatic, stopChild, delay } = require('../browser-hub-online.cjs');
const { root, artifactDir, hardware, launch, shot, writeSummary } = require('../fixtures/c5-browser.cjs');

const DEVICES = ['k1', 'k2', 'gp0', 'gp1', 'gp2', 'gp3'];
const BOSSES = [
  '01-marina-bront', '02-last-light-vela', '03-mudline-crapto', '04-ranch-zephyr',
  '05-neon-sproto102', '06-circuit-rune', '07-moonkeep-bigswole', '08-crown-alpha777',
  '09-hatchery-highsproto', '10-verse-sprotosales', '11-rooftop-sproto1668', '12-codebreak-sproto3106',
];
const out = artifactDir();

function loadBundle() {
  const sandbox = { console: { log() {} } };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const files = ['public/js/manifest.js', 'public/js/sim.js', 'public/js/ai.js', 'public/js/net-protocol.js', 'tests/fixtures/sha256.js', 'tests/fixtures/scenarios.js'];
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
  return sandbox;
}

function seatAll(session, CoopProtocol, accountId, count) {
  for (let slot = 0; slot < count; slot++) {
    const assigned = CoopProtocol.assignSeat(session, { slot, accountId, device: DEVICES[slot], generation: 1 });
    assert.strictEqual(assigned.ok, true, assigned.reason || 'assign');
  }
}

function stepNeutral(CoopProtocol, session, loops) {
  for (let i = 0; i < loops; i++) {
    const stepped = CoopProtocol.stepLoop(session, [null, null, null], i * 100);
    assert.strictEqual(stepped.ok, true, stepped.reason || 'step');
  }
}

function authority() {
  const sandbox = loadBundle();
  const { CoopProtocol, Sim, Scenarios } = sandbox;
  const manifest = CoopProtocol.contentManifest(sandbox.MANIFEST);
  const bossIds = JSON.parse(JSON.stringify(manifest.stages.map(stage => stage.canonicalBossId)));
  assert.deepStrictEqual(bossIds, BOSSES);
  assert.strictEqual(manifest.stages.length, 12);

  const goldens = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/sim-goldens.json'), 'utf8'));
  const ran = Scenarios.runAll();
  assert.strictEqual(ran.content, goldens.content);
  assert.strictEqual(ran.cases.length, goldens.cases.length);
  for (let i = 0; i < goldens.cases.length; i++) {
    assert.strictEqual(ran.cases[i].id, goldens.cases[i].id);
    assert.strictEqual(ran.cases[i].stateHash, goldens.cases[i].stateHash, ran.cases[i].id);
    assert.strictEqual(ran.cases[i].mode, goldens.cases[i].mode, ran.cases[i].id);
  }
  const stage1 = ran.cases.find(row => row.id === 'human-seed3-stage1');
  assert.ok(stage1.flags.ufo > 0 && stage1.flags.revive > 0 && stage1.flags.dead > 0 && stage1.flags.power > 0);
  assert.ok(stage1.flags.boss > 0);
  assert.ok(ran.cases.find(row => row.id === 'human-seed5-stage1').flags.bossPhase >= 1);
  for (let stage = 0; stage < 12; stage++) {
    for (const kind of ['human', 'mixed', 'cpu']) assert.ok(ran.cases.some(row => row.id === 'stage-' + stage + '-' + kind));
  }

  const one = CoopProtocol.createMatch({ mode: 'banked', seed: 3, matchId: 'one-account' });
  assert.strictEqual(one.ok, true);
  seatAll(one.session, CoopProtocol, 'acct-ada', 6);
  assert.strictEqual(CoopProtocol.beginEncounter(one.session).ok, true);
  stepNeutral(CoopProtocol, one.session, 2);
  const oneFacts = CoopProtocol.participationFacts(one.session);
  assert.strictEqual(oneFacts.accounts.length, 1);
  assert.strictEqual(oneFacts.accounts[0].slots.length, 6);
  assert.strictEqual(oneFacts.accounts[0].presentAtStart, 1);
  assert.strictEqual(oneFacts.tickets, 0);
  assert.strictEqual(oneFacts.phasesAreOneClear, 1);
  const beforeLife = JSON.stringify(CoopProtocol.lifeFacts(one.session.state));
  CoopProtocol.releaseSeat(one.session, { slot: 5, accountId: 'acct-ada', generation: 1 });
  assert.strictEqual(JSON.stringify(CoopProtocol.lifeFacts(one.session.state)), beforeLife);
  assert.strictEqual(one.session.state.players[5].ctrl, 'cpu');

  const six = CoopProtocol.createMatch({ mode: 'banked', seed: 4, matchId: 'six-humans' });
  const names = ['ada', 'bea', 'cy', 'dee', 'eli', 'fay'];
  for (let i = 0; i < 6; i++) {
    assert.strictEqual(CoopProtocol.assignSeat(six.session, { slot: i, accountId: 'acct-' + names[i], device: 'k1', generation: 1 }).ok, true);
  }
  CoopProtocol.beginEncounter(six.session);
  stepNeutral(CoopProtocol, six.session, 1);
  const sixFacts = CoopProtocol.participationFacts(six.session);
  assert.strictEqual(sixFacts.accounts.length, 6);
  assert.ok(sixFacts.accounts.every(row => row.slots.length === 1 && row.presentAtStart === 1));

  const mixed = CoopProtocol.createMatch({ mode: 'banked', seed: 5, matchId: 'mixed' });
  assert.strictEqual(CoopProtocol.assignSeat(mixed.session, { slot: 0, accountId: 'acct-ada', device: 'k1', generation: 1 }).ok, true);
  assert.strictEqual(CoopProtocol.assignSeat(mixed.session, { slot: 1, accountId: 'acct-ada', device: 'k2', generation: 1 }).ok, true);
  assert.strictEqual(CoopProtocol.assignSeat(mixed.session, { slot: 2, accountId: 'acct-bea', device: 'gp0', generation: 1 }).ok, true);
  CoopProtocol.beginEncounter(mixed.session);
  stepNeutral(CoopProtocol, mixed.session, 1);
  const mixedFacts = CoopProtocol.participationFacts(mixed.session);
  assert.strictEqual(mixedFacts.accounts.length, 2);
  assert.strictEqual(mixedFacts.accounts.find(row => row.accountId === 'acct-ada').slots.length, 2);
  assert.strictEqual(mixed.session.state.players.filter(player => player.ctrl === 'cpu').length, 3);

  const late = CoopProtocol.createMatch({ mode: 'banked', seed: 6, matchId: 'late' });
  CoopProtocol.assignSeat(late.session, { slot: 0, accountId: 'acct-ada', device: 'k1', generation: 1 });
  CoopProtocol.beginEncounter(late.session);
  stepNeutral(CoopProtocol, late.session, 2);
  CoopProtocol.assignSeat(late.session, { slot: 1, accountId: 'acct-bea', device: 'k2', generation: 1 });
  stepNeutral(CoopProtocol, late.session, 1);
  const lateFacts = CoopProtocol.participationFacts(late.session);
  const bea = lateFacts.accounts.find(row => row.accountId === 'acct-bea');
  assert.strictEqual(bea.presentAtStart, 0);
  assert.strictEqual(bea.eligible, 0);
  assert.strictEqual(lateFacts.tickets, 0);

  const afk = CoopProtocol.createMatch({ mode: 'banked', seed: 7, matchId: 'afk' });
  CoopProtocol.assignSeat(afk.session, { slot: 0, accountId: 'acct-ada', device: 'k1', generation: 1 });
  CoopProtocol.beginEncounter(afk.session);
  stepNeutral(CoopProtocol, afk.session, 200);
  const afkRow = CoopProtocol.participationFacts(afk.session).accounts[0];
  assert.strictEqual(afkRow.nonNeutral, 0);
  assert.ok(afkRow.neutralAlive >= 300, 'neutral ' + afkRow.neutralAlive);
  assert.strictEqual(afkRow.afk, 1);
  assert.strictEqual(afkRow.eligible, 0);

  const down = CoopProtocol.createMatch({ mode: 'banked', seed: 8, matchId: 'down' });
  CoopProtocol.assignSeat(down.session, { slot: 0, accountId: 'acct-ada', device: 'k1', generation: 1 });
  CoopProtocol.beginEncounter(down.session);
  for (let i = 1; i < 6; i++) {
    down.session.state.players[i].st = 'dead';
    down.session.state.players[i].x = 8000;
  }
  down.session.state.players[0].st = 'down';
  down.session.state.players[0].downT = 5000;
  down.session.state.players[0].lives = 1; // no spare life: with one, the last human drops back in at once (plan A3)
  down.session.state.players[0].x = 80;
  stepNeutral(CoopProtocol, down.session, 200);
  const downRow = CoopProtocol.participationFacts(down.session).accounts[0];
  assert.ok(downRow.downTicks > 300, 'down ' + downRow.downTicks);
  assert.ok(downRow.neutralAlive < 300, 'down counted as idle ' + downRow.neutralAlive);
  assert.strictEqual(downRow.afk, 0);

  const banked = CoopProtocol.createMatch({ mode: 'banked', seed: 9, matchId: 'god' });
  const god = CoopProtocol.command(banked.session, { t: 'god' }, 1);
  assert.strictEqual(god.ok, false);
  assert.strictEqual(banked.session.state.god, false);
  const stage = CoopProtocol.command(banked.session, { t: 'stage', index: 4 }, 1);
  assert.strictEqual(stage.ok, false);
  assert.strictEqual(banked.session.state.stageIdx, 0);
  assert.strictEqual(CoopProtocol.command(banked.session, { t: 'earn', amount: 120 }, 1).ok, false);
  assert.strictEqual(CoopProtocol.terminalFacts(banked.session).tickets, 0);

  const practice = CoopProtocol.createMatch({ mode: 'practice', seed: 10, matchId: 'practice', stage: 3 });
  assert.strictEqual(practice.ok, true);
  assert.strictEqual(practice.session.state.stageIdx, 3);
  const toggled = CoopProtocol.command(practice.session, { t: 'god' }, 1);
  assert.strictEqual(toggled.ok, true);
  assert.strictEqual(practice.session.state.god, true);
  assert.strictEqual(CoopProtocol.command(practice.session, { t: 'stage', index: 11 }, 1).ok, true);
  assert.strictEqual(practice.session.state.stageIdx, 11);
  assert.strictEqual(CoopProtocol.terminalFacts(practice.session).tickets, 0);
  assert.strictEqual(CoopProtocol.command(practice.session, { t: 'earn' }, 1).reason, 'rejected');
  const refused = CoopProtocol.createMatch({ mode: 'banked', seed: 11, matchId: 'no-stage', stage: 2 });
  assert.strictEqual(refused.ok, false);

  const standin = createAuthorityMatch({ id: 'stale', privateRoom: true, seed: 12 });
  const who = { userId: 'acct-ada', sessionId: 's1', username: 'ada' };
  standin.hello(who, { t: 'hello', protocol: PROTOCOL, fingerprint: '0'.repeat(64), devices: ['k1'] });
  assert.ok(standin.drain().some(row => row.body && row.body.reason === 'version_mismatch'));
  standin.hello(who, { t: 'hello', protocol: PROTOCOL, fingerprint: FINGERPRINT, devices: DEVICES });
  assert.strictEqual(standin.seatView().filter(seat => seat.human).length, 6);
  standin.command(who);
  assert.strictEqual(standin.state.session.state.god, false);
  assert.strictEqual(standin.state.ledgerWrites, 0);
  const lives = standin.life().lives.slice();
  const saved = standin.shutdown();
  assert.strictEqual(saved.saved.rewards, 0);
  const restored = createAuthorityMatch({ id: 'restored', privateRoom: true, seed: 12, restore: saved.saved });
  assert.strictEqual(restored.seatView().filter(seat => seat.human).length, 6);
  assert.deepStrictEqual(restored.life().lives, lives);
  assert.strictEqual(Sim.STATE_VERSION, 1);
  console.log('authority facts ok', JSON.stringify({ goldens: ran.cases.length, ms: ran.ms, ufo: stage1.flags.ufo, revive: stage1.flags.revive, power: stage1.flags.power, dead: stage1.flags.dead }));
  return { cases: ran.cases.length, ms: ran.ms, stage1: stage1.flags };
}

async function stageShots() {
  const { chromium } = require('playwright');
  const staticServer = await startStatic();
  const browser = await launch({ chromium }, 'chromium');
  const shots = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(staticServer.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.SprotoApp && window.SprotoApp.screen === 'title', null, { timeout: 45000 });
    await page.keyboard.press('KeyF');
    await page.waitForFunction(() => window.SprotoApp.screen === 'lobby', null, { timeout: 10000 });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.SprotoApp.screen === 'stages', null, { timeout: 10000 });
    shots.push(await shot(page, path.join(out, 'c5-stage-select.png')));
    for (let stage = 0; stage < 12; stage++) {
      await page.evaluate(index => {
        window.SprotoApp.progress.freePlay = true; // every stage is drawn here, unlocked or not
        window.SprotoApp.stageSel = index;
        window.SprotoApp.screen = 'stages';
        window.SprotoApp.sim = null;
      }, stage);
      for (let attempt = 0; attempt < 4; attempt++) {
        const ready = await page.evaluate(index => window.SprotoApp.screen === 'game' && window.SprotoApp.sim && window.SprotoApp.sim.stageIdx === index, stage);
        if (ready) break;
        await page.keyboard.press('KeyF');
        await delay(200);
      }
      await page.waitForFunction(index => window.SprotoApp.screen === 'game' && window.SprotoApp.sim && window.SprotoApp.sim.stageIdx === index, stage, { timeout: 10000 });
      await delay(350);
      const drawn = await page.evaluate(() => ({
        stage: window.SprotoApp.sim.stageIdx,
        boss: window.MANIFEST.bosses[window.SprotoApp.sim.stageIdx].stage,
        mode: window.SprotoApp.sim.mode,
      }));
      assert.strictEqual(drawn.stage, stage);
      shots.push(await shot(page, path.join(out, 'c5-stage-' + String(stage + 1).padStart(2, '0') + '.png')));
      if (stage === 0) {
        await page.keyboard.press('Digit9');
        await delay(80);
        await page.keyboard.press('Digit9');
        await page.waitForFunction(() => window.SprotoApp.sim && window.SprotoApp.sim.god, null, { timeout: 5000 });
        shots.push(await shot(page, path.join(out, 'c5-practice-god.png')));
        const tickets = await page.evaluate(() => window.SprotoApp.hub.balance);
        assert.strictEqual(tickets, null);
      }
      await page.evaluate(() => { window.SprotoApp.screen = 'stages'; window.SprotoApp.sim = null; });
    }
    return shots;
  } finally {
    await browser.close().catch(() => {});
    await stopChild(staticServer.child);
  }
}

async function soak(ms) {
  const { chromium } = require('playwright');
  const staticServer = await startStatic();
  const browser = await launch({ chromium }, 'chromium');
  const samples = [];
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const client = await page.context().newCDPSession(page);
    await client.send('Performance.enable');
    await page.goto(staticServer.url + '?demo=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.SprotoApp && window.SprotoApp.screen === 'game' && window.SprotoApp.sim, null, { timeout: 45000 });
    const started = Date.now();
    while (Date.now() - started < ms) {
      const metrics = await client.send('Performance.getMetrics');
      const heap = metrics.metrics.find(row => row.name === 'JSHeapUsedSize');
      const nodes = metrics.metrics.find(row => row.name === 'Nodes');
      const live = await page.evaluate(() => ({
        screen: window.SprotoApp.screen,
        mode: window.SprotoApp.sim && window.SprotoApp.sim.mode,
        stage: window.SprotoApp.sim && window.SprotoApp.sim.stageIdx,
        tick: window.SprotoApp.sim && window.SprotoApp.sim.t,
      }));
      samples.push({
        t: Date.now() - started,
        jsHeap: heap ? heap.value : null,
        nodes: nodes ? nodes.value : null,
        screen: live.screen,
        mode: live.mode,
        stage: live.stage,
        tick: live.tick,
      });
      if (!live.mode || live.mode === 'gameover' || live.mode === 'victory' || live.screen !== 'game') {
        await page.evaluate(() => {
          const app = window.SprotoApp;
          app.role = 'local';
          app.progress.freePlay = true;
          app.stageSel = ((app.sim && app.sim.stageIdx) || 0) % 12;
          app.screen = 'stages';
        });
        await page.keyboard.press('KeyF');
        await page.waitForFunction(() => window.SprotoApp.screen === 'game' && window.SprotoApp.sim, null, { timeout: 10000 }).catch(() => {});
      }
      const remain = ms - (Date.now() - started);
      if (remain <= 0) break;
      await delay(Math.min(30000, remain));
    }
    const heaps = samples.map(row => row.jsHeap).filter(value => typeof value === 'number');
    const first = heaps[0] || 0;
    const last = heaps[heaps.length - 1] || 0;
    const peak = heaps.reduce((max, value) => Math.max(max, value), 0);
    return { ms, samples: samples.length, first, last, peak, growth: last - first, hardware: hardware(), tail: samples.slice(-3) };
  } finally {
    await browser.close().catch(() => {});
    await stopChild(staticServer.child);
  }
}

async function main() {
  const facts = authority();
  const summary = { hardware: hardware(), facts, screenshots: [] };
  if (process.env.C5_NODE_ONLY !== '1') summary.screenshots = await stageShots();
  if (process.env.C5_SOAK_MS) summary.soak = await soak(Number(process.env.C5_SOAK_MS));
  writeSummary(out, 'c5-authority-summary.json', summary);
  if (summary.soak) writeSummary(out, 'c5-soak.json', summary.soak);
  console.log('authority ok', JSON.stringify({ cases: facts.cases, shots: summary.screenshots.length, soak: summary.soak && { samples: summary.soak.samples, growth: summary.soak.growth, peak: summary.soak.peak } }));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
