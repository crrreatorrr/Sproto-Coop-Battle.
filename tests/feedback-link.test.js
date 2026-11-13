// The feedback adapter (public/js/feedback-link.js): install rules, pause / resume and context.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const F = require(path.join(root, 'public/js/feedback-link.js'));

function fakeSdk() {
  const calls = { installed: 0, crumbs: [], opened: 0 };
  let open = false;
  const HubSDK = {
    feedbackTransportFromSdk: sdk => ({ sdk }),
    installFeedback(options) {
      calls.installed++;
      calls.options = options;
      return {
        open() { calls.opened++; open = true; },
        close() { open = false; options.onClose(); },
        isOpen: () => open,
        breadcrumb: (type, data) => calls.crumbs.push([type, data]),
      };
    },
  };
  return { HubSDK, calls };
}

function playing(role) {
  const players = [0, 1, 2, 3].map(i => ({ s: i, n: 'Sproto ' + i, w: i, c: i === 2 ? 'local' : 'cpu', x: 100 + i, y: 40 + i, z: 0, hp: 80 - i, l: 2, sc: 1500 * i, cb: 1, st: 'idle' }));
  return {
    role, screen: 'game', paused: false, frozen: false, pauseMenu: null, myId: 7, runId: 'run-1', hub: { kind: 'account' },
    slots: players.map(p => ({ ctrl: p.c, owner: 0, dev: p.c === 'local' ? 'k1' : '' })),
    sim: { stage: { waves: [{ done: true }, { done: true }, { done: false }, { done: false }] } },
    view: { t: 900, si: 0, mode: 'play', lock: 1, camX: 600, len: 2400, god: 0, players, enemies: [{}, {}], boss: { ph: 1, hp: 300, mh: 900, st: 'idle' } },
  };
}

// The version in the adapter is the package version.
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.strictEqual(F.VERSION, pkg.version);

// Without the SDK (standalone play) nothing is installed and every call is harmless.
{
  const fb = F.create({ app: playing('local') });
  assert.strictEqual(fb.install(undefined, null), false);
  assert.strictEqual(fb.install({}, {}), false);
  assert.strictEqual(fb.ready(), false);
  assert.strictEqual(fb.isOpen(), false);
  assert.strictEqual(fb.open(), false);
  fb.breadcrumb('stage_start', { stage: 1 });
}

// Local play freezes without touching the pause state, and resume puts back what was there.
for (const before of [{ paused: false, pauseMenu: null }, { paused: true, pauseMenu: { dev: 'keys', sel: 1, held: false } }]) {
  const app = Object.assign(playing('local'), before);
  const keys = new Set(['KeyD', 'KeyF']);
  const fb = F.create({ app, input: { keys } });
  const token = fb.pause();
  assert.notStrictEqual(token, false);
  assert.strictEqual(app.frozen, true);
  assert.strictEqual(keys.size, 0, 'held keys are dropped');
  assert.strictEqual(app.paused, before.paused);
  assert.strictEqual(app.pauseMenu, before.pauseMenu);
  keys.add('Escape');
  fb.resume(token);
  assert.strictEqual(app.frozen, false);
  assert.strictEqual(keys.size, 0);
  assert.strictEqual(app.paused, before.paused);
  assert.strictEqual(app.pauseMenu, before.pauseMenu);
  assert.strictEqual(app.screen, 'game');
}

// Online roles cannot pause: nothing is frozen and no server hold is asked for.
for (const role of ['host', 'guest', 'banked']) {
  const app = playing(role);
  let holds = 0;
  app.authority = { toggleHold() { holds++; }, accountId: () => 'acct', view: () => ({}) };
  const fb = F.create({ app, input: { keys: new Set() } });
  assert.strictEqual(fb.pause(), false, role);
  assert.strictEqual(app.frozen, false);
  assert.strictEqual(app.paused, false);
  assert.strictEqual(holds, 0);
}

