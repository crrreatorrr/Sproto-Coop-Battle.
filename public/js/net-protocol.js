// Authoritative Coop protocol. Practice still uses the relay in server/server.js.
// This module never mints Tickets, submits scores, or applies a client snapshot.
(function (root) {
'use strict';
const PROTOCOL_VERSION = 1;
const GAME_ID = 'sproto-coop-battle';
const LIMITS = {
  simHz: 60,
  loopHz: 20,
  substeps: 3,
  snapshotHz: 10,
  snapshotMaxHz: 15,
  maxSeats: 4,
  maxFutureFrames: 3,
  maxPayloadBytes: 2048,
  maxInputBytes: 768,
  maxStateBytes: 262144,
  maxInputsPerSecond: 60,
  inputBurst: 12,
  maxSeq: 4294967295,
  maxAccountChars: 64,
  maxDeviceChars: 16,
  reconnectGraceMs: 15000,
  encounterGraceTicks: 180,
  afkAliveTicks: 300,
  buttonMaskMax: 255,
  inputBatchMax: 3,
  snapshotKeyframeLoops: 60,
};
const SNAPSHOT_KIND = 'sproto-coop-battle-snapshot';
const DELTA_KIND = 'sproto-coop-battle-snapshot-delta';
const ACCOUNT_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const DEVICE_RE = /^[A-Za-z0-9_-]{1,16}$/;

function fail(reason) { return { ok: false, reason: reason }; }
function simApi() {
  const sim = root.Sim;
  if (!sim || !sim.create || !sim.step) throw new Error('sim');
  return sim;
}

function unpackMask(n) {
  return {
    l: n & 1, r: (n >> 1) & 1, u: (n >> 2) & 1, d: (n >> 3) & 1,
    a: (n >> 4) & 1, j: (n >> 5) & 1, s: (n >> 6) & 1, p: (n >> 7) & 1,
  };
}
function packMask(inp) {
  return (inp.l ? 1 : 0) | ((inp.r ? 1 : 0) << 1) | ((inp.u ? 1 : 0) << 2) | ((inp.d ? 1 : 0) << 3) |
    ((inp.a ? 1 : 0) << 4) | ((inp.j ? 1 : 0) << 5) | ((inp.s ? 1 : 0) << 6) | ((inp.p ? 1 : 0) << 7);
}
function neutralButtons() { return { l: 0, r: 0, u: 0, d: 0, a: 0, j: 0, s: 0, p: 0 }; }

function contentManifest(manifest) {
  const sim = simApi();
  const bosses = manifest && manifest.bosses;
  const fighters = manifest && manifest.fighters;
  if (!bosses || !bosses.length || !fighters || !fighters.length) throw new Error('manifest');
  const stages = [];
  for (let i = 0; i < bosses.length; i++) {
    const boss = bosses[i];
    if (!boss || !boss.key || !boss.stage || !boss.pilot || !boss.machines || !boss.machines.length) throw new Error('boss');
    if (!boss.phases || !boss.phases.length || boss.phases.length > 2 || boss.machines.length !== boss.phases.length) throw new Error('phases');
    stages.push({
      index: i,
      canonicalBossId: boss.key,
      displayStage: boss.stage,
      pilot: boss.pilot,
      machines: boss.machines.slice(),
      phaseCount: boss.phases.length,
      phase2Attacks: boss.phases.length > 1 && boss.attacks !== 'bar' ? [sim.bossExtraAttack(i, 'signature'), sim.bossExtraAttack(i, 'special')] : [],
      ...(boss.attacks ? { attacks: boss.attacks, shadowStage: boss.shadowStage, attacksByPhase: boss.attacksByPhase } : {}),
      oneClear: true,
      length: sim.stageLength(i),
      archetype: sim.BOSS_ARCHETYPES[i % sim.BOSS_ARCHETYPES.length],
    });
  }
  return {
    gameId: GAME_ID,
    bossTransformTicks: sim.BOSS_TRANSFORM_TICKS,
    stages: stages,
    fighters: fighters.map((f, i) => ({ id: f.id, name: f.name, passive: sim.PASSIVES[i % sim.PASSIVES.length].id })),
    weapons: sim.WEAPONS.map(w => w.id),
    classes: sim.CLASSES.map(c => c.id),
    party: { size: sim.SLOTS, cpuFill: true },
    shadows: manifest.shadows ? manifest.shadows.stages.map(rows => rows.map(row => [row.id, row.role])) : [],
  };
}

function blankSeats() {
  const seats = [];
  for (let slot = 0; slot < LIMITS.maxSeats; slot++) {
    seats.push({ slot: slot, accountId: null, generation: 0, device: '', human: false });
  }
  return seats;
}
function lifeFacts(state) {
  return {
    lives: state.players.map(p => p.lives),
    hp: state.players.map(p => p.hp),
    powers: state.players.map(p => p.powers.slice()),
    items: state.items.map(item => item.id),
    dead: state.players.map(p => p.dead ? 1 : 0),
    downT: state.players.map(p => p.downT),
  };
}
function createMatch(opts) {
  const sim = simApi();
  const options = opts || {};
  const mode = options.mode === 'banked' ? 'banked' : 'practice';
  if (mode === 'banked' && options.stage) return fail('stage');
  const stage = mode === 'banked' ? 0 : (options.stage | 0);
  const seed = options.seed >>> 0;
  if (!seed) return fail('seed');
  const manifest = options.manifest || root.MANIFEST;
  const cpuParty = options.cpuParty === true || (!options.slots && options.cpuParty !== false);
  const slots = options.slots || sim.partySlots(manifest);
  const state = sim.create(slots, seed, stage, { cpuParty });
  return {
    ok: true,
    session: {
      mode: mode,
      matchId: String(options.matchId || 'local'),
      manifest,
      state: state,
      seats: blankSeats(),
      loops: 0,
      seq: {},
      limiters: {},
      encounter: null,
      closedEncounter: null,
    },
  };
}
function validAccount(id) { return typeof id === 'string' && ACCOUNT_RE.test(id); }
function validDevice(device) { return typeof device === 'string' && DEVICE_RE.test(device); }
function validGeneration(n) { return Number.isInteger(n) && n >= 1 && n <= LIMITS.maxSeq; }

function assignSeat(session, req, earnedTier) {
  if (!session || !session.state || !session.seats) return fail('schema');
  if (!req || !Number.isInteger(req.slot) || req.slot < 0 || req.slot >= LIMITS.maxSeats) return fail('seat');
  if (!validAccount(req.accountId) || !validDevice(req.device) || !validGeneration(req.generation)) return fail('owner');
  const seat = session.seats[req.slot];
  if (seat.human && (seat.accountId !== req.accountId || seat.device !== req.device)) return fail('occupied');
  for (let i = 0; i < session.seats.length; i++) {
    const other = session.seats[i];
    if (i !== req.slot && other.human && other.accountId === req.accountId && other.device === req.device) return fail('device');
  }
  const player = session.state.players[req.slot];
  const newOwner = !seat.human;
  const before = lifeFacts(session.state);
  for (let i = 0; i < session.seats.length; i++) {
    const other = session.seats[i];
    if (other.human && other.accountId === req.accountId) other.generation = req.generation;
  }
  seat.accountId = req.accountId;
  seat.generation = req.generation;
  seat.device = req.device;
  seat.human = true;
  simApi().seatIn(session.state, req.slot, { ctrl: 'local' });
  if (newOwner && earnedTier !== undefined) {
    const sim = simApi();
    player.weapon = sim.weaponFor(sim.classOf(player).id, player.weapon, earnedTier);
  }
  const after = lifeFacts(session.state);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('life-reset');
  return { ok: true, seat: seat, lives: player.lives, hp: player.hp, powers: player.powers.slice() };
}

// Lobby picks are keyed by claimed device so changing one local player's loadout
// cannot also change a second player sharing the same account and socket.
function parseLoadouts(raw, devices) {
  if (raw === undefined) return { ok: true, picks: {} };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('loadout');
  const picks = {};
  for (const device of Object.keys(raw)) {
    const row = raw[device];
    if (!validDevice(device) || badPickKey(device) || !devices.includes(device) || !validLoadout(row)) return fail('loadout');
    picks[device] = row;
  }
  return { ok: true, picks };
}
const badPickKey = key => key === '__proto__' || key === 'constructor' || key === 'prototype';
function validLoadout(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const keys = Object.keys(row);
  return keys.length > 0 && keys.every(key =>
    ['fighter', 'weapon', 'classId'].includes(key) && typeof row[key] === 'string' && /^[a-zA-Z0-9-]{1,32}$/.test(row[key]));
}

function parseCpuLoadouts(raw) {
  if (raw === undefined) return { ok: true, picks: {} };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('loadout');
  const picks = {};
  for (const slot of Object.keys(raw)) {
    if (!/^[0-9]$/.test(slot) || Number(slot) >= LIMITS.maxSeats || !validLoadout(raw[slot])) return fail('loadout');
    picks[slot] = raw[slot];
  }
  return { ok: true, picks };
}

// The host supplies the earned tier separately. The player's message supplies
// only IDs. Changing a pick keeps the existing seat, ownership, and generation.
function selectLoadout(session, req, earnedTier) {
  if (!session || !session.state || !session.seats) return fail('schema');
  if (!req || !Number.isInteger(req.slot) || req.slot < 0 || req.slot >= LIMITS.maxSeats) return fail('seat');
  if (session.state.t !== 0) return fail('phase');
  const seat = session.seats[req.slot];
  if (!seat.human || seat.accountId !== req.accountId || seat.generation !== req.generation) return fail('owner');
  return applyLoadout(session, req, earnedTier);
}

function selectCpuLoadout(session, req, earnedTier) {
  if (!session || !session.state || !session.seats) return fail('schema');
  if (!req || !Number.isInteger(req.slot) || req.slot < 0 || req.slot >= LIMITS.maxSeats) return fail('seat');
  if (session.state.t !== 0 || !session.state.cpuParty) return fail('phase');
  const lead = session.seats.find(seat => seat.human);
  if (!lead || lead.accountId !== req.accountId || lead.generation !== req.generation) return fail('owner');
  if (session.seats[req.slot].human || session.state.players[req.slot].ctrl !== 'cpu') return fail('occupied');
  return applyLoadout(session, req, earnedTier);
}

function applyLoadout(session, req, earnedTier) {
  const sim = simApi();
  const p = session.state.players[req.slot];
  const classId = req.classId === undefined ? sim.classOf(p).id : req.classId;
  if (!sim.CLASSES.some(c => c.id === classId)) return fail('class');
  const fighters = session.manifest.fighters;
  const fid = req.fighter === undefined ? p.fid : fighters.findIndex(f => f.id === req.fighter);
  if (fid < 0) return fail('fighter');
  const tier = Number.isInteger(earnedTier) && earnedTier >= 1 ? earnedTier : 1;
  const requested = req.weapon === undefined ? p.weapon : sim.WEAPONS.findIndex(w => w.id === req.weapon);
  const weapon = sim.weaponFor(classId, requested, tier);
  if (req.weapon !== undefined && weapon !== requested) return fail('weapon_locked');
  sim.setClass(p, classId);
  // The fighter passive can affect max HP; preserve the same health fraction.
  const hp = sim.maxHp(p);
  p.fid = fid;
  if (hp !== sim.maxHp(p)) p.hp = Math.round(p.hp * sim.maxHp(p) / hp);
  p.weapon = weapon;
  return { ok: true };
}

function releaseSeat(session, req) {
  if (!session || !req || !Number.isInteger(req.slot) || req.slot < 0 || req.slot >= LIMITS.maxSeats) return fail('seat');
  const seat = session.seats[req.slot];
  if (!seat.human || seat.accountId !== req.accountId || seat.generation !== req.generation) return fail('owner');
  const player = session.state.players[req.slot];
  const before = lifeFacts(session.state);
  seat.accountId = null;
  seat.generation = 0;
  seat.device = '';
  seat.human = false;
  simApi().seatOut(session.state, req.slot);
  const after = lifeFacts(session.state);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('life-reset');
  return { ok: true, seat: seat, lives: player.lives, hp: player.hp, powers: player.powers.slice() };
}

function payloadBytes(msg) {
  try { return JSON.stringify(msg).length; } catch (err) { return LIMITS.maxPayloadBytes + 1; }
}
function takeToken(session, accountId, now) {
  if (!Number.isFinite(now)) return fail('nan');
  let bucket = session.limiters[accountId];
  if (!bucket) bucket = session.limiters[accountId] = { tokens: LIMITS.inputBurst, last: now };
  if (now < bucket.last) return fail('clock');
  const refill = (now - bucket.last) * (LIMITS.maxInputsPerSecond / 1000);
  bucket.tokens = Math.min(LIMITS.inputBurst, bucket.tokens + refill);
  bucket.last = now;
  if (bucket.tokens < 1) return fail('rate');
  bucket.tokens -= 1;
  return { ok: true };
}
function rememberSeq(session, accountId, generation, seq) {
  if (!Number.isInteger(seq) || seq < 0 || seq > LIMITS.maxSeq) return fail('seq');
  const key = accountId + '#' + generation;
  const prev = session.seq[key];
  if (prev !== undefined && seq <= prev) return fail(seq === prev ? 'duplicate' : 'stale-seq');
  session.seq[key] = seq;
  return { ok: true };
}

function acceptInput(session, msg, now) {
  if (!session || session.mode !== 'banked' && session.mode !== 'practice') return fail('schema');
  if (!msg || msg.t !== 'input' || typeof msg !== 'object' || Array.isArray(msg)) return fail('schema');
  if (payloadBytes(msg) > LIMITS.maxInputBytes) return fail('oversized');
  if (!validAccount(msg.accountId) || !validGeneration(msg.generation)) return fail('owner');
  if (!Number.isInteger(msg.frame)) return fail(typeof msg.frame === 'number' && !Number.isFinite(msg.frame) ? 'nan' : 'frame');
  const tick = session.state.t;
  if (msg.frame <= tick) return fail('stale');
  if (msg.frame > tick + LIMITS.maxFutureFrames) return fail('future');
  if (!Array.isArray(msg.seats) || msg.seats.length < 1 || msg.seats.length > LIMITS.maxSeats) return fail('seats');
  const seen = {};
  const applied = [];
  for (let i = 0; i < msg.seats.length; i++) {
    const row = msg.seats[i];
    if (!row || !Number.isInteger(row.slot) || row.slot < 0 || row.slot >= LIMITS.maxSeats) return fail('seat');
    if (seen[row.slot]) return fail('seat');
    seen[row.slot] = 1;
    if (!validDevice(row.device)) return fail('owner');
    if (typeof row.mask !== 'number' || !Number.isFinite(row.mask) || !Number.isInteger(row.mask) || row.mask < 0 || row.mask > LIMITS.buttonMaskMax) {
      return fail(typeof row.mask === 'number' && !Number.isFinite(row.mask) ? 'nan' : 'mask');
    }
    const seat = session.seats[row.slot];
    if (!seat.human || seat.accountId !== msg.accountId || seat.generation !== msg.generation || seat.device !== row.device) return fail('owner');
    applied.push({ slot: row.slot, buttons: unpackMask(row.mask) });
  }
  const rate = takeToken(session, msg.accountId, now);
  if (!rate.ok) return rate;
  const seq = rememberSeq(session, msg.accountId, msg.generation, msg.seq);
  if (!seq.ok) return seq;
  return { ok: true, frame: msg.frame, seats: applied };
}

function applyButtons(session, applied) {
  for (let i = 0; i < session.state.players.length; i++) {
    const player = session.state.players[i];
    if (player.ctrl === 'cpu') continue;
    player.in = neutralButtons();
  }
  if (!applied) return;
  for (let i = 0; i < applied.seats.length; i++) {
    const row = applied.seats[i];
    session.state.players[row.slot].in = row.buttons;
  }
}

function latchKill(session, enc) {
  const boss = session.state.boss, mode = session.state.mode;
  if (enc.killTick || !((boss && boss.st === 'dead') || mode === 'clear' || mode === 'victory')) return;
  enc.killTick = session.state.t;
  const standing = {};
  for (let i = 0; i < session.seats.length; i++) {
    const seat = session.seats[i];
    if (seat.human && session.state.players[seat.slot].st !== 'dead') standing[seat.accountId] = 1;
  }
  const ids = Object.keys(enc.accounts);
  for (let i = 0; i < ids.length; i++) enc.accounts[ids[i]].out = !standing[ids[i]];
}
function notePresence(session) {
  const enc = session.encounter;
  if (!enc) return;
  const age = session.state.t - enc.startTick;
  // The moment the boss falls (or the stage clears) is latched once per encounter. An account all
  // of whose seats are dead at that moment was out for the kill and is not eligible for this boss.
  // A downed seat is not out: it is revived by the clear.
  latchKill(session, enc);
  for (let i = 0; i < session.seats.length; i++) {
    const seat = session.seats[i];
    if (!seat.human) continue;
    let row = enc.accounts[seat.accountId];
    if (!row) {
      row = enc.accounts[seat.accountId] = {
        slots: [],
        presentAtStart: age <= 1,
        nonNeutral: 0,
        neutralAlive: 0,
        downTicks: 0,
        seen: 0,
      };
    }
    if (row.slots.indexOf(seat.slot) < 0) row.slots.push(seat.slot);
    const player = session.state.players[seat.slot];
    row.seen++;
    if (player.st === 'down' || player.st === 'dead') row.downTicks++;
    else {
      const inp = player.in || neutralButtons();
      const neutral = !(inp.l || inp.r || inp.u || inp.d || inp.a || inp.j || inp.s || inp.p);
      if (!neutral) row.nonNeutral++;
      else if (age > LIMITS.encounterGraceTicks) row.neutralAlive++;
    }
  }
}

function beginEncounter(session) {
  const stages = contentManifest(session.manifest).stages;
  const stage = stages[session.state.stageIdx];
  if (!stage) return fail('stage');
  session.encounter = {
    canonicalBossId: stage.canonicalBossId,
    stageIndex: session.state.stageIdx,
    startTick: session.state.t,
    accounts: {},
  };
  session.closedEncounter = null;
  return { ok: true, canonicalBossId: stage.canonicalBossId };
}

function participationFacts(session) {
  const enc = session.encounter || session.closedEncounter;
  if (!enc) return { canonicalBossId: null, accounts: [], tickets: 0 };
  if (enc === session.encounter) latchKill(session, enc); // also when asked on the very tick the boss fell
  const accounts = [];
  const ids = Object.keys(enc.accounts).sort();
  for (let i = 0; i < ids.length; i++) {
    const row = enc.accounts[ids[i]];
    const afk = row.nonNeutral === 0 && row.neutralAlive >= LIMITS.afkAliveTicks;
    accounts.push({
      accountId: ids[i],
      slots: row.slots.slice(),
      presentAtStart: row.presentAtStart ? 1 : 0,
      nonNeutral: row.nonNeutral,
      neutralAlive: row.neutralAlive,
      downTicks: row.downTicks,
      afk: afk ? 1 : 0,
      out: row.out ? 1 : 0,
      eligible: row.presentAtStart && !afk && !row.out ? 1 : 0,
    });
  }
  return {
    canonicalBossId: enc.canonicalBossId,
    stageIndex: enc.stageIndex,
    startTick: enc.startTick,
    phasesAreOneClear: 1,
    accounts: accounts,
    tickets: 0,
    scoreSubmitted: 0,
  };
}

function endEncounter(session) {
  const facts = participationFacts(session);
  session.closedEncounter = session.encounter;
  session.encounter = null;
  return facts;
}

function terminalFacts(session) {
  const state = session.state;
  const stage = contentManifest(session.manifest).stages[state.stageIdx];
  const boss = state.boss;
  return {
    tick: state.t,
    mode: state.mode,
    stageIndex: state.stageIdx,
    canonicalBossId: stage ? stage.canonicalBossId : null,
    bossPhase: boss ? boss.phase : null,
    bossHp: boss ? boss.hp : null,
    phasesAreOneClear: 1,
    encounterCleared: state.mode === 'clear' || state.mode === 'victory' ? 1 : 0,
    victory: state.mode === 'victory' ? 1 : 0,
    gameOver: state.mode === 'gameover' ? 1 : 0,
    tickets: 0,
    scoreSubmitted: 0,
  };
}

// Rollback copies for stepLoop. seq is { key: number } and limiters is { account: { tokens, last } },
// so a copy of each map and each bucket is all a failed loop needs to restore.
function copySeq(seq) {
  const out = {};
  const keys = Object.keys(seq);
  for (let i = 0; i < keys.length; i++) out[keys[i]] = seq[keys[i]];
  return out;
}
function copyLimiters(limiters) {
  const out = {};
  const keys = Object.keys(limiters);
  for (let i = 0; i < keys.length; i++) {
    const bucket = limiters[keys[i]];
    out[keys[i]] = { tokens: bucket.tokens, last: bucket.last };
  }
  return out;
}

function stepLoop(session, frames, now) {
  if (!session) return fail('schema');
  if (!Array.isArray(frames) || frames.length !== LIMITS.substeps) return fail('substeps');
  // Taken before the first input is checked; a loop with no input copies nothing.
  let savedSeq = null, savedLimiters = null;
  const decoded = [];
  for (let i = 0; i < frames.length; i++) {
    if (!frames[i]) { decoded.push(null); continue; }
    if (!savedSeq) { savedSeq = copySeq(session.seq); savedLimiters = copyLimiters(session.limiters); }
    const applied = acceptInput(session, frames[i], now + i);
    if (!applied.ok) {
      session.seq = savedSeq;
      session.limiters = savedLimiters;
      return applied;
    }
    decoded.push(applied);
  }
  const sim = simApi();
  for (let i = 0; i < decoded.length; i++) {
    applyButtons(session, decoded[i]);
    notePresence(session);
    sim.step(session.state);
  }
  session.loops++;
  const due = session.loops % 2 === 0;
  return { ok: true, snapshot: due ? snapshotEnvelope(session) : null };
}

function snapshotEnvelope(session) {
  return {
    kind: SNAPSHOT_KIND,
    protocol: PROTOCOL_VERSION,
    gameId: GAME_ID,
    matchId: session.matchId,
    tick: session.state.t,
    loop: session.loops,
    hz: LIMITS.snapshotHz,
    restart: 0,
    state: simApi().snapshot(session.state),
  };
}

// Optional wire savings. Neither changes the match: the hub opts in (and tells clients through
// coop.version features), and stepLoop still takes one input message per substep and returns full
// snapshot envelopes.
//
// Input batch: one { t: 'inputs', batch: [input, ...] } message carries up to three substeps'
// input messages. Each item is still checked by acceptInput (seq, rate, owner), as if sent alone.
function splitInputBatch(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.t !== 'inputs') return fail('schema');
  if (payloadBytes(msg) > LIMITS.maxPayloadBytes) return fail('oversized');
  const batch = msg.batch;
  if (!Array.isArray(batch) || batch.length < 1 || batch.length > LIMITS.inputBatchMax) return fail('batch');
  for (let i = 0; i < batch.length; i++) {
    const item = batch[i];
    if (!item || typeof item !== 'object' || Array.isArray(item) || item.t !== 'input') return fail('schema');
    if (i && item.frame <= batch[i - 1].frame) return fail('frame');
  }
  return { ok: true, inputs: batch.slice() };
}

// Snapshot delta: the change from one snapshot envelope's render state to the next, as a tree of
// { r: value } (replace), { o: { key: change }, d: [deleted keys] } (object) and
// { a: { index: change }, n: length } (array). Values are compared as their JSON forms, so
// applying the delta to the base gives exactly the JSON of the full envelope. A delta names its
// base by loop; a client without that base waits for the next full envelope (keyframe).
function jsonValue(v) { return v === undefined || typeof v === 'function' ? undefined : v; }
function diffValue(a, b) {
  if (a === b) return undefined;
  const ao = typeof a === 'object' && a !== null, bo = typeof b === 'object' && b !== null;
  if (!ao || !bo || Array.isArray(a) !== Array.isArray(b) || typeof b.toJSON === 'function') return { r: b };
  if (Array.isArray(b)) {
    const set = {};
    let changed = a.length !== b.length;
    for (let i = 0; i < b.length; i++) {
      const v = jsonValue(b[i]) === undefined ? null : b[i];
      const d = i < a.length ? diffValue(jsonValue(a[i]) === undefined ? null : a[i], v) : { r: v };
      if (d !== undefined) { set[i] = d; changed = true; }
    }
    if (!changed) return undefined;
    const out = { a: set };
    if (a.length !== b.length) out.n = b.length;
    return out;
  }
  const set = {}, gone = [];
  let changed = false;
  const keys = Object.keys(b);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i], v = jsonValue(b[k]);
    if (v === undefined) continue;
    const was = jsonValue(a[k]);
    const d = was === undefined || !Object.prototype.hasOwnProperty.call(a, k) ? { r: v } : diffValue(was, v);
    if (d !== undefined) { set[k] = d; changed = true; }
  }
  const old = Object.keys(a);
  for (let i = 0; i < old.length; i++) {
    const k = old[i];
    if (jsonValue(a[k]) !== undefined && jsonValue(b[k]) === undefined) gone.push(k);
  }
  // Key order, only when it is not the base's order with deletions removed and additions appended.
  const kept = [], order = [];
  for (let i = 0; i < old.length; i++) if (jsonValue(a[old[i]]) !== undefined && jsonValue(b[old[i]]) !== undefined) kept.push(old[i]);
  for (let i = 0; i < keys.length; i++) if (jsonValue(b[keys[i]]) !== undefined) order.push(keys[i]);
  let reordered = false;
  for (let i = 0; i < kept.length; i++) if (order[i] !== kept[i]) { reordered = true; break; }
  if (!changed && !gone.length && !reordered) return undefined;
  const out = { o: set };
  if (gone.length) out.d = gone;
  if (reordered) out.k = order;
  return out;
}
function plainCopy(v) {
  if (typeof v !== 'object' || v === null) return v;
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = plainCopy(v[i]);
    return out;
  }
  const out = {};
  const keys = Object.keys(v);
  for (let i = 0; i < keys.length; i++) out[keys[i]] = plainCopy(v[keys[i]]);
  return out;
}
function patchValue(a, d) {
  if (!d || typeof d !== 'object') throw new Error('delta');
  if (Object.prototype.hasOwnProperty.call(d, 'r')) return plainCopy(d.r);
  if (d.a) {
    if (!Array.isArray(a)) throw new Error('delta');
    const n = d.n === undefined ? a.length : d.n;
    if (!Number.isInteger(n) || n < 0) throw new Error('delta');
    const out = a.slice(0, n);
    const keys = Object.keys(d.a);
    for (let i = 0; i < keys.length; i++) {
      const at = Number(keys[i]);
      if (!Number.isInteger(at) || at < 0 || at >= n) throw new Error('delta');
      out[at] = patchValue(out[at], d.a[keys[i]]);
    }
    return out;
  }
  if (d.o) {
    if (typeof a !== 'object' || a === null || Array.isArray(a)) throw new Error('delta');
    const out = {};
    const gone = Array.isArray(d.d) ? d.d : [];
    const keys = Object.keys(a);
    for (let i = 0; i < keys.length; i++) if (gone.indexOf(keys[i]) < 0) out[keys[i]] = a[keys[i]];
    const set = Object.keys(d.o);
    for (let i = 0; i < set.length; i++) {
      if (set[i] === '__proto__') throw new Error('delta');
      out[set[i]] = patchValue(out[set[i]], d.o[set[i]]);
    }
    if (!Array.isArray(d.k)) return out;
    const ordered = {};
    for (let i = 0; i < d.k.length; i++) {
      if (typeof d.k[i] !== 'string' || !Object.prototype.hasOwnProperty.call(out, d.k[i]) || d.k[i] === '__proto__') throw new Error('delta');
      ordered[d.k[i]] = out[d.k[i]];
    }
    if (Object.keys(ordered).length !== Object.keys(out).length) throw new Error('delta');
    return ordered;
  }
  throw new Error('delta');
}
function snapshotDelta(base, next) {
  if (!base || !next || base.kind !== SNAPSHOT_KIND || next.kind !== SNAPSHOT_KIND || base.matchId !== next.matchId) return fail('base');
  const d = diffValue(base.state, next.state);
  return {
    ok: true,
    delta: {
      kind: DELTA_KIND, protocol: next.protocol, gameId: next.gameId, matchId: next.matchId,
      tick: next.tick, loop: next.loop, hz: next.hz, restart: next.restart,
      base: base.loop, baseTick: base.tick, d: d === undefined ? null : d,
    },
  };
}
function applySnapshotDelta(base, delta) {
  if (!base || !delta || base.kind !== SNAPSHOT_KIND || delta.kind !== DELTA_KIND) return fail('schema');
  if (delta.matchId !== base.matchId || delta.base !== base.loop || delta.baseTick !== base.tick) return fail('base');
  let state;
  try { state = delta.d === null ? plainCopy(base.state) : patchValue(plainCopy(base.state), delta.d); }
  catch (err) { return fail('delta'); }
  return {
    ok: true,
    envelope: {
      kind: SNAPSHOT_KIND, protocol: delta.protocol, gameId: delta.gameId, matchId: delta.matchId,
      tick: delta.tick, loop: delta.loop, hz: delta.hz, restart: delta.restart, state: state,
    },
  };
}

