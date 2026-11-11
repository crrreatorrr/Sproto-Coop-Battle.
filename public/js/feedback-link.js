// In-game feedback (press N twice) for Sproto Coop Battle. Classic script. The window itself lives
// in the hub SDK (HubSDK.installFeedback); this file is only the game's adapter: how to freeze local
// play, what "right now" looks like, and the pixel theme. Without the SDK or a hub session nothing is
// installed, so offline and practice-server play never see it. It reads app state only and never
// touches the pinned sim files.
(function (root) {
  'use strict';
  var VERSION = '0.1.0'; // package.json version; tests/feedback-link.test.js keeps the two equal
  var TITLE = 'Sproto Coop Battle';
  var PIXEL = '"Press Start 2P", ui-monospace, monospace';
  // The join dialog's look: dark panel, yellow frame, square corners.
  var THEME = {
    font: PIXEL,
    titleFont: PIXEL,
    background: 'rgba(0, 0, 0, 0.6)',
    panel: '#14112a',
    text: '#ffffff',
    muted: '#c8c6e0',
    accent: '#ffd23d',
    accentText: '#000000',
    border: '#555070',
    radius: '0',
    css: '.root { font-size: 9px; line-height: 1.7; }' +
      ' .panel { border: 3px solid #ffd23d; box-shadow: none; padding: 16px; }' +
      ' .title { font-size: 12px; color: #ffd23d; }' +
      ' .sub, .hint, .shotbar, .mini, .chip kbd { font-size: 7px; }' +
      ' .msg, .toast, .toast button { font-size: 8px; }' +
      ' .chip, .mini, .btn, textarea { border-width: 2px; }' +
      ' .mini { white-space: nowrap; }' +
      ' textarea { font-size: 10px; background: #000; color: #ffd23d; }' +
      ' .btn.primary { font-weight: 400; }' +
      ' .shot canvas { image-rendering: pixelated; }',
  };
  var CRUMB_MAX = 24;
  var ERROR_MAX = 10;

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  function create(deps) {
    deps = deps || {};
    var app = deps.app || null;
    var handle = null;
    var waiting = []; // breadcrumbs recorded before the SDK was installed
    var errors = [];
    var afterClose = null;

    function input() { return deps.input || root.Input || null; }
    function fingerprint() {
      var net = deps.netHub || root.NetHub;
      return net && typeof net.FINGERPRINT === 'string' ? net.FINGERPRINT : '';
    }
    function version() {
      var f = fingerprint();
      return VERSION + (f ? '+' + f.slice(0, 8) : '');
    }

    // The crash guard reports each distinct error once. Keep the last few for the note.
    function onCrash(report) {
      var perf = root.performance;
      errors.push({ message: String(report && report.message), stack: String((report && report.stack) || ''), at: perf && perf.now ? Math.round(perf.now()) : 0, source: report && report.source });
      if (errors.length > ERROR_MAX) errors.shift();
    }
    var guard = deps.crash || root.CrashGuard;
    try { if (guard && guard.onCrash) guard.onCrash(onCrash); } catch (err) { /* feedback works without it */ }

    // The window swallows key events while it is open, so a key held when it opened would never
    // get its keyup. Drop held keys on the way in and on the way out.
    function releaseInput() {
      try {
        var I = input();
        if (I && I.keys && I.keys.clear) I.keys.clear();
      } catch (err) { /* input is best effort */ }
    }

    // Local play freezes: main.js runs no sim step and reads no menu input while app.frozen is set.
    // Nothing else changes (app.paused, the pause menu, the screen), so resume puts back exactly the
    // state the window opened on. Host, guest and server matches keep running for the other
    // players, so they are not paused and no server hold is taken: `false` tells the window so.
    function pause() {
      releaseInput();
      if (!app || app.role !== 'local') return false;
      var token = { frozen: !!app.frozen };
      app.frozen = true;
      return token;
    }
    function resume(token) {
      if (app) app.frozen = !!(token && token.frozen);
      releaseInput();
    }

    function mySlot() {
      var slots = app.slots || [];
      var acct = app.role === 'banked' && app.authority && app.authority.accountId ? app.authority.accountId() : null;
      for (var i = 0; i < slots.length; i++) {
        var s = slots[i];
        if (!s || s.ctrl === 'cpu') continue;
        if (app.role === 'guest') { if (s.ctrl === 'remote' && s.owner === app.myId) return i; }
        else if (app.role === 'banked') { if (acct != null && s.owner === acct) return i; }
        else if (s.ctrl === 'local') return i;
      }
      return -1;
    }

    function context() {
      try {
        if (!app) return {};
        var role = String(app.role || 'local');
        var mode = role === 'banked' ? 'server match' : role === 'local' ? 'local practice' : 'relay practice (' + role + ')';
        var slots = app.slots || [];
        var humans = 0;
        for (var i = 0; i < slots.length; i++) if (slots[i] && slots[i].ctrl !== 'cpu') humans++;
        var extra = {
          role: role,
          screen: String(app.screen || ''),
          fingerprint: fingerprint(),
          players: slots.length,
          humans: humans,
          hub: app.hub ? String(app.hub.kind || '') : '',
          paused: !!app.paused,
          pauseMenu: !!app.pauseMenu,
        };
        if (app.runId) extra.runId = String(app.runId);
        var snap = app.screen === 'game' ? app.view : null;
        if (!snap) return { level: 'menu: ' + extra.screen, mode: mode, extra: extra };

        var manifest = root.MANIFEST || {};
        var info = (manifest.bosses || [])[snap.si] || null;
        var label = String(snap.si + 1);
        var level = (label.length < 2 ? '0' + label : label) + (info ? ' ' + info.stage : '');
        extra.stageIndex = snap.si;
        if (info) extra.stageKey = info.key;
        extra.section = String(snap.mode || '');
        extra.locked = !!snap.lock;
        extra.cameraX = num(snap.camX);
        if (num(snap.len) && num(snap.camX) != null) extra.progress = Math.round((snap.camX / snap.len) * 100);
        extra.god = !!snap.god;
        extra.enemies = (snap.enemies || []).length;
        // Wave counts exist only where this page runs the sim (local play and the relay host).
        var waves = app.sim && app.sim.stage && app.sim.stage.waves;
        if (waves && waves.length) {
          var done = 0;
          for (var w = 0; w < waves.length; w++) if (waves[w].done) done++;
          extra.wave = done;
          extra.waves = waves.length;
        }
        if (snap.boss) {
          var b = snap.boss, names = info && info.machines;
          extra.boss = { name: names ? names[b.ph] || names[0] : '', phase: b.ph + 1, hp: b.hp, maxHp: b.mh, state: b.st };
        }

        var players = snap.players || [];
        var slot = mySlot();
        var p = null;
        for (var k = 0; k < players.length; k++) if (players[k].s === slot) p = players[k];
        var out = { level: level, mode: mode, gameTime: num(snap.t) == null ? undefined : snap.t / 60, extra: extra };
        if (!p) {
          // No human on this device (attract mode, or watching before taking a seat).
          p = players[0] || null;
          extra.spectating = true;
        }
        if (p) {
          var weapons = (root.Sim && root.Sim.WEAPONS) || [];
          out.position = { x: p.x, y: p.y, z: p.z };
          out.player = {
            slot: p.s + 1,
            character: p.n,
            weapon: weapons[p.w] ? weapons[p.w].name : p.w,
            health: p.hp,
            lives: p.l,
            score: p.sc,
            combo: p.cb,
            state: p.st,
            control: p.c,
          };
        }
        return out;
      } catch (err) {
        return { extra: { contextError: String((err && err.message) || err).slice(0, 200) } };
      }
    }

    function breadcrumb(type, data) {
      try {
        if (handle) { handle.breadcrumb(type, data); return; }
        waiting.push([type, data]);
        if (waiting.length > CRUMB_MAX) waiting.shift();
      } catch (err) { /* never into the game loop */ }
    }

    function options(HubSDK, sdk) {
      return {
        title: TITLE,
        version: version(),
        transport: HubSDK.feedbackTransportFromSdk(sdk),
        pause: pause,
        resume: resume,
        context: context,
        canvases: function () {
          var cv = root.document && root.document.getElementById('game');
          return cv ? [cv] : [];
        },
        errors: function () { return errors.slice(); },
        theme: THEME,
        onClose: function () {
          var fn = afterClose;
          afterClose = null;
          if (fn) { try { fn(); } catch (err) { /* the menu is optional */ } }
        },
      };
    }

    // Once per page, when the SDK has loaded. Returns whether the shortcut is now live.
    function install(HubSDK, sdk) {
      if (handle) return true;
      if (!HubSDK || !sdk || typeof HubSDK.installFeedback !== 'function' || typeof HubSDK.feedbackTransportFromSdk !== 'function') return false;
      try {
        handle = HubSDK.installFeedback(options(HubSDK, sdk)) || null;
      } catch (err) {
        handle = null;
      }
      if (!handle) return false;
      var list = waiting;
      waiting = [];
      for (var i = 0; i < list.length; i++) breadcrumb(list[i][0], list[i][1]);
      return true;
    }

    // main.js calls this with the promise from CoopHub.boot: by then the SDK is loaded or absent.
    function boot(nextApp, job) {
      if (nextApp) app = nextApp;
      return Promise.resolve(job).then(function () {
        var session = root.CoopHub && root.CoopHub.session;
        return install(root.HubSDK, session && session.sdk ? session.sdk() : null);
      }).catch(function () { return false; });
    }

    // Open from a menu. `then` runs when that window closes (the pause menu reopens itself).
    function open(then) {
      if (!handle || handle.isOpen()) return false;
      afterClose = typeof then === 'function' ? then : null;
      handle.open();
      // A refused open (not signed in) only shows a toast and never closes: forget the callback.
      root.setTimeout(function () { if (handle && !handle.isOpen()) afterClose = null; }, 1000);
      return true;
    }

    return {
      boot: boot,
      install: install,
      ready: function () { return !!handle; },
      isOpen: function () { return !!handle && handle.isOpen(); },
      open: open,
      breadcrumb: breadcrumb,
      pause: pause,
      resume: resume,
      context: context,
      version: version,
    };
  }

  var shared = create();
  var CoopFeedback = {
    VERSION: VERSION,
    THEME: THEME,
    create: create,
    boot: shared.boot,
    ready: shared.ready,
    isOpen: shared.isOpen,
    open: shared.open,
    breadcrumb: shared.breadcrumb,
  };
  root.CoopFeedback = CoopFeedback;
  if (typeof module !== 'undefined' && module.exports) module.exports = CoopFeedback;
})(typeof window !== 'undefined' ? window : globalThis);
