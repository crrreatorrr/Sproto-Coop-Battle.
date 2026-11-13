// C4: authoritative client against a Nakama-shaped stand-in.
// The stand-in runs the real C3 sim and the H2-C opcodes. It writes no Tickets.
// Usage: node tests/browser-hub-online.cjs [outDir]
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const root = path.join(__dirname, '..');
const FINGERPRINT = 'fb9f2679528b6810dfd3a42ce41bb6f2ed3ac8e75eb3741e2ad30ccd9a4b9a72';
const PROTOCOL = 1;
const OP = { HELLO: 1, WELCOME: 2, READY: 3, START: 4, INPUT: 10, SNAPSHOT: 11, SEATS: 12, REJECT: 13, RESUME: 14, END: 15, RELEASE: 16, PING: 17, PONG: 18, COMMAND: 19 };
const DEVICES = ['k1', 'k2', 'gp0', 'gp1', 'gp2', 'gp3'];
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const BANNED_TYPES = { god: 1, stage: 1, state: 1, seed: 1, earn: 1, score: 1, pause: 1, snapshot: 1, result: 1 };
const BANNED_KEYS = ['god', 'stage', 'state', 'seed', 'earn', 'score', 'pause', 'snapshot', 'result', 'hp', 'lives', 'ctrl'];
const RECONNECT_LOOPS = 15 * 20;

function loadGame() {
  if (global.CoopProtocol && global.Sim && global.MANIFEST) {
    return { Sim: global.Sim, CoopProtocol: global.CoopProtocol, MANIFEST: global.MANIFEST };
  }
  global.window = global;
  require(path.join(root, 'public/js/manifest.js'));
  require(path.join(root, 'public/js/sim.js'));
  require(path.join(root, 'public/js/ai.js'));
  require(path.join(root, 'public/js/net-protocol.js'));
  return { Sim: global.Sim, CoopProtocol: global.CoopProtocol, MANIFEST: global.MANIFEST };
}

function normalizeCode(input) {
  const code = String(input || '').toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== 12) return '';
  for (let i = 0; i < code.length; i++) if (ALPHABET.indexOf(code.charAt(i)) < 0) return '';
  return code;
}
function banned(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return true;
  if (BANNED_TYPES[String(msg.t || '')]) return true;
  for (let i = 0; i < BANNED_KEYS.length; i++) if (msg[BANNED_KEYS[i]] !== undefined) return true;
  return false;
}
function parseDevices(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > DEVICES.length) return null;
  const out = [];
  const seen = {};
  for (let i = 0; i < raw.length; i++) {
    const device = String(raw[i] || '');
    if (DEVICES.indexOf(device) < 0 || seen[device]) return null;
    seen[device] = 1;
    out.push(device);
  }
  return out;
}
function fighterIndex(manifest, id) {
  const list = manifest.fighters;
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return i;
  return -1;
}
function weaponIndex(Sim, id) {
  for (let i = 0; i < Sim.WEAPONS.length; i++) if (Sim.WEAPONS[i].id === id) return i;
  return -1;
}

