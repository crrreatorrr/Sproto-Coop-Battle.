// Hub session for Sproto Coop Battle. Classic script. Loads vendor/hub-sdk (global HubSDK),
// never a CDN. Redeems #t= once, then the game can play with or without a hub account.
// Local play and the old relay stay practice: this file never calls earn or score. Its one event
// write is the Marina Anchor Relic for a stage 1 clear (reportStageClear below), which pays no Tickets.
(function (root) {
  'use strict';
  var GAME_ID = 'sproto-coop-battle';
  var SESSION_KEY = 'hub:' + GAME_ID + ':session';
  var TAB_KEY = 'sproto-coop-battle:hub-tab';
  var LOOPBACK = /^(localhost|[\w-]+\.localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)$/i;

  function isLoopback(host) {
    return LOOPBACK.test(String(host || ''));
  }

  function pageOf(loc) {
    loc = loc || {};
    return {
      protocol: loc.protocol || 'https:',
      hostname: String(loc.hostname || ''),
      port: loc.port ? String(loc.port) : '',
    };
  }

  function derivedHub(page) {
    if (/^play\./i.test(page.hostname)) {
      var port = page.port ? ':' + page.port : '';
      return page.protocol + '//' + page.hostname.slice(5) + port + '/hub/';
    }
    return '/hub/';
  }

  // Accept only a same-origin /hub/, the apex of a play. host, or another loopback hub.
  function parseConfigured(value, page) {
    var raw = String(value || '').trim().split('#')[0];
    if (!raw || /[\s\\]/.test(raw) || raw.indexOf('//') === 0) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:/i.test(raw)) return '';
    if (raw.charAt(0) === '/') {
      if (raw !== '/hub' && raw.indexOf('/hub/') !== 0) return '';
      return '/hub/';
    }
    var url;
    try { url = new URL(raw); } catch (err) { return ''; }
    if (url.username || url.password || url.search) return '';
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.pathname !== '/hub' && url.pathname !== '/hub/') return '';
    var hubHost = url.hostname;
    var sameHost = hubHost === page.hostname && url.protocol === page.protocol;
    var playApex = /^play\./i.test(page.hostname) && hubHost === page.hostname.slice(5);
    var loop = isLoopback(page.hostname) && isLoopback(hubHost);
    if (!sameHost && !playApex && !loop) return '';
    return url.protocol + '//' + url.host + '/hub/';
  }

  function trustedHubPage(loc, configured) {
    var page = pageOf(loc);
    var derived = derivedHub(page);
    var chosen = parseConfigured(configured, page);
    return chosen || derived;
  }

  function exitUrl(loc, configured) {
    return trustedHubPage(loc, configured).replace(/\/$/, '') + '/#from=' + GAME_ID;
  }

  function stripTicket(hash) {
    var raw = String(hash || '');
    if (raw.charAt(0) === '#') raw = raw.slice(1);
    var params = new URLSearchParams(raw);
    if (!params.has('t')) return raw ? '#' + raw : '';
    params.delete('t');
    var next = params.toString();
    return next ? '#' + next : '';
  }

  function hashHasTicket(hash) {
    var raw = String(hash || '');
    if (raw.charAt(0) === '#') raw = raw.slice(1);
    return new URLSearchParams(raw).has('t');
  }

  function errorCode(err) {
    if (!err) return '';
    if (typeof err.code === 'string' && err.code) return err.code;
    return 'init_failed';
  }

  function ticketMessage(code) {
    if (code === 'ticket_expired') return 'Hub ticket expired';
    if (code === 'ticket_used') return 'Hub ticket was already used';
    if (code === 'ticket_game') return 'Hub ticket was for another game';
    if (code === 'ticket_invalid') return 'Hub ticket was not accepted';
    if (code === 'init_failed') return 'Hub unavailable';
    return '';
  }

  function usernameFromToken(token) {
    try {
      var part = String(token || '').split('.')[1];
      if (!part) return '';
      var pad = part.length % 4 === 0 ? '' : '===='.slice(part.length % 4);
      var json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/') + pad));
      return typeof json.usn === 'string' ? json.usn : '';
    } catch (err) {
      return '';
    }
  }

  function browserStore(kind) {
    var area = kind === 'local' ? root.localStorage : root.sessionStorage;
    return {
      getItem: function (key) { try { return area.getItem(key); } catch (err) { return null; } },
      setItem: function (key, value) { try { area.setItem(key, value); } catch (err) { /* private mode */ } },
      removeItem: function (key) { try { area.removeItem(key); } catch (err) { /* private mode */ } },
    };
  }

  function loadClassicSdk() {
    if (root.HubSDK && root.HubSDK.createHubSdk) return Promise.resolve(root.HubSDK);
    if (!root.document) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var script = root.document.createElement('script');
      script.src = 'vendor/hub-sdk/dist/hub-sdk.iife.js';
      script.async = false;
      script.onload = function () { resolve(root.HubSDK && root.HubSDK.createHubSdk ? root.HubSDK : null); };
      script.onerror = function () { resolve(null); };
      (root.document.head || root.document.documentElement).appendChild(script);
    });
  }

  function createSession(deps) {
    deps = deps || {};
    var loc = deps.location || root.location || { protocol: 'https:', hostname: '', hash: '', search: '' };
    var config = deps.config || root.SPROTO_COOP_HUB || {};
    var sdk = deps.sdk || null;
    var tabId = deps.tabId || ('tab-' + Math.random().toString(36).slice(2));
    var listeners = [];
    var pending = null;
    var state = {
      gameId: GAME_ID,
      kind: 'offline',
      label: 'OFFLINE',
      playerId: null,
      balance: null,
      message: '',
      confirming: false,
      confirmCount: 0,
      practice: true,
      bankedWrites: 0,
      playable: true,
      ready: false,
      ticketError: '',
      generation: 0,
      expiresAt: 0,
      left: false,
      navigated: false,
      balanceJob: null,
    };

    function readHash() {
      return deps.readHash ? deps.readHash() : (loc.hash || '');
    }
    function writeHash(hash) {
      if (deps.writeHash) deps.writeHash(hash);
      else if (loc && root.history && root.history.replaceState) {
        root.history.replaceState(null, '', (loc.pathname || '/') + (loc.search || '') + (hash || ''));
      }
    }
    function now() { return deps.now ? deps.now() : Date.now(); }
    function emit() { if (deps.onChange) deps.onChange(state); }
    function exitTarget() { return exitUrl(loc, config.hubUrl); }

    function clearFragment() {
      var current = readHash();
      var next = stripTicket(current);
      if (next !== current && !(current === '' && next === '')) writeHash(next);
    }

    function listen(target, type, fn) {
      if (!target || !target.addEventListener) return;
      target.addEventListener(type, fn);
      listeners.push([target, type, fn]);
    }
    function unlistenAll() {
      while (listeners.length) {
        var row = listeners.pop();
        try { row[0].removeEventListener(row[1], row[2]); } catch (err) { /* already gone */ }
      }
    }

    function writeTab() {
      if (!deps.local) return;
      try {
        deps.local.setItem(TAB_KEY, JSON.stringify({ tabId: tabId, playerId: state.playerId || '' }));
      } catch (err) { /* storage full */ }
    }

    function refreshBalance() {
      if (state.kind !== 'account' && state.kind !== 'guest') return Promise.resolve(null);
      if (!sdk || !sdk.getTicketBalance) return Promise.resolve(null);
      if (state.balanceJob) return state.balanceJob;
      var gen = state.generation;
      var playerId = state.playerId;
      var job;
      job = Promise.resolve().then(function () { return sdk.getTicketBalance(); }).then(function (result) {
        if (gen !== state.generation || playerId !== state.playerId) return null;
        state.balance = result && typeof result.balance === 'number' ? result.balance : null;
        emit();
        return state.balance;
      }, function () {
        if (gen === state.generation && playerId === state.playerId) {
          state.balance = null;
          emit();
        }
        return null;
      }).finally(function () {
        if (state.balanceJob === job) state.balanceJob = null;
      });
      state.balanceJob = job;
      return job;
    }

    function readLive() {
      if (!sdk || !sdk.getSession) return null;
      try { return sdk.getSession() || null; } catch (err) { return null; }
    }

    function adoptLive(live, profile) {
      if (profile && profile.serverTime === 0) {
        state.generation += 1;
        state.balanceJob = null;
        state.kind = 'error';
        state.label = 'HUB ERROR';
        state.playerId = null;
        state.balance = null;
        state.message = 'Hub profile did not load';
        state.playable = true;
        emit();
        return;
      }
      var username = usernameFromToken(live.token);
      state.generation += 1;
      state.balanceJob = null;
      state.balance = null;
      state.playerId = live.playerId || null;
      state.expiresAt = live.expiresAt || 0;
      state.kind = username ? 'account' : 'guest';
      state.label = username || 'GUEST';
      state.message = state.ticketError ? ticketMessage(state.ticketError) : '';
      state.playable = true;
      if (state.expiresAt && now() >= state.expiresAt) {
        clearIdentity('expired');
        return;
      }
      writeTab();
      emit();
      refreshBalance();
    }

    function clearIdentity(reason) {
      state.generation += 1;
      state.balanceJob = null;
      state.playerId = null;
      state.balance = null;
      state.expiresAt = 0;
      state.confirming = false;
      state.kind = 'offline';
      state.label = 'OFFLINE';
      state.message = reason === 'expired' ? 'Hub session expired'
        : reason === 'swap' ? 'Hub account changed'
        : reason === 'logout' ? 'Hub signed out'
        : reason === 'takeover' ? 'Opened in another tab'
        : '';
      state.playable = true;
      emit();
    }

    function checkSession() {
      var live = readLive();
      if (!live) {
        if (state.kind === 'account' || state.kind === 'guest' || state.playerId) clearIdentity('logout');
        return;
      }
      if (live.expiresAt && now() >= live.expiresAt) {
        clearIdentity('expired');
        return;
      }
      if (live.playerId !== state.playerId) {
        clearIdentity('swap');
        adoptLive(live, { serverTime: 1 });
      }
    }

    function onStorage(event) {
      if (!event || event.key !== TAB_KEY || !state.playerId) return;
      var next = null;
      try { next = JSON.parse(event.newValue || 'null'); } catch (err) { next = null; }
      if (!next || next.tabId === tabId) return;
      if (next.playerId !== state.playerId) clearIdentity(next.playerId ? 'takeover' : 'logout');
    }

    function markNavigated() { state.navigated = true; }

    function leave() {
      if (state.left) return;
      state.left = true;
      state.confirming = false;
      unlistenAll();
      try { if (deps.release) deps.release(); } catch (err) { /* still leave */ }
      try { if (sdk && sdk.exit) sdk.exit('return'); } catch (err) { /* still leave */ }
      if (!state.navigated) {
        state.navigated = true;
        try { if (deps.assign) deps.assign(exitTarget()); } catch (err) { /* navigation refused */ }
      }
    }

    function requestReturn(live) {
      if (state.left) return { confirm: false, left: true };
      if (live && !state.confirming) {
        state.confirming = true;
        state.confirmCount += 1;
        emit();
        return { confirm: true, left: false };
      }
      state.confirming = false;
      leave();
      return { confirm: false, left: true };
    }

    function cancelReturn() {
      if (!state.confirming) return;
      state.confirming = false;
      emit();
    }

    function openSdk(HubSDK) {
      var serverKey = config.serverKey || '';
      if (!serverKey && isLoopback(pageOf(loc).hostname)) serverKey = 'defaultkey';
      return HubSDK.createHubSdk({
        serverUrl: config.serverUrl != null ? config.serverUrl : '',
        serverKey: serverKey,
        hubUrl: trustedHubPage(loc, config.hubUrl),
        assign: function () { markNavigated(); if (deps.assign) deps.assign(exitTarget()); },
      });
    }

    function savedSession() {
      try { return !!(deps.session && deps.session.getItem(SESSION_KEY)); } catch (err) { return false; }
    }

    async function doConnect() {
      state.playable = true;
      var hadTicket = hashHasTicket(readHash());
      if (!sdk) {
        if (!hadTicket && !savedSession()) {
          state.kind = 'offline';
          state.ready = true;
          emit();
          return state;
        }
        var HubSDK = deps.loadSdk ? await deps.loadSdk() : await loadClassicSdk();
        if (!HubSDK) {
          clearFragment();
          state.kind = hadTicket ? 'error' : 'offline';
          state.label = state.kind === 'error' ? 'HUB ERROR' : 'OFFLINE';
          state.message = hadTicket ? 'Hub unavailable' : '';
          state.ticketError = hadTicket ? 'init_failed' : '';
          state.ready = true;
          emit();
          return state;
        }
        sdk = openSdk(HubSDK);
      }
      var profile = null;
      var firstError = null;
      try {
        profile = await sdk.init(GAME_ID);
      } catch (err) {
        firstError = err;
      }
      clearFragment();
      if (!profile && hadTicket) {
        try { profile = await sdk.init(GAME_ID); }
        catch (err) { if (!firstError) firstError = err; }
      }
      state.ticketError = errorCode(firstError);
      var live = readLive();
      if (!live) {
        state.kind = !hadTicket && firstError ? 'error' : 'offline';
        state.label = state.kind === 'error' ? 'HUB ERROR' : 'OFFLINE';
        state.playerId = null;
        state.balance = null;
        state.message = ticketMessage(state.ticketError);
        state.ready = true;
        state.playable = true;
        emit();
        return state;
      }
      adoptLive(live, profile);
      state.ready = true;
      var events = deps.events || root;
      listen(events, 'storage', onStorage);
      listen(events, 'visibilitychange', checkSession);
      listen(events, 'focus', checkSession);
      return state;
    }

    function openRealtime() {
      var live = readLive();
      if (!live || !sdk || !root.HubSDK || !root.HubSDK.realtimeFromSdk) return null;
      var serverUrl = config.serverUrl != null ? config.serverUrl : '';
      return root.HubSDK.realtimeFromSdk(sdk, { serverUrl: serverUrl });
    }

    // Marina Anchor Relic (hub SDK 0.6.4). The game calls this when the sim's 'clear' event fires in
    // local, hosted or relay play. Only stage 1 (stageIdx 0, Tidebreak Marina) counts, God Mode too.
    // It reports at most once per run id, and only when the hub opened this page (a redeemed ticket
    // or the saved hub session); standalone play does nothing. The key is unique per run and the body
    // is fixed for it, so a retry is idempotent. It never throws or rejects: errors resolve null.
    // Banked runs do not call it; the hub's server grants the Relic for them.
    var reportedRuns = {};
    function warnReport(err) {
      try { if (root.console) root.console.warn('[hub] stage clear report failed', (err && (err.code || err.message)) || String(err)); } catch (e) { /* no console */ }
    }
    function reportStageClear(stageIdx, godMode, runId) {
      try {
        var run = String(runId || '');
        if (stageIdx !== 0 || !run || state.left) return Promise.resolve(null);
        if (reportedRuns[run]) return reportedRuns[run];
        if (state.kind !== 'account' && state.kind !== 'guest') return Promise.resolve(null);
        if (!sdk || !readLive()) return Promise.resolve(null);
        var body = { stage: 1, godMode: godMode === true };
        var key = 'coop.stage_clear:1:' + run;
        var job = Promise.resolve().then(function () {
          return sdk.reportEvent('coop.stage_clear', body, key);
        }).then(function (result) {
          return result && typeof result === 'object' ? result : {};
        }, function (err) {
          warnReport(err);
          return null;
        });
        reportedRuns[run] = job;
        return job;
      } catch (err) {
        warnReport(err);
        return Promise.resolve(null);
      }
    }

    function connect() {
      if (pending) return pending;
      pending = doConnect().catch(function () {
        clearFragment();
        state.kind = 'error';
        state.label = 'HUB ERROR';
        state.message = 'Hub unavailable';
        state.playable = true;
        state.ready = true;
        emit();
        return state;
      });
      return pending;
    }

    return {
      GAME_ID: GAME_ID,
      state: state,
      connect: connect,
      refreshBalance: refreshBalance,
      requestReturn: requestReturn,
      cancelReturn: cancelReturn,
      checkSession: checkSession,
      notifyStorage: onStorage,
      markNavigated: markNavigated,
      exitUrl: exitTarget,
      leave: leave,
      openRealtime: openRealtime,
      reportStageClear: reportStageClear,
      // The SDK instance once it has loaded, else null. feedback-link.js builds its transport on it.
      sdk: function () { return sdk; },
    };
  }

  function boot(hooks) {
    hooks = hooks || {};
    if (root.CoopHub && root.CoopHub.session) return root.CoopHub.session.connect();
    var session = createSession({
      location: root.location,
      config: root.SPROTO_COOP_HUB || {},
      local: browserStore('local'),
      session: browserStore('session'),
      readHash: function () { return root.location.hash || ''; },
      writeHash: function (hash) {
        var path = root.location.pathname + root.location.search + (hash || '');
        root.history.replaceState(null, '', path);
      },
      assign: function (url) { root.location.assign(url); },
      release: hooks.release,
      onChange: hooks.onChange,
      loadSdk: loadClassicSdk,
    });
    root.CoopHub.session = session;
    return session.connect();
  }

  root.CoopHub = {
    GAME_ID: GAME_ID,
    SESSION_KEY: SESSION_KEY,
    TAB_KEY: TAB_KEY,
    trustedHubPage: trustedHubPage,
    exitUrl: exitUrl,
    stripTicket: stripTicket,
    usernameFromToken: usernameFromToken,
    createSession: createSession,
    boot: boot,
    session: null,
  };
})(typeof window !== 'undefined' ? window : globalThis);
