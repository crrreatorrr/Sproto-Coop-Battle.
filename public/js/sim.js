// Sproto Coop Battle — authoritative game simulation.
// Runs only on the host (or in local play). Guests receive snapshots.
// World: x scrolls right, y is belt depth (0 = back, DEPTH = front), z is height.
(function (root) {
'use strict';
const W = 640, H = 360, DEPTH = 120, FLOOR_TOP = 218; // belt is drawn from screen y FLOOR_TOP to FLOOR_TOP+DEPTH
// Up to four Sprotos, one per seated human. A seat nobody has taken stays empty (ctrl 'none'):
// its Sproto is out of the run, and no CPU Sproto fills it.
const SLOTS = 4;
const EMPTY = 'none';
const seated = p => p.ctrl !== EMPTY;
const SLOT_COLORS = ['#ff4d4d', '#3da5ff', '#4dff7a', '#ffd23d'];

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
  { id: 'knife',  reach: 32, dmg: 5, startup: 22, active: 3, recovery: 18, thrower: true },
];
// Each human may die once and drop back in; the second death puts that human out until the next
// stage. The run is lost when no human is left, or when every Sproto is down.
const SPECIAL_COST = 6, MAX_HP = 100, START_LIVES = 2;
// Fighting: dash (double-tap), block/parry (Special), grab/throw, launcher + juggles, slam.
// Block rises on the tick Special is pressed and the parry window is its first PARRY_WINDOW ticks.
// Letting go within SPIN_TAP ticks without having blocked anything is the spin attack. A block
// raised within PARRY_LOCK ticks of the last one cannot parry, so parries cannot be mashed.
const DASH_TICKS = 14, DOUBLE_TAP = 14, SPIN_TAP = 6, PARRY_WINDOW = 8, PARRY_LOCK = 24, GRAB_TICKS = 150;
// An Attack press is remembered for this many ticks, so one made late in a swing still comes out.
const ATTACK_BUFFER = 6;
// A human who has pressed nothing for this long no longer holds the CPU teammates back.
const IDLE_AFTER = 300;
// A downed Sproto that nobody revives within 10 seconds dies.
const UFO_TICKS = 720, DOWN_TICKS = 600, REVIVE_TICKS = 70;
// CPU teammates are deliberately weaker than humans so the team can lose Sprotos. With one or two
// humans they carry more of the fight, so they hit harder and last longer.
const CPU_DMG = 0.55, CPU_TAKEN = 1.35, CPU_DMG_FEW = 0.75, CPU_TAKEN_FEW = 1.15;
// Difficulty scales with the number of human seats (h = 1..4), counted when a stage's first fight
// starts so a drop-in mid-stage does not change the stage in progress.
const WAVE_SCALE = h => 0.5 + 0.1 * h, GRUNT_HP_SCALE = h => 0.58 + 0.102 * h, BOSS_HP_SCALE = h => 0.35 + 0.15 * h;
// Difficulty: more Shadow Sprotos, tougher and more aggressive.
// Difficulty ramps by stage: stage 1 is a warm-up, stage 12 is brutal. Shadow Sproto health starts
// 1.5x up from stage 1 so the opening stage is a real fight.
const ENEMY_HP = s => 1.5 + 0.08 * s, ENEMY_DMG = s => 0.8 + 0.1 * s, MAX_ON_SCREEN = 12;

// One small passive per Sproto, by fighter index (the same order as MANIFEST.fighters).
const PASSIVES = [
  { id: 'duelist', name: 'Duelist', text: 'parry window +50%' },
  { id: 'leech', name: 'Leech', text: '+2 health per KO' },
  { id: 'brawler', name: 'Brawler', text: '+10% weapon damage' },
  { id: 'medic', name: 'Medic', text: 'revives 40% faster' },
  { id: 'tough', name: 'Tough', text: '+10 max health' },
  { id: 'sprinter', name: 'Sprinter', text: 'walks 10% faster' },
];
const has = (p, id) => PASSIVES[p.fid % PASSIVES.length].id === id;
const maxHp = p => MAX_HP + (has(p, 'tough') ? 10 : 0);
// Boss scripts, by boss index % 4. Elite Shadow Sprotos: a guard that stops frontal hits.
const BOSS_ARCHETYPES = ['gunner', 'charger', 'summoner', 'bomber'];
const ELITE_FROM_STAGE = 1, ELITE_MAX = 2, GUARD_HITS = 6, GUARD_REGEN = 300;
const BOMB_FLIGHT = 48, FIRE_LIFE = 200, CHARGER_WINDUP = 36, CHARGER_HP = 0.5, SUMMON_EVERY = 220;

function rng(state) { // mulberry32 stored in state.seed
  let t = (state.seed = (state.seed + 0x6D2B79F5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function seatedHumans(state) { let n = 0; for (const p of state.players) if (p.ctrl !== 'cpu' && seated(p)) n++; return clamp(n, 1, SLOTS); }
const humansOf = state => state.humans || seatedHumans(state);
function lockHumans(state) { if (!state.humans) state.humans = seatedHumans(state); }
// Local and relay drop-in: when more humans are seated than the stage was counted for, what is left
// of the stage grows to the new count (boss, Shadow Sprotos on screen, the rest of the wave). It
// never shrinks, and nothing calls this for banked matches, whose count stays as locked.
function rescaleHumans(state) {
  const was = state.humans, now = seatedHumans(state);
  if (!was || now <= was) return false;
  state.humans = now;
  const b = state.boss, kb = BOSS_HP_SCALE(now) / BOSS_HP_SCALE(was), kg = GRUNT_HP_SCALE(now) / GRUNT_HP_SCALE(was), kw = WAVE_SCALE(now) / WAVE_SCALE(was);
  if (b && b.hp > 0) { b.hp = Math.round(b.hp * kb); b.maxHp = Math.round(b.maxHp * kb); }
  for (const e of state.enemies) if (!e.dead && e.hp > 0) { e.hp = Math.round(e.hp * kg); e.maxHp = Math.round(e.maxHp * kg); }
  for (const w of state.stage.waves) if (w.active && w.left > 0) w.left = Math.round(w.left * kw);
  return true;
}
const cpuDmg = state => (humansOf(state) <= 2 ? CPU_DMG_FEW : CPU_DMG);
const cpuTaken = state => (humansOf(state) <= 2 ? CPU_TAKEN_FEW : CPU_TAKEN);
const pick = (s, arr) => arr[Math.floor(rng(s) * arr.length)];

function stageLength(i) { return 2200 + i * 80; }
function makeStage(state, i) {
  const len = stageLength(i);
  const waves = [];
  const per = 8 + Math.min(14, Math.round(i * 1.3)); // crowds grow every stage
  waves.push({ x: 420, count: per, done: false });
  waves.push({ x: Math.floor(len * 0.3), count: per + 3, done: false });
  waves.push({ x: Math.floor(len * 0.5), count: per + 4, done: false, ufo: true });
  waves.push({ x: Math.floor(len * 0.75), count: per + 6, done: false });
  const crates = [];
  for (let k = 0; k < 4; k++) crates.push({ x: 300 + k * Math.floor(len / 4.5) + Math.floor(rng(state) * 120), y: 20 + Math.floor(rng(state) * 80) });
  return { index: i, len, waves, bossX: len - 160, crates };
}

function newPlayer(slot, cfg) {
  return {
    id: 'p' + slot, slot, fid: cfg.fid, weapon: cfg.weapon, ctrl: cfg.ctrl, owner: cfg.owner || 0, name: cfg.name || ('P' + (slot + 1)),
    x: 80 + slot * 14, y: 18 + slot * 17, z: 0, vx: 0, vy: 0, vz: 0, face: 1,
    hp: MAX_HP + (PASSIVES[cfg.fid % PASSIVES.length].id === 'tough' ? 10 : 0), lives: START_LIVES, score: 0, st: 'idle', t: 0, combo: 0, comboT: 0, hitDone: null,
    inv: 90, downT: 0, revive: 0, ufoT: 0, ufoShield: 0, shotCd: 0, ballCd: 0, out: false, contT: 0,
    in: { l: 0, r: 0, u: 0, d: 0, a: 0, j: 0, s: 0, p: 0 }, prev: { a: 0, j: 0, s: 0, p: 0, l: 0, r: 0 }, powers: [], hs: 0, bufA: 0, tapDir: 0, tapT: -99, dashDir: 0, grab: null, knees: 0, kills: 0, revs: 0, parries: 0, ai: { t: 0, tx: 0, ty: 0, jitter: 0 },
  };
}

// An empty seat holds a placeholder Sproto that is out of the run until a human takes the seat. It
// already carries a fresh Sproto's lives and hp, so taking the seat moves no life fact.
function emptySeat(p) { Object.assign(p, { st: 'out', t: 0, fresh: true }); return p; }

function create(slots, seed, firstStage) {
  const state = {
    t: 0, seed: seed >>> 0 || 1234567, mode: 'play', stageIdx: 0, stage: null, camX: 0, lockX: null,
    players: slots.map((c, i) => (c.ctrl === EMPTY ? emptySeat(newPlayer(i, c)) : newPlayer(i, c))), enemies: [], projs: [], items: [], fx: [], boss: null,
    banner: null, events: [], nextId: 1, clearT: 0, totalScore: 0, god: false,
  };
  startStage(state, Math.max(0, Math.min(11, firstStage | 0)));
  return state;
}

function startStage(state, i) {
  state.stageIdx = i;
  state.stage = makeStage(state, i);
  state.camX = 0; state.lockX = null; state.enemies = []; state.projs = []; state.items = []; state.fx = []; state.boss = null; state.hazards = [];
  state.mode = 'play'; state.clearT = 0; state.humans = 0;
  for (const c of state.stage.crates) state.items.push({ id: state.nextId++, kind: 'crate', x: c.x, y: c.y, z: 0, hp: 12 });
  state.players.forEach((p, k) => {
    if (p.fresh) return; // a seat nobody has taken stays out
    Object.assign(p, { x: 60 + k * 16, y: 14 + k * 18, z: 0, vx: 0, vy: 0, vz: 0, face: 1, st: 'idle', t: 0, inv: 120, ufoT: 0, downT: 0, revive: 0 });
    // Dead Sprotos return for the next stage: CPUs as before, and a human who was put out comes
    // back on a last life. Everyone can be revived by a CPU once more.
    if (p.dead && p.ctrl !== 'cpu') p.lives = Math.max(p.lives, 1);
    p.hp = p.dead ? 60 : Math.max(p.hp, 60); p.dead = false; p.npcRevived = false;
    // A player who left gets the same stage recovery, and stays out until they take the seat again.
    if (!seated(p)) { p.awaySt = 'idle'; setState(p, 'out'); }
  });
  state.banner = { text: 'STAGE ' + (i + 1), sub: (root.MANIFEST ? root.MANIFEST.bosses[i % 12].stage : ''), t: 150 };
  ev(state, 'stage');
}

function ev(state, name, x) { state.events.push(x === undefined ? name : name + ':' + Math.round(x)); }
function fx(state, kind, x, y, z, extra) { state.fx.push(Object.assign({ id: state.nextId++, kind, x, y, z, t: 0 }, extra || {})); }

// ---------------- players ----------------
// God mode (toggled by pressing 9 twice, as in Sproto Arcade): human Sprotos take no damage
// and their weapon attacks run at double speed. CPU teammates are unaffected.
const isGod = (state, p) => state.god && p.ctrl !== 'cpu';
function toggleGod(state) {
  state.god = !state.god;
  state.banner = { text: state.god ? 'GOD MODE ON' : 'GOD MODE OFF', sub: state.god ? 'Unlimited health · 2x attack speed' : '', t: 90 };
  if (state.god) for (const p of state.players) if (p.ctrl !== 'cpu' && alive(p)) p.hp = maxHp(p);
  ev(state, state.god ? 'ufo' : 'shield');
}
const alive = p => p.st !== 'down' && p.st !== 'out' && p.st !== 'dead';
function activePlayers(state) { return state.players.filter(alive); }

function setState(p, st) { p.st = st; p.t = 0; }

function updatePlayer(state, p) {
  const inp = p.in;
  if (p.hs > 0) { // hitstop: frozen for a few ticks on impact; an Attack tap during it is kept
    if (inp.a && !p.prev.a) p.bufA = ATTACK_BUFFER;
    p.prev.a = inp.a; p.hs--; return;
  }
  const pressA = inp.a && !p.prev.a, pressJ = inp.j && !p.prev.j, pressS = inp.s && !p.prev.s, pressP = inp.p && !p.prev.p;
  if (pressA) p.bufA = ATTACK_BUFFER; else if (p.bufA > 0) p.bufA--;
  const wantA = p.bufA > 0; // pressed now, or within the last few ticks
  // Double-tap left or right to dash.
  let dash = 0;
  for (const [k, d] of [['l', -1], ['r', 1]]) {
    if (inp[k] && !p.prev[k]) { if (p.tapDir === d && state.t - p.tapT <= DOUBLE_TAP) dash = d; p.tapDir = d; p.tapT = state.t; }
  }
  p.prev.a = inp.a; p.prev.j = inp.j; p.prev.s = inp.s; p.prev.p = inp.p; p.prev.l = inp.l; p.prev.r = inp.r; p.prev.d = inp.d;
  // Ticks since this seat last pressed anything (CPU teammates stop waiting for an idle human).
  p.idle = inp.l || inp.r || inp.u || inp.d || inp.a || inp.j || inp.s || inp.p ? 0 : (p.idle || 0) + 1;
  p.t++;
  const god = isGod(state, p);
  if (god && (p.st === 'attack' || p.st === 'special' || p.st === 'jumpatk' || p.st === 'dashatk')) p.t++; // 2x attack speed
  if (god && alive(p)) p.hp = maxHp(p);  if (p.inv > 0) p.inv--;
  if (p.comboT > 0 && --p.comboT === 0) p.combo = 0;

  if (p.st === 'dead') return; // no automatic revives: dead Sprotos sit out the rest of the stage
  if (p.st === 'down') {
    p.downT--;
    // Humans revive anyone, as often as they like. CPU Sprotos revive anyone too, humans and each
    // other, but each Sproto gets only one CPU revive per life and per stage (p.npcRevived).
    const helper = state.players.find(o => o !== p && (o.ctrl !== 'cpu' || !p.npcRevived) && alive(o) && o.st !== 'ufo' && Math.abs(o.x - p.x) < 30 && Math.abs(o.y - p.y) < 20);
    if (helper) {
      p.revive += has(helper, 'medic') && state.t % 5 < 2 ? 2 : 1; // a Medic revives 40% faster
      if (p.revive % 12 === 0) fx(state, 'spark', p.x, p.y, 20);
      if (p.revive >= REVIVE_TICKS) {
        p.hp = 45; setState(p, 'idle'); p.inv = 120; p.revive = 0;
        if (helper.ctrl === 'cpu') p.npcRevived = true;
        helper.score += 500; helper.revs = (helper.revs || 0) + 1; ev(state, 'revive'); fx(state, 'text', p.x, p.y, 70, { text: 'REVIVED!' });
      }
    } else p.revive = Math.max(0, p.revive - 1);
    if (p.downT <= 0) die(state, p);
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
    const fin = isFinisher(p);
    const tot = w.startup + w.active + w.recovery + (fin ? 6 : 0);
    p.vx *= 0.7; p.vy = 0;
    if (p.t > w.startup && p.t <= w.startup + w.active) {
      if (p.launch) meleeHit(state, p, w.reach, w.dmg, false, 1, false, { launch: true });
      else {
        // Bo Staff: hit 2 also strikes behind you.
        meleeHit(state, p, w.reach + (fin ? 8 : 0), w.dmg + (fin ? 4 : 0), fin, w.knock, w.id === 'bo' && p.combo === 2, { fin });
        if (fin && p.t === w.startup + 1) weaponFinisher(state, p, w);
      }
    }
    if (dash && p.t > w.startup + w.active) startDash(state, p, dash); // cancel recovery into a dash
    else if (p.t >= tot) setState(p, 'idle');
    else if (wantA && p.t > w.startup + w.active && !fin && !p.launch) startAttack(state, p, inp);
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
  } else if (p.st === 'dash') {
    p.vx = p.dashDir * (p.t < 8 ? 6.2 : 3); p.vy = (inp.d ? 1 : inp.u ? -1 : 0) * 1.2;
    if (pressA) { setState(p, 'dashatk'); p.bufA = 0; p.hitDone = new Set(); ev(state, 'swing'); }
    else if (p.t >= DASH_TICKS) setState(p, 'idle');
  } else if (p.st === 'dashatk') {
    // Dash strike: slides through and knocks the first enemies down.
    p.vx *= 0.9; p.vy = 0;
    const w = WEAPONS[p.weapon];
    if (p.t >= 2 && p.t <= 9) meleeHit(state, p, w.reach + 6, w.dmg + 3, true, w.knock + 1);
    if (p.t >= 20) setState(p, 'idle');
  } else if (p.st === 'block') {
    p.vx = 0; p.vy = 0;
    if (!inp.s) {
      p.parryLock = state.t + PARRY_LOCK;
      // A quick tap that blocked nothing is the spin attack.
      if (p.t <= SPIN_TAP && !p.blockHit && !inp.d) startSpin(state, p, god); else setState(p, 'idle');
    }
  } else if (p.st === 'grab') {
    updateGrab(state, p, pressA, inp);
  } else if (p.st === 'throw') {
    p.vx = 0; p.vy = 0;
    if (p.t > 14) setState(p, 'idle');
  } else if (p.st === 'slam') {
    p.vx *= 0.9;
    if (p.z === 0) {
      // Ground slam: a shockwave that also hits enemies lying on the floor.
      const w = WEAPONS[p.weapon];
      p.hitDone = new Set();
      meleeHit(state, p, 56, w.dmg + 6, true, 4, true, { lying: true });
      fx(state, 'ring', p.x, p.y, 0); ev(state, 'boom'); shake(state, 5);
      setState(p, 'land');
    }
  } else if (p.st === 'jump') {
    if (pressA) p.bufA = 0;
    if (pressA && inp.d && p.z > 20) { setState(p, 'slam'); p.vz = -9; p.hitDone = new Set(); ev(state, 'swing'); }
    else if (pressA) { setState(p, 'jumpatk'); p.hitDone = new Set(); ev(state, 'swing'); }
    if (p.z === 0 && p.t > 2) { setState(p, 'land'); p.vx = 0; p.vy = 0; }
  } else { // idle / walk
    const sp = (p.ctrl === 'cpu' && p.ai.rescue ? 3.6 : 2.3) * (has(p, 'sprinter') ? 1.1 : 1); // a rescuing CPU sprints
    let mx = (inp.r ? 1 : 0) - (inp.l ? 1 : 0), my = (inp.d ? 1 : 0) - (inp.u ? 1 : 0);
    p.vx = mx * sp; p.vy = my * sp * 0.62;
    if (mx) p.face = mx;
    p.st = mx || my ? 'walk' : 'idle';
    const dazed = mx ? state.enemies.find(e => e.st === 'hit' && e.stun >= 2 && !e.dead && Math.abs(e.y - p.y) < 10 && (e.x - p.x) * mx > 0 && Math.abs(e.x - p.x) < 26) : null;
    if ((pressP || (pressS && inp.d)) && p.powers.length) {
      usePower(state, p, p.powers.shift());
    } else if (dash) {
      startDash(state, p, dash);
    } else if (inp.s && !(inp.d && p.powers.length)) {
      // Block on press. Held from an earlier move it rises on the first free tick.
      setState(p, 'block'); p.blockHit = false; p.noParry = state.t < (p.parryLock || 0); ev(state, 'shield');
    } else if (dazed && p.ctrl !== 'cpu' || (dazed && p.ctrl === 'cpu' && rng(state) < 0.02)) {
      startGrab(state, p, dazed);
    } else if (wantA && inp.u) {
      startAttack(state, p, inp, true); // launcher
    } else if (pressA && pressJ) {
      startSpin(state, p, god);
    } else if (pressJ) {
      setState(p, 'jump'); p.vz = 8.6; p.vx = mx * 2.6; p.vy = my * 1.4; ev(state, 'jump');
    } else if (wantA) startAttack(state, p, inp);
    // Pick up items by walking over them.
    for (const it of state.items) {
      if (it.kind === 'crate' || it.taken) continue;
      if (it.kind === 'ufo' && p.ctrl === 'cpu') continue; // only human players can take the UFO
      if (Math.abs(it.x - p.x) < 20 && Math.abs(it.y - p.y) < 14) takeItem(state, p, it);
    }
  }
  clampPlayer(state, p);
}

// The spin attack costs a little health; without enough of it the Sproto just stands.
function startSpin(state, p, god) {
  if (!god && p.hp <= SPECIAL_COST + 1) { setState(p, 'idle'); return; }
  if (!god) p.hp -= SPECIAL_COST;
  setState(p, 'special'); p.hitDone = new Set(); ev(state, 'special'); fx(state, 'ring', p.x, p.y, 0);
}
function clampPlayer(state, p) {
  p.y = clamp(p.y, 0, DEPTH);
  const right = state.lockX !== null ? Math.min(state.lockX + W, state.stage.len + W) : state.stage.len + W;
  p.x = clamp(p.x, state.camX + 14, Math.min(state.camX + W - 14, right - 14));
}

const maxCombo = p => (WEAPONS[p.weapon].id === 'katana' ? 4 : 3); // Katana: a 4th combo hit
const isFinisher = p => !p.launch && p.combo >= maxCombo(p);
function startAttack(state, p, inp, launch) {
  p.launch = !!launch; p.bufA = 0;
  p.combo = launch ? 1 : p.combo >= maxCombo(p) ? 1 : p.combo + 1;
  p.comboT = 40;
  setState(p, 'attack');
  p.hitDone = new Set();
  // Step into the swing and auto-face the nearest foe in front-ish.
  p.vx = p.face * 1.4;
  ev(state, 'swing');
}

function startDash(state, p, dir) {
  setState(p, 'dash'); p.dashDir = dir; p.face = dir; p.inv = Math.max(p.inv, 7); ev(state, 'jump');
  fx(state, 'ring', p.x - dir * 10, p.y, 0);
}
function shake(state, n) { state.shake = Math.max(state.shake || 0, n); }
// Weapon finishers: each weapon's last combo hit has its own effect.
function weaponFinisher(state, p, w) {
  const dmg = p.ctrl === 'cpu' ? Math.ceil(10 * cpuDmg(state)) : 10;
  if (w.id === 'hammer' || w.id === 'spear') {
    // Hammer: a shockwave rolls along the lane. Spear: the thrust pierces the whole lane.
    const len = w.id === 'hammer' ? 170 : 150;
    for (const e of state.enemies) {
      if (e.hp <= 0 || e.st === 'lying' || p.hitDone.has(e.id)) continue;
      const dx = (e.x - p.x) * p.face;
      if (dx > 0 && dx < len && Math.abs(e.y - p.y) < 14) { p.hitDone.add(e.id); hurtEnemy(state, e, dmg + (w.id === 'spear' ? 6 : 0), true, p.face, 4, p); }
    }
    fx(state, w.id === 'hammer' ? 'wave' : 'thrust', p.x + p.face * 20, p.y, 0, { small: p.face }); shake(state, 4);
  }
}
function startGrab(state, p, e) {
  setState(p, 'grab'); p.grab = e.id; p.knees = 0; p.face = e.x > p.x ? 1 : -1;
  e.st = 'grabbed'; e.t = 0; e.vx = 0; e.vy = 0; e.vz = 0; e.z = 0;
  ev(state, 'swing');
}
// A grab can end without the grabber's say (hit, knocked down, downed, killed). The enemy must
// never stay 'grabbed' after that: nothing else can hit it, and the wave would never clear.
function releaseGrab(state, p) {
  if (p.grab === null || p.grab === undefined) return;
  const e = state.enemies.find(o => o.id === p.grab);
  if (e && e.st === 'grabbed') { e.st = e.dead ? 'knock' : 'walk'; e.t = 0; }
  p.grab = null;
}
function updateGrab(state, p, pressA, inp) {
  p.vx = 0; p.vy = 0;
  const e = state.enemies.find(o => o.id === p.grab);
  if (!e || e.dead || e.st !== 'grabbed' || p.t > GRAB_TICKS) { if (e && e.st === 'grabbed') { e.st = e.dead ? 'knock' : 'walk'; e.t = 0; } p.grab = null; setState(p, 'idle'); return; }
  e.x = p.x + p.face * 22; e.y = p.y; e.face = -p.face;
  const dir = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
  if (pressA) p.bufA = 0;
  if (pressA && !dir && p.knees < 2) {
    // Knee strike.
    p.knees++; p.kneeT = state.t; hurtEnemy(state, e, p.ctrl === 'cpu' ? 4 : 7, false, p.face, 0, p);
    p.hs = 3; e.hs = 3; ev(state, 'hit');
    // A knee that kills lets go. Holding on used to put the dead enemy back on its feet as a
    // Shadow Sproto that could attack but never be hit.
    if (e.dead) { p.grab = null; setState(p, 'idle'); } else { e.st = 'grabbed'; e.t = 0; }
  } else if (pressA) {
    // Throw: forward, or the way you are pushing. The thrown Sproto bowls over the crowd.
    const d = dir || p.face;
    p.face = d; e.st = 'knock'; e.t = 0; e.vx = d * 7.5; e.vz = 4.5; e.thrown = p.slot; e.x = p.x + d * 10;
    hurtEnemy(state, e, p.ctrl === 'cpu' ? 6 : 12, true, d, 7.5, p);
    if (!e.dead) { e.st = 'knock'; e.vx = d * 7.5; }
    p.grab = null; setState(p, 'throw'); ev(state, 'throw'); shake(state, 3);
  }
}
function meleeHit(state, p, reach, dmg, knockdown, knockF, around, opt) {
  opt = opt || {};
  const hits = p.hitDone || (p.hitDone = new Set());
  const w = WEAPONS[p.weapon];
  const hit = has(p, 'brawler') ? Math.round(dmg * 1.1) : dmg;
  for (const e of state.enemies) {
    if (e.hp <= 0 || hits.has(e.id) || e.st === 'grabbed' || (e.st === 'lying' && !opt.lying)) continue;
    const dx = (e.x - p.x) * (around ? Math.sign(e.x - p.x) || 1 : p.face);
    // Airborne (juggled) enemies can be hit higher than standing ones.
    if (dx < -10 || dx > reach || Math.abs(e.y - p.y) > 15 || e.z - p.z > 75 || p.z - e.z > 40) continue;
    hits.add(e.id);
    const dir = Math.sign(e.x - p.x) || p.face;
    // An elite's guard stops hits from the front. A launcher goes under it, a parry or enough
    // blocked hits break it, and its back is always open.
    if (guarding(e, p)) {
      if (opt.launch) breakGuard(state, e);
      else {
        e.guard--; p.hs = Math.max(p.hs, 3); e.hs = 3; fx(state, 'shield', e.x, e.y, 30); ev(state, 'shield');
        if (e.guard <= 0) { breakGuard(state, e); e.st = 'hit'; e.t = 0; e.stun = 3; e.vx = dir * 1.2; fx(state, 'text', e.x, e.y, 80, { text: 'GUARD BREAK!' }); }
        continue;
      }
    }
    hurtEnemy(state, e, p.ctrl === 'cpu' ? Math.ceil(hit * cpuDmg(state)) : hit, knockdown, dir, knockF, p, opt.launch);
    // Weapon rules: Axe hits make enemies bleed; Flail hits pull them in.
    if (w.id === 'axe' && !e.dead) { e.bleed = Math.min(3, (e.bleed || 0) + 1); e.bleedT = 180; e.bleedBy = p.slot; }
    if (w.id === 'flail' && !e.dead && e.st !== 'knock') e.x += (p.x + p.face * 26 - e.x) * 0.5;
    // Hitstop: attacker and target freeze briefly; finishers hit harder and shake the screen.
    const stop = opt.fin || knockdown ? 6 : 3;
    p.hs = Math.max(p.hs, stop); e.hs = stop;
    if (opt.fin) shake(state, 2);
  }
  for (const it of state.items) {
    if (it.kind !== 'crate' || hits.has(it.id)) continue;
    const dx = (it.x - p.x) * p.face;
    if (dx < -10 || dx > reach || Math.abs(it.y - p.y) > 16) continue;
    hits.add(it.id);
    it.hp -= dmg; fx(state, 'spark', it.x, it.y, 18); ev(state, 'hit');
    if (it.hp <= 0) breakCrate(state, it);
  }
  // Swinging into a thrown knife or a missile knocks it out of the air.
  for (const pr of state.projs) {
    if (!pr.enemy || !(pr.kind === 'knife' || pr.homing) || pr.remove) continue;
    const dx = (pr.x - p.x) * (around ? Math.sign(pr.x - p.x) || 1 : p.face);
    if (dx > -10 && dx < reach + 6 && Math.abs(pr.y - p.y) < 16 && Math.abs(pr.z - (p.z + 26)) < 40) {
      pr.remove = true; p.score += 100; fx(state, 'spark', pr.x, pr.y, pr.z); ev(state, 'shield');
      if (pr.homing) { fx(state, 'boom', pr.x, pr.y, pr.z, { small: 1 }); ev(state, 'boom'); }
    }
  }
  const b = state.boss;
  if (b && b.hp > 0 && b.st !== 'enter' && b.st !== 'transform' && !hits.has('boss')) {
    const half = b.w / 2;
    const dx = p.x - b.x;
    if (Math.abs(dx) < half + reach * 0.8 && Math.abs(b.y - p.y) < 32) {
      hits.add('boss');
      hurtBoss(state, b, p.ctrl === 'cpu' ? Math.ceil(dmg * cpuDmg(state)) : dmg, p);
      p.hs = Math.max(p.hs, 3);
    }
  }
}

function hurtPlayer(state, p, dmg, dir, knock, src) {
  if (p.inv > 0 || !alive(p) || p.st === 'special') return false;
  // Blocking (hold Special) stops 75% of a frontal hit; blocking just before the hit is a parry.
  if (p.st === 'block' && Math.sign(dir) === -p.face) {
    p.blockHit = true;
    if (p.t <= PARRY_WINDOW + (has(p, 'duelist') ? 4 : 0) && !p.noParry) {
      fx(state, 'parry', p.x + p.face * 14, p.y, 34); fx(state, 'text', p.x, p.y, 76, { text: 'PARRY!' }); ev(state, 'shield');
      p.hs = 6; p.inv = 20; p.score += 300; p.parries = (p.parries || 0) + 1;
      if (src && src.st === 'attack') { src.st = 'hit'; src.t = 0; src.stun = 3; src.vx = -dir * 2; src.hs = 10; if (src.elite) breakGuard(state, src); } // the attacker is left dazed
      return true;
    }
    p.hp -= Math.max(1, Math.round(dmg * 0.25)); p.vx = dir * 1.5; p.inv = 10; fx(state, 'shield', p.x, p.y, 30); ev(state, 'shield');
    if (p.hp <= 0) { p.hp = 0; setState(p, 'down'); p.downT = DOWN_TICKS; p.revive = 0; p.vx = 0; p.z = 0; ev(state, 'down'); }
    return true;
  }
  if (isGod(state, p)) { fx(state, 'shield', p.x, p.y, 30 + p.z); return false; } // unlimited health
  if (p.st === 'ufo') {
    p.ufoShield--; p.inv = 40; fx(state, 'shield', p.x, p.y, 50); ev(state, 'shield');
    if (p.ufoShield <= 0) ejectUfo(state, p);
    return true;
  }
  p.hp -= p.ctrl === 'cpu' ? Math.ceil(dmg * cpuTaken(state)) : dmg;
  releaseGrab(state, p); // any hit that lands breaks a grab
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

function die(state, p) {
  p.hp = 0; p.revive = 0; releaseGrab(state, p);
  fx(state, 'text', p.x, p.y, 70, { text: p.name + ' DIED' }); ev(state, 'ko');
  if (p.ctrl === 'cpu') { setState(p, 'dead'); p.dead = true; p.lives = 0; return; }
  p.lives--;
  if (p.lives <= 0) {
    // Out until the next stage. The run only ends when no human is left in it.
    p.lives = 0; setState(p, 'dead'); p.dead = true;
    if (!state.players.some(q => q.ctrl !== 'cpu' && seated(q) && !q.dead)) gameOver(state, 'No human Sproto is left');
    return;
  }
  respawn(state, p, false);
}
function gameOver(state, why) {
  if (state.mode === 'gameover') return;
  state.mode = 'gameover'; state.banner = { text: 'GAME OVER', sub: why + ' · press START', t: 99999 }; ev(state, 'bossdown');
}

function respawn(state, p, cont) {
  const ps = activePlayers(state);
  const ax = ps.length ? ps.reduce((s, o) => s + o.x, 0) / ps.length : state.camX + 120;
  p.npcRevived = false; // a new life gets one CPU revive again
  Object.assign(p, { hp: maxHp(p), x: clamp(ax, state.camX + 40, state.camX + W - 40), y: 30 + rng(state) * 60, z: 140, vz: 0, vx: 0, vy: 0, inv: 150, revive: 0, ufoT: 0 });
  setState(p, 'jump');
  fx(state, 'text', p.x, p.y, 90, { text: p.name + ' IS BACK · LAST LIFE' });
  ev(state, 'respawn');
}

function takeItem(state, p, it) {
  if (it.kind === 'snack') { p.hp = Math.min(maxHp(p), p.hp + 40); it.taken = true; ev(state, 'heal'); fx(state, 'text', p.x, p.y, 70, { text: '+40' }); }
  else if (it.kind === 'gem') { p.score += 1000; it.taken = true; ev(state, 'coin'); }
  else if (it.kind === 'power') {
    if (p.ctrl === 'cpu' || p.powers.length >= MAX_POWERS) return;
    p.powers.push(it.pt); it.taken = true; ev(state, 'coin');
    fx(state, 'text', p.x, p.y, 80, { text: ['STORM', 'METEOR', 'LIGHTNING'][it.pt] + ' SAVED' });
  }
  else if (it.kind === 'ufo') {
    it.taken = true; setState(p, 'ufo'); p.ufoT = UFO_TICKS; p.ufoShield = 4; p.z = 46; p.inv = 30;
    ev(state, 'ufo'); fx(state, 'text', p.x, p.y, 110, { text: 'UFO!' });
  }
}

// ---------------- saved power-ups ----------------
// Picked up by human players, held up to 3, fired with the Power button (or Down + Special).
const POWERS = ['storm', 'meteor', 'bolt'];
const MAX_POWERS = 3;
function dropPower(state, x, y) {
  state.items.push({ id: state.nextId++, kind: 'power', pt: Math.floor(rng(state) * POWERS.length), x: clamp(x, state.camX + 30, state.camX + W - 30), y: clamp(y, 6, DEPTH - 6), z: 0 });
}
function usePower(state, p, pt) {
  setState(p, 'special'); p.hitDone = new Set(); p.inv = 70;
  const owner = p, kind = POWERS[pt] || 'storm';
  state.banner = { text: ['SPROTO STORM!', 'METEOR RAIN!', 'CHAIN LIGHTNING!'][pt] || 'POWER!', t: 50, power: 1 };
  shake(state, 8);
  ev(state, 'transform');
  const foes = state.enemies.filter(e => e.hp > 0 && e.x > state.camX - 20 && e.x < state.camX + W + 20);
  const b = state.boss && state.boss.hp > 0 && state.boss.st !== 'enter' && state.boss.st !== 'transform' && state.boss.st !== 'dead' ? state.boss : null;
  if (kind === 'storm') {
    // A shockwave around you: huge radius, knocks everything down, wipes enemy shots.
    fx(state, 'nova', p.x, p.y, 0);
    for (const e of foes) if (Math.abs(e.x - p.x) < 260 && Math.abs(e.y - p.y) < 80) hurtEnemy(state, e, 55, true, Math.sign(e.x - p.x) || 1, 7, owner);
    if (b && Math.abs(b.x - p.x) < 300) hurtBoss(state, b, 220, owner);
    state.projs = state.projs.filter(pr => !(pr.enemy && Math.abs(pr.x - p.x) < 280));
  } else if (kind === 'meteor') {
    // Meteors rain on the enemies across the whole screen over 1.5 seconds.
    const targets = foes.slice(0, 12).map(e => [e.x, e.y]);
    while (targets.length < 12) targets.push([state.camX + 40 + rng(state) * (W - 80), rng(state) * DEPTH]);
    if (b) targets.push([b.x, b.y], [b.x, b.y]);
    state.strikes = (state.strikes || []).concat(targets.map(([x, y], k) => ({ x, y, at: state.t + 20 + k * 6, owner: p.slot })));
    for (const st of state.strikes) fx(state, 'meteor', st.x, st.y, 0, { small: st.at - state.t });
  } else {
    // Lightning arcs to the 10 nearest enemies on screen.
    foes.sort((a, c) => Math.abs(a.x - p.x) - Math.abs(c.x - p.x));
    for (const e of foes.slice(0, 10)) { fx(state, 'bolt', e.x, e.y, 0); hurtEnemy(state, e, 60, true, Math.sign(e.x - p.x) || 1, 4, owner); }
    if (b) { fx(state, 'bolt', b.x, b.y, 0); fx(state, 'bolt', b.x - 30, b.y, 0); hurtBoss(state, b, 200, owner); }
  }
}
function updateStrikes(state) {
  if (!state.strikes || !state.strikes.length) return;
  for (const st of state.strikes) {
    if (st.at !== state.t) continue;
    fx(state, 'boom', st.x, st.y, 6); ev(state, 'boom');
    const owner = state.players[st.owner];
    for (const e of state.enemies) if (e.hp > 0 && Math.abs(e.x - st.x) < 52 && Math.abs(e.y - st.y) < 30) hurtEnemy(state, e, 45, true, Math.sign(e.x - st.x) || 1, 5, owner);
    const b = state.boss;
    if (b && b.hp > 0 && b.st !== 'enter' && b.st !== 'transform' && b.st !== 'dead' && Math.abs(b.x - st.x) < b.w / 2 + 40) hurtBoss(state, b, 70, owner);
  }
  state.strikes = state.strikes.filter(st => st.at > state.t);
}

function breakCrate(state, it) {
  it.taken = true; ev(state, 'crate');
  fx(state, 'boom', it.x, it.y, 10, { small: 1 });
  const r = rng(state);
  if (r < 0.3) dropPower(state, it.x, it.y);
  else state.items.push({ id: state.nextId++, kind: r < 0.75 ? 'snack' : 'gem', x: it.x, y: it.y, z: 0 });
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
    p.shotCd = isGod(state, p) ? 4 : 8; ev(state, 'laser');
  }
  if ((pressS || inp.j) && p.ballCd === 0) {
    state.projs.push({ id: state.nextId++, kind: 'ball', owner: p.slot, x: p.x + p.face * 20, y: p.y, z: p.z, vx: p.face * 3.2, vy: 0, vz: 3, dmg: 22, t: 0, life: 120, hit: [] });
    p.ballCd = isGod(state, p) ? 35 : 70; ev(state, 'ball');
  }
  if (--p.ufoT <= 0) ejectUfo(state, p);
}
function ejectUfo(state, p) {
  setState(p, 'jump'); p.vz = 5; p.inv = 90; p.ufoT = 0;
  fx(state, 'boom', p.x, p.y, p.z, { small: 1 }); ev(state, 'boom');
}

// ---------------- enemies (Shadow Sprotos) ----------------
function spawnEnemy(state, side, plain) {
  let kind = Math.floor(rng(state) * ENEMY_WEAPONS.length);
  // From stage 2 on, some are elites (never more than two at once): a club or a pike, more health,
  // harder hits and a guard.
  let elites = 0;
  for (const o of state.enemies) if (o.elite && !o.dead) elites++;
  const elite = !plain && state.stageIdx >= ELITE_FROM_STAGE && elites < ELITE_MAX && rng(state) < 0.08 + 0.01 * state.stageIdx;
  if (elite) kind = kind % 2 ? 2 : 0;
  const hp = Math.round((26 + state.stageIdx * 4 + (kind === 0 ? 14 : 0)) * ENEMY_HP(state.stageIdx) * GRUNT_HP_SCALE(humansOf(state)) * (elite ? 1.6 : 1));
  const x = side > 0 ? state.camX + W + 30 + rng(state) * 40 : state.camX - 30 - rng(state) * 40;
  state.enemies.push({
    id: state.nextId++, fid: Math.floor(rng(state) * (root.MANIFEST ? root.MANIFEST.fighters.length : 3)), weapon: kind, x, y: rng(state) * DEPTH, z: 0, vx: 0, vy: 0, vz: 0,
    face: -side, hp, maxHp: hp, st: 'walk', t: 0, cd: 25 + Math.floor(rng(state) * 40), target: null, inv: 0, hitDone: null,
    // Each Shadow Sproto keeps its own lane offset and stand-off distance, so a crowd fans out.
    offY: (rng(state) - 0.5) * 16, offX: (rng(state) - 0.5) * 56,
  });
  if (elite) { const e = state.enemies[state.enemies.length - 1]; e.elite = true; e.guard = GUARD_HITS; e.guardT = 0; }
}

// Elite Shadow Sprotos hold a guard while they stand facing the attacker.
const guarding = (e, p) => !!e.elite && e.guard > 0 && (e.st === 'walk' || e.st === 'idle' || e.st === 'attack') && (p.x - e.x) * e.face >= 0;
function breakGuard(state, e) { e.guard = 0; e.guardT = GUARD_REGEN; }
function hurtEnemy(state, e, dmg, knockdown, dir, knockF, p, launch) {
  // Juggles: each extra hit on an airborne enemy does 15% less.
  const air = e.st === 'knock' && e.z > 4 && !e.dead;
  if (air) { e.jug = (e.jug || 0) + 1; dmg = Math.max(1, Math.round(dmg * Math.pow(0.85, e.jug))); }
  e.hp -= dmg;
  if (p) p.score += dmg * 10;
  fx(state, 'spark', e.x + dir * 4, e.y, 34 + e.z);
  ev(state, 'hit', e.x);
  if (e.hp <= 0) {
    e.st = 'knock'; e.t = 0; e.vx = dir * (knockF + 1); e.vz = 6; e.dead = true;
    if (rng(state) < 0.04) dropPower(state, e.x, e.y);
    if (p) { p.score += 200; p.kills = (p.kills || 0) + 1; if (has(p, 'leech') && alive(p)) p.hp = Math.min(maxHp(p), p.hp + 2); }
    return;
  }
  if (launch) { e.st = 'knock'; e.t = 0; e.vx = dir * 0.8; e.vz = 9.5; e.jug = 0; e.stun = 0; fx(state, 'text', e.x, e.y, 80, { text: 'LAUNCH!' }); return; }
  if (air) { e.vz = Math.max(e.vz, 4.6); e.vx = dir * 0.9; e.t = 0; return; } // keep them up in the air
  if (knockdown || (e.st === 'hit' && e.t < 4 && e.stun > 2)) { e.st = 'knock'; e.t = 0; e.vx = dir * knockF; e.vz = 5.5; e.stun = 0; }
  else { e.st = 'hit'; e.t = 0; e.vx = dir * 1.2; e.stun = (e.stun || 0) + 1; }
}

function updateEnemy(state, e) {
  if (e.hs > 0) { e.hs--; return; }
  if (e.bleedT > 0) {
    e.bleedT--;
    if (e.bleedT % 30 === 0 && e.hp > 0 && !e.dead) { e.hp -= e.bleed * 2; fx(state, 'spark', e.x, e.y, 30); if (e.hp <= 0) hurtEnemy(state, e, 0, true, 1, 2, state.players[e.bleedBy]); }
  }
  if (e.elite && e.guard <= 0 && --e.guardT <= 0) e.guard = GUARD_HITS; // the guard comes back
  if (e.st === 'grabbed') {
    // Second guard: whatever ended the grab, an enemy nobody is holding walks again.
    if (state.players.some(q => q.st === 'grab' && q.grab === e.id)) { e.t++; return; }
    e.st = e.dead ? 'knock' : 'walk'; e.t = 0;
  }
  e.t++;
  e.x += e.vx; e.y = clamp(e.y + e.vy, 0, DEPTH); e.z += e.vz;
  if (e.z > 0 || e.vz > 0) e.vz -= 0.55;
  if (e.z <= 0) { e.z = 0; if (e.vz < 0) e.vz = 0; }
  const w = ENEMY_WEAPONS[e.weapon];
  if (e.st === 'hit') { e.vx *= 0.8; if (e.t > 18) { e.st = 'walk'; e.t = 0; e.cd = Math.max(e.cd, 20); } return; }
  if (e.st === 'knock') {
    e.vx *= 0.97;
    if (e.thrown !== undefined && e.thrown !== null) {
      // A thrown Sproto bowls over everyone it flies into.
      for (const o of state.enemies) if (o !== e && o.hp > 0 && o.st !== 'lying' && o.st !== 'grabbed' && Math.abs(o.x - e.x) < 22 && Math.abs(o.y - e.y) < 14 && o.st !== 'knock') hurtEnemy(state, o, 14, true, Math.sign(e.vx) || 1, 5, state.players[e.thrown]);
      if (e.z === 0 && e.t > 4) e.thrown = null;
    }
    if (e.z === 0 && e.t > 6) { e.vx = 0; e.st = 'lying'; e.t = 0; e.jug = 0; if (e.dead) { ev(state, 'ko'); } }
    return;
  }
  if (e.st === 'lying') { if (e.dead ? e.t > 50 : e.t > 46) { if (e.dead) e.remove = true; else { e.st = 'walk'; e.t = 0; e.stun = 0; } } return; }

  // Choose target: nearest active non-UFO player (UFO pilots are targeted less).
  const ps = activePlayers(state);
  if (!ps.length) { e.vx = 0; e.vy = 0; return; }
  if (!e.target || e.t % 90 === 0 || !alive(e.target)) {
    // Crowded targets are less attractive, so a wave spreads over the team instead of piling on
    // one Sproto, and each Shadow Sproto takes the emptier side of the one it picks.
    let best = null, bd = 1e9;
    for (const p of ps) {
      let on = 0; for (const o of state.enemies) if (o !== e && !o.dead && o.target === p) on++;
      const d = Math.abs(p.x - e.x) + Math.abs(p.y - e.y) * 2 + (p.st === 'ufo' ? 300 : 0) + on * 80 + rng(state) * 60;
      if (d < bd) { bd = d; best = p; }
    }
    e.target = best;
    let l = 0, r = 0;
    for (const o of state.enemies) if (o !== e && !o.dead && o.target === best) { if (o.x < best.x) l++; else r++; }
    e.side = l === r ? 0 : l < r ? -1 : 1;
  }
  const p = e.target;
  if (e.cd > 0) e.cd--;
  if (e.st === 'attack') {
    e.vx = 0; e.vy = 0;
    if (w.thrower) {
      if (e.t === w.startup) {
        state.projs.push({ id: state.nextId++, kind: 'knife', x: e.x + e.face * 16, y: e.y, z: 18, vx: e.face * 4, vy: 0, vz: 0, dmg: Math.round(6 * ENEMY_DMG(state.stageIdx)), t: 0, life: 120, enemy: true });
        ev(state, 'throw');
      }
    } else if (e.t > w.startup && e.t <= w.startup + w.active) {
      for (const q of ps) {
        const dx = (q.x - e.x) * e.face;
        if (dx > -8 && dx < w.reach && Math.abs(q.y - e.y) < 14 && q.z < 40 && !(e.hitDone && e.hitDone.has(q.slot))) {
          (e.hitDone || (e.hitDone = new Set())).add(q.slot);
          hurtPlayer(state, q, Math.round((w.dmg + Math.floor(state.stageIdx / 3)) * ENEMY_DMG(state.stageIdx) * (e.elite ? 1.25 : 1)), e.face, w.id === 'club' && rng(state) < 0.4, e);
        }
      }
    }
    if (e.t >= w.startup + w.active + w.recovery) { e.st = 'walk'; e.t = 0; e.cd = 30 + Math.floor(rng(state) * 45); }
    return;
  }
  // Approach: stand off at weapon reach on the near side, in the same lane.
  const side = e.side || (e.x < p.x ? -1 : 1);
  const want = w.thrower ? 150 + (e.offX || 0) : w.reach * (0.66 + (e.offX || 0) * 0.007); // 46%..86% of reach: always close enough to swing
  // Stand-off points are kept on screen so every Shadow Sproto is reachable.
  const tx = clamp(p.x + side * want, state.camX + 24, state.camX + W - 24), ty = clamp(p.y + e.offY, 0, DEPTH);
  const dx = tx - e.x, dy = ty - e.y;
  const sp = w.id === 'knife' ? 1.5 : 1.1;
  e.vx = Math.abs(dx) > 4 ? Math.sign(dx) * sp : 0;
  e.vy = Math.abs(dy) > 3 ? Math.sign(dy) * sp * 0.6 : 0;
  // Do not stand inside another Shadow Sproto: step apart across the lanes.
  for (const o of state.enemies) {
    if (o === e || o.dead || o.st === 'knock' || o.st === 'lying' || Math.abs(o.x - e.x) > 22 || Math.abs(o.y - e.y) > 8) continue;
    e.vy = (e.y > o.y || (e.y === o.y && e.id > o.id) ? 1 : -1) * 0.7; break;
  }
  e.face = p.x > e.x ? 1 : -1;
  e.st = e.vx || e.vy ? 'walk' : 'idle';
  const inRange = Math.abs(p.x - e.x) < (w.thrower ? 220 : w.reach) && Math.abs(p.y - e.y) < 10;
  if (inRange && e.cd === 0) { e.st = 'attack'; e.t = 0; e.hitDone = null; ev(state, 'eswing'); }
}

// ---------------- boss (Sproto Arcade machines) ----------------
const BOSS_SCALE = 0.95;
// Rear sweep: after this many ticks with two Sprotos behind the boss (or longer with one), it marks
// the ground behind it for SWEEP_WARN ticks and then hits everything standing there.
const SWEEP_AFTER = 180, SWEEP_AFTER_ONE = 300, SWEEP_WARN = 36, SWEEP_REACH = 170;
// A boss with this much open floor on both sides (beyond half its width) is in the middle of the
// arena: its volleys then fire both ways, so the floor behind it is never a safe place to stand.
const MID_ROOM = 60;
const inMiddle = (state, b) => b.x - (state.camX + 70) > b.w / 2 + MID_ROOM && state.camX + W - 70 - b.x > b.w / 2 + MID_ROOM;
function bossInfo(i) { return root.MANIFEST ? root.MANIFEST.bosses[i % 12] : null; }
function startBoss(state) {
  const info = bossInfo(state.stageIdx);
  const ph = info ? info.phases[0] : { body: [60, 60, 200, 250] };
  lockHumans(state);
  // (4,200 on stage 1 up to 9,040 on stage 12) x the human scale: 2,100 to 4,520 for one human,
  // 3,990 to 8,590 for four. One human faces about 53% of the four-human boss.
  // The charger spends much of its fight rushing out of reach, so it has less health to compensate.
  const hp = Math.round((4200 + state.stageIdx * 440) * BOSS_HP_SCALE(state.humans) * (state.stageIdx % 4 === 1 ? CHARGER_HP : 1));
  state.boss = {
    bi: state.stageIdx % 12, phase: 0, hp, maxHp: hp, x: state.camX + W + 140, y: DEPTH / 2, z: 0, face: -1,
    st: 'enter', t: 0, row: 0, w: (ph.body[2] - ph.body[0]) * BOSS_SCALE * 0.85, cycle: 0, flash: 0, tx: 0, ty: 0, hitCd: 0, adds: 0,
    arch: state.stageIdx % BOSS_ARCHETYPES.length, addT: 0,
  };
  state.banner = { text: info ? info.machines[0].toUpperCase() : 'BOSS', sub: (info ? 'piloted by ' + info.pilot + ' · ' : '') + BOSS_ARCHETYPES[state.boss.arch].toUpperCase(), t: 150, boss: true };
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
    dropPower(state, state.camX + 200, DEPTH / 2 + 30);
    ev(state, 'transform');
  }
  if (b.hp <= 0) {
    b.hp = 0; b.st = 'dead'; b.t = 0; ev(state, 'bossdown');
    // The fight is over: its shots vanish, its Shadow Sprotos fall, and nobody can be hurt while it
    // explodes. A dead boss must not end the run.
    for (const pr of state.projs) if (pr.enemy || pr.lob) pr.remove = true;
    state.hazards = [];
    for (const e of state.enemies) if (e.hp > 0 && !e.dead) { e.hp = 0; e.st = 'knock'; e.t = 0; e.vx = (e.x < b.x ? -1 : 1) * 3; e.vz = 6; e.dead = true; }
    for (const pl of activePlayers(state)) { pl.score += 5000; pl.inv = Math.max(pl.inv, 150); }
  }
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
  // Faster in phase 2, and enraged below 25% HP.
  const fast = (b.phase === 1 ? 0.6 : 1) * (b.hp < b.maxHp * 0.25 ? 0.75 : 1);
  // Each machine runs one of four scripts. gunner: the shots below. charger: charges every second
  // attack and leaves its lane burning. summoner: single shots, slower, but it keeps calling Shadow
  // Sprotos. bomber: weapon A lobs bombs at marked spots instead of firing along a lane.
  const arch = BOSS_ARCHETYPES[b.arch || 0];
  if (arch === 'summoner' && ++b.addT % Math.floor(SUMMON_EVERY * fast) === 0) {
    let alive = 0; for (const e of state.enemies) if (!e.dead) alive++;
    if (alive < 1 + humansOf(state)) { spawnEnemy(state, 1, true); spawnEnemy(state, -1, true); } // plain Shadow Sprotos, never elites
  }
  // Contact damage, only once the rush has started: the wind-up is the warning, not a hit.
  const windup = arch === 'charger' ? CHARGER_WINDUP : 24;
  for (const p of ps) if (Math.abs(p.x - b.x) < b.w * 0.35 && Math.abs(p.y - b.y) < 16 && p.z < 30 && b.st === 'charge' && b.t >= windup) hurtPlayer(state, p, arch === 'charger' ? 12 + state.stageIdx : 16 + state.stageIdx * 1.5, Math.sign(p.x - b.x) || 1, true); // the charger rushes more often, for less

  if (b.st === 'idle') {
    // Drift toward a lane near the target, keep distance from the group.
    const avgX = ps.reduce((s, p) => s + p.x, 0) / ps.length;
    const wantX = avgX < (arenaL + arenaR) / 2 ? arenaR - 20 : arenaL + 20;
    b.x += clamp(wantX - b.x, -1.2, 1.2);
    b.y += clamp(target.y - b.y, -1.4, 1.4);
    // Face the side with more Sprotos on it (the average position only breaks a tie).
    let left = 0, right = 0;
    for (const p of ps) { if (p.x < b.x) left++; else right++; }
    b.face = left === right ? (avgX > b.x ? 1 : -1) : right > left ? 1 : -1;
    // Nobody is safe behind the machine: Sprotos who stay there draw a rear sweep.
    let behind = 0;
    for (const p of ps) if (p.st !== 'ufo' && (p.x - b.x) * b.face < 0 && Math.abs(p.x - b.x) < b.w / 2 + SWEEP_REACH) behind++;
    b.rear = behind ? (b.rear || 0) + 1 : Math.max(0, (b.rear || 0) - 2);
    const wait = (arch === 'summoner' ? 50 : 34) * fast;
    if (b.t > wait && ((behind >= 2 && b.rear > SWEEP_AFTER) || b.rear > SWEEP_AFTER_ONE)) {
      b.st = 'sweep'; b.t = 0; b.rear = 0; b.tx = -b.face; ev(state, 'charge');
    } else if (b.t > wait) {
      b.cycle++;
      // Charge rushes in both phases (every 4th attack in phase 2, every 5th in phase 1); the
      // charger rushes every third attack, and every second one in phase 2.
      const charge = arch === 'charger' ? (b.phase ? b.cycle % 2 === 1 : b.cycle % 3 === 2) : b.phase ? b.cycle % 4 === 3 : b.cycle % 5 === 4;
      if (charge) { b.st = 'charge'; b.t = 0; b.tx = b.face; b.cx = b.x; ev(state, 'charge'); }
      else { b.st = 'fire'; b.t = 0; b.row = 1 + (b.cycle % 3); b.missile = b.cycle % 3 === 2; b.tx = target.x; b.ty = target.y;
        b.both = inMiddle(state, b); // decided now, so the floor warning shows both sides
        b.lob = arch === 'bomber' && b.row === 1;
        // Lock the lanes now; they are shown on the floor until the shots fire. Spreads leave gaps.
        const offs = b.row === 2 ? (b.phase ? [-72, -36, 0, 36, 72] : [-40, 0, 40]) : [0];
        b.warn = b.missile || b.lob ? null : offs.map(o => clamp(Math.round(b.ty + o), 0, DEPTH)).filter((v, i, a) => a.indexOf(v) === i);
        // The bomber marks where its bombs will land: one Sproto each, two bombs (three in phase 2).
        if (b.lob) {
          b.marks = [];
          // In the middle it marks Sprotos on both sides of it in turn, front first.
          let pool = ps;
          if (b.both) {
            const front = ps.filter(q => (q.x - b.x) * b.face >= 0), back = ps.filter(q => (q.x - b.x) * b.face < 0);
            pool = [];
            for (let k = 0; k < ps.length; k++) { const q = (k % 2 ? back : front)[Math.floor(k / 2)] || (k % 2 ? front : back)[Math.floor(k / 2)]; if (q && pool.indexOf(q) < 0) pool.push(q); }
            for (const q of ps) if (pool.indexOf(q) < 0) pool.push(q);
          }
          for (let k = 0; k < Math.min(pool.length, b.phase ? 3 : 2); k++) {
            const q = b.both ? pool[k] : pool[(b.cycle + k) % pool.length];
            b.marks.push([Math.round(q.x), Math.round(q.y)]);
            fx(state, 'mark', q.x, q.y, 0, { small: 30 + BOMB_FLIGHT });
          }
        }
      }
    }
  } else if (b.st === 'fire') {
    // 4-frame weapon animation: anticipation, locked, muzzle (fire), recoil.
    // Weapons A and C fire bursts (3 shots, 5 in phase 2); weapon B fires one wide volley.
    const fireAt = 30, burst = b.missile || b.row === 2 || b.lob || arch === 'summoner' ? 1 : (b.phase ? 3 : 2);
    if (b.t >= fireAt && (b.t - fireAt) % 8 === 0 && (b.t - fireAt) / 6 < burst) { if (b.lob) bossLob(state, b); else bossShoot(state, b); }
    if (b.t > 54 + (burst - 1) * 8) { b.st = 'idle'; b.t = 0; b.warn = null; }
  } else if (b.st === 'sweep') {
    // Rear sweep: the zone behind the machine is marked, then everything standing in it is hit.
    // It is low: a jump clears it, and so does walking round to the front.
    if (b.t === SWEEP_WARN) {
      for (const p of ps) {
        const dx = (p.x - b.x) * b.tx;
        if (p.st !== 'ufo' && dx > 0 && dx < b.w / 2 + SWEEP_REACH && p.z < 20) hurtPlayer(state, p, 12 + state.stageIdx, b.tx, true);
      }
      fx(state, 'nova', b.x + b.tx * (b.w / 2 + 40), b.y, 0); ev(state, 'boom'); shake(state, 5);
    }
    if (b.t > SWEEP_WARN + 24) { b.st = 'idle'; b.t = 0; }
  } else if (b.st === 'charge') {
    if (b.t < windup) { b.x += (rng(state) - 0.5) * 2; } // the charger winds up longer
    else { b.x += b.tx * 8.5; if (b.x < arenaL - 10 || b.x > arenaR + 10) { b.x = clamp(b.x, arenaL - 10, arenaR + 10); b.st = 'idle'; b.t = 0; b.face = -b.face; ev(state, 'boom'); fx(state, 'boom', b.x + b.tx * b.w * 0.4, b.y, 20);
      // The charger's lane keeps burning where it drove (at most two fires at once).
      if (arch === 'charger') { if (!state.hazards) state.hazards = []; const stop = b.x - b.tx * (b.w / 2 + 80); /* the fire ends short of the machine, so the fight at its side goes on */ state.hazards.push({ id: state.nextId++, y: Math.round(b.y), x0: Math.min(b.cx, stop), x1: Math.max(b.cx, stop), t: 0, life: FIRE_LIFE + (b.phase ? 60 : 0), half: b.phase ? 15 : 11 }); if (state.hazards.length > 2) state.hazards.shift(); } } }
  }
}

// Bomber: lobbed bombs fly over everyone and burst where the ground was marked.
function bossLob(state, b) {
  const info = bossInfo(b.bi), ph = info ? info.phases[b.phase] : null;
  const mz = (ph ? (ph.body[3] - ph.body[1]) * BOSS_SCALE : 120) * 0.45, mx = b.x + b.face * b.w * 0.55, n = BOMB_FLIGHT;
  ev(state, 'bossfire');
  for (const m of b.marks || []) {
    state.projs.push({ id: state.nextId++, kind: 'boss', row: 0, x: mx, y: b.y, z: mz, vx: (m[0] - mx) / n, vy: (m[1] - b.y) / n, vz: 0.15 * n - mz / n, dmg: 12 + state.stageIdx, t: 0, life: n + 4, lob: n, tx: m[0], ty: m[1], phase: b.phase, bi: b.bi });
  }
}
function bombBoom(state, pr) {
  fx(state, 'boom', pr.tx, pr.ty, 8); ev(state, 'boom'); shake(state, 3);
  for (const p of activePlayers(state)) {
    if (p.st !== 'ufo' && Math.abs(p.x - pr.tx) < 30 && Math.abs(p.y - pr.ty) < 14 && p.z < 30) hurtPlayer(state, p, pr.dmg, Math.sign(p.x - pr.tx) || 1, true);
  }
}
// Burning lanes left by a charger: standing in one costs a little health every 0.6 s.
function updateHazards(state) {
  if (!state.hazards || !state.hazards.length) return;
  for (const h of state.hazards) {
    h.t++;
    if (h.t % 36 !== 18) continue;
    for (const p of activePlayers(state)) {
      if (p.st !== 'ufo' && p.z < 10 && p.x > h.x0 - 6 && p.x < h.x1 + 6 && Math.abs(p.y - h.y) < h.half) hurtPlayer(state, p, 3 + Math.floor(state.stageIdx / 3), p.face, false);
    }
  }
  state.hazards = state.hazards.filter(h => h.t < h.life);
}
function bossShoot(state, b) {
  const info = bossInfo(b.bi);
  const ph = info ? info.phases[b.phase] : null;
  const bodyH = ph ? (ph.body[3] - ph.body[1]) * BOSS_SCALE : 120;
  const mz = bodyH * 0.45;
  const spd = b.phase ? 4.6 : 3.8;
  const dmg = 11 + state.stageIdx;
  ev(state, 'bossfire');
  // In the middle of the arena the same volley also leaves the machine's back.
  for (const dir of b.both ? [b.face, -b.face] : [b.face]) {
    const mx = b.x + dir * b.w * 0.55;
    if (b.missile) {
      // Homing missiles: one in phase 1, a pair in phase 2.
      for (const off of b.phase ? [-24, 24] : [0]) state.projs.push({ id: state.nextId++, kind: 'boss', row: 3, x: mx, y: clamp(b.y + off, 0, DEPTH), z: mz, vx: dir * 1.6, vy: 0, vz: 0, dmg: dmg + 8, t: 0, life: 300, enemy: true, homing: true, boom: true, phase: b.phase, bi: b.bi });
      continue;
    }
    // Shots fly straight along the lanes that were warned on the floor, low enough to jump over.
    // Standing in a warned lane gets you hit; stepping out of it or jumping does not.
    const r = b.row - 1; // projectile row 0..2 matches weapon A/B/C firing rows 1..3
    for (const y of b.warn || [b.ty]) {
      state.projs.push({ id: state.nextId++, kind: 'boss', row: r, x: mx, y, z: 16, vx: dir * spd, vy: 0, vz: 0, dmg, t: 0, life: 260, enemy: true, phase: b.phase, bi: b.bi });
    }
  }
}

// ---------------- projectiles ----------------
function updateProjs(state) {
  const ps = activePlayers(state);
  for (const pr of state.projs) {
    if (pr.remove) continue; // knocked out of the air or wiped earlier this tick
    pr.t++;
    if (pr.lob) { // a bomber's bomb: an arc to its mark, no hits on the way
      pr.x += pr.vx; pr.y += pr.vy; pr.z = Math.max(0, pr.z + pr.vz); pr.vz -= 0.3;
      if (pr.t >= pr.lob) { pr.remove = true; bombBoom(state, pr); }
      continue;
    }
    if (pr.homing && ps.length) {
      let best = ps[0], bd = 1e9;
      for (const p of ps) { const d = Math.abs(p.x - pr.x) + Math.abs(p.y - pr.y); if (d < bd) { bd = d; best = p; } }
      pr.vx += Math.sign(best.x - pr.x) * 0.03; pr.vy += Math.sign(best.y - pr.y) * 0.015;
      pr.vx = clamp(pr.vx, -1.9, 1.9); pr.vy = clamp(pr.vy, -0.7, 0.7);
      pr.z += (24 - pr.z) * 0.02;
    }
    pr.x += pr.vx; pr.y += pr.vy; pr.z += pr.vz;
    if (pr.kind === 'ball') { pr.vz -= 0.3; if (pr.z <= 0) { pr.z = 0; pr.life = 0; ballBoom(state, pr); } }
    if (pr.t > pr.life || pr.x < state.camX - 80 || pr.x > state.camX + W + 80) { pr.remove = true; continue; }
    if (pr.enemy) {
      for (const p of ps) {
        if (Math.abs(p.x - pr.x) < 14 && Math.abs(p.y - pr.y) < 9 && pr.z >= p.z - 4 && pr.z <= p.z + 54) {
          if (hurtPlayer(state, p, pr.dmg, Math.sign(pr.vx) || 1, !!pr.boom || pr.row === 2)) {
            pr.remove = true;
            if (pr.boom) { fx(state, 'boom', pr.x, pr.y, pr.z); ev(state, 'boom'); }
            break;
          }
        }
      }
      if (pr.homing && pr.t > 280) { pr.remove = true; fx(state, 'boom', pr.x, pr.y, pr.z); ev(state, 'boom'); }
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
  state.banner = { text: 'STAGE CLEAR!', sub: 'Every Sproto advances', t: 200 };
  ev(state, 'clear');
  for (const p of state.players) if (p.st === 'down') { p.hp = 40; setState(p, 'idle'); }
}

function updateCamera(state) {
  // A human who has pressed nothing for IDLE_AFTER ticks is not waited for (the CPUs already go
  // on without them), so the screen follows everyone else. With four seats, two idle humans at
  // the left edge would otherwise hold the average back and the run would never move on.
  const all = activePlayers(state), busy = all.filter(p => p.ctrl === 'cpu' || (p.idle || 0) < IDLE_AFTER);
  const ps = busy.length ? busy : all;
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
    if (!w.active && state.camX + W * 0.5 >= w.x) { lockHumans(state); w.active = true; state.lockX = state.camX; w.left = Math.round(w.count * WAVE_SCALE(state.humans)); ev(state, 'wave'); }
    if (w.active) {
      const onScreen = state.enemies.filter(e => !e.dead).length;
      if (w.left > 0 && onScreen < MAX_ON_SCREEN && state.t % 16 === 0) { spawnEnemy(state, rng(state) < 0.6 ? 1 : -1); w.left--; }
      if (w.left === 0 && onScreen === 0) {
        w.done = true; w.active = false; state.lockX = null; state.banner = { text: 'GO!', arrow: true, t: 90 };
        if (w.ufo) state.items.push({ id: state.nextId++, kind: 'ufo', x: state.camX + W - 120, y: DEPTH / 2, z: 0 });
        dropPower(state, state.camX + W / 2, 20 + rng(state) * (DEPTH - 40)); // every cleared wave leaves a power-up
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
    if (!seated(p)) continue;
    if (p.ctrl === 'cpu') root.SproAI ? root.SproAI.think(state, p) : null;
    updatePlayer(state, p);
  }
  for (const e of state.enemies) updateEnemy(state, e);
  state.enemies = state.enemies.filter(e => !e.remove);
  updateBoss(state);
  updateHazards(state);
  updateProjs(state);
  updateStrikes(state);
  if (state.shake > 0) { state.shake *= 0.85; if (state.shake < 0.3) state.shake = 0; }
  for (const f of state.fx) f.t++;
  state.fx = state.fx.filter(f => f.t < (f.kind === 'text' ? 60 : f.kind === 'boom' ? 32 : f.kind === 'ring' ? 20 : f.kind === 'nova' ? 40 : f.kind === 'bolt' ? 18 : f.kind === 'meteor' || f.kind === 'mark' ? f.small : f.kind === 'wave' || f.kind === 'thrust' ? 18 : f.kind === 'parry' ? 16 : 14));
  state.items = state.items.filter(i => !i.taken);
  if (state.mode === 'play') { updateCamera(state); updateWaves(state); }
  if (state.mode === 'clear' && ++state.clearT > 220) {
    if (state.stageIdx + 1 >= 12) { state.mode = 'victory'; state.banner = { text: 'VICTORY!', sub: 'All twelve machines are scrap', t: 99999 }; ev(state, 'victory'); }
    else startStage(state, state.stageIdx + 1);
  }
  // Game over when every Sproto on screen is down or dead (nobody is left to revive).
  // A downed human who still has a spare life uses it now instead of losing the run with it unspent.
  if (state.mode === 'play' && !state.players.some(alive)) {
    for (const p of state.players) if (p.st === 'down' && p.ctrl !== 'cpu' && p.lives > 1) die(state, p);
    if (state.mode === 'play' && !state.players.some(alive)) gameOver(state, 'Every Sproto is down');
  }
}

// A human takes seat `slot`. A seat that never had a Sproto gets a fresh one, placed as a stage start
// would place it. A Sproto whose player left comes back as it was: lives, hp and powers are kept.
function seatIn(state, slot, cfg) {
  const p = state.players[slot];
  if (!p) throw new Error('seat');
  const c = cfg || {};
  const fresh = p.fresh === true;
  if (fresh) {
    Object.assign(p, newPlayer(slot, { fid: p.fid, weapon: p.weapon, ctrl: c.ctrl, owner: c.owner, name: p.name }));
    delete p.fresh;
    p.hp = Math.max(p.hp, 60); p.dead = false; p.npcRevived = false;
  } else if (p.ctrl !== EMPTY) {
    p.ctrl = c.ctrl; p.owner = c.owner || 0;
    return p;
  }
  p.ctrl = c.ctrl; p.owner = c.owner || 0;
  const back = p.awaySt;
  delete p.awaySt;
  Object.assign(p, { x: clamp(state.camX + 60 + slot * 16, state.camX + 40, state.camX + W - 40), y: 14 + slot * 18, z: 0, vx: 0, vy: 0, vz: 0, face: 1, ufoT: 0, revive: 0 });
  // Only a new Sproto gets spawn protection. A returning one keeps the timer it left with, so
  // leaving and retaking a seat never refreshes invulnerability.
  if (fresh) p.inv = 120;
  setState(p, back === 'down' || back === 'dead' ? back : 'idle');
  return p;
}
// The human in seat `slot` leaves. Their Sproto steps out of the run with its lives, hp and powers.
function seatOut(state, slot) {
  const p = state.players[slot];
  if (!p) throw new Error('seat');
  if (!seated(p)) return p;
  releaseGrab(state, p);
  p.awaySt = p.st;
  p.ctrl = EMPTY; p.owner = 0;
  p.in = { l: 0, r: 0, u: 0, d: 0, a: 0, j: 0, s: 0, p: 0 };
  setState(p, 'out');
  return p;
}

// Compact, render-only view of the state (used for rendering and network snapshots).
const r1 = v => Math.round(v * 10) / 10;
function snapshot(state) {
  return {
    t: state.t, sk: r1(state.shake || 0), god: state.god ? 1 : 0, mode: state.mode, si: state.stageIdx, len: state.stage.len, camX: r1(state.camX), lock: state.lockX !== null ? 1 : 0,
    banner: state.banner,
    players: state.players.map(p => ({ s: p.slot, f: p.fid, w: p.weapon, c: p.ctrl, n: p.name, x: r1(p.x), y: r1(p.y), z: r1(p.z), fc: p.face, hp: p.hp, l: p.lives, sc: p.score, st: p.st, t: p.t, cb: p.launch ? 2 : Math.min(3, p.combo), kn: p.st === 'grab' && state.t - (p.kneeT || -99) < 8 ? 1 : 0, inv: p.inv, dt: p.downT, rv: p.revive, ut: p.ufoT, us: p.ufoShield, nr: p.npcRevived ? 1 : 0, pw: p.powers.slice(), k: p.kills || 0, rvn: p.revs || 0, pa: p.parries || 0, mh: maxHp(p) })),
    enemies: state.enemies.map(e => ({ id: e.id, f: e.fid, w: e.weapon, x: r1(e.x), y: r1(e.y), z: r1(e.z), fc: e.face, st: e.st, t: e.t, hp: e.hp, mh: e.maxHp, d: e.dead ? 1 : 0, el: e.elite ? (e.guard > 0 ? 2 : 1) : 0 })),
    projs: state.projs.map(p => ({ id: p.id, k: p.kind, r: p.row, ph: p.phase, bi: p.bi, x: r1(p.x), y: r1(p.y), z: r1(p.z), vx: r1(p.vx), t: p.t })),
    items: state.items.map(i => ({ id: i.id, k: i.kind, x: i.x, y: i.y, pt: i.pt })),
    fx: state.fx.map(f => ({ id: f.id, k: f.kind, x: r1(f.x), y: r1(f.y), z: r1(f.z), t: f.t, tx: f.text, sm: f.small })),
    boss: state.boss && { bi: state.boss.bi, ph: state.boss.phase, hp: state.boss.hp, mh: state.boss.maxHp, x: r1(state.boss.x), y: r1(state.boss.y), fc: state.boss.face, st: state.boss.st, t: state.boss.t, row: state.boss.row, wl: state.boss.st === 'fire' ? state.boss.warn : null, fl: state.boss.flash, mi: state.boss.missile ? 1 : 0, bo: state.boss.st === 'fire' && state.boss.both ? 1 : 0, w: Math.round(state.boss.w), ar: state.boss.arch || 0 },
    hz: (state.hazards || []).map(h => ({ id: h.id, y: h.y, x0: Math.round(h.x0), x1: Math.round(h.x1), t: h.t, l: h.life, hf: h.half })),
  };
}

// Full restart state. Sim.snapshot is render-only and cannot resume the sim.
// Packing sorts keys, replaces enemy.target with a seat ref, and stores hit sets
// as data. It does not change step(), RNG, or combat.
const STATE_KIND = 'sproto-coop-battle-state';
const STATE_VERSION = 1;
const MAX_STATE_BYTES = 262144;

function badStateKey(k) { return k === '__proto__' || k === 'constructor' || k === 'prototype'; }
function cmpPacked(a, b) {
  const as = (typeof a === 'number' ? '0' : '1') + String(a);
  const bs = (typeof b === 'number' ? '0' : '1') + String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}
function packValue(v, seen) {
  if (v === null) return null;
  const ty = typeof v;
  if (ty === 'number') {
    if (!Number.isFinite(v)) throw new Error('nan');
    return Object.is(v, -0) ? 0 : v;
  }
  if (ty === 'string' || ty === 'boolean') return v;
  if (ty !== 'object') throw new Error('type');
  if (seen.has(v)) throw new Error('cycle');
  if (typeof Set !== 'undefined' && v instanceof Set) {
    seen.add(v);
    const arr = [];
    v.forEach(item => arr.push(packValue(item, seen)));
    arr.sort(cmpPacked);
    return { $set: arr };
  }
  if (Array.isArray(v)) {
    seen.add(v);
    return v.map(item => packValue(item, seen));
  }
  seen.add(v);
  const out = {};
  const keys = Object.keys(v).sort();
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (badStateKey(k)) throw new Error('key');
    const child = v[k];
    if (child === undefined) continue;
    if (k === 'target' && child && typeof child === 'object') {
      if (!Number.isInteger(child.slot)) throw new Error('target');
      out.target = { $ref: 'player', slot: child.slot };
      continue;
    }
    out[k] = packValue(child, seen);
  }
  return out;
}
function assertPacked(v, seen) {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('nan');
    return;
  }
  if (typeof Set !== 'undefined' && v instanceof Set) throw new Error('unpacked');
  if (seen.has(v)) throw new Error('cycle');
  seen.add(v);
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) assertPacked(v[i], seen);
    return;
  }
  const keys = Object.keys(v);
  for (let i = 0; i < keys.length; i++) {
    if (badStateKey(keys[i])) throw new Error('key');
    assertPacked(v[keys[i]], seen);
  }
}
function revivePacked(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(revivePacked);
  const keys = Object.keys(v);
  if (keys.length === 1 && Object.prototype.hasOwnProperty.call(v, '$set')) {
    if (!Array.isArray(v.$set)) throw new Error('set');
    return new Set(v.$set.map(revivePacked));
  }
  if (v.$ref === 'player' && keys.length === 2) {
    if (!Number.isInteger(v.slot) || v.slot < 0 || v.slot >= SLOTS) throw new Error('target');
    return { $ref: 'player', slot: v.slot };
  }
  const out = {};
  for (let i = 0; i < keys.length; i++) {
    if (badStateKey(keys[i])) throw new Error('key');
    out[keys[i]] = revivePacked(v[keys[i]]);
  }
  return out;
}
function linkPackedPlayers(state) {
  const players = state.players || [];
  const enemies = state.enemies || [];
  for (let i = 0; i < enemies.length; i++) {
    const target = enemies[i].target;
    if (target && target.$ref === 'player') {
      const p = players[target.slot];
      if (!p || p.slot !== target.slot) throw new Error('target');
      enemies[i].target = p;
    }
  }
}
function exportState(state) {
  const packed = { kind: STATE_KIND, version: STATE_VERSION, state: packValue(state, new Set()) };
  const text = JSON.stringify(packed);
  if (text.length > MAX_STATE_BYTES) throw new Error('oversized');
  return JSON.parse(text);
}
function importState(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('schema');
  if (data.kind !== STATE_KIND || data.version !== STATE_VERSION) throw new Error('version');
  if (!data.state || typeof data.state !== 'object') throw new Error('schema');
  assertPacked(data, new Set());
  const text = JSON.stringify(data);
  if (text.length > MAX_STATE_BYTES) throw new Error('oversized');
  const state = revivePacked(JSON.parse(text).state);
  if (!state || !Array.isArray(state.players) || state.players.length !== SLOTS) throw new Error('seats');
  for (let i = 0; i < SLOTS; i++) {
    if (!state.players[i] || state.players[i].slot !== i || state.players[i].id !== 'p' + i) throw new Error('seat');
    if (!Array.isArray(state.players[i].powers)) throw new Error('powers');
  }
  if (!state.stage || !Array.isArray(state.enemies) || !Array.isArray(state.items) || !Array.isArray(state.projs)) throw new Error('schema');
  linkPackedPlayers(state);
  return state;
}

const Sim = { W, H, DEPTH, FLOOR_TOP, SLOTS, EMPTY, seatIn, seatOut, SLOT_COLORS, WEAPONS, ENEMY_WEAPONS, MAX_HP, BOSS_SCALE, UFO_TICKS, DOWN_TICKS, REVIVE_TICKS, PARRY_WINDOW, SPIN_TAP, PARRY_LOCK, ATTACK_BUFFER, SWEEP_WARN, SWEEP_REACH, MID_ROOM, WAVE_SCALE, GRUNT_HP_SCALE, BOSS_HP_SCALE, humansOf, rescaleHumans, IDLE_AFTER, PASSIVES, BOSS_ARCHETYPES, GUARD_HITS, GUARD_REGEN, BOMB_FLIGHT, maxHp, STATE_KIND, STATE_VERSION, MAX_STATE_BYTES, create, step, snapshot, exportState, importState, toggleGod, startStage, stageLength, alive, rng, clamp };
root.Sim = Sim;
if (typeof module !== 'undefined') module.exports = Sim;
})(typeof window !== 'undefined' ? window : globalThis);
