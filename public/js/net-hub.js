// Authoritative Nakama client for Sproto Coop Battle.
// Practice relay stays in net.js. This file never calls earn, score, or session.event.
// Snapshots are render views. acceptClientState is ignored. A drop does not become a local host.
(function (root) {
  'use strict';
  var PROTOCOL = 1;
  var GAME_ID = 'sproto-coop-battle';
  var FINGERPRINT = 'fb9f2679528b6810dfd3a42ce41bb6f2ed3ac8e75eb3741e2ad30ccd9a4b9a72';
  var OP = {
    HELLO: 1, WELCOME: 2, READY: 3, START: 4, INPUT: 10, SNAPSHOT: 11, SEATS: 12,
    REJECT: 13, RESUME: 14, END: 15, RELEASE: 16, PING: 17, PONG: 18, COMMAND: 19,
  };
  var DEVICES = ['k1', 'k2', 'gp0', 'gp1', 'gp2', 'gp3'];
  var SEATS = 4; // Sim.SLOTS: always four Sprotos
  var BANNED = { god: 1, stage: 1, state: 1, seed: 1, earn: 1, score: 1, pause: 1, snapshot: 1, result: 1 };
  var RPC_OK = { 'coop.version': 1, 'coop.room_create': 1, 'coop.room_join': 1, 'coop.queue_cancel': 1, 'coop.resume': 1, 'coop.metrics': 1 };
  var SIM_MS = 1000 / 60;
  var RECONNECT_MS = 15000;
  // After a server restart, coop.resume is retried with backoff for this long. A
  // maintenance answer with retryAt can stretch the window, up to RESUME_MAINT_MAX_MS.
  var RESUME_WINDOW_MS = 180000;
  var RESUME_BASE_MS = 1000;
  var RESUME_CAP_MS = 15000;
  var RESUME_MAINT_MAX_MS = 20 * 60000;
  // coop.resume answers that will not change on a retry.
  var RESUME_FINAL = {
    checkpoint_missing: 1, match_finished: 1, not_in_roster: 1, version_mismatch: 1,
    rejected: 1, capacity_dark: 1, wrong_scope: 1, bad_json: 1, blocked: 1,
  };
  var RESUME_FAILED = 'Server checkpoint could not resume. This tab did not become host.';
  var RESTARTING = 'Server restarting — reconnecting…';
  var ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

  function fighterId(fid) {
    var list = root.MANIFEST && root.MANIFEST.fighters;
    var row = list && list[fid];
    return row && row.id ? row.id : '';
  }
  function weaponId(index) {
    var list = root.Sim && root.Sim.WEAPONS;
    var row = list && list[index];
    return row && row.id ? row.id : '';
  }
  function fighterCount() {
    var list = root.MANIFEST && root.MANIFEST.fighters;
    return list && list.length ? list.length : 6;
  }
  function weaponCount() {
    var list = root.Sim && root.Sim.WEAPONS;
    return list && list.length ? list.length : 6;
  }
  function normalizeCode(input) {
    var code = String(input || '').toUpperCase().replace(/[\s-]/g, '');
    if (code.length !== 12) return '';
    for (var i = 0; i < code.length; i++) if (ALPHABET.indexOf(code.charAt(i)) < 0) return '';
    return code;
  }
  function copySeat(seat) {
    return {
      slot: seat.slot | 0,
      accountId: seat.accountId || '',
      device: seat.device || '',
      generation: seat.generation | 0,
      human: seat.human ? 1 : 0,
      ctrl: seat.ctrl || 'cpu',
      lives: seat.lives,
      hp: seat.hp,
      fighter: seat.fighter | 0,
      weapon: seat.weapon | 0,
      name: seat.name || '',
    };
  }
  function createState() {
    return {
      phase: 'idle',
      banked: false,
      practiceFallback: false,
      rewards: 0,
      receipt: null,
      hostTakeover: 0,
      acceptClientState: 0,
      importedRestart: 0,
      sawFull: false,
      code: '',
      matchId: '',
      accountId: '',
      generation: 0,
      seq: 0,
      serverTick: 0,
      serverTickAt: 0,
      bias: 0,
      lastBias: 0,
      lastSentFrame: 0,
      lastBurst: 0,
      lastPing: 0,
      seats: [],
      yours: [],
      wanted: [],
      picks: {},
      snapshot: null,
      prevSnapshot: null,
      snapAt: 0,
      snapGap: 100,
      message: '',
      rejects: [],
      held: false,
      background: false,
      replaced: false,
      endReason: '',
      resume: '',
      rtt: null,
      rttSamples: [],
      ledgerCalls: 0,
      livesAtDrop: null,
      enabled: null,
      reconnectUntil: 0,
      restarting: false,
      resumeAt: 0,
      stageIndex: 0,
    };
  }
  function resumeDelay(attempt) {
    return Math.min(RESUME_CAP_MS, RESUME_BASE_MS * Math.pow(2, Math.max(0, attempt | 0)));
  }
  function errorCode(err) {
    if (!err) return '';
    return String(err.code || err.error || err.message || '');
  }
  // retryAt from a maintenance error, as unix ms. Accepts ms, seconds or an ISO date,
  // on the error itself, its details, or as "retryAt=<n>" in the message.
  function retryAtMs(err) {
    if (!err) return 0;
    var raw = err.retryAt;
    if (raw == null && err.details) raw = err.details.retryAt;
    if (raw == null && err.data) raw = err.data.retryAt;
    if (raw == null) {
      var m = /retryAt["=:\s]+([0-9TZ:.+-]+)/.exec(String(err.message || ''));
      if (m) raw = m[1];
    }
    if (raw == null || raw === '') return 0;
    var n = typeof raw === 'number' ? raw : /^\d+(\.\d+)?$/.test(String(raw)) ? Number(raw) : Date.parse(String(raw));
    if (!isFinite(n) || n <= 0) return 0;
    return n < 1e12 ? n * 1000 : n;
  }
  function leadTicks(state) {
    // Round trip in 60 Hz ticks, minus the loop that checks input before it steps.
    var fromRtt = state.rtt == null ? 0 : Math.round(state.rtt / SIM_MS) - 3;
    var lead = fromRtt + state.bias;
    if (lead < 0) lead = 0;
    if (lead > 36) lead = 36;
    return lead;
  }
  function planFrames(state, now) {
    if (!state.serverTickAt || state.phase !== 'playing') return [];
    var est = state.serverTick + Math.floor((now - state.serverTickAt) / SIM_MS);
    var base = est + leadTicks(state);
    var out = [];
    for (var i = 1; i <= 3; i++) {
      var frame = base + i;
      if (frame > state.lastSentFrame) out.push(frame);
    }
    return out;
  }
  function slotsOf(state) {
    var n = fighterCount();
    var slots = [];
    for (var i = 0; i < SEATS; i++) {
      slots.push({ ctrl: 'cpu', owner: 0, dev: '', fid: i % n, weapon: i % weaponCount(), label: '', lives: null, hp: null, grace: false });
    }
    for (var s = 0; s < state.seats.length; s++) {
      var seat = state.seats[s];
      var index = seat.slot | 0;
      if (index < 0 || index >= SEATS) continue;
      var human = !!seat.human;
      var mine = !!(state.accountId && seat.accountId === state.accountId);
      var grace = human && seat.ctrl === 'cpu';
      slots[index] = {
        ctrl: human ? (mine ? 'local' : 'remote') : 'cpu',
        owner: human ? seat.accountId : 0,
        dev: human ? seat.device : '',
        fid: seat.fighter | 0,
        weapon: seat.weapon | 0,
        label: (seat.name || (human ? 'P' + (index + 1) : '')) + (grace ? ' AI' : ''),
        lives: seat.lives,
        hp: seat.hp,
        grace: grace,
      };
    }
    return slots;
  }
  function learnAccount(state) {
    if (state.accountId) return;
    for (var i = 0; i < state.seats.length; i++) {
      var seat = state.seats[i];
      if (seat.device && state.yours.indexOf(seat.device) >= 0 && seat.accountId) {
        state.accountId = seat.accountId;
        return;
      }
    }
  }
  function lifeRows(state) {
    var rows = [];
    for (var i = 0; i < state.seats.length; i++) {
      var seat = state.seats[i];
      rows.push({ slot: seat.slot, lives: seat.lives, hp: seat.hp, device: seat.device, accountId: seat.accountId });
    }
    return rows;
  }
  function takeRender(state, envelope, now) {
    if (!envelope) return;
    if (envelope.restart) {
      state.importedRestart += 1;
      return;
    }
    var render = envelope.kind === 'sproto-coop-battle-snapshot' ? envelope.state : envelope.state || null;
    if (!render || !render.players) return;
    state.prevSnapshot = state.snapshot;
    state.snapshot = render;
    state.snapGap = state.snapAt ? Math.min(200, Math.max(16, now - state.snapAt)) : 100;
    state.snapAt = now;
    if (typeof envelope.tick === 'number') {
      state.serverTick = envelope.tick;
      state.serverTickAt = now;
    }
    if (typeof render.si === 'number') state.stageIndex = render.si;
  }
  function noteReject(state, reason, now) {
    state.rejects.push(reason);
    if (state.rejects.length > 32) state.rejects.shift();
    if (now - state.lastBias < 50) return;
    if (reason === 'future') { state.bias -= 1; state.lastBias = now; }
    else if (reason === 'stale') { state.bias += 1; state.lastBias = now; }
  }
  // The match opcode rewards field stays 0 and is not a receipt. A message that
  // claims rewards cannot become a displayed award. payoutCopy only names +20
  // or a zero when a receipt object is passed in by a test or a future reader.
  function payoutCopy(receipt) {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return 'TICKETS PAID BY SERVER, SEE BALANCE';
    var reason = String(receipt.reason || '');
    if (reason === 'already_paid') return 'ALREADY CLAIMED TODAY';
    if (receipt.paid === true && receipt.tickets === 20 && reason === 'clear') return '+20 TICKETS';
    if (receipt.paid === false) return '0 TICKETS';
    return 'TICKETS PAID BY SERVER, SEE BALANCE';
  }
  function applyMessage(state, op, msg, now) {
    msg = msg || {};
    if (msg.rewards) state.rewards = 0;
    if (msg.receipt) state.receipt = null;
    if (msg.hostTakeover) state.hostTakeover = 0;
    // A match that has ended stays ended. A late WELCOME, RESUME or START from it
    // (a socket that rejoined after END) is dropped. A resume joins a new match and
    // leaves 'ended' before its messages arrive.
    if ((op === OP.WELCOME || op === OP.RESUME || op === OP.START) && state.phase === 'ended') return;
    if (op === OP.WELCOME || op === OP.RESUME) {
      state.generation = msg.generation | 0;
      state.yours = Array.isArray(msg.yours) ? msg.yours.slice() : [];
      state.seats = Array.isArray(msg.seats) ? msg.seats.map(copySeat) : [];
      learnAccount(state);
      state.seq = 0;
      state.lastSentFrame = typeof msg.tick === 'number' ? msg.tick : 0;
      state.phase = msg.phase === 'playing' ? 'playing' : 'lobby';
      state.banked = true;
      state.replaced = false;
      state.acceptClientState = 0;
      if (msg.full) state.sawFull = true;
      if (msg.acceptClientState) state.importedRestart += 1;
      takeRender(state, msg.snapshot, now);
      state.message = op === OP.RESUME ? 'Rejoined. Lives and items stayed on the server.' : '';
      return;
    }
    if (op === OP.START) {
      if (msg.stageIndex) state.importedRestart += 1;
      state.phase = 'playing';
      state.banked = true;
      state.stageIndex = 0;
      state.seats = Array.isArray(msg.seats) ? msg.seats.map(copySeat) : state.seats;
      state.seq = 0;
      state.lastSentFrame = typeof msg.tick === 'number' ? msg.tick : 0;
      takeRender(state, msg.snapshot, now);
      state.message = 'Server run, stage 1. TICKETS PAID BY SERVER, SEE BALANCE.';
      return;
    }
    if (op === OP.SNAPSHOT) {
      takeRender(state, msg, now);
      return;
    }
    if (op === OP.SEATS) {
      state.seats = Array.isArray(msg.seats) ? msg.seats.map(copySeat) : state.seats;
      learnAccount(state);
      return;
    }
    if (op === OP.REJECT) {
      noteReject(state, String(msg.reason || 'rejected'), now);
      if (msg.reason === 'version_mismatch') state.message = 'Sim version does not match the server';
      else if (msg.reason === 'rejected') state.message = 'The server rejected that command';
      return;
    }
    if (op === OP.END) {
      state.phase = 'ended';
      state.endReason = String(msg.reason || '');
      state.resume = msg.resume === 'server' ? 'server' : '';
      state.matchId = msg.matchId || state.matchId;
      state.hostTakeover = 0;
      state.rewards = 0;
      state.message = state.resume === 'server'
        ? 'Server restart. Rejoining from the server checkpoint.'
        : 'Match ended (' + (state.endReason || 'done') + '). TICKETS PAID BY SERVER, SEE BALANCE.';
      return;
    }
    if (op === OP.PONG) {
      if (typeof msg.c === 'number') {
        var rtt = now - msg.c;
        if (rtt >= 0 && rtt < 5000) {
          state.rtt = rtt;
          state.rttSamples.push(rtt);
          if (state.rttSamples.length > 40) state.rttSamples.shift();
        }
      }
    }
  }
  function buildInput(state, frame, masks) {
    var seats = [];
    var seen = {};
    for (var i = 0; i < state.seats.length; i++) {
      var seat = state.seats[i];
      if (!seat.human || !seat.device) continue;
      if (state.yours.indexOf(seat.device) < 0) continue;
      if (state.accountId && seat.accountId && seat.accountId !== state.accountId) continue;
      if (seen[seat.slot]) continue;
      seen[seat.slot] = 1;
      var mask = masks && masks[seat.device] != null ? masks[seat.device] : 0;
      mask = mask | 0;
      if (mask < 0 || mask > 255) mask = 0;
      seats.push({ slot: seat.slot, device: seat.device, mask: mask });
    }
    if (!seats.length) return null;
    state.seq += 1;
    return { t: 'input', frame: frame, seq: state.seq, seats: seats };
  }
  function viewOf(state, now) {
    var samples = state.rttSamples.slice().sort(function (a, b) { return a - b; });
    var mid = samples.length ? samples[Math.floor(samples.length / 2)] : null;
    var jitter = 0;
    if (samples.length > 1) {
      var mean = 0;
      for (var i = 0; i < samples.length; i++) mean += samples[i];
      mean /= samples.length;
      var acc = 0;
      for (var j = 0; j < samples.length; j++) acc += Math.abs(samples[j] - mean);
      jitter = Math.round(acc / samples.length);
    }
    return {
      phase: state.phase,
      banked: state.banked && !state.practiceFallback && !state.replaced,
      practiceFallback: state.practiceFallback,
      rewards: 0,
      receipt: null,
      payout: payoutCopy(state.receipt),
      hostTakeover: 0,
      acceptClientState: 0,
      importedRestart: state.importedRestart,
      sawFull: state.sawFull,
      code: state.code,
      matchId: state.matchId,
      accountId: state.accountId,
      generation: state.generation,
      seats: state.seats,
      yours: state.yours.slice(),
      slots: slotsOf(state),
      snapshot: state.snapshot,
      prevSnapshot: state.prevSnapshot,
      snapAt: state.snapAt,
      snapGap: state.snapGap,
      message: state.message,
      rejects: state.rejects.slice(),
      held: state.held,
      background: state.background,
      replaced: state.replaced,
      endReason: state.endReason,
      resume: state.resume,
      rtt: mid,
      jitter: jitter,
      ledgerCalls: state.ledgerCalls,
      livesAtDrop: state.livesAtDrop,
      enabled: state.enabled,
      reconnectMs: state.reconnectUntil && now ? Math.max(0, state.reconnectUntil - now) : 0,
      restarting: state.restarting,
      resumeMs: state.restarting && state.resumeAt ? Math.max(0, state.resumeAt - now) : 0,
      stageIndex: state.stageIndex,
      offerPractice: state.phase === 'reconnecting' || state.phase === 'replaced' || state.phase === 'ended' || state.phase === 'dark',
    };
  }

  function create(opts) {
    opts = opts || {};
    var state = createState();
    if (opts.accountId) state.accountId = String(opts.accountId);
    var match = null;
    var transport = null;
    var ticket = '';
    var subs = [];
    var leaving = false;
    var retry = null;
    var expiryTimer = null;
    function now() { return opts.now ? opts.now() : Date.now(); }
    function wallNow() { return opts.wallNow ? opts.wallNow() : Date.now(); }
    function later(fn, ms) {
      var set = opts.setTimeout || root.setTimeout;
      return set ? set(fn, ms) : null;
    }
    function cancel(timer) {
      var clear = opts.clearTimeout || root.clearTimeout;
      if (timer != null && clear) clear(timer);
    }
    function emit() {
      var view = viewOf(state, now());
      for (var i = 0; i < subs.length; i++) subs[i](view);
    }
    function send(op, body) {
      if (opts.onSend) opts.onSend(op, body, state);
      if (match && match.send) match.send(op, body);
    }
    function allowRpc(id, body) {
      if (!RPC_OK[id]) { state.ledgerCalls += 1; return false; }
      if (body && (body.earn != null || body.score != null || body.god != null || body.state != null || body.stage != null || body.seed != null)) {
        state.ledgerCalls += 1;
        return false;
      }
      return true;
    }
    function rpc(id, body) {
      if (!allowRpc(id, body)) return Promise.reject(new Error('blocked'));
      if (!transport || !transport.rpc) return Promise.reject(new Error('no hub session'));
      return transport.rpc(id, body || {});
    }
    function helloBody() {
      var body = { t: 'hello', protocol: PROTOCOL, fingerprint: FINGERPRINT, devices: state.wanted.slice() };
      // Fighter and weapon are rejected once the server has started. Send them only in its lobby.
      if (state.serverPhase === 'lobby' && state.wanted.length) {
        var dev = state.wanted[state.wanted.length - 1];
        var pick = state.picks[dev] || { fid: 0, weapon: 0 };
        var fighter = fighterId(pick.fid);
        var weapon = weaponId(pick.weapon);
        if (fighter) body.fighter = fighter;
        if (weapon) body.weapon = weapon;
      }
      return body;
    }
    function sendHello() {
      if (!state.wanted.length) return;
      send(OP.HELLO, helloBody());
    }
    function onMatchMessage(msg) {
      var body = {};
      try { body = msg.json ? msg.json() : msg; }
      catch (err) { body = {}; }
      var op = msg.opCode != null ? msg.opCode : msg.op;
      applyMessage(state, op, body, now());
      if (body && (body.phase === 'playing' || body.phase === 'lobby')) state.serverPhase = body.phase;
      if (op === OP.START) state.serverPhase = 'playing';
      if (op === OP.END && state.resume === 'server' && !leaving) {
        // The server that sent this is shutting down. Do not ask it; retry the restarted one.
        match = null;
        startResume(state.matchId);
      }
      emit();
    }
    // Retry coop.resume with backoff (1, 2, 4, 8, 15, 15 … s) until it places us, the
    // server gives a final answer, the player leaves, or the window closes.
    function startResume(matchId) {
      if (!matchId || leaving || retry) return;
      var t = now();
      retry = { matchId: matchId, started: t, until: t + RESUME_WINDOW_MS, attempt: 0, timer: null };
      cancel(expiryTimer);
      expiryTimer = null;
      state.phase = 'reconnecting';
      state.restarting = true;
      state.reconnectUntil = 0;
      state.resume = 'server';
      state.message = RESTARTING;
      scheduleResume(retry, resumeDelay(0));
    }
    function scheduleResume(job, ms) {
      state.resumeAt = now() + ms;
      job.timer = later(function () {
        job.timer = null;
        attemptResume(job);
      }, ms);
    }
    function stopResume() {
      if (!retry) return;
      cancel(retry.timer);
      retry = null;
      state.restarting = false;
      state.resumeAt = 0;
    }
    function giveUpResume(job) {
      if (retry !== job) return;
      stopResume();
      state.phase = 'ended';
      state.resume = '';
      state.endReason = state.endReason || 'resume_failed';
      state.message = RESUME_FAILED;
      emit();
    }
    function attemptResume(job) {
      if (retry !== job || leaving) return;
      job.attempt += 1;
      state.resumeAt = 0;
      emit();
      resume(job.matchId).then(function (handle) {
        if (retry !== job) return;
        if (!handle) { giveUpResume(job); return; }
        stopResume();
        emit();
      }, function (err) {
        if (retry !== job || leaving) return;
        var code = errorCode(err);
        if (RESUME_FINAL[code]) { giveUpResume(job); return; }
        var t = now();
        var wait = resumeDelay(job.attempt);
        if (code === 'maintenance') {
          var at = retryAtMs(err);
          if (at) {
            wait = Math.max(RESUME_BASE_MS, at - wallNow());
            job.until = Math.max(job.until, Math.min(job.started + RESUME_MAINT_MAX_MS, t + wait + RESUME_CAP_MS));
          }
        }
        if (t >= job.until) { giveUpResume(job); return; }
        if (t + wait > job.until) wait = job.until - t;
        scheduleResume(job, wait);
        emit();
      });
    }
    // A plain drop: the server holds the seats for RECONNECT_MS. After that this tab is out.
    function expireReconnect(t) {
      if (state.phase !== 'reconnecting' || retry || !state.reconnectUntil || t < state.reconnectUntil) return false;
      cancel(expiryTimer);
      expiryTimer = null;
      state.phase = 'ended';
      state.endReason = 'reconnect_timeout';
      state.reconnectUntil = 0;
      state.message = 'Reconnect timed out. The server run went on without this tab.';
      emit();
      return true;
    }
    function bind(handle) {
      match = handle;
      // Only the current match handle speaks. A stale one (the match before a resume)
      // can still close or deliver late; that must not touch the new match.
      if (handle.onMessage) handle.onMessage(function (msg) { if (match === handle) onMatchMessage(msg); });
      if (handle.onClose) handle.onClose(function (reason) { if (match === handle) onClose(reason); });
      if (handle.onRejoin) handle.onRejoin(function () { sendHello(); });
      if (handle.self && handle.self.userId && !state.accountId) state.accountId = handle.self.userId;
      sendHello();
    }
    function onClose(reason) {
      match = null;
      if (leaving) return;
      var live = state.phase === 'playing' || state.phase === 'lobby' || state.phase === 'reconnecting';
      if (reason === 'kicked' || reason === 'replaced') {
        stopResume();
        state.replaced = true;
        state.banked = false;
        state.phase = 'replaced';
        state.message = 'Another tab took this account. This tab cannot host the banked run.';
      } else if (retry) {
        // A resume is in progress and owns the phase.
      } else if ((reason === 'rejoin_failed' || reason === 'ended') && live && state.matchId) {
        // The socket came back but the match did not (match_not_found): the server restarted.
        state.livesAtDrop = lifeRows(state);
        startResume(state.matchId);
      } else if (live) {
        state.livesAtDrop = lifeRows(state);
        state.phase = 'reconnecting';
        state.reconnectUntil = now() + RECONNECT_MS;
        state.banked = true;
        state.message = 'Reconnecting. The server holds your seats for 15s. This is not a local host.';
        cancel(expiryTimer);
        expiryTimer = later(function () { expiryTimer = null; expireReconnect(now()); }, RECONNECT_MS);
      }
      emit();
    }
    async function openTransport() {
      if (transport) return transport;
      if (opts.transport) { transport = opts.transport; return transport; }
      if (opts.openTransport) { transport = await opts.openTransport(); return transport; }
      if (typeof root.SPROTO_COOP_REALTIME === 'function') {
        transport = wrapSdk(root.SPROTO_COOP_REALTIME());
        return transport;
      }
      var session = root.CoopHub && root.CoopHub.session;
      if (!session || !session.openRealtime) throw new Error('Hub session required');
      var rt = session.openRealtime();
      if (!rt) throw new Error('Hub session required');
      transport = wrapSdk(rt);
      return transport;
    }
    function wrapSdk(rt) {
      var matched = [];
      if (rt.onMatchmakerMatched) rt.onMatchmakerMatched(function (found) { matched.forEach(function (fn) { fn(found); }); });
      return {
        rpc: function (id, body) { return rt.rpc(id, body); },
        joinMatch: async function (matchId, metadata) {
          if (rt.connect) await rt.connect();
          return rt.joinMatch({ matchId: matchId }, metadata);
        },
        addMatchmaker: async function (req) {
          if (rt.connect) await rt.connect();
          return rt.addMatchmaker(req);
        },
        removeMatchmaker: function (id) { return rt.removeMatchmaker(id); },
        onMatched: function (fn) { matched.push(fn); },
        connect: function () { return rt.connect ? rt.connect() : Promise.resolve(); },
        disconnect: function () { if (rt.disconnect) rt.disconnect(); },
      };
    }
    async function checkVersion() {
      var version = await rpc('coop.version', {});
      state.enabled = !!(version && version.enabled === true);
      if (!version || version.enabled !== true) {
        state.phase = 'dark';
        state.banked = false;
        state.message = version && version.enabled === false ? 'Authoritative coop is dark' : 'Hub version unavailable';
        emit();
        return false;
      }
      if (version.protocol !== PROTOCOL || version.fingerprint !== FINGERPRINT) {
        state.phase = 'dark';
        state.banked = false;
        state.message = 'Sim version does not match this client';
        emit();
        return false;
      }
      if (version.rewards) state.rewards = 0;
      return true;
    }
    function meta() {
      return { protocol: String(PROTOCOL), fingerprint: FINGERPRINT, v: String(PROTOCOL), sim: FINGERPRINT };
    }
    async function join(matchId) {
      var opened = await openTransport();
      var handle = await opened.joinMatch(matchId, meta());
      state.matchId = matchId;
      state.banked = true;
      if (state.phase !== 'playing') state.phase = 'lobby';
      bind(handle);
      emit();
      return handle;
    }
    async function resume(matchId) {
      if (!matchId || leaving) return null;
      await openTransport();
      var placed = await rpc('coop.resume', { matchId: matchId });
      if (placed && typeof placed.error === 'string') {
        var failed = new Error(placed.message || placed.error);
        failed.code = placed.error;
        if (placed.retryAt != null) failed.retryAt = placed.retryAt;
        throw failed;
      }
      if (!placed || !placed.matchId) throw new Error('checkpoint');
      if (placed.hostTakeover) state.hostTakeover = 0;
      return join(placed.matchId);
    }
    function claim(dev) {
      if (DEVICES.indexOf(dev) < 0) return;
      if (!state.picks[dev]) state.picks[dev] = { fid: 0, weapon: 0 };
      if (state.wanted.indexOf(dev) < 0) state.wanted.push(dev);
      if (state.phase === 'playing' || state.phase === 'lobby') sendHello();
    }
    function release(dev) {
      if (DEVICES.indexOf(dev) < 0) return;
      var left = [];
      for (var i = 0; i < state.wanted.length; i++) if (state.wanted[i] !== dev) left.push(state.wanted[i]);
      state.wanted = left;
      if (state.yours.indexOf(dev) >= 0) send(OP.RELEASE, { t: 'release', device: dev });
    }
    function cycle(dev, key, dir) {
      if (state.phase === 'playing') return;
      if (DEVICES.indexOf(dev) < 0) return;
      var pick = state.picks[dev] || { fid: 0, weapon: 0 };
      if (key === 'fid') pick.fid = (pick.fid + dir + fighterCount()) % fighterCount();
      else pick.weapon = (pick.weapon + dir + weaponCount()) % weaponCount();
      state.picks[dev] = pick;
      if (state.yours.indexOf(dev) >= 0) {
        send(OP.RELEASE, { t: 'release', device: dev });
        sendHello();
      }
      emit();
    }
    function pump(t) {
      if (state.phase === 'reconnecting') expireReconnect(t);
      if (state.phase !== 'playing' || state.replaced || leaving) return;
      if (!state.yours.length) return;
      if (state.lastBurst && t - state.lastBurst < 50) return;
      var frames = planFrames(state, t);
      if (!frames.length) return;
      var masks = {};
      for (var i = 0; i < state.yours.length; i++) {
        var dev = state.yours[i];
        masks[dev] = (state.held || state.background) ? 0 : ((opts.readMask ? opts.readMask(dev) : 0) | 0);
      }
      var sent = 0;
      for (var f = 0; f < frames.length && sent < 3; f++) {
        var body = buildInput(state, frames[f], masks);
        if (!body) break;
        send(OP.INPUT, body);
        state.lastSentFrame = frames[f];
        sent += 1;
      }
      if (sent) state.lastBurst = t;
      if (!state.lastPing || t - state.lastPing > 500) {
        state.lastPing = t;
        send(OP.PING, { t: 'ping', c: t });
      }
    }
    async function leave() {
      leaving = true;
      state.banked = false;
      if (retry || state.phase === 'reconnecting') {
        stopResume();
        state.phase = 'ended';
        state.endReason = state.endReason || 'left';
        state.reconnectUntil = 0;
      }
      cancel(expiryTimer);
      expiryTimer = null;
      var opened = transport;
      if (ticket && opened && opened.removeMatchmaker) {
        try { await opened.removeMatchmaker(ticket); } catch (err) { /* already gone */ }
        ticket = '';
      }
      try { await rpc('coop.queue_cancel', {}); } catch (err) { /* not queued */ }
      if (match && match.leave) {
        try { await match.leave(); } catch (err) { /* socket already down */ }
      }
      match = null;
      if (opened && opened.disconnect && !opts.keepSocket) {
        try { opened.disconnect(); } catch (err) { /* already closed */ }
      }
      state.phase = state.practiceFallback ? 'idle' : state.phase;
      emit();
    }
    return {
      state: state,
      view: function () { return viewOf(state, now()); },
      accountId: function () { return state.accountId; },
      subscribe: function (fn) { subs.push(fn); return function () { subs = subs.filter(function (item) { return item !== fn; }); }; },
      claim: claim,
      release: release,
      cycle: cycle,
      ready: function () { if (state.phase === 'lobby') send(OP.READY, { t: 'ready' }); },
      toggleHold: function () {
        state.held = !state.held;
        state.message = state.held ? 'Your inputs are held. The match continues.' : '';
        emit();
      },
      setBackground: function (on) { state.background = !!on; },
      setConfirming: function (on) {
        if (on && !state.confirmingHold) { state.heldBefore = state.held; state.confirmingHold = true; state.held = true; }
        if (!on && state.confirmingHold) { state.held = !!state.heldBefore; state.confirmingHold = false; }
      },
      pump: pump,
      leave: leave,
      command: function (type) {
        if (!BANNED[type]) return;
        state.message = type === 'god' ? 'God Mode is practice only' : type === 'stage' ? 'Stage select is practice only' : 'Rejected';
        send(OP.COMMAND, { t: type });
        emit();
      },
      sendRaw: function (op, body) { send(op, body); },
      apply: function (op, msg, t) { applyMessage(state, op, msg, t == null ? now() : t); emit(); },
      abandonToPractice: function () {
        state.practiceFallback = true;
        state.banked = false;
        state.phase = 'idle';
        state.message = 'New practice run. The server match was not taken over.';
        leave();
      },
      quickQueue: async function () {
        leaving = false;
        state.banked = true;
        state.phase = 'queue';
        state.message = 'Finding a server run…';
        emit();
        var opened = await openTransport();
        if (!await checkVersion()) return state;
        var queued = await opened.addMatchmaker({
          query: '*',
          minCount: 1,
          maxCount: 6,
          stringProperties: { game: GAME_ID, v: '1', sim: FINGERPRINT },
        });
        ticket = queued && queued.ticket || '';
        opened.onMatched(function (found) {
          if (!found || leaving) return;
          var id = found.matchId || found.match_id;
          if (!id) return;
          ticket = '';
          join(id).catch(function (err) {
            state.phase = 'dark';
            state.banked = false;
            state.message = err && err.message ? err.message : 'Join failed';
            emit();
          });
        });
        return state;
      },
      createRoom: async function () {
        leaving = false;
        state.banked = true;
        state.phase = 'queue';
        state.message = 'Creating a server room…';
        emit();
        await openTransport();
        if (!await checkVersion()) return state;
        var created = await rpc('coop.room_create', { v: PROTOCOL, sim: FINGERPRINT });
        state.code = created.code || '';
        state.rewards = 0;
        state.hostTakeover = 0;
        await join(created.matchId);
        state.message = 'Room ' + state.code + ' — TICKETS PAID BY SERVER, SEE BALANCE';
        emit();
        return state;
      },
      joinCode: async function (code) {
        leaving = false;
        var normalized = normalizeCode(code);
        if (!normalized) {
          state.message = 'Room codes are 12 characters';
          emit();
          throw new Error('room code');
        }
        state.banked = true;
        state.phase = 'queue';
        emit();
        await openTransport();
        if (!await checkVersion()) throw new Error(state.message || 'dark');
        var found = await rpc('coop.room_join', { code: normalized, v: PROTOCOL, sim: FINGERPRINT });
        state.code = normalized;
        await join(found.matchId);
        state.message = 'Joined ' + normalized + ' — the code is not a login';
        emit();
        return state;
      },
      cancel: async function () { await leave(); },
      rejoin: async function () {
        if (!state.matchId) throw new Error('no match');
        leaving = false;
        var opened = await openTransport();
        if (opened.connect) await opened.connect();
        return join(state.matchId);
      },
      resume: resume,
    };
  }

  function readMask(dev) {
    if (!root.Input) return 0;
    return root.Input.pack(root.Input.read(dev)) | 0;
  }
  function attach(app, hooks) {
    hooks = hooks || {};
    var ctl = create({
      now: function () { return root.performance && root.performance.now ? root.performance.now() : Date.now(); },
      readMask: readMask,
      accountId: hooks.accountId || '',
    });
    var lastStage = -1;
    ctl.subscribe(function (view) {
      app.code = view.code || app.code;
      app.snap = view.snapshot;
      app.prevSnap = view.prevSnapshot;
      app.snapAt = view.snapAt;
      app.snapGap = view.snapGap || 100;
      if (view.slots && view.slots.length === SEATS) app.slots = view.slots;
      if (view.message && view.message !== app._authMsg) {
        app._authMsg = view.message;
        if (hooks.toast) hooks.toast(view.message);
      }
      if (view.phase === 'dark') { app.role = 'local'; app.screen = 'title'; app.sim = null; return; }
      if (view.phase === 'playing' || view.phase === 'reconnecting' || view.phase === 'ended') {
        app.screen = 'game';
        if (root.Render && view.snapshot && view.stageIndex !== lastStage) {
          lastStage = view.stageIndex;
          root.Render.enterStage(view.stageIndex || 0);
          if ((view.stageIndex || 0) < 11) root.Render.bossImages((view.stageIndex || 0) + 1);
        }
      } else if (view.phase === 'lobby' || view.phase === 'queue') app.screen = 'lobby';
    });
    app.authority = ctl;
    return ctl;
  }

  var NetHub = {
    PROTOCOL: PROTOCOL,
    GAME_ID: GAME_ID,
    FINGERPRINT: FINGERPRINT,
    OP: OP,
    DEVICES: DEVICES,
    RECONNECT_MS: RECONNECT_MS,
    RESUME_WINDOW_MS: RESUME_WINDOW_MS,
    resumeDelay: resumeDelay,
    retryAtMs: retryAtMs,
    normalizeCode: normalizeCode,
    payoutCopy: payoutCopy,
    createState: createState,
    applyMessage: applyMessage,
    buildInput: buildInput,
    planFrames: planFrames,
    slotsOf: slotsOf,
    viewOf: viewOf,
    leadTicks: leadTicks,
    create: create,
    attach: attach,
  };
  root.NetHub = NetHub;
  if (typeof module !== 'undefined' && module.exports) module.exports = NetHub;
})(typeof window !== 'undefined' ? window : globalThis);