function createAuthorityMatch(opts) {
  const game = loadGame();
  const { Sim, CoopProtocol, MANIFEST } = game;
  opts = opts || {};
  const seed = (opts.seed >>> 0) || 1;
  const made = CoopProtocol.createMatch({ mode: 'banked', seed: seed === 0 ? 1 : seed, matchId: opts.id || 'm' });
  if (!made.ok) throw new Error('sim');
  const session = made.session;
  if (opts.restore) {
    session.state = Sim.importState(opts.restore.exported);
    session.seats = opts.restore.seats;
    session.loops = opts.restore.loops || 0;
  }
  const state = {
    id: opts.id || 'm',
    phase: opts.restore && opts.restore.phase === 'playing' ? 'playing' : 'lobby',
    privateRoom: !!opts.privateRoom,
    code: opts.code || '',
    seed: seed === 0 ? 1 : seed,
    roster: opts.roster || [],
    names: opts.names || {},
    loop: 0,
    playLoop: 0,
    session: session,
    accounts: {},
    present: {},
    inbox: {},
    out: [],
    ledgerWrites: 0,
    endReason: '',
  };
  if (opts.restore && opts.restore.accounts) {
    for (const id of Object.keys(opts.restore.accounts)) {
      const row = opts.restore.accounts[id];
      state.accounts[id] = { userId: id, sessionId: '', generation: row.generation || 1, ready: false, leftLoop: state.loop, devices: row.devices.slice() };
      for (let i = 0; i < session.seats.length; i++) {
        if (session.seats[i].accountId === id) session.state.players[i].ctrl = 'cpu';
      }
    }
  }

  function emit(to, op, body) { state.out.push({ to: to, op: op, body: body }); }
  function drain() { const rows = state.out.slice(); state.out.length = 0; return rows; }
  function reject(presence, reason) {
    emit(presence, OP.REJECT, { t: 'reject', reason: reason, rewards: 0, hostTakeover: 0 });
    return reason;
  }
  function seatView() {
    const out = [];
    for (let i = 0; i < session.seats.length; i++) {
      const seat = session.seats[i];
      const player = session.state.players[i];
      out.push({
        slot: seat.slot, accountId: seat.human && seat.accountId ? seat.accountId : '', device: seat.human ? seat.device : '',
        generation: seat.human ? seat.generation : 0, human: seat.human ? 1 : 0, ctrl: player.ctrl,
        lives: player.lives, hp: player.hp, fighter: player.fid, weapon: player.weapon, name: player.name,
      });
    }
    return out;
  }
  function broadcastSeats() {
    emit(null, OP.SEATS, { t: 'seats', tick: session.state.t, seats: seatView(), rewards: 0, hostTakeover: 0 });
  }
  function holds(account, device) { return account.devices.indexOf(device) >= 0; }
  function seatFor(accountId, device) {
    for (let i = 0; i < session.seats.length; i++) {
      const seat = session.seats[i];
      if (seat.human && seat.accountId === accountId && seat.device === device) return i;
    }
    return -1;
  }
  function freeSlot() {
    for (let i = 0; i < session.seats.length; i++) if (!session.seats[i].human) return i;
    return -1;
  }
  function countHuman() {
    let n = 0;
    for (let i = 0; i < session.seats.length; i++) if (session.seats[i].human) n++;
    return n;
  }
  function rosterAllows(userId) {
    if (state.accounts[userId]) return true;
    if (state.privateRoom) return true;
    return state.roster.indexOf(userId) >= 0;
  }
  function viewBody(account, kind) {
    const snap = CoopProtocol.snapshotEnvelope(session);
    return {
      t: kind, protocol: PROTOCOL, fingerprint: FINGERPRINT, matchId: state.id, generation: account.generation,
      nextSeq: 1, tick: session.state.t, phase: state.phase, seats: seatView(), yours: account.devices.slice(),
      snapshot: snap, full: kind === 'resume' ? Sim.exportState(session.state) : null,
      rewards: 0, hostTakeover: 0, acceptClientState: 0, snapshotHz: 10, loopHz: 20, substeps: 3, mode: 'banked',
    };
  }
  function life() { return CoopProtocol.lifeFacts(session.state); }

  function hello(presence, msg) {
    if (!session || state.phase === 'done') return reject(presence, 'match_ended');
    if (!msg || Number(msg.protocol) !== PROTOCOL || String(msg.fingerprint || '') !== FINGERPRINT) return reject(presence, 'version_mismatch');
    if (banned(msg)) return reject(presence, 'rejected');
    const devices = parseDevices(msg.devices);
    if (!devices) return reject(presence, 'device');
    if (state.phase === 'playing' && (msg.fighter !== undefined || msg.weapon !== undefined)) return reject(presence, 'rejected');
    let fighter = -1;
    let weapon = -1;
    if (msg.fighter !== undefined) {
      fighter = fighterIndex(MANIFEST, String(msg.fighter));
      if (fighter < 0) return reject(presence, 'fighter');
    }
    if (msg.weapon !== undefined) {
      weapon = weaponIndex(Sim, String(msg.weapon));
      if (weapon < 0) return reject(presence, 'weapon');
    }
    let account = state.accounts[presence.userId];
    let reclaimed = false;
    if (!account) {
      if (!rosterAllows(presence.userId)) return reject(presence, 'not_in_roster');
      account = { userId: presence.userId, sessionId: presence.sessionId, generation: 1, ready: false, leftLoop: -1, devices: [] };
      state.accounts[presence.userId] = account;
    } else if (account.sessionId !== presence.sessionId) {
      reclaimed = account.devices.length > 0;
      const previous = state.present[presence.userId];
      if (previous) emit(previous, OP.REJECT, { t: 'reject', reason: 'replaced', rewards: 0, hostTakeover: 0 });
      account.sessionId = presence.sessionId;
      account.generation += 1;
      account.leftLoop = -1;
      for (let i = 0; i < session.seats.length; i++) {
        const seat = session.seats[i];
        if (seat.human && seat.accountId === account.userId && seat.device) {
          CoopProtocol.assignSeat(session, { slot: seat.slot, accountId: account.userId, device: seat.device, generation: account.generation });
        }
      }
    }
    const before = JSON.stringify(life());
    let need = 0;
    for (let n = 0; n < devices.length; n++) if (!holds(account, devices[n])) need++;
    if (need > CoopProtocol.LIMITS.maxSeats - countHuman()) return reject(presence, 'match_full');
    for (let i = 0; i < devices.length; i++) {
      if (holds(account, devices[i])) continue;
      const slot = freeSlot();
      if (slot < 0) return reject(presence, 'match_full');
      const assigned = CoopProtocol.assignSeat(session, { slot: slot, accountId: presence.userId, device: devices[i], generation: account.generation });
      if (!assigned.ok) return reject(presence, assigned.reason);
      account.devices.push(devices[i]);
      const player = session.state.players[slot];
      if (fighter >= 0) player.fid = fighter;
      if (weapon >= 0) player.weapon = weapon;
      player.name = String(state.names[presence.userId] || presence.username || 'P' + (slot + 1)).slice(0, 16);
    }
    if (JSON.stringify(life()) !== before) throw new Error('life-reset');
    state.present[presence.userId] = presence;
    const kind = reclaimed || account.generation > 1 ? 'resume' : 'welcome';
    emit(presence, kind === 'resume' ? OP.RESUME : OP.WELCOME, viewBody(account, kind));
    broadcastSeats();
    return null;
  }

  function ready(presence) {
    const account = state.accounts[presence.userId];
    if (!account || account.sessionId !== presence.sessionId) return reject(presence, 'hello_required');
    if (!account.devices.length) return reject(presence, 'seat');
    if (state.phase !== 'lobby') return reject(presence, 'phase');
    account.ready = true;
    broadcastSeats();
    return null;
  }

  function release(presence, msg) {
    const account = state.accounts[presence.userId];
    if (!account || account.sessionId !== presence.sessionId) return reject(presence, 'stale-socket');
    const device = String(msg && msg.device || '');
    if (DEVICES.indexOf(device) < 0) return reject(presence, 'device');
    const slot = seatFor(account.userId, device);
    if (slot < 0) return reject(presence, 'seat');
    const before = JSON.stringify(life());
    const released = CoopProtocol.releaseSeat(session, { slot: slot, accountId: account.userId, generation: account.generation });
    if (!released.ok) return reject(presence, released.reason);
    account.devices = account.devices.filter(item => item !== device);
    if (JSON.stringify(life()) !== before) throw new Error('life-reset');
    broadcastSeats();
    return null;
  }

  function input(presence, msg, now, rawLen) {
    if ((rawLen || 0) > 768) return reject(presence, 'oversized');
    if (!msg || msg.t !== 'input' || banned(msg)) return reject(presence, 'rejected');
    const account = state.accounts[presence.userId];
    if (!account || account.sessionId !== presence.sessionId) return reject(presence, 'stale-socket');
    if (state.phase !== 'playing') return reject(presence, 'phase');
    const frame = msg.frame;
    if (typeof frame !== 'number' || !Number.isFinite(frame) || Math.floor(frame) !== frame) return reject(presence, 'frame');
    const tick = session.state.t;
    if (frame <= tick) return reject(presence, 'stale');
    if (frame > tick + 3) return reject(presence, 'future');
    const stamped = Object.assign({}, msg, { accountId: account.userId, generation: account.generation });
    const key = String(frame);
    if (!state.inbox[key]) state.inbox[key] = {};
    state.inbox[key][account.userId] = stamped;
    return null;
  }

  function command(presence) { return reject(presence, 'rejected'); }

  function leave(presence) {
    const account = state.accounts[presence.userId];
    const current = state.present[presence.userId];
    if (!current || current.sessionId !== presence.sessionId) return;
    state.present[presence.userId] = null;
    if (!account || !account.devices.length) return;
    if (state.phase === 'lobby') {
      const devices = account.devices.slice();
      for (let i = 0; i < devices.length; i++) {
        const slot = seatFor(account.userId, devices[i]);
        if (slot >= 0) CoopProtocol.releaseSeat(session, { slot: slot, accountId: account.userId, generation: account.generation });
      }
      account.devices = [];
      account.ready = false;
      account.leftLoop = -1;
    } else if (state.phase === 'playing') {
      account.leftLoop = state.loop;
      for (let i = 0; i < session.seats.length; i++) {
        if (session.seats[i].human && session.seats[i].accountId === account.userId) session.state.players[i].ctrl = 'cpu';
      }
    }
    broadcastSeats();
  }

  function tryStart() {
    if (state.phase !== 'lobby') return;
    let seated = 0;
    let waiting = false;
    for (const id of Object.keys(state.accounts)) {
      const account = state.accounts[id];
      if (!account.devices.length) continue;
      seated++;
      if (!account.ready || !state.present[id]) waiting = true;
    }
    if (!seated || waiting) return;
    if (!state.privateRoom && state.roster.length) {
      let joined = 0;
      for (let i = 0; i < state.roster.length; i++) {
        const member = state.accounts[state.roster[i]];
        if (member && member.devices.length && state.present[state.roster[i]]) joined++;
      }
      if (joined < state.roster.length && state.loop < 15 * 20) return;
    }
    const begun = CoopProtocol.beginEncounter(session);
    if (!begun.ok) return;
    state.phase = 'playing';
    state.playLoop = state.loop;
    emit(null, OP.START, {
      t: 'start', protocol: PROTOCOL, fingerprint: FINGERPRINT, matchId: state.id, tick: session.state.t,
      seed: state.seed, stageIndex: 0, seats: seatView(), snapshot: CoopProtocol.snapshotEnvelope(session),
      rewards: 0, hostTakeover: 0, mode: 'banked',
    });
  }

  function loop(now) {
    state.loop++;
    const clock = typeof now === 'number' ? now : state.loop * 50;
    if (state.phase === 'lobby') tryStart();
    if (state.phase !== 'playing') return drain();
    let released = false;
    for (const id of Object.keys(state.accounts)) {
      const account = state.accounts[id];
      if (account.leftLoop >= 0 && account.devices.length && state.loop - account.leftLoop >= RECONNECT_LOOPS) {
        const devices = account.devices.slice();
        const before = JSON.stringify(life());
        for (let i = 0; i < devices.length; i++) {
          const slot = seatFor(account.userId, devices[i]);
          if (slot >= 0) CoopProtocol.releaseSeat(session, { slot: slot, accountId: account.userId, generation: account.generation });
        }
        if (JSON.stringify(life()) !== before) throw new Error('life-reset');
        account.devices = [];
        account.leftLoop = -2;
        account.ready = false;
        released = true;
      }
    }
    if (released) broadcastSeats();
    const tick = session.state.t;
    const groups = [[], [], []];
    for (const frame of Object.keys(state.inbox)) {
      const n = Number(frame);
      if (n === tick + 1 || n === tick + 2 || n === tick + 3) {
        const bucket = state.inbox[frame];
        for (const id of Object.keys(bucket)) groups[n - tick - 1].push(bucket[id]);
        delete state.inbox[frame];
      } else if (n <= tick) delete state.inbox[frame];
    }
    for (let step = 0; step < 3; step++) {
      const decoded = [];
      for (let m = 0; m < groups[step].length; m++) {
        const applied = CoopProtocol.acceptInput(session, groups[step][m], clock + step);
        if (!applied.ok) {
          const who = state.present[groups[step][m].accountId];
          if (who) reject(who, applied.reason);
          continue;
        }
        for (let s = 0; s < applied.seats.length; s++) decoded.push(applied.seats[s]);
      }
      for (let p = 0; p < session.state.players.length; p++) {
        if (session.state.players[p].ctrl === 'cpu') continue;
        session.state.players[p].in = CoopProtocol.neutralButtons();
      }
      for (let d = 0; d < decoded.length; d++) session.state.players[decoded[d].slot].in = decoded[d].buttons;
      Sim.step(session.state);
      if (session.state.events && session.state.events.length) session.state.events.length = 0;
    }
    session.loops++;
    if (session.loops % 2 === 0) emit(null, OP.SNAPSHOT, CoopProtocol.snapshotEnvelope(session));
    return drain();
  }

  function checkpoint() {
    return {
      resumable: state.phase === 'playing' || state.phase === 'lobby',
      exported: Sim.exportState(session.state),
      seats: JSON.parse(JSON.stringify(session.seats)),
      seed: state.seed,
      phase: state.phase,
      loops: session.loops,
      accounts: Object.fromEntries(Object.keys(state.accounts).map(id => [id, { generation: state.accounts[id].generation, devices: state.accounts[id].devices.slice() }])),
      rewards: 0,
    };
  }

  function shutdown() {
    const saved = checkpoint();
    saved.resumable = true;
    state.phase = 'done';
    state.endReason = 'server_shutdown';
    emit(null, OP.END, {
      t: 'end', reason: 'server_shutdown', rewards: 0, scoreSubmitted: 0, hostTakeover: 0,
      resume: 'server', checkpoint: 1, acceptClientState: 0, matchId: state.id, tick: session.state.t,
    });
    return { saved: saved, events: drain() };
  }

  return { state: state, hello: hello, ready: ready, release: release, input: input, command: command, leave: leave, loop: loop, life: life, seatView: seatView, drain: drain, checkpoint: checkpoint, shutdown: shutdown, rosterAllows: rosterAllows };
}

