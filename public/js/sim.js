// Sproto Coop Battle — authoritative game simulation.
// Runs only on the host (or in local play). Guests receive snapshots.
// World: x scrolls right, y is belt depth (0 = back, DEPTH = front), z is height.
(function (root) {
'use strict';
const W = 640, H = 360, DEPTH = 120, FLOOR_TOP = 218; // belt is drawn from screen y FLOOR_TOP to FLOOR_TOP+DEPTH
const SLOTS = 6;
const SLOT_COLORS = ['#ff4d4d', '#3da5ff', '#4dff7a', '#ffd23d', '#d36bff', '#ff9a3d'];

// Weapons: every Sproto fights armed. reach/dmg per combo hit; startup/active/recovery in ticks.
const WEAPONS = [
  { id: 'katana', name: 'Katana',      reach: 46, dmg: 9,  startup: 4, active: 4, recovery: 7,  knock: 3.2 },
  { id: 'bo',     name: 'Bo Staff',    reach: 60, dmg: 8,  startup: 5, active: 5, recovery: 8,  knock: 3.6 },
  { id: 'hammer', name: 'War Hammer',  reach: 44, dmg: 14, startup: 8, active: 4, recovery: 11, knock: 5.0 },
  { id: 'spear',  name: 'Spear',       reach: 68, dmg: 9,  startup: 6, active: 4, recovery: 9,  knock: 3.0 },
  { id: 'axe',    name: 'Battle Axe',  reach: 48, dmg: 12, startup: 7, active: 4, recovery: 10, knock: 4.2 },
  { id: 'flail',  name: 'Chain Flail', reach: 56, dmg: 10, startup: 6, active: 6, recovery: 10, knock: 3.8 },
];
const ENEMY_WEAPONS = [
  { id: 'club',   reach: 40, dmg: 7, startup: 16, active: 4, recovery: 22 },
  { id: 'knife',  reach: 32, dmg: 5, startup: 10, active: 3, recovery: 16 },
  { id: 'pike',   reach: 62, dmg: 8, startup: 20, active: 5, recovery: 24 },
  { id: 'knife',  reach: 32, dmg: 5, startup: 10, active: 3, recovery: 18, thrower: true },
];
const SPECIAL_COST = 6, MAX_HP = 100, START_LIVES = 3;
const UFO_TICKS = 720, DOWN_TICKS = 360, REVIVE_TICKS = 70;

function rng(state) { // mulberry32 stored in state.seed
  let t = (state.seed = (state.seed + 0x6D2B79F5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const pick = (s, arr) => arr[Math.floor(rng(s) * arr.length)];

function stageLength(i) { return 2200 + i * 80; }
function makeStage(state, i) {
  const len = stageLength(i);
  const waves = [];
  const per = 7 + Math.min(5, Math.floor(i / 2)); // six players face crowds
  waves.push({ x: 420, count: per, done: false });
  waves.push({ x: Math.floor(len * 0.4), count: per + 2, done: false, ufo: true });
  waves.push({ x: Math.floor(len * 0.7), count: per + 3, done: false });
  const crates = [];
  for (let k = 0; k < 4; k++) crates.push({ x: 300 + k * Math.floor(len / 4.5) + Math.floor(rng(state) * 120), y: 20 + Math.floor(rng(state) * 80) });
  return { index: i, len, waves, bossX: len - 160, crates };
}

function newPlayer(slot, cfg) {
  return {
    id: 'p' + slot, slot, fid: cfg.fid, weapon: cfg.weapon, ctrl: cfg.ctrl, owner: cfg.owner || 0, name: cfg.name || ('P' + (slot + 1)),
    x: 80 + slot * 14, y: 18 + slot * 17, z: 0, vx: 0, vy: 0, vz: 0, face: 1,
    hp: MAX_HP, lives: START_LIVES, score: 0, st: 'idle', t: 0, combo: 0, comboT: 0, hitDone: null,
    inv: 90, downT: 0, revive: 0, ufoT: 0, ufoShield: 0, shotCd: 0, ballCd: 0, out: false, contT: 0,
    in: { l: 0, r: 0, u: 0, d: 0, a: 0, j: 0, s: 0 }, prev: { a: 0, j: 0, s: 0 }, ai: { t: 0, tx: 0, ty: 0, jitter: 0 },
  };
}

function create(slots, seed) {
  const state = {
    t: 0, seed: seed >>> 0 || 1234567, mode: 'play', stageIdx: 0, stage: null, camX: 0, lockX: null,
    players: slots.map((c, i) => newPlayer(i, c)), enemies: [], projs: [], items: [], fx: [], boss: null,
    banner: null, events: [], nextId: 1, clearT: 0, totalScore: 0,
  };
  startStage(state, 0);
  return state;
}

function startStage(state, i) {
  state.stageIdx = i;
  state.stage = makeStage(state, i);
  state.camX = 0; state.lockX = null; state.enemies = []; state.projs = []; state.items = []; state.fx = []; state.boss = null;
  state.mode = 'play'; state.clearT = 0;
  for (const c of state.stage.crates) state.items.push({ id: state.nextId++, kind: 'crate', x: c.x, y: c.y, z: 0, hp: 12 });
  state.players.forEach((p, k) => {
    Object.assign(p, { x: 60 + k * 16, y: 14 + k * 18, z: 0, vx: 0, vy: 0, vz: 0, face: 1, st: p.out ? 'out' : 'idle', t: 0, inv: 120, ufoT: 0, downT: 0, revive: 0 });
    if (!p.out) p.hp = Math.max(p.hp, 60);
  });
  state.banner = { text: 'STAGE ' + (i + 1), sub: (root.MANIFEST ? root.MANIFEST.bosses[i % 12].stage : ''), t: 150 };
  ev(state, 'stage');
}

function ev(state, name, x) { state.events.push(x === undefined ? name : name + ':' + Math.round(x)); }
function fx(state, kind, x, y, z, extra) { state.fx.push(Object.assign({ id: state.nextId++, kind, x, y, z, t: 0 }, extra || {})); }

// ---------------- players ----------------
const alive = p => p.st !== 'down' && p.st !== 'out' && p.st !== 'dead';
function activePlayers(state) { return state.players.filter(alive); }

function setState(p, st) { p.st = st; p.t = 0; }

function updatePlayer(state, p) {
  const inp = p.in;
  const pressA = inp.a && !p.prev.a, pressJ = inp.j && !p.prev.j, pressS = inp.s && !p.prev.s;
  p.prev.a = inp.a; p.prev.j = inp.j; p.prev.s = inp.s;
  p.t++;
  if (p.inv > 0) p.inv--;
  if (p.comboT > 0 && --p.comboT === 0) p.combo = 0;

  if (p.st === 'out') {
    // Out of lives: humans press attack to continue, CPUs continue automatically.
    p.contT++;
    if ((p.ctrl === 'cpu' && p.contT > 240) || (p.ctrl !== 'cpu' && pressA)) respawn(state, p, true);
    return;
  }
  if (p.st === 'down') {
    p.downT--;
    const helper = state.players.find(o => o !== p && alive(o) && o.st !== 'ufo' && Math.abs(o.x - p.x) < 30 && Math.abs(o.y - p.y) < 20);
    if (helper) {
      p.revive++;
      if (p.revive % 12 === 0) fx(state, 'spark', p.x, p.y, 20);
      if (p.revive >= REVIVE_TICKS) {
        p.hp = 45; setState(p, 'idle'); p.inv = 120; p.revive = 0;
        helper.score += 500; ev(state, 'revive'); fx(state, 'text', p.x, p.y, 70, { text: 'REVIVED!' });
      }
    } else p.revive = Math.max(0, p.revive - 1);
    if (p.downT <= 0) {
      p.lives--;
      if (p.lives > 0) respawn(state, p, false);
      else { setState(p, 'out'); p.contT = 0; }
    }
    return;
  }

  // Gravity / knockback physics.
  p.x += p.vx; p.y += p.vy; p.z += p.vz;
  if (p.z > 0 || p.vz > 0) p.vz -= 0.55;
  if (p.z <= 0) { p.z = 0; if (p.vz < 0) p.vz = 0; }

  if (p.st === 'ufo') { updateUfoPilot(state, p, pressA, pressS); clampPlayer(state, p); return; }

  if (p.st === 'hit') {
    p.vx *= 0.8;
    if (p.t > 16) setState(p, 'idle');
  } else if (p.st === 'knock') {
    p.vx *= 0.96;
    if (p.z === 0 && p.t > 8) { p.vx = 0; setState(p, 'lying'); }
  } else if (p.st === 'lying') {
    if (p.t > 40) { setState(p, 'idle'); p.inv = 60; }
  } else if (p.st === 'attack') {
    const w = WEAPONS[p.weapon];
    const tot = w.startup + w.active + w.recovery + (p.combo === 3 ? 6 : 0);
    p.vx *= 0.7; p.vy = 0;
    if (p.t > w.startup && p.t <= w.startup + w.active) meleeHit(state, p, w.reach + (p.combo === 3 ? 8 : 0), w.dmg + (p.combo === 3 ? 4 : 0), p.combo === 3, w.knock);
    if (p.t >= tot) setState(p, 'idle');
    else if (pressA && p.t > w.startup + w.active && p.combo < 3) startAttack(state, p);
  } else if (p.st === 'jumpatk') {
    const w = WEAPONS[p.weapon];
    meleeHit(state, p, w.reach * 0.8, w.dmg + 2, true, w.knock);
    if (p.z === 0) { setState(p, 'land'); p.vx = 0; p.vy = 0; }
  } else if (p.st === 'special') {
    p.vx = 0; p.vy = 0;
    if (p.t % 6 === 0) p.face = -p.face;
    if (p.t > 6 && p.t < 30) meleeHit(state, p, WEAPONS[p.weapon].reach + 14, 12, true, 5, true);
    if (p.t >= 36) setState(p, 'idle');
  } else if (p.st === 'land') {
    if (p.t > 6) setState(p, 'idle');
  } else if (p.st === 'jump') {
    if (pressA) { setState(p, 'jumpatk'); p.hitDone = new Set(); ev(state, 'swing'); }
    if (p.z === 0 && p.t > 2) { setState(p, 'land'); p.vx = 0; p.vy = 0; }
  } else { // idle / walk
    const sp = 2.3;
    let mx = (inp.r ? 1 : 0) - (inp.l ? 1 : 0), my = (inp.d ? 1 : 0) - (inp.u ? 1 : 0);
    p.vx = mx * sp; p.vy = my * sp * 0.62;
    if (mx) p.face = mx;
    p.st = mx || my ? 'walk' : 'idle';
    if (pressS || (pressA && pressJ)) {
      if (p.hp > SPECIAL_COST + 1) { p.hp -= SPECIAL_COST; setState(p, 'special'); p.hitDone = new Set(); ev(state, 'special'); fx(state, 'ring', p.x, p.y, 0); }
    } else if (pressJ) {
      setState(p, 'jump'); p.vz = 8.6; p.vx = mx * 2.6; p.vy = my * 1.4; ev(state, 'jump');
    } else if (pressA) startAttack(state, p);
    // Pick up items by walking over them.
    for (const it of state.items) {
      if (it.kind === 'crate' || it.taken) continue;
      if (Math.abs(it.x - p.x) < 20 && Math.abs(it.y - p.y) < 14) takeItem(state, p, it);
    }
  }
  clampPlayer(state, p);
}

function clampPlayer(state, p) {
  p.y = clamp(p.y, 0, DEPTH);
  const right = state.lockX !== null ? Math.min(state.lockX + W, state.stage.len + W) : state.stage.len + W;
  p.x = clamp(p.x, state.camX + 14, Math.min(state.camX + W - 14, right - 14));
}

function startAttack(state, p) {
  p.combo = p.combo >= 3 ? 1 : p.combo + 1;
  p.comboT = 40;
  setState(p, 'attack');
  p.hitDone = new Set();
  // Step into the swing and auto-face the nearest foe in front-ish.
  p.vx = p.face * 1.4;
  ev(state, 'swing');
}

function meleeHit(state, p, reach, dmg, knockdown, knockF, around) {
  const hits = p.hitDone || (p.hitDone = new Set());
  for (const e of state.enemies) {
    if (e.hp <= 0 || hits.has(e.id) || e.st === 'lying') continue;
    const dx = (e.x - p.x) * (around ? Math.sign(e.x - p.x) || 1 : p.face);
    if (dx < -10 || dx > reach || Math.abs(e.y - p.y) > 15 || Math.abs(e.z - p.z) > 40) continue;
    hits.add(e.id);
    hurtEnemy(state, e, dmg, knockdown, Math.sign(e.x - p.x) || p.face, knockF, p);
  }
  for (const it of state.items) {
    if (it.kind !== 'crate' || hits.has(it.id)) continue;
    const dx = (it.x - p.x) * p.face;
    if (dx < -10 || dx > reach || Math.abs(it.y - p.y) > 16) continue;
    hits.add(it.id);
    it.hp -= dmg; fx(state, 'spark', it.x, it.y, 18); ev(state, 'hit');
    if (it.hp <= 0) breakCrate(state, it);
  }
  const b = state.boss;
  if (b && b.hp > 0 && b.st !== 'enter' && b.st !== 'transform' && !hits.has('boss')) {
    const half = b.w / 2;
    const dx = p.x - b.x;
    if (Math.abs(dx) < half + reach * 0.8 && Math.abs(b.y - p.y) < 32) {
      hits.add('boss');
      hurtBoss(state, b, dmg, p);
    }
  }
}

function hurtPlayer(state, p, dmg, dir, knock) {
  if (p.inv > 0 || !alive(p) || p.st === 'special') return false;
  if (p.st === 'ufo') {
    p.ufoShield--; p.inv = 40; fx(state, 'shield', p.x, p.y, 50); ev(state, 'shield');
    if (p.ufoShield <= 0) ejectUfo(state, p);
    return true;
  }
  p.hp -= dmg;
  ev(state, 'hurt');
  fx(state, 'spark', p.x, p.y, 34 + p.z);
  if (p.hp <= 0) {
    p.hp = 0; setState(p, 'down'); p.downT = DOWN_TICKS; p.revive = 0; p.vx = 0; p.vy = 0; p.z = 0;
    fx(state, 'text', p.x, p.y, 70, { text: 'HELP!' }); ev(state, 'down');
    return true;
  }
  if (knock) { setState(p, 'knock'); p.vx = dir * 3; p.vz = 5; p.inv = 50; }
  else { setState(p, 'hit'); p.vx = dir * 1.6; p.inv = 14; }
  return true;
}

function respawn(state, p, cont) {
  if (cont) { p.lives = START_LIVES; p.score = 0; }
  const ps = activePlayers(state);
  const ax = ps.length ? ps.reduce((s, o) => s + o.x, 0) / ps.length : state.camX + 120;
  Object.assign(p, { hp: MAX_HP, x: clamp(ax, state.camX + 40, state.camX + W - 40), y: 30 + rng(state) * 60, z: 140, vz: 0, vx: 0, vy: 0, inv: 150, revive: 0, ufoT: 0 });
  setState(p, 'jump');
  fx(state, 'text', p.x, p.y, 90, { text: p.name + (cont ? ' CONTINUES' : ' IS BACK') });
  ev(state, 'respawn');
}

function takeItem(state, p, it) {
  if (it.kind === 'snack') { p.hp = Math.min(MAX_HP, p.hp + 40); it.taken = true; ev(state, 'heal'); fx(state, 'text', p.x, p.y, 70, { text: '+40' }); }
  else if (it.kind === 'gem') { p.score += 1000; it.taken = true; ev(state, 'coin'); }
  else if (it.kind === 'ufo') {
    it.taken = true; setState(p, 'ufo'); p.ufoT = UFO_TICKS; p.ufoShield = 4; p.z = 46; p.inv = 30;
    ev(state, 'ufo'); fx(state, 'text', p.x, p.y, 110, { text: 'UFO!' });
  }
}

function breakCrate(state, it) {
  it.taken = true; ev(state, 'crate');
  fx(state, 'boom', it.x, it.y, 10, { small: 1 });
  const r = rng(state);
  state.items.push({ id: state.nextId++, kind: r < 0.65 ? 'snack' : 'gem', x: it.x, y: it.y, z: 0 });
}

// ---------------- UFO (from Sproto Arcade) ----------------
function updateUfoPilot(state, p, pressA, pressS) {
  const inp = p.in;
  const mx = (inp.r ? 1 : 0) - (inp.l ? 1 : 0), my = (inp.d ? 1 : 0) - (inp.u ? 1 : 0);
  p.vx = p.vx * 0.85 + mx * 0.6; p.vy = p.vy * 0.85 + my * 0.4; p.vz = 0;
  p.z += (46 + Math.sin(state.t / 9) * 3 - p.z) * 0.2;
  if (mx) p.face = mx;
  if (p.shotCd > 0) p.shotCd--;
  if (p.ballCd > 0) p.ballCd--;
  if ((inp.a) && p.shotCd === 0) {
    state.projs.push({ id: state.nextId++, kind: 'laser', owner: p.slot, x: p.x + p.face * 40, y: p.y, z: p.z + 6, vx: p.face * 9, vy: 0, vz: 0, dmg: 5, t: 0, life: 70, pierce: true, hit: [] });
    p.shotCd = 8; ev(state, 'laser');
  }
  if ((pressS || inp.j) && p.ballCd === 0) {
    state.projs.push({ id: state.nextId++, kind: 'ball', owner: p.slot, x: p.x + p.face * 20, y: p.y, z: p.z, vx: p.face * 3.2, vy: 0, vz: 3, dmg: 22, t: 0, life: 120, hit: [] });
    p.ballCd = 70; ev(state, 'ball');
  }
  if (--p.ufoT <= 0) ejectUfo(state, p);
}
function ejectUfo(state, p) {
  setState(p, 'jump'); p.vz = 5; p.inv = 90; p.ufoT = 0;
  fx(state, 'boom', p.x, p.y, p.z, { small: 1 }); ev(state, 'boom');
}

// ---------------- enemies (Shadow Sprotos) ----------------
function spawnEnemy(state, side) {
  const kind = Math.floor(rng(state) * ENEMY_WEAPONS.length);
  const hp = 26 + state.stageIdx * 3 + (kind === 0 ? 14 : 0);
  const x = side > 0 ? state.camX + W + 30 + rng(state) * 40 : state.camX - 30 - rng(state) * 40;
  state.enemies.push({
    id: state.nextId++, fid: Math.floor(rng(state) * 3), weapon: kind, x, y: rng(state) * DEPTH, z: 0, vx: 0, vy: 0, vz: 0,
    face: -side, hp, maxHp: hp, st: 'walk', t: 0, cd: 40 + Math.floor(rng(state) * 60), target: null, inv: 0, hitDone: null,
    offY: (rng(state) - 0.5) * 10, offX: 0,
  });
}

function hurtEnemy(state, e, dmg, knockdown, dir, knockF, p) {
  e.hp -= dmg;
  if (p) p.score += dmg * 10;
  fx(state, 'spark', e.x + dir * 4, e.y, 34 + e.z);
  ev(state, 'hit', e.x);
  if (e.hp <= 0) {
    e.st = 'knock'; e.t = 0; e.vx = dir * (knockF + 1); e.vz = 6; e.dead = true;
    if (p) p.score += 200;
    return;
  }
  if (knockdown || (e.st === 'hit' && e.t < 4 && e.stun > 2)) { e.st = 'knock'; e.t = 0; e.vx = dir * knockF; e.vz = 5.5; e.stun = 0; }
  else { e.st = 'hit'; e.t = 0; e.vx = dir * 1.2; e.stun = (e.stun || 0) + 1; }
}

function updateEnemy(state, e) {
  e.t++;
  e.x += e.vx; e.y = clamp(e.y + e.vy, 0, DEPTH); e.z += e.vz;
  if (e.z > 0 || e.vz > 0) e.vz -= 0.55;
  if (e.z <= 0) { e.z = 0; if (e.vz < 0) e.vz = 0; }
  const w = ENEMY_WEAPONS[e.weapon];
  if (e.st === 'hit') { e.vx *= 0.8; if (e.t > 18) { e.st = 'walk'; e.t = 0; e.cd = Math.max(e.cd, 20); } return; }
  if (e.st === 'knock') {
    e.vx *= 0.97;
    if (e.z === 0 && e.t > 6) { e.vx = 0; e.st = 'lying'; e.t = 0; if (e.dead) { ev(state, 'ko'); } }
    return;
  }
  if (e.st === 'lying') { if (e.dead ? e.t > 50 : e.t > 46) { if (e.dead) e.remove = true; else { e.st = 'walk'; e.t = 0; e.stun = 0; } } return; }

  // Choose target: nearest active non-UFO player (UFO pilots are targeted less).
  const ps = activePlayers(state);
  if (!ps.length) { e.vx = 0; e.vy = 0; return; }
  if (!e.target || e.t % 90 === 0 || !alive(e.target)) {
    let best = null, bd = 1e9;
    for (const p of ps) { const d = Math.abs(p.x - e.x) + Math.abs(p.y - e.y) * 2 + (p.st === 'ufo' ? 300 : 0) + rng(state) * 60; if (d < bd) { bd = d; best = p; } }
    e.target = best;
  }
  const p = e.target;
  if (e.cd > 0) e.cd--;
  if (e.st === 'attack') {
    e.vx = 0; e.vy = 0;
    if (w.thrower) {
      if (e.t === w.startup) {
        state.projs.push({ id: state.nextId++, kind: 'knife', x: e.x + e.face * 16, y: e.y, z: 30, vx: e.face * 5, vy: 0, vz: 0, dmg: 6, t: 0, life: 120, enemy: true });
        ev(state, 'throw');
      }
    } else if (e.t > w.startup && e.t <= w.startup + w.active) {
      for (const q of ps) {
        const dx = (q.x - e.x) * e.face;
        if (dx > -8 && dx < w.reach && Math.abs(q.y - e.y) < 14 && q.z < 40 && !(e.hitDone && e.hitDone.has(q.slot))) {
          (e.hitDone || (e.hitDone = new Set())).add(q.slot);
          hurtPlayer(state, q, w.dmg + Math.floor(state.stageIdx / 3), e.face, w.id === 'club' && rng(state) < 0.4);
        }
      }
    }
    if (e.t >= w.startup + w.active + w.recovery) { e.st = 'walk'; e.t = 0; e.cd = 50 + Math.floor(rng(state) * 70); }
    return;
  }
  // Approach: stand off at weapon reach on the near side, in the same lane.
  const side = e.x < p.x ? -1 : 1;
  const want = w.thrower ? 150 : w.reach * 0.75;
  // Stand-off points are kept on screen so every Shadow Sproto is reachable.
  const tx = clamp(p.x + side * want, state.camX + 24, state.camX + W - 24), ty = clamp(p.y + e.offY, 0, DEPTH);
  const dx = tx - e.x, dy = ty - e.y;
  const sp = w.id === 'knife' ? 1.5 : 1.1;
  e.vx = Math.abs(dx) > 4 ? Math.sign(dx) * sp : 0;
  e.vy = Math.abs(dy) > 3 ? Math.sign(dy) * sp * 0.6 : 0;
  e.face = p.x > e.x ? 1 : -1;
  e.st = e.vx || e.vy ? 'walk' : 'idle';
  const inRange = Math.abs(p.x - e.x) < (w.thrower ? 220 : w.reach) && Math.abs(p.y - e.y) < 10;
  if (inRange && e.cd === 0) { e.st = 'attack'; e.t = 0; e.hitDone = null; ev(state, 'eswing'); }
}

// ---------------- boss (Sproto Arcade machines) ----------------
const BOSS_SCALE = 0.95;
function bossInfo(i) { return root.MANIFEST ? root.MANIFEST.bosses[i % 12] : null; }
function startBoss(state) {
  const info = bossInfo(state.stageIdx);
  const ph = info ? info.phases[0] : { body: [60, 60, 200, 250] };
  const hp = 700 + state.stageIdx * 90;
  state.boss = {
    bi: state.stageIdx % 12, phase: 0, hp, maxHp: hp, x: state.camX + W + 140, y: DEPTH / 2, z: 0, face: -1,
    st: 'enter', t: 0, row: 0, w: (ph.body[2] - ph.body[0]) * BOSS_SCALE * 0.85, cycle: 0, flash: 0, tx: 0, ty: 0, hitCd: 0, adds: 0,
  };
  state.banner = { text: info ? info.machines[0].toUpperCase() : 'BOSS', sub: info ? 'piloted by ' + info.pilot : '', t: 150, boss: true };
  ev(state, 'bossin');
}

function hurtBoss(state, b, dmg, p) {
  b.hp -= dmg; b.flash = 6;
  if (p) p.score += dmg * 15;
  fx(state, 'spark', b.x + (p ? Math.sign(p.x - b.x) * b.w * 0.3 : 0), b.y, 50 + rng(state) * 40);
  ev(state, 'bosshit');
  if (b.phase === 0 && b.hp <= b.maxHp / 2) {
    b.phase = 1; b.st = 'transform'; b.t = 0;
    const info = bossInfo(b.bi); if (info) b.w = (info.phases[1].body[2] - info.phases[1].body[0]) * BOSS_SCALE * 0.85;
    state.banner = { text: info ? info.machines[1].toUpperCase() : 'PHASE 2', sub: 'phase 2', t: 120, boss: true };
    state.items.push({ id: state.nextId++, kind: 'ufo', x: state.camX + 120, y: DEPTH / 2, z: 0 });
    ev(state, 'transform');
  }
  if (b.hp <= 0) { b.hp = 0; b.st = 'dead'; b.t = 0; ev(state, 'bossdown'); for (const pl of activePlayers(state)) pl.score += 5000; }
}

function updateBoss(state) {
  const b = state.boss; if (!b) return;
  b.t++; if (b.flash > 0) b.flash--;
  const ps = activePlayers(state);
  const arenaL = state.camX + 70, arenaR = state.camX + W - 70;
  if (b.st === 'enter') {
    b.x += (arenaR - 30 - b.x) * 0.03;
    if (b.t > 120) { b.st = 'idle'; b.t = 0; }
    return;
  }
  if (b.st === 'transform') { if (b.t % 10 === 0) fx(state, 'boom', b.x + (rng(state) - 0.5) * b.w, b.y, 40 + rng(state) * 80); if (b.t > 90) { b.st = 'idle'; b.t = 0; } return; }
  if (b.st === 'dead') {
    if (b.t % 7 === 0) { fx(state, 'boom', b.x + (rng(state) - 0.5) * b.w, b.y + (rng(state) - 0.5) * 20, 20 + rng(state) * 100); ev(state, 'boom'); }
    if (b.t > 150) { state.boss = null; stageClear(state); }
    return;
  }
  if (!ps.length) return;
  // The machine is solid: push grounded Sprotos out of its body.
  if (b.st !== 'charge') for (const p of ps) {
    const dx = p.x - b.x, half = b.w * 0.42;
    if (p.st !== 'ufo' && p.z < 40 && Math.abs(dx) < half && Math.abs(p.y - b.y) < 22) p.x = b.x + (dx < 0 ? -half : half);
  }
  const target = ps[Math.floor((b.cycle * 7 + b.t) % ps.length)];
  const fast = b.phase === 1 ? 0.7 : 1;
  // Periodic Shadow Sprotos keep six players busy.
  if (b.t % Math.floor(420 * fast) === 200 && state.enemies.length < 4) { spawnEnemy(state, 1); spawnEnemy(state, -1); }
  // Contact damage.
  for (const p of ps) if (Math.abs(p.x - b.x) < b.w * 0.35 && Math.abs(p.y - b.y) < 16 && p.z < 30 && b.st === 'charge') hurtPlayer(state, p, 12, Math.sign(p.x - b.x) || 1, true);

  if (b.st === 'idle') {
    // Drift toward a lane near the target, keep distance from the group.
    const avgX = ps.reduce((s, p) => s + p.x, 0) / ps.length;
    const wantX = avgX < (arenaL + arenaR) / 2 ? arenaR - 20 : arenaL + 20;
    b.x += clamp(wantX - b.x, -1.2, 1.2);
    b.y += clamp(target.y - b.y, -0.8, 0.8);
    b.face = avgX > b.x ? 1 : -1;
    if (b.t > 70 * fast) {
      b.cycle++;
      const roll = b.cycle % (b.phase ? 5 : 4);
      if (b.phase === 1 && roll === 4) { b.st = 'charge'; b.t = 0; b.tx = b.face; ev(state, 'charge'); }
      else { b.st = 'fire'; b.t = 0; b.row = 1 + (b.cycle % 3); b.missile = b.cycle % 4 === 3; b.tx = target.x; b.ty = target.y; }
    }
  } else if (b.st === 'fire') {
    // 4-frame weapon animation: anticipation, locked, muzzle (fire), recoil.
    const fireAt = 24;
    if (b.t === fireAt || (b.phase && b.row === 3 && (b.t === fireAt + 10 || b.t === fireAt + 20))) bossShoot(state, b);
    if (b.t > 48) { b.st = 'idle'; b.t = 0; }
  } else if (b.st === 'charge') {
    if (b.t < 30) { b.x += (rng(state) - 0.5) * 2; }
    else { b.x += b.tx * 6.5; if (b.x < arenaL - 10 || b.x > arenaR + 10) { b.x = clamp(b.x, arenaL - 10, arenaR + 10); b.st = 'idle'; b.t = 0; b.face = -b.face; ev(state, 'boom'); fx(state, 'boom', b.x + b.tx * b.w * 0.4, b.y, 20); } }
  }
}

function bossShoot(state, b) {
  const info = bossInfo(b.bi);
  const ph = info ? info.phases[b.phase] : null;
  const bodyH = ph ? (ph.body[3] - ph.body[1]) * BOSS_SCALE : 120;
  const mz = bodyH * 0.45;
  const mx = b.x + b.face * b.w * 0.55;
  const spd = b.phase ? 5.2 : 4.2;
  const dmg = 9 + Math.floor(state.stageIdx / 2);
  ev(state, 'bossfire');
  if (b.missile) {
    state.projs.push({ id: state.nextId++, kind: 'boss', row: 3, x: mx, y: b.y, z: mz, vx: b.face * 1.8, vy: 0, vz: 0, dmg: dmg + 6, t: 0, life: 300, enemy: true, homing: true, boom: true, phase: b.phase, bi: b.bi });
    return;
  }
  const r = b.row - 1; // projectile row 0..2 matches weapon A/B/C firing rows 1..3
  const lanes = r === 1 ? (b.phase ? [-36, -12, 12, 36] : [-30, 0, 30]) : [0];
  for (const off of lanes) {
    const ty = clamp(b.ty + off, 0, DEPTH);
    const steps = Math.max(1, Math.abs(b.tx - mx) / spd);
    state.projs.push({ id: state.nextId++, kind: 'boss', row: r, x: mx, y: b.y, z: r === 2 ? 14 : mz * 0.5, vx: b.face * spd, vy: clamp((ty - b.y) / steps, -1.5, 1.5), vz: 0, dmg, t: 0, life: 200, enemy: true, phase: b.phase, bi: b.bi });
  }
}

// ---------------- projectiles ----------------
function updateProjs(state) {
  const ps = activePlayers(state);
  for (const pr of state.projs) {
    pr.t++;
    if (pr.homing && ps.length) {
      let best = ps[0], bd = 1e9;
      for (const p of ps) { const d = Math.abs(p.x - pr.x) + Math.abs(p.y - pr.y); if (d < bd) { bd = d; best = p; } }
      pr.vx += Math.sign(best.x - pr.x) * 0.05; pr.vy += Math.sign(best.y - pr.y) * 0.03;
      pr.vx = clamp(pr.vx, -2.2, 2.2); pr.vy = clamp(pr.vy, -1, 1);
      pr.z += (24 - pr.z) * 0.02;
    }
    pr.x += pr.vx; pr.y += pr.vy; pr.z += pr.vz;
    if (pr.kind === 'ball') { pr.vz -= 0.3; if (pr.z <= 0) { pr.z = 0; pr.life = 0; ballBoom(state, pr); } }
    if (pr.t > pr.life || pr.x < state.camX - 80 || pr.x > state.camX + W + 80) { pr.remove = true; continue; }
    if (pr.enemy) {
      for (const p of ps) {
        if (Math.abs(p.x - pr.x) < 16 && Math.abs(p.y - pr.y) < 11 && Math.abs((p.z + 26) - pr.z) < 32) {
          if (hurtPlayer(state, p, pr.dmg, Math.sign(pr.vx) || 1, !!pr.boom || pr.row === 2)) {
            pr.remove = true;
            if (pr.boom) { fx(state, 'boom', pr.x, pr.y, pr.z); ev(state, 'boom'); }
            break;
          }
        }
      }
      if (pr.homing && pr.t > 260) { pr.remove = true; fx(state, 'boom', pr.x, pr.y, pr.z); ev(state, 'boom'); }
    } else if (pr.kind === 'laser') {
      for (const e of state.enemies) {
        if (e.hp <= 0 || pr.hit.includes(e.id)) continue;
        if (Math.abs(e.x - pr.x) < 18 && Math.abs(e.y - pr.y) < 14) { pr.hit.push(e.id); hurtEnemy(state, e, pr.dmg, false, Math.sign(pr.vx), 2, state.players[pr.owner]); }
      }
      const b = state.boss;
      if (b && b.hp > 0 && b.st !== 'enter' && b.st !== 'transform' && !pr.hit.includes('boss') && Math.abs(b.x - pr.x) < b.w / 2 && Math.abs(b.y - pr.y) < 30) {
        pr.hit.push('boss'); hurtBoss(state, b, pr.dmg, state.players[pr.owner]); pr.remove = true;
      }
    }
  }
  state.projs = state.projs.filter(p => !p.remove);
}
function ballBoom(state, pr) {
  fx(state, 'boom', pr.x, pr.y, 10); ev(state, 'boom');
  const owner = state.players[pr.owner];
  for (const e of state.enemies) if (e.hp > 0 && Math.abs(e.x - pr.x) < 50 && Math.abs(e.y - pr.y) < 30) hurtEnemy(state, e, pr.dmg, true, Math.sign(e.x - pr.x) || 1, 4, owner);
  const b = state.boss;
  if (b && b.hp > 0 && b.st !== 'enter' && b.st !== 'transform' && Math.abs(b.x - pr.x) < b.w / 2 + 40 && Math.abs(b.y - pr.y) < 40) hurtBoss(state, b, pr.dmg, owner);
}

// ---------------- flow ----------------
function stageClear(state) {
  state.mode = 'clear'; state.clearT = 0;
  state.banner = { text: 'STAGE CLEAR!', sub: 'All six Sprotos advance', t: 200 };
  ev(state, 'clear');
  for (const p of state.players) if (p.st === 'down') { p.hp = 40; setState(p, 'idle'); }
}

function updateCamera(state) {
  const ps = activePlayers(state);
  if (!ps.length) return;
  const lead = Math.max(...ps.map(p => p.x)), avg = ps.reduce((s, p) => s + p.x, 0) / ps.length;
  let want = Math.max(state.camX, Math.min(avg - W * 0.42, lead - W * 0.6));
  if (state.lockX !== null) want = Math.min(want, state.lockX);
  want = Math.min(want, state.stage.len - W + 160);
  state.camX += clamp(want - state.camX, 0, 3);
}

function updateWaves(state) {
  const st = state.stage;
  for (const w of st.waves) {
    if (w.done) continue;
    if (!w.active && state.camX + W * 0.5 >= w.x) { w.active = true; state.lockX = state.camX; w.left = w.count; ev(state, 'wave'); }
    if (w.active) {
      const onScreen = state.enemies.filter(e => !e.dead).length;
      if (w.left > 0 && onScreen < 8 && state.t % 26 === 0) { spawnEnemy(state, rng(state) < 0.6 ? 1 : -1); w.left--; }
      if (w.left === 0 && onScreen === 0) {
        w.done = true; w.active = false; state.lockX = null; state.banner = { text: 'GO!', arrow: true, t: 90 };
        if (w.ufo) state.items.push({ id: state.nextId++, kind: 'ufo', x: state.camX + W - 120, y: DEPTH / 2, z: 0 });
        ev(state, 'go');
      }
    }
    return; // only one wave at a time
  }
  if (!state.boss && state.mode === 'play' && state.camX >= st.len - W + 150) { state.lockX = state.camX; startBoss(state); }
}

function step(state) {
  state.t++;
  if (state.banner && --state.banner.t <= 0) state.banner = null;
  if (state.mode === 'gameover' || state.mode === 'victory') return;
  for (const p of state.players) {
    if (p.ctrl === 'cpu') root.SproAI ? root.SproAI.think(state, p) : null;
    updatePlayer(state, p);
  }
  for (const e of state.enemies) updateEnemy(state, e);
  state.enemies = state.enemies.filter(e => !e.remove);
  updateBoss(state);
  updateProjs(state);
  for (const f of state.fx) f.t++;
  state.fx = state.fx.filter(f => f.t < (f.kind === 'text' ? 60 : f.kind === 'boom' ? 32 : f.kind === 'ring' ? 20 : 14));
  state.items = state.items.filter(i => !i.taken);
  if (state.mode === 'play') { updateCamera(state); updateWaves(state); }
  if (state.mode === 'clear' && ++state.clearT > 220) {
    if (state.stageIdx + 1 >= 12) { state.mode = 'victory'; state.banner = { text: 'VICTORY!', sub: 'All twelve machines are scrap', t: 99999 }; ev(state, 'victory'); }
    else startStage(state, state.stageIdx + 1);
  }
  // Game over only when every human is out of lives and none continued.
  const humans = state.players.filter(p => p.ctrl !== 'cpu');
  if (humans.length && humans.every(p => p.st === 'out' && p.contT > 600)) { state.mode = 'gameover'; state.banner = { text: 'GAME OVER', sub: 'Press START to retry', t: 99999 }; }
}

// Compact, render-only view of the state (used for rendering and network snapshots).
const r1 = v => Math.round(v * 10) / 10;
function snapshot(state) {
  return {
    t: state.t, mode: state.mode, si: state.stageIdx, len: state.stage.len, camX: r1(state.camX), lock: state.lockX !== null ? 1 : 0,
    banner: state.banner,
    players: state.players.map(p => ({ s: p.slot, f: p.fid, w: p.weapon, c: p.ctrl, n: p.name, x: r1(p.x), y: r1(p.y), z: r1(p.z), fc: p.face, hp: p.hp, l: p.lives, sc: p.score, st: p.st, t: p.t, cb: p.combo, inv: p.inv, dt: p.downT, rv: p.revive, ut: p.ufoT, us: p.ufoShield, ct: p.contT })),
    enemies: state.enemies.map(e => ({ id: e.id, f: e.fid, w: e.weapon, x: r1(e.x), y: r1(e.y), z: r1(e.z), fc: e.face, st: e.st, t: e.t, hp: e.hp, mh: e.maxHp, d: e.dead ? 1 : 0 })),
    projs: state.projs.map(p => ({ id: p.id, k: p.kind, r: p.row, ph: p.phase, bi: p.bi, x: r1(p.x), y: r1(p.y), z: r1(p.z), vx: r1(p.vx), t: p.t })),
    items: state.items.map(i => ({ id: i.id, k: i.kind, x: i.x, y: i.y })),
    fx: state.fx.map(f => ({ id: f.id, k: f.kind, x: r1(f.x), y: r1(f.y), z: r1(f.z), t: f.t, tx: f.text, sm: f.small })),
    boss: state.boss && { bi: state.boss.bi, ph: state.boss.phase, hp: state.boss.hp, mh: state.boss.maxHp, x: r1(state.boss.x), y: r1(state.boss.y), fc: state.boss.face, st: state.boss.st, t: state.boss.t, row: state.boss.row, fl: state.boss.flash, mi: state.boss.missile ? 1 : 0 },
  };
}

const Sim = { W, H, DEPTH, FLOOR_TOP, SLOTS, SLOT_COLORS, WEAPONS, ENEMY_WEAPONS, MAX_HP, BOSS_SCALE, UFO_TICKS, DOWN_TICKS, REVIVE_TICKS, create, step, snapshot, startStage, alive, rng, clamp };
root.Sim = Sim;
if (typeof module !== 'undefined') module.exports = Sim;
})(typeof window !== 'undefined' ? window : globalThis);