function command(session, msg, now) {
  if (!session || !msg || typeof msg !== 'object' || Array.isArray(msg)) return fail('schema');
  if (payloadBytes(msg) > LIMITS.maxPayloadBytes) return fail('oversized');
  const banked = session.mode === 'banked';
  if (msg.t === 'god' || msg.t === 'stage' || msg.t === 'state' || msg.t === 'seed' || msg.t === 'earn' || msg.t === 'score') {
    if (msg.t === 'state' || msg.t === 'earn' || msg.t === 'score') return fail('rejected');
    if (banked) return fail('rejected');
    if (msg.t === 'god') {
      simApi().toggleGod(session.state);
      return { ok: true, practice: 1, god: session.state.god ? 1 : 0 };
    }
    if (msg.t === 'stage') {
      if (!Number.isInteger(msg.index) || msg.index < 0 || msg.index >= root.MANIFEST.bosses.length) return fail('stage');
      simApi().startStage(session.state, msg.index);
      return { ok: true, practice: 1, stageIndex: session.state.stageIdx };
    }
    return fail('rejected');
  }
  if (msg.t === 'join-seat') return assignSeat(session, msg);
  if (msg.t === 'release-seat') return releaseSeat(session, msg);
  if (msg.t === 'input') return acceptInput(session, msg, now);
  return fail('schema');
}