function createStandin(opts) {
  opts = opts || {};
  const latency = { ms: opts.latencyMs || 0, jitter: opts.jitterMs || 0 };
  const matches = new Map();
  const codes = new Map();
  const sockets = new Set();
  const checkpoints = new Map();
  let seq = 0;
  const ledgerWrites = { n: 0 };
  const tickets = [];
  function oneWay() {
    const base = latency.ms / 2;
    const span = latency.jitter / 2;
    const j = span ? (Math.random() * 2 - 1) * span : 0;
    return Math.max(0, base + j);
  }
  function delay(fn) { setTimeout(fn, oneWay()); }
  function send(ws, env) {
    delay(() => { if (ws.readyState === 1) ws.send(JSON.stringify(env)); });
  }
  function presenceWire(p) { return { user_id: p.userId, session_id: p.sessionId, username: p.username }; }
  function deliver(match, events) {
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const payload = Buffer.from(JSON.stringify(ev.body)).toString('base64');
      const targets = [];
      if (ev.to) targets.push(ev.to);
      else {
        for (const id of Object.keys(match.state.present)) {
          const presence = match.state.present[id];
          if (presence) targets.push(presence);
        }
      }
      for (let t = 0; t < targets.length; t++) {
        const ws = targets[t].ws;
        if (!ws) continue;
        if (ev.body && ev.body.reason === 'replaced') {
          send(ws, { match_presence_event: { match_id: match.state.id, leaves: [presenceWire(targets[t])] } });
          continue;
        }
        send(ws, { match_data: { match_id: match.state.id, op_code: String(ev.op), data: payload, reliable: true } });
      }
    }
  }
  function roomCode() {
    let code = '';
    for (let i = 0; i < 12; i++) code += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
    return code;
  }
  function rpc(ws, cid, id, body) {
    const presence = ws.presence;
    if (id === 'coop.version') {
      return { protocol: PROTOCOL, fingerprint: FINGERPRINT, enabled: true, rewards: 0, hostTakeover: 0, match: 'sproto_coop', loopHz: 20, substeps: 3, snapshotHz: 10 };
    }
    if (id === 'coop.room_create') {
      if (body && (body.seed != null || body.state != null || body.stage != null || body.god != null)) return { error: 'rejected', message: 'The server chooses the run' };
      seq += 1;
      let code = '';
      for (let n = 0; n < 5 && !code; n++) {
        const candidate = roomCode();
        if (!codes.has(candidate)) code = candidate;
      }
      const names = {};
      names[presence.userId] = presence.username;
      const match = createAuthorityMatch({ id: 'room-' + seq, privateRoom: true, code: code, names: names });
      matches.set(match.state.id, match);
      codes.set(code, { id: match.state.id, expires: Date.now() + 600000 });
      return { matchId: match.state.id, code: code, protocol: PROTOCOL, fingerprint: FINGERPRINT, rewards: 0, hostTakeover: 0, ttlS: 600 };
    }
    if (id === 'coop.room_join') {
      const code = normalizeCode(body && body.code);
      const row = code && codes.get(code);
      if (!row || Date.now() > row.expires || !matches.has(row.id)) return { error: 'room_not_found', message: 'Room not found' };
      return { matchId: row.id, rewards: 0, hostTakeover: 0, protocol: PROTOCOL, fingerprint: FINGERPRINT };
    }
    if (id === 'coop.queue_cancel') return { ok: true, queued: false };
    if (id === 'coop.resume') {
      if (body && (body.state != null || body.seed != null || body.god != null || body.stage != null)) return { error: 'rejected', message: 'The server resumes from its checkpoint' };
      const saved = checkpoints.get(String(body && body.matchId || ''));
      if (!saved) return { error: 'checkpoint_missing', message: 'No checkpoint' };
      if (!saved.accounts[presence.userId]) return { error: 'not_in_roster', message: 'Not a member of that run' };
      seq += 1;
      const match = createAuthorityMatch({ id: 'resume-' + seq, privateRoom: true, seed: saved.seed, restore: saved });
      matches.set(match.state.id, match);
      checkpoints.set(savedMatchId(saved), saved);
      return { matchId: match.state.id, rewards: 0, hostTakeover: 0, protocol: PROTOCOL, fingerprint: FINGERPRINT };
    }
    if (id === 'coop.metrics') {
      const match = matches.get(String(body && body.matchId || ''));
      if (!match) return { error: 'match_missing', message: 'No match' };
      return { rewards: 0, hostTakeover: 0, phase: match.state.phase, tick: match.state.session.state.t, seats: match.seatView().filter(seat => seat.human).length };
    }
    ledgerWrites.n += 1;
    return { error: 'rejected', message: 'No economy RPC' };
  }
  function savedMatchId(saved) { return saved.matchId || ''; }
  function flushQueue() {
    if (!tickets.length) return;
    const batch = tickets.splice(0, CoopProtocol.LIMITS.maxSeats);
    seq += 1;
    const ids = batch.map(row => row.presence.userId);
    const names = {};
    batch.forEach(row => { names[row.presence.userId] = row.presence.username; });
    const match = createAuthorityMatch({ id: 'queue-' + seq, privateRoom: false, roster: ids, names: names });
    matches.set(match.state.id, match);
    batch.forEach(row => {
      const users = batch.map(item => ({ presence: presenceWire(item.presence), string_properties: item.props, numeric_properties: {} }));
      send(row.ws, { matchmaker_matched: { ticket: row.ticket, match_id: match.state.id, users: users, self: users[batch.indexOf(row)] } });
    });
  }
  const server = http.createServer((req, res) => {
    if (req.url === '/test/latency' && req.method === 'POST') {
      let buf = '';
      req.on('data', chunk => { buf += chunk; });
      req.on('end', () => {
        const body = JSON.parse(buf || '{}');
        latency.ms = Number(body.ms) || 0;
        latency.jitter = Number(body.jitter) || 0;
        res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        res.end(JSON.stringify({ ms: latency.ms, jitter: latency.jitter }));
      });
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const token = new URL(req.url, 'http://127.0.0.1').searchParams.get('token') || '';
    let user = { uid: '', usn: '' };
    try { user = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); } catch (err) { user = { uid: '', usn: '' }; }
    if (!user.uid) { ws.close(4001, 'unauthorized'); return; }
    seq += 1;
    ws.presence = { userId: user.uid, sessionId: 'sess-' + seq, username: String(user.usn || user.uid).slice(0, 16), ws: ws };
    sockets.add(ws);
    ws.on('message', raw => {
      let env;
      try { env = JSON.parse(raw.toString()); } catch (err) { return; }
      const cid = env.cid;
      if (env.rpc) {
        let body = {};
        try { body = env.rpc.payload ? JSON.parse(env.rpc.payload) : {}; } catch (err) { body = null; }
        const result = body ? rpc(ws, cid, env.rpc.id, body) : { error: 'bad_json', message: 'Bad request' };
        send(ws, { cid: cid, rpc: { id: env.rpc.id, payload: JSON.stringify(result) } });
        return;
      }
      if (env.matchmaker_add) {
        const props = env.matchmaker_add.string_properties || {};
        if (props.game !== 'sproto-coop-battle' || props.v !== '1' || props.sim !== FINGERPRINT) {
          send(ws, { cid: cid, error: { code: 3, message: 'version_mismatch' } });
          return;
        }
        seq += 1;
        const ticket = 't-' + seq;
        tickets.push({ ticket: ticket, ws: ws, presence: ws.presence, props: props });
        send(ws, { cid: cid, matchmaker_ticket: { ticket: ticket } });
        return;
      }
      if (env.matchmaker_remove) { send(ws, { cid: cid }); return; }
      if (env.match_join) {
        const match = matches.get(String(env.match_join.match_id || ''));
        if (!match || match.state.phase === 'done') { send(ws, { cid: cid, error: { code: 4, message: 'Match not found' } }); return; }
        const meta = env.match_join.metadata || {};
        if (meta.fingerprint && (String(meta.fingerprint) !== FINGERPRINT || Number(meta.protocol || meta.v) !== PROTOCOL)) {
          send(ws, { cid: cid, error: { code: 5, message: 'version_mismatch' } });
          return;
        }
        if (!match.rosterAllows(ws.presence.userId)) { send(ws, { cid: cid, error: { code: 5, message: 'not_in_roster' } }); return; }
        ws.matchId = match.state.id;
        const others = [];
        for (const id of Object.keys(match.state.present)) {
          const presence = match.state.present[id];
          if (presence && presence.sessionId !== ws.presence.sessionId) others.push(presenceWire(presence));
        }
        send(ws, { cid: cid, match: { match_id: match.state.id, authoritative: true, label: JSON.stringify({ rewards: 0, hostTakeover: 0, mode: 'banked' }), size: others.length + 1, presences: others, self: presenceWire(ws.presence) } });
        return;
      }
      if (env.match_leave) {
        const match = matches.get(ws.matchId || '');
        if (match) { match.leave(ws.presence); deliver(match, match.drain()); }
        send(ws, { cid: cid });
        return;
      }
      if (env.match_data_send) {
        const wait = oneWay();
        setTimeout(() => {
          const match = matches.get(String(env.match_data_send.match_id || ''));
          if (!match || ws.readyState !== 1) return;
          const op = Number(env.match_data_send.op_code || 0);
          let msg = {};
          try { msg = JSON.parse(Buffer.from(String(env.match_data_send.data || ''), 'base64').toString()); } catch (err) { msg = null; }
          const rawLen = msg ? JSON.stringify(msg).length : 99999;
          if (op === OP.PING) {
            match.state.out.push({ to: ws.presence, op: OP.PONG, body: { t: 'pong', c: msg && msg.c, s: match.state.loop, rewards: 0 } });
          } else if (op === OP.COMMAND) match.command(ws.presence);
          else if (!msg) match.state.out.push({ to: ws.presence, op: OP.REJECT, body: { t: 'reject', reason: 'schema', rewards: 0, hostTakeover: 0 } });
          else if (op === OP.HELLO) match.hello(ws.presence, msg);
          else if (op === OP.READY) match.ready(ws.presence);
          else if (op === OP.RELEASE) match.release(ws.presence, msg);
          else if (op === OP.INPUT) match.input(ws.presence, msg, Date.now(), rawLen);
          deliver(match, match.drain());
        }, wait);
      }
    });
    ws.on('close', () => {
      sockets.delete(ws);
      const match = matches.get(ws.matchId || '');
      if (match) { match.leave(ws.presence); deliver(match, match.drain()); }
    });
  });
  let paused = false;
  const timer = setInterval(() => {
    // A Playwright round trip is long enough for a power pickup. Callers freeze
    // the loop while they sample life, so that pickup is not blamed on reconnect.
    if (paused) return;
    flushQueue();
    for (const match of matches.values()) {
      if (match.state.phase === 'done') continue;
      const events = match.loop(Date.now());
      deliver(match, events);
    }
  }, 50);
  if (timer.unref) timer.unref();
  function shutdownMatch(id) {
    const match = matches.get(id);
    if (!match) return null;
    const result = match.shutdown();
    result.saved.matchId = id;
    checkpoints.set(id, result.saved);
    deliver(match, result.events);
    return result.saved;
  }
  return {
    latency: latency, matches: matches, ledgerWrites: ledgerWrites, checkpoints: checkpoints,
    listen: () => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port))),
    close: () => new Promise(resolve => { clearInterval(timer); wss.close(); server.close(() => resolve()); }),
    drop: userId => new Promise(resolve => {
      let pending = 0;
      for (const ws of sockets) {
        if (!ws.presence || ws.presence.userId !== userId) continue;
        pending++;
        ws.once('close', () => { if (--pending === 0) resolve(); });
        ws.close(4000, 'drop');
      }
      if (!pending) resolve();
    }),
    pause: () => { paused = true; },
    resume: () => { paused = false; },
    shutdownMatch: shutdownMatch,
    setLatency: (ms, jitter) => { latency.ms = ms; latency.jitter = jitter || 0; },
  };
}