// Context: stage, mode, the local player's position and state, and the extras.
{
  globalThis.MANIFEST = { bosses: [{ key: '01-marina-bront', stage: 'Tidebreak Marina', machines: ['Breakwater Tug', 'Dry Dock Press'] }] };
  globalThis.Sim = { WEAPONS: [{ name: 'Bat' }, { name: 'Pipe' }, { name: 'Laser' }] };
  const fb = F.create({ app: playing('local'), netHub: { FINGERPRINT: 'f8705ec4b68e5643e7ce' } });
  const c = fb.context();
  assert.strictEqual(c.level, '01 Tidebreak Marina');
  assert.strictEqual(c.mode, 'local practice');
  assert.deepStrictEqual(c.position, { x: 102, y: 42, z: 0 });
  assert.strictEqual(c.gameTime, 15);
  assert.deepStrictEqual(c.player, { slot: 3, character: 'Sproto 2', weapon: 'Laser', health: 78, lives: 2, score: 3000, combo: 1, state: 'idle', control: 'local' });
  assert.strictEqual(c.extra.role, 'local');
  assert.strictEqual(c.extra.players, 4);
  assert.strictEqual(c.extra.humans, 1);
  assert.strictEqual(c.extra.wave, 2);
  assert.strictEqual(c.extra.waves, 4);
  assert.strictEqual(c.extra.progress, 25);
  assert.deepStrictEqual(c.extra.boss, { name: 'Dry Dock Press', phase: 2, hp: 300, maxHp: 900, state: 'idle' });
  assert.strictEqual(c.extra.fingerprint, 'f8705ec4b68e5643e7ce');
  assert.strictEqual(fb.version(), pkg.version + '+f8705ec4');
  assert.ok(JSON.stringify(c).length < 2000);

  // A relay guest finds its own seat by owner id.
  const guest = playing('guest');
  guest.sim = null;
  guest.slots[2] = { ctrl: 'local', owner: 0, dev: 'k1' };
  guest.slots[3] = { ctrl: 'remote', owner: 7, dev: 'k1' };
  const g = F.create({ app: guest }).context();
  assert.strictEqual(g.player.slot, 4);
  assert.strictEqual(g.mode, 'relay practice (guest)');
  assert.strictEqual(g.extra.wave, undefined);

  // Menus and broken state never throw.
  const menu = playing('local');
  menu.screen = 'title';
  assert.strictEqual(F.create({ app: menu }).context().level, 'menu: title');
  const broken = playing('local');
  broken.view = { si: 0, players: null, get mode() { throw new Error('boom'); } };
  assert.ok(F.create({ app: broken }).context().extra.contextError);
  assert.deepStrictEqual(F.create({}).context(), {});
}

// Install happens once, early breadcrumbs are replayed, and the pause-menu callback runs on close.
{
  const { HubSDK, calls } = fakeSdk();
  const report = [];
  const fb = F.create({ app: playing('local'), crash: { onCrash: fn => report.push(fn) } });
  fb.breadcrumb('stage_start', { stage: 1 });
  const sdk = {};
  assert.strictEqual(fb.install(HubSDK, sdk), true);
  assert.strictEqual(fb.install(HubSDK, sdk), true);
  assert.strictEqual(calls.installed, 1);
  assert.strictEqual(calls.options.transport.sdk, sdk);
  assert.strictEqual(calls.options.title, 'Sproto Coop Battle');
  assert.strictEqual(calls.options.theme.radius, '0');
  assert.ok(calls.options.theme.font.includes('Press Start 2P'));
  assert.deepStrictEqual(calls.crumbs, [['stage_start', { stage: 1 }]]);
  fb.breadcrumb('boss_start', { stage: 1, phase: 1 });
  assert.strictEqual(calls.crumbs.length, 2);
  report[0]({ message: 'bad frame', stack: 'at x', source: 'frame' });
  assert.strictEqual(calls.options.errors()[0].message, 'bad frame');
  let reopened = 0;
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => 0;
  try { assert.strictEqual(fb.open(() => reopened++), true); } finally { globalThis.setTimeout = realTimeout; }
  assert.strictEqual(fb.isOpen(), true);
  assert.strictEqual(fb.open(), false, 'already open');
  calls.options.onClose();
  calls.options.onClose();
  assert.strictEqual(reopened, 1);
}

// The page loads the adapter after the hub link, and main.js freezes on app.frozen.
{
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.ok(scripts.indexOf('js/feedback-link.js') > scripts.indexOf('js/hub-link.js'));
  assert.ok(scripts.indexOf('js/feedback-link.js') < scripts.indexOf('js/main.js'));
  const main = fs.readFileSync(path.join(root, 'public/js/main.js'), 'utf8');
  assert.ok(main.includes('!app.paused && !app.frozen'));
  assert.ok(main.includes('if (app.frozen)'));
}

console.log('feedback link ok');