const CoopProtocol = {
  PROTOCOL_VERSION: PROTOCOL_VERSION,
  GAME_ID: GAME_ID,
  LIMITS: LIMITS,
  contentManifest: contentManifest,
  createMatch: createMatch,
  assignSeat: assignSeat,
  parseLoadouts: parseLoadouts,
  selectLoadout: selectLoadout,
  parseCpuLoadouts: parseCpuLoadouts,
  selectCpuLoadout: selectCpuLoadout,
  weaponTier: (clears) => simApi().Combat.unlockedTier(clears, 13),
  releaseSeat: releaseSeat,
  acceptInput: acceptInput,
  command: command,
  stepLoop: stepLoop,
  beginEncounter: beginEncounter,
  endEncounter: endEncounter,
  participationFacts: participationFacts,
  terminalFacts: terminalFacts,
  snapshotEnvelope: snapshotEnvelope,
  SNAPSHOT_KIND: SNAPSHOT_KIND,
  DELTA_KIND: DELTA_KIND,
  splitInputBatch: splitInputBatch,
  snapshotDelta: snapshotDelta,
  applySnapshotDelta: applySnapshotDelta,
  packMask: packMask,
  unpackMask: unpackMask,
  lifeFacts: lifeFacts,
  neutralButtons: neutralButtons,
};
root.CoopProtocol = CoopProtocol;
if (typeof module !== 'undefined' && module.exports) module.exports = CoopProtocol;
})(typeof window !== 'undefined' ? window : globalThis);