function tokenFor(id, name) {
  const body = Buffer.from(JSON.stringify({ uid: id, usn: name || id })).toString('base64url');
  return 'h.' + body + '.s';
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function probe(url) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (res.ok) return true;
    } catch (err) { /* not up */ }
    await delay(100);
  }
  return false;
}

function startStatic() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'server', 'server.js')], {
      cwd: root, env: Object.assign({}, process.env, { PORT: '0' }), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('static timeout')); }, 10000);
    const onData = chunk => {
      buf += chunk.toString();
      const match = buf.match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timer); resolve({ child: child, url: 'http://127.0.0.1:' + match[1] + '/' }); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
  });
}

async function stopChild(child) {
  if (!child || child.killed || child.exitCode != null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(2000).then(() => child.kill('SIGKILL'))]);
}

async function openPlayer(browser, pageUrl, nakama, user, errs) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const sdk = fs.readFileSync(path.join(root, 'vendor/hub-sdk/dist/hub-sdk.iife.js'), 'utf8');
  await page.addInitScript(sdk + '\n;window.HubSDK = HubSDK;');
  await page.addInitScript(spec => {
    window.SPROTO_COOP_REALTIME = () => window.HubSDK.createRealtime({
      serverUrl: spec.nakama,
      getToken: async () => spec.token,
      reconnect: spec.reconnect === false ? false : { baseDelayMs: 40, maxDelayMs: 200, maxAttempts: 30 },
    });
  }, { nakama: nakama, token: user.token || tokenFor(user.id, user.name), reconnect: user.reconnect !== false });
  page.on('pageerror', err => errs.push(user.id + ': ' + err.message));
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.SprotoApp && window.SprotoApp.screen === 'title', null, { timeout: 45000 });
  await page.evaluate(user => {
    const state = window.CoopHub && window.CoopHub.session && window.CoopHub.session.state;
    if (state) { state.kind = 'account'; state.label = user.name; state.playerId = user.id; state.bankedWrites = 0; }
    if (window.SprotoApp) {
      window.SprotoApp.hub.kind = 'account';
      window.SprotoApp.hub.label = user.name;
      window.SprotoApp._hubPlayer = user.id;
    }
  }, user);
  return page;
}

async function choose(page, item) {
  const index = await page.evaluate(name => window.SprotoApp ? ['LOCAL PLAY', 'HOST ONLINE', 'JOIN ONLINE', 'HUB QUICK', 'HUB ROOM', 'JOIN HUB', 'RETURN TO BAR'].indexOf(name) : -1, item);
  if (index < 0) throw new Error('missing menu ' + item);
  // One frame folds two taps of the same key into one press, so wait for each step to land
  // (a loaded machine can stretch a frame past the 90 ms between presses).
  await page.waitForFunction(() => window.SprotoApp.screen === 'title', null, { timeout: 15000 });
  for (let i = 0; i < index; i++) {
    const at = await page.evaluate(() => window.SprotoApp.menu);
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(was => window.SprotoApp.menu !== was, at, { timeout: 5000 });
  }
  await page.keyboard.press('KeyF');
}

async function main() {
  const out = path.resolve(process.argv[2] || path.join(__dirname, 'artifacts'));
  fs.mkdirSync(out, { recursive: true });
  const { chromium } = require('playwright');
  const standin = createStandin();
  const port = await standin.listen();
  const nakama = 'http://127.0.0.1:' + port;
  const staticServer = await startStatic();
  if (!await probe(staticServer.url + 'healthz')) throw new Error('static server did not start');
  const errs = [];
  const summary = { nakama: nakama, practice: staticServer.url, rewards: 0, ledgerWrites: 0, screenshots: [], latency: {} };
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const host = await openPlayer(browser, staticServer.url, nakama, { id: 'acct-ada', name: 'ada' }, errs);
    const guest = await openPlayer(browser, staticServer.url, nakama, { id: 'acct-bea', name: 'bea' }, errs);
    await choose(host, 'HUB ROOM');
    await host.waitForFunction(() => window.SprotoApp && window.SprotoApp.code && window.SprotoApp.code.length === 12, null, { timeout: 15000 });
    const code = await host.evaluate(() => window.SprotoApp.code);
    summary.room = code;
    await choose(guest, 'JOIN HUB');
    await guest.fill('#code', code);
    await guest.click('#joinForm button[type=submit]');
    await guest.waitForFunction(() => window.SprotoApp.authority && window.SprotoApp.authority.view().phase === 'lobby', null, { timeout: 15000 });
    await host.keyboard.press('Enter');
    await guest.keyboard.press('Enter');
    await host.waitForFunction(() => {
      const view = window.SprotoApp.authority && window.SprotoApp.authority.view();
      return view && view.phase === 'playing' && typeof view.rtt === 'number';
    }, null, { timeout: 10000 });
    await guest.waitForFunction(() => window.SprotoApp.authority && window.SprotoApp.authority.view().phase === 'playing', null, { timeout: 10000 });
    const startX = await host.evaluate(() => window.SprotoApp.authority.view().snapshot.players[0].x);
    await host.bringToFront();
    await host.keyboard.down('KeyD');
    await delay(200);
    const held = await host.evaluate(() => ({
      keys: window.Input && window.Input.keys ? Array.from(window.Input.keys) : [],
      mask: window.Input.pack(window.Input.read('k1')),
    }));
    await delay(1300);
    await host.keyboard.up('KeyD');
    const moved = await host.evaluate(from => {
      const view = window.SprotoApp.authority.view();
      const player = view.snapshot && view.snapshot.players[0];
      return {
        x: player ? player.x : 0, from: from, ctrl: player && player.c, st: player && player.st,
        phase: view.phase, rewards: view.rewards, ledger: view.ledgerCalls, yours: view.yours,
        rtt: view.rtt, rejects: view.rejects.slice(-8), tick: view.snapshot && view.snapshot.t,
        sent: window.SprotoApp.authority.state.lastSentFrame,
        serverTick: window.SprotoApp.authority.state.serverTick,
        seq: window.SprotoApp.authority.state.seq,
        bias: window.SprotoApp.authority.state.bias,
      };
    }, startX);
    moved.held = held;
    summary.twoBrowser = moved;
    if (moved.phase !== 'playing' || !(moved.x > moved.from + 30)) throw new Error('two-browser run did not move: ' + JSON.stringify(moved));
    if (moved.rewards !== 0 || moved.ledger !== 0) throw new Error('ledger write in the two-browser run');
    await host.screenshot({ path: path.join(out, 'c4-two-browser.png') });
    summary.screenshots.push('c4-two-browser.png');

    // Dash ends one tick before an overlapped power is picked up, and only while
    // idle or walking. Wait until that seat has been idle with the same powers
    // for several ticks, freeze the stand-in, and sample again. The loop runs
    // every 50 ms, so a Playwright round trip can collect a power between the
    // two reads and look like a reconnect refill. Require reconnect to leave
    // hp, lives, and powers unchanged.
    const settleDeadline = Date.now() + 4000;
    let beforeDrop = null;
    while (Date.now() < settleDeadline) {
      const settled = await host.evaluate(() => {
        const view = window.SprotoApp.authority && window.SprotoApp.authority.view();
        const player = view && view.snapshot && view.snapshot.players[0];
        if (!view || view.phase !== 'playing' || !player || player.st !== 'idle') {
          window.__coopSettle = null;
          return false;
        }
        const powers = JSON.stringify(player.pw || []);
        const mark = window.__coopSettle;
        if (!mark || mark.powers !== powers) {
          window.__coopSettle = { tick: view.snapshot.t, powers: powers };
          return false;
        }
        return view.snapshot.t >= mark.tick + 6;
      });
      if (!settled) { await delay(30); continue; }
      standin.pause();
      const frozen = await host.evaluate(() => {
        const view = window.SprotoApp.authority && window.SprotoApp.authority.view();
        const player = view && view.snapshot && view.snapshot.players[0];
        const mark = window.__coopSettle;
        if (!view || !player || !mark || player.st !== 'idle') return null;
        if (JSON.stringify(player.pw || []) !== mark.powers) return null;
        return view.snapshot.players.map(row => ({ hp: row.hp, lives: row.l, powers: row.pw }));
      });
      if (frozen) { beforeDrop = frozen; break; }
      standin.resume();
    }
    if (!beforeDrop) throw new Error('reconnect settle timed out');
    // Stay frozen through the second sample. ws.close is not synchronous, and
    // once the seat is human again the match can pick up a power during the
    // screenshot. That pickup is not a reconnect refill.
    await standin.drop('acct-ada');
    try {
      await host.waitForFunction(() => {
        const view = window.SprotoApp.authority && window.SprotoApp.authority.view();
        return view && (view.phase === 'reconnecting' || view.generation > 1);
      }, null, { timeout: 8000 });
      await host.screenshot({ path: path.join(out, 'c4-reconnect.png') });
      summary.screenshots.push('c4-reconnect.png');
      await host.waitForFunction(() => window.SprotoApp.authority.view().phase === 'playing' && window.SprotoApp.authority.view().generation > 1, null, { timeout: 10000 });
      const afterDrop = await host.evaluate(() => window.SprotoApp.authority.view().snapshot.players.map(player => ({ hp: player.hp, lives: player.l, powers: player.pw })));
      summary.reconnect = { before: beforeDrop, after: afterDrop, generation: await host.evaluate(() => window.SprotoApp.authority.view().generation) };
      const healed = afterDrop.some((row, i) => row.lives > beforeDrop[i].lives || row.hp > beforeDrop[i].hp + 1 || JSON.stringify(row.powers) !== JSON.stringify(beforeDrop[i].powers));
      if (healed) throw new Error('reconnect refilled hp, lives, or powers: ' + JSON.stringify(summary.reconnect));
    } finally {
      standin.resume();
    }

    await host.evaluate(() => window.SprotoApp.authority.command('god'));
    await host.evaluate(() => window.SprotoApp.authority.sendRaw(10, { t: 'input', frame: 9, seq: 1, seats: [{ slot: 3, device: 'k2', mask: 1 }] }));
    await delay(400);
    const rejects = await host.evaluate(() => window.SprotoApp.authority.view().rejects);
    summary.rejects = rejects;
    if (!rejects.length) throw new Error('forged input and god command were not rejected');

    await host.evaluate(() => { window.SprotoApp.authority.claim('k2'); });
    await host.evaluate(() => {
      const pad = { connected: true, buttons: Array.from({ length: 16 }, () => ({ pressed: false })), axes: [0.8, 0] };
      navigator.getGamepads = () => [pad, null, null, null];
      window.SprotoApp.authority.claim('gp0');
    });
    await delay(600);
    const mixed = await host.evaluate(() => window.SprotoApp.authority.view().yours.slice());
    summary.mixedDevices = mixed;
    if (mixed.indexOf('k1') < 0 || mixed.indexOf('k2') < 0 || mixed.indexOf('gp0') < 0) throw new Error('mixed devices were not seated: ' + mixed.join(','));
    await host.screenshot({ path: path.join(out, 'c4-mixed-devices.png') });
    summary.screenshots.push('c4-mixed-devices.png');

    const four = [];
    const names = ['ada', 'bea', 'cy', 'dee'];
    for (let i = 0; i < names.length; i++) {
      const page = await openPlayer(browser, staticServer.url, nakama, { id: 'four-' + names[i], name: names[i] }, errs);
      four.push(page);
      if (i === 0) {
        await choose(page, 'HUB ROOM');
        await page.waitForFunction(() => window.SprotoApp.code && window.SprotoApp.code.length === 12, null, { timeout: 15000 });
      } else {
        const room = await four[0].evaluate(() => window.SprotoApp.code);
        await choose(page, 'JOIN HUB');
        await page.fill('#code', room);
        await page.click('#joinForm button[type=submit]');
        await page.waitForFunction(() => window.SprotoApp.authority && window.SprotoApp.authority.view().phase === 'lobby', null, { timeout: 15000 });
      }
    }
    for (const page of four) await page.keyboard.press('Enter');
    await four[0].waitForFunction(() => window.SprotoApp.authority && window.SprotoApp.authority.view().phase === 'playing', null, { timeout: 10000 });
    const humans = await four[0].evaluate(() => window.SprotoApp.authority.view().seats.filter(seat => seat.human).length);
    const accounts = await four[0].evaluate(() => {
      const ids = {};
      window.SprotoApp.authority.view().seats.forEach(seat => { if (seat.human && seat.accountId) ids[seat.accountId] = 1; });
      return Object.keys(ids);
    });
    summary.humans = humans;
    summary.accounts = accounts;
    if (humans !== 4 || accounts.length !== 4) throw new Error('expected four accounts, saw ' + humans + ' seats / ' + accounts.join(','));
    await four[0].screenshot({ path: path.join(out, 'c4-four-accounts.png') });
    summary.screenshots.push('c4-four-accounts.png');

    for (const sample of [{ ms: 100, jitter: 20 }, { ms: 200, jitter: 30 }]) {
      standin.setLatency(sample.ms, sample.jitter);
      await guest.evaluate(() => {
        const authority = window.SprotoApp.authority;
        authority.state.rttSamples = [];
        authority.state.rtt = null;
      });
      await delay(1800);
      const view = await guest.evaluate(() => {
        const row = window.SprotoApp.authority.view();
        return { rtt: row.rtt, jitter: row.jitter, rewards: row.rewards, ledger: row.ledgerCalls };
      });
      summary.latency[String(sample.ms)] = view;
      if (view.rewards !== 0 || view.ledger !== 0) throw new Error('latency run wrote a reward');
      if (typeof view.rtt !== 'number' || view.rtt < sample.ms * 0.4 || view.rtt > sample.ms * 2.5) {
        throw new Error('rtt ' + view.rtt + ' outside the ' + sample.ms + ' ms band');
      }
    }
    await guest.screenshot({ path: path.join(out, 'c4-latency.png') });
    summary.screenshots.push('c4-latency.png');
    const twin = await openPlayer(browser, staticServer.url, nakama, { id: 'acct-ada', name: 'ada' }, errs);
    await choose(twin, 'JOIN HUB');
    await twin.fill('#code', code);
    await twin.click('#joinForm button[type=submit]');
    await host.waitForFunction(() => {
      const view = window.SprotoApp.authority && window.SprotoApp.authority.view();
      return view && view.replaced;
    }, null, { timeout: 10000 });
    summary.doubleTab = await host.evaluate(() => window.SprotoApp.authority.view().message);
    await host.screenshot({ path: path.join(out, 'c4-double-tab.png') });
    summary.screenshots.push('c4-double-tab.png');

    summary.ledgerWrites = standin.ledgerWrites.n;
    if (summary.ledgerWrites !== 0) throw new Error('stand-in recorded an economy RPC');
    if (errs.length) throw new Error(errs.join(' | '));
    fs.writeFileSync(path.join(out, 'c4-browser-summary.json'), JSON.stringify(summary, null, 2) + '\n');
    console.log('hub browser ok', JSON.stringify(summary));
  } finally {
    if (browser) await browser.close().catch(() => {});
    await standin.close();
    await stopChild(staticServer.child);
  }
}

function basicAuth() {
  return 'Basic ' + Buffer.from((process.env.NAKAMA_SERVER_KEY || 'defaultkey') + ':').toString('base64');
}

async function nakamaRpc(base, name, body, token) {
  const params = new URLSearchParams({ unwrap: 'true' });
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(base.replace(/\/$/, '') + '/v2/rpc/' + encodeURIComponent(name) + '?' + params, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body || {}),
  });
  const text = await response.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch (err) { parsed = { message: text }; }
  if (!response.ok || parsed.error) throw new Error(name + ' ' + response.status + ' ' + text.slice(0, 240));
  return parsed;
}

async function gameLogin(base, label) {
  const auth = await fetch(base.replace(/\/$/, '') + '/v2/account/authenticate/device?create=true', {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'c4-' + label + '-' + require('crypto').randomUUID() }),
  });
  const authBody = await auth.json();
  if (!auth.ok || !authBody.token) throw new Error('device auth ' + auth.status);
  const opened = await nakamaRpc(base, 'portal.enter', { game: 'sproto-coop-battle', ranked: false }, authBody.token);
  const redeemed = await fetch(base.replace(/\/$/, '') + '/v2/account/authenticate/custom?create=false', {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 't:' + opened.ticket, vars: { game: 'sproto-coop-battle' } }),
  });
  const game = await redeemed.json();
  if (!redeemed.ok || !game.token) throw new Error('redeem ' + redeemed.status + ' ' + JSON.stringify(game).slice(0, 200));
  const payload = JSON.parse(Buffer.from(game.token.split('.')[1], 'base64url').toString());
  return { id: payload.uid, name: label, token: game.token };
}

async function runReal(nakama) {
  const out = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(__dirname, 'artifacts'));
  fs.mkdirSync(out, { recursive: true });
  const versionProbe = await gameLogin(nakama, 'probe');
  const version = await nakamaRpc(nakama, 'coop.version', {}, versionProbe.token);
  if (version.enabled !== true) throw new Error('coop.version enabled is not true: ' + JSON.stringify(version));
  const ada = await gameLogin(nakama, 'ada');
  const bea = await gameLogin(nakama, 'bea');
  const beforeAda = await nakamaRpc(nakama, 'tickets.balance', { game: 'sproto-coop-battle' }, ada.token);
  const beforeBea = await nakamaRpc(nakama, 'tickets.balance', { game: 'sproto-coop-battle' }, bea.token);
  const { chromium } = require('playwright');
  const staticServer = await startStatic();
  if (!await probe(staticServer.url + 'healthz')) throw new Error('static server did not start');
  const errs = [];
  let browser;
  const summary = { nakama: nakama.replace(/\/$/, ''), version: { enabled: version.enabled, protocol: version.protocol, fingerprint: version.fingerprint, rewards: version.rewards }, ledger: {} };
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    ada.reconnect = false;
    bea.reconnect = false;
    const host = await openPlayer(browser, staticServer.url, nakama, ada, errs);
    const guest = await openPlayer(browser, staticServer.url, nakama, bea, errs);
    await choose(host, 'HUB ROOM');
    await host.waitForFunction(() => window.SprotoApp && window.SprotoApp.code && window.SprotoApp.code.length === 12, null, { timeout: 20000 });
    const code = await host.evaluate(() => window.SprotoApp.code);
    summary.room = code;
    await choose(guest, 'JOIN HUB');
    await guest.fill('#code', code);
    await guest.click('#joinForm button[type=submit]');
    await guest.waitForFunction(() => window.SprotoApp.authority && window.SprotoApp.authority.view().phase === 'lobby', null, { timeout: 20000 });
    await host.keyboard.press('Enter');
    await guest.keyboard.press('Enter');
    await host.waitForFunction(() => window.SprotoApp.authority && window.SprotoApp.authority.view().phase === 'playing', null, { timeout: 20000 });
    await guest.waitForFunction(() => window.SprotoApp.authority && window.SprotoApp.authority.view().phase === 'playing', null, { timeout: 20000 });
    await delay(800);
    await host.screenshot({ path: path.join(out, 'c4-real-two-browser.png') });
    const before = await host.evaluate(() => window.SprotoApp.authority.view().snapshot.players.map(player => ({ hp: player.hp, lives: player.l, powers: player.pw })));
    const { execFileSync } = require('child_process');
    const block = ['-n', 'iptables', '-I', 'OUTPUT', '-p', 'tcp', '--dport', '7350', '-j', 'REJECT', '--reject-with', 'tcp-reset'];
    const unblock = ['-n', 'iptables', '-D', 'OUTPUT', '-p', 'tcp', '--dport', '7350', '-j', 'REJECT', '--reject-with', 'tcp-reset'];
    execFileSync('sudo', block, { stdio: 'ignore' });
    try {
      await host.waitForFunction(() => {
        const view = window.SprotoApp.authority && window.SprotoApp.authority.view();
        return view && (view.phase === 'reconnecting' || view.generation > 1);
      }, null, { timeout: 15000 });
    } finally {
      execFileSync('sudo', unblock, { stdio: 'ignore' });
    }
    await delay(300);
    await host.evaluate(() => window.SprotoApp.authority.rejoin());
    try {
      await host.waitForFunction(() => {
        const view = window.SprotoApp.authority && window.SprotoApp.authority.view();
        return view && view.phase === 'playing' && view.generation > 1;
      }, null, { timeout: 20000 });
    } catch (err) {
      const stuck = await host.evaluate(() => {
        const view = window.SprotoApp.authority && window.SprotoApp.authority.view();
        return view ? { phase: view.phase, generation: view.generation, message: view.message, rejects: view.rejects.slice(-6), replaced: view.replaced, matchId: view.matchId } : null;
      });
      console.log('reconnect stuck', JSON.stringify(stuck));
      throw err;
    }
    const after = await host.evaluate(() => window.SprotoApp.authority.view().snapshot.players.map(player => ({ hp: player.hp, lives: player.l, powers: player.pw })));
    summary.reconnect = { before: before, after: after, generation: await host.evaluate(() => window.SprotoApp.authority.view().generation) };
    const refilled = after.some((row, i) => !before[i] || row.lives > before[i].lives || row.hp > before[i].hp + 1 || JSON.stringify(row.powers) !== JSON.stringify(before[i].powers));
    if (refilled) throw new Error('real reconnect refilled lives, hp, or powers ' + JSON.stringify(summary.reconnect));
    await host.screenshot({ path: path.join(out, 'c4-real-reconnect.png') });
    const afterAda = await nakamaRpc(nakama, 'tickets.balance', { game: 'sproto-coop-battle' }, ada.token);
    const afterBea = await nakamaRpc(nakama, 'tickets.balance', { game: 'sproto-coop-battle' }, bea.token);
    summary.ledger = { ada: { before: beforeAda.balance, after: afterAda.balance }, bea: { before: beforeBea.balance, after: afterBea.balance }, rewards: version.rewards };
    if (beforeAda.balance !== afterAda.balance || beforeBea.balance !== afterBea.balance) {
      throw new Error('ticket balance changed ' + JSON.stringify(summary.ledger));
    }
    if (errs.length) throw new Error(errs.join(' | '));
    fs.writeFileSync(path.join(out, 'c4-real-summary.json'), JSON.stringify(summary, null, 2) + '\n');
    console.log('real nakama ok', JSON.stringify(summary));
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopChild(staticServer.child);
  }
}

module.exports = {
  loadGame, createAuthorityMatch, createStandin, tokenFor, normalizeCode, OP, FINGERPRINT, PROTOCOL, runReal,
  startStatic, stopChild, probe, delay, openPlayer, choose,
};

if (require.main === module) {
  const real = process.env.NAKAMA_URL;
  const job = real ? runReal(real) : main();
  job.catch(err => {
    console.error(err);
    process.exit(1);
  });
}
