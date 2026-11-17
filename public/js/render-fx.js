// In-game drawing loaded at the lobby or first stage. The title keeps its own
// fighter and stage previews. Combat sheets are authored by tools/build-combat-sprites.py.
(function (root) {
'use strict';
const S = root.Sim, R = root.Render, M = root.MANIFEST;
const { W, H, FLOOR_TOP } = S;
const BS = S.BOSS_SCALE, img = R.img, ready = R.ready, text = R.text;
const { frameCanvas, canFilter, drawFighter, drawBackground, weapon } = R;
const fxImg = k => img('assets/fx/' + k + '.png');

// Actor rows: walk, lane/lob, spread, homing, charge, sweep, transform keys, summon.
// Projectile rows: lane/lob, spread, homing, impact. The art faces screen-left.
const BOSS_CELL = 220, BOSS_FX_CELL = 96, BOSS_FOOT = 206;
const BOSS_WALK = [0, 1, 2, 1];
const BOSS_SPRITE_SIZE = Math.round(BS * 256);
const BOSS_SPRITE_FOOT = Math.round(BOSS_FOOT * BOSS_SPRITE_SIZE / BOSS_CELL);

// Grip-centered equipment, right-facing shots and centered effects share this grid.
// See tools/build-combat-sprites.py for the source art.
const CELL = 64;
const CLASS_ROWS = {
  mage: { staff: 0, wand: 24, rod: 25, scepter: 26 },
  healer: { staff: 1, rod: 27, scepter: 28 },
  ranged: { bow: 2, crossbow: 29 },
};
const WEAPON_ROWS = { bow: 3, scimitar: 4, mace: 5, rapier: 30, greatsword: 31, cudgel: 32, halberd: 33, 'twin-blades': 34 };
const SHOT_ROWS = { 'mage-bolt': 6, 'healer-bolt': 7, arrow: 8, 'arcane-orb': 9, 'power-arrow': 10, enemyArrow: 11, knife: 12 };
const HIT_ROWS = { 'class-heal': 13, 'mage-hit': 14, 'healer-hit': 15, 'arrow-hit': 16, enemyShotHit: 17, spark: 18 };
const ROLE_COLORS = { mage: '#e0b0ff', healer: '#81f0b1', ranged: '#83dfff' };
const CAST_POSES = {
  wand: { body: [25, 14, 12, 13], degrees: [-50, -70, -6, -36] },
  staff: { body: [25, 15, 26, 13], degrees: [-58, -116, -4, -42] },
  rod: { body: [25, 27, 12, 25], degrees: [-54, -84, -3, -62] },
  scepter: { body: [25, 15, 30, 27], degrees: [-62, -128, -8, -48] },
};
const TRAIL_ROWS = {
  katana: 19, scimitar: 19, 'twin-blades': 19, hammer: 20, mace: 20, cudgel: 20,
  spear: 21, rapier: 21, pike: 21, axe: 22, greatsword: 22, halberd: 22,
  bo: 23, flail: 23, club: 20, knife: 19,
};
const Tints = root.AssetLoader.lru(30);

// Preserve the legacy melee art that the title preview does not draw.
const stageWeapons = {};
function makeStageWeapon(id) {
  if (stageWeapons[id]) return stageWeapons[id];
  if (!['axe', 'flail', 'club', 'knife', 'pike'].includes(id)) return null;
  const c = document.createElement('canvas'), g = c.getContext('2d');
  const px = (ctx, x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
  const ol = '#14121c';
  let gx = 6, gy = 4;
  switch (id) {
    case 'axe': c.width = 40; c.height = 22;
      px(g, 0, 9, 30, 4, ol); px(g, 1, 10, 28, 2, '#8a5a32');
      px(g, 24, 1, 14, 20, ol); px(g, 25, 2, 12, 18, '#aab4c8'); px(g, 34, 2, 3, 18, '#eef4ff'); px(g, 25, 9, 4, 4, '#4a4a58'); gx = 5; gy = 11; break;
    case 'flail': c.width = 46; c.height = 16;
      px(g, 0, 6, 14, 4, ol); px(g, 1, 7, 12, 2, '#7a4a2a');
      for (let i = 0; i < 5; i++) { px(g, 14 + i * 4, 7, 3, 2, '#9aa2b4'); }
      g.fillStyle = ol; g.beginPath(); g.arc(38, 8, 8, 0, 7); g.fill(); g.fillStyle = '#7a8296'; g.beginPath(); g.arc(38, 8, 6, 0, 7); g.fill();
      px(g, 30, 7, 2, 2, '#c8d0e0'); px(g, 37, 0, 2, 2, '#c8d0e0'); px(g, 37, 14, 2, 2, '#c8d0e0'); px(g, 44, 7, 2, 2, '#c8d0e0'); gx = 4; gy = 8; break;
    case 'club': c.width = 30; c.height = 10;
      px(g, 0, 3, 30, 5, ol); px(g, 1, 4, 10, 3, '#6a4a2a'); px(g, 11, 2, 18, 7, ol); px(g, 12, 3, 16, 5, '#8a5a32'); px(g, 18, 3, 2, 2, '#c8c8c8'); px(g, 24, 6, 2, 2, '#c8c8c8'); gx = 4; gy = 5; break;
    case 'knife': c.width = 18; c.height = 6;
      px(g, 0, 2, 6, 3, ol); px(g, 1, 3, 4, 1, '#3a2a2a'); px(g, 6, 1, 11, 4, ol); px(g, 6, 2, 10, 2, '#dfe6f2'); gx = 3; gy = 3; break;
    case 'pike': c.width = 58; c.height = 9;
      px(g, 0, 3, 46, 3, ol); px(g, 1, 4, 44, 1, '#5a4a3a'); px(g, 46, 1, 11, 7, ol); px(g, 47, 2, 9, 5, '#9aa2b4'); gx = 18; break;
  }
  return stageWeapons[id] = { c, gx, gy };
}

function combatCell(g, row, frame, x, y, size, tint) {
  const sheet = fxImg('combat');
  if (!ready(sheet)) return false;
  const srcX = (frame + (row % 2) * 4) * CELL, srcY = Math.floor(row / 2) * CELL;
  const dx = Math.round(x - size / 2), dy = Math.round(y - size / 2);
  if (!tint) {
    g.drawImage(sheet, srcX, srcY, CELL, CELL, dx, dy, size, size);
    return true;
  }
  const key = [row, frame, tint].join('|');
  let cell = Tints.get(key);
  if (!cell) {
    cell = document.createElement('canvas');
    cell.width = cell.height = CELL;
    const ctx = cell.getContext('2d');
    ctx.drawImage(sheet, srcX, srcY, CELL, CELL, 0, 0, CELL, CELL);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, CELL, CELL);
    Tints.set(key, cell);
  }
  g.drawImage(cell, dx, dy, size, size);
  return true;
}

// A firing pose includes anticipation, aim, release and recovery. Release keys off the
// exact simulation tick so changing a weapon's windup keeps sound and sprites aligned.
function shotFrame(t, windup, duration) {
  if (t < windup) return t * 2 < windup ? 0 : 1;
  return t < windup + Math.min(6, (duration - windup) / 2) ? 2 : 3;
}

function combatPose(o, id, weapon) {
  const classId = o.cl || (weapon && weapon.classId);
  if (o.st === 'cast' || o.st === 'shoot' || o.st === 'heal') {
    const timing = S.classMoveTiming(classId, o.w, Boolean(o.ab));
    const phase = shotFrame(o.t, timing.windup, timing.duration);
    if (o.st === 'heal') {
      const rod = weapon?.gear === 'rod';
      return { pose: (rod ? [25, 27, 31, 25] : [25, 15, 31, 27])[phase], ang: [-74, -96, -55, -80][phase], phase };
    }
    if (o.st === 'shoot') {
      const crossbow = weapon && weapon.gear === 'crossbow';
      return { pose: (crossbow ? [25, 27, 13, 25] : [14, 25, 11, 13])[phase], ang: [-28, -6, -4, 10][phase], phase };
    }
    const cast = CAST_POSES[weapon?.gear] || CAST_POSES.staff;
    return { pose: cast.body[phase], ang: cast.degrees[phase], phase };
  }
  if (o.st === 'ranged' && weapon && weapon.ranged) {
    const { startup, recovery } = weapon.ranged;
    const phase = shotFrame(o.t, startup, startup + recovery);
    const angle = Math.atan2(o.ay - o.y, Math.abs(o.ax - o.x)) * 180 / Math.PI;
    const aim = Math.max(-28, Math.min(28, angle || 0));
    if (id === 'bow') return { pose: [14, 25, 11, 13][phase], ang: [-28, aim, aim, 14][phase], phase };
    return { pose: [14, 15, 12, 13][phase], ang: [-48, -105, aim, 35][phase], phase };
  }
  if (o.st !== 'attack' || !weapon) return null;
  const t = o.t, a = weapon.startup, b = a + weapon.active;
  const phase = t <= a ? 0 : t <= b ? 1 : 2;
  const k = phase === 0 ? t / a : phase === 1 ? (t - a) / weapon.active : Math.min(1, (t - b) / weapon.recovery);
  const swing = phase === 1;
  const trailFrame = Math.min(3, Math.max(0, Math.ceil(k * 4) - 1));
  const action = (body, angle) => ({ pose: body[phase], ang: angle[phase], phase: swing ? 2 : phase, swoosh: swing, trailFrame });
  if (id === 'scimitar' || id === 'twin-blades') {
    const rising = (o.cb || 1) % 2 === 0;
    return rising ? action([14, 15, 25], [48, 65 - 175 * k, -102 + 55 * k])
      : action([25, 12, 13], [-95, -105 + 140 * k, 35 - 60 * k]);
  }
  if (id === 'hammer' || id === 'mace' || id === 'cudgel') {
    return action([15, 12, 10], [-90 - 45 * k, -140 + 204 * k, 64 - 52 * k]);
  }
  if (id === 'spear' || id === 'rapier' || id === 'pike') {
    return action([14, 12, 13], [-12 - 18 * k, -4 + 8 * k, 8 - 40 * k]);
  }
  if (id === 'axe' || id === 'greatsword' || id === 'halberd') {
    return action([29, 30, 13], [-62 - 103 * k, -165 + 195 * k, 30 - 70 * k]);
  }
  if (id === 'bo' || id === 'flail') {
    const backswing = (o.cb || 1) % 2 === 0;
    return backswing ? action([29, 30, 13], [75, 80 - 193 * k, -113 + 50 * k])
      : action([11, 12, 13], [-70 - 69 * k, -139 + 200 * k, 61 - 65 * k]);
  }
  return null;
}

const HEAVY_GEAR = new Set(['hammer', 'mace', 'cudgel', 'axe', 'greatsword', 'halberd']);

function authoredPose(o, id, weapon, base) {
  const clips = o.cl && M.fighters[o.f]?.clips;
  if (!clips) return base;
  let clip;
  let frame;
  const t = o.t;
  switch (o.st) {
    case 'heal': case 'cast':
      clip = 'cast'; frame = base.phase; break;
    case 'shoot':
      clip = clips.ranged ? 'ranged' : 'cast'; frame = base.phase; break;
    case 'hit':
      clip = 'recoil'; frame = Math.floor(t / 4); break;
    case 'dash':
      clip = 'dash'; frame = Math.floor(t / 5); break;
    case 'jump':
      clip = 'jump'; frame = t < 2 ? 0 : t < 6 ? 1 : o.z > 24 && t < 18 ? 2 : 3; break;
    case 'jumpatk':
      clip = 'airKick'; frame = Math.floor(t / 4); break;
    case 'special':
      clip = 'special'; frame = Math.floor(t / 9); break;
    case 'attack':
      if (!weapon || !HEAVY_GEAR.has(id)) return base;
      clip = 'heavy';
      if (t <= weapon.startup) frame = t * 2 <= weapon.startup ? 0 : 1;
      else if (t <= weapon.startup + weapon.active) frame = (t - weapon.startup) * 2 <= weapon.active ? 2 : 3;
      else frame = 4;
      break;
    default: return base;
  }
  const range = clips[clip];
  return range ? { ...base, pose: range[0] + Math.min(frame, range[1] - 1), fallback: base.pose } : base;
}

function pose(o, id, weapon) {
  return authoredPose(o, id, weapon, combatPose(o, id, weapon) || fighterPose(o, weapon));
}

function gear(g, o, id, P, hand, scale, weapon) {
  // The thrown knife leaves the Shadow's hand on the release frame.
  if (id === 'knife' && o.st === 'ranged' && P.phase >= 2) return true;
  const classId = o.cl || (weapon && weapon.classId);
  const variants = CLASS_ROWS[classId];
  const throwing = id === 'knife' && o.st === 'ranged';
  const row = throwing ? 35 : variants ? variants[weapon && weapon.gear] : WEAPON_ROWS[id];
  if (row === undefined) return false;
  g.save();
  g.translate(hand[0] - 3, hand[1]);
  const bowAtRest = (classId === 'ranged' || id === 'bow') && (o.st === 'idle' || o.st === 'walk');
  g.rotate((bowAtRest ? -15 : P.ang) * Math.PI / 180);
  const drawn = combatCell(g, row, P.phase || 0, 0, 0, CELL / scale, weapon && weapon.tint);
  g.restore();
  return drawn;
}

function shadowFrame(e, weapon) {
  switch (e.st) {
    case 'walk': return 1 + (Math.floor(e.t / 6) % 4);
    case 'attack': return e.t <= weapon.startup ? 5 : e.t <= weapon.startup + weapon.active ? 6 : 7;
    case 'ranged': {
      const { startup, echo = 0 } = weapon.ranged;
      if (e.t < startup) return 8;
      if (e.t < startup + 6) return 9;
      if (e.t < startup + echo) return 8;
      return e.t < startup + echo + 6 ? 9 : 10;
    }
    case 'hit': case 'grabbed': case 'knock': return 11;
    case 'lying': case 'dead': return 12;
    default: return 0;
  }
}

function drawShadow(g, sheet, e, weapon, sx, sy, alpha) {
  if (!Number.isInteger(e.sh) || !ready(sheet)) return false;
  const col = shadowFrame(e, weapon);
  g.save();
  g.globalAlpha = alpha;
  g.translate(Math.round(sx), Math.round(sy));
  g.scale(e.fc * 1.6, 1.6);
  g.drawImage(sheet, col * CELL, e.sh * CELL, CELL, CELL, -32, -56, CELL, CELL);
  g.restore();
  return true;
}

function trail(g, id, P, hand) {
  const row = TRAIL_ROWS[id];
  if (row === undefined) return false;
  g.save();
  g.translate(hand[0], hand[1]);
  let drawn;
  if (row === 20 && P.trailFrame !== undefined) {
    drawn = combatCell(g, row, P.trailFrame, 22, 16, 64);
  } else {
    g.rotate((P.ang - 18) * Math.PI / 180);
    const weapon = R.weapon(id);
    const len = weapon.c.width - weapon.gx;
    const size = WEAPON_ROWS[id] !== undefined ? 60 : Math.min(102, Math.max(54, len * 2.08));
    drawn = combatCell(g, row, P.trailFrame ?? 1, 0, 0, size);
  }
  g.restore();
  return drawn;
}

function projectile(g, p, sx, sy, shadowSheet) {
  const imported = p.k === 'enemyBolt' || p.k === 'enemyTwin';
  const row = imported ? SHOT_ROWS.enemyArrow : SHOT_ROWS[p.k];
  if (row === undefined) return false;
  // Screen y changes with belt depth; vx/vy are actual velocity on that plane.
  const spin = p.k === 'knife' ? p.t * 0.55 * Math.sign(p.vx) : 0;
  g.save(); g.translate(Math.round(sx), Math.round(sy)); g.rotate(Math.atan2(p.vy || 0, p.vx) + spin);
  let drawn;
  if (imported && Number.isInteger(p.sh) && ready(shadowSheet)) {
    const echo = p.k === 'enemyTwin';
    const size = (echo ? 59 : 53) + (Math.floor(p.t / 3) % 2) * 3;
    // Warm motion ticks distinguish hostile shots even when the source art is dark.
    g.fillStyle = '#4d2042'; g.fillRect(-17, -2, 10, 4);
    g.fillStyle = echo ? '#fff1bb' : '#ffd395';
    g.fillRect(-16, -1, 7, 2);
    if (echo) g.fillRect(-14, 3, 5, 1);
    g.drawImage(shadowSheet, 13 * CELL, p.sh * CELL, CELL, CELL, -size / 2, -size / 2, size, size);
    drawn = true;
  } else {
    const weapon = S.WEAPONS[p.w];
    const size = p.k === 'arcane-orb' ? 49 : weapon?.gear === 'crossbow' ? 34 : 41;
    drawn = combatCell(g, row, Math.floor(p.t / 3) % 4, 0, 0, size, weapon?.tint);
  }
  g.restore();
  return drawn;
}

// Flickering amber warning light standing at (x, y).
function warnLight(g, x, y, t, k) {
  const im = fxImg('lights'); if (!ready(im)) return;
  const f = (t >> 2) % 4, h = 30 * (k || 1), w = h * 19 / 56;
  g.save(); g.globalAlpha = Math.floor(t / 4) % 2 ? 1 : 0.62;
  g.drawImage(im, f * 19, 0, 19, 56, Math.round(x - w / 2), Math.round(y - h), w, h);
  g.restore();
}
// Impact burst frame f (0..3), row 0 orange, 1 violet.
function burstFrame(g, row, f, x, y, size, alpha) {
  const im = fxImg('burst'); if (!ready(im)) return false;
  g.save(); g.globalAlpha = alpha; g.drawImage(im, f * 48, row * 48, 48, 48, Math.round(x - size / 2), Math.round(y - size / 2), size, size); g.restore();
  return true;
}
// Rear sweep: cracks glow, then crystal spikes ripple up and collapse (depth-sorted).
function sweepSpikes(g, bw, camX, list, lx, lw) {
  const im = fxImg('spikes'); if (!ready(im)) return false;
  const warn = S.SWEEP_WARN, rear = -bw.fc, x0 = bw.x - camX;
  for (let row = 0; row < 4; row++) {
    const ly = 12 + row * 32, gy = FLOOR_TOP + ly;
    for (let col = 0; ; col++) {
      const x = x0 + rear * ((bw.w || 150) * 0.3 + 14 + col * 30 + (row % 2) * 15);
      if (x < lx - 10 || x > lx + lw + 10) { if (col > 12) break; if ((x - x0) * rear > lw + 40) break; continue; }
      if (bw.t < warn) {
        const f = Math.min(2, Math.floor(bw.t / warn * 3));
        g.drawImage(im, f * 42, 63, 42, 8, Math.round(x - 21), gy - 6, 42, 8);
        continue;
      }
      const e = bw.t - warn - Math.floor(col * 0.7) - (row % 2); // spikes ripple outward
      if (e < 0) continue;
      list.push({ y: ly - 0.2, d: () => {
        if (e < 12) {
          const h = Math.round(56 * Math.min(1, (e + 1) / 4)), w = 37;
          g.drawImage(im, 0, 63 - Math.round(h * 63 / 56), 42, Math.round(h * 63 / 56), Math.round(x - w / 2), gy - h + 2, w, h);
        } else if (e < 20) {
          const f = Math.floor((e - 12) / 2);
          g.drawImage(im, f * 42, 71, 42, 16, Math.round(x - 19), gy - 14, 38, 14);
        }
      } });
    }
  }
  return true;
}

// Warning lights on the machine during charge/sweep wind-ups and missile volleys.
function windup(g, b, sx, sy, ph) {
  if (!((b.st === 'charge' && b.t < (b.ar === 1 ? 36 : 24)) || (b.st === 'sweep' && b.t < S.SWEEP_WARN) || (b.st === 'fire' && b.mi && b.t < 30))) return;
  const top = sy - (ph.body[3] - ph.body[1]) * BS * 0.55, half = (b.w || 150) * 0.32;
  warnLight(g, sx - half, top, b.t, 0.8); warnLight(g, sx + half, top, b.t + 4, 0.8);
}

function drawFx(g, f, camX) {
  const sx = f.x - camX, sy = FLOOR_TOP + f.y - f.z;
  if (f.k === 'bossSpecialImpact') {
    const ph = M.bosses[f.bi].phases[f.ph], color = S.bossExtraAttack(f.bi, 'special').color;
    const size = f.sm, age = f.t / 36, alpha = Math.max(0, 1 - age);
    const radius = size * (0.18 + age * 0.74);
    g.save();
    g.globalAlpha = alpha * 0.8;
    g.strokeStyle = color; g.lineWidth = 4 - age * 3;
    g.beginPath(); g.ellipse(sx, sy + 9, radius, radius * 0.35, 0, 0, 7); g.stroke();
    g.globalAlpha = alpha * 0.55;
    g.strokeStyle = color; g.lineWidth = 1.5;
    g.beginPath(); g.ellipse(sx, sy + 9, radius * 0.85, radius * 0.3, 0, 0, 7); g.stroke();
    g.fillStyle = color;
    for (let i = 0; i < 10; i++) {
      const angle = i * 0.628 + (f.id % 19) * 0.21;
      const dx = Math.cos(angle) * radius, dy = Math.sin(angle) * radius * 0.55;
      g.fillRect(Math.round(sx + dx), Math.round(sy + dy - 35 * age), i % 2 ? 4 : 2, 2);
    }
    g.globalAlpha = alpha;
    drawBossFx(g, ph, 3, Math.min(3, Math.floor(f.t / 8)), sx, sy, size + 25, false);
    g.restore();
    return;
  }
  if (f.k === 'bossHit') {
    const color = S.bossExtraAttack(f.bi, 'special').color;
    const r = 6 + f.t * 1.6;
    g.save();
    g.globalAlpha = Math.max(0, 1 - f.t / 14);
    g.fillStyle = color;
    for (let i = 0; i < 5; i++) {
      const angle = i * Math.PI * 0.4 + f.id;
      g.fillRect(Math.round(sx + Math.cos(angle) * r), Math.round(sy + Math.sin(angle) * r), 5, 3);
    }
    g.restore();
    return;
  }
  if (f.k === 'bossImpact') {
    const ph = M.bosses[f.bi]?.phases[f.ph];
    if (ph && drawBossFx(g, ph, 3, Math.min(3, Math.floor(f.t / 6)), sx, sy, f.sm || 82, false)) return;
    f = { ...f, k: 'boom' };
  }
  if (HIT_ROWS[f.k] !== undefined) {
    const heal = f.k === 'class-heal', frameTicks = heal ? 6 : 3;
    const frame = Math.min(3, Math.floor(f.t / frameTicks));
    const life = heal ? 30 : 15;
    g.save(); g.globalAlpha = Math.max(0, Math.min(1, (life - f.t) / 5));
    const drawn = combatCell(g, HIT_ROWS[f.k], frame, sx, sy - (heal ? 6 : 0), heal ? 62 : 44);
    g.restore();
    if (drawn) return;
  }
  if (f.k === 'spark') {
    g.strokeStyle = f.t < 4 ? '#fff' : '#ffd23d'; g.lineWidth = 2;
    const r = 4 + f.t * 1.4;
    for (let i = 0; i < 6; i++) { const a = i * 1.047 + f.id; g.beginPath(); g.moveTo(sx + Math.cos(a) * r * .4, sy + Math.sin(a) * r * .4); g.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r); g.stroke(); }
  } else if (f.k === 'boom' && fxImg('burst') && ready(fxImg('burst'))) {
    const size = f.sm ? 34 : 60, fr = Math.min(3, Math.floor(f.t / 5));
    if (f.t < 6) { g.fillStyle = `rgba(255,190,80,${0.5 * (1 - f.t / 6)})`; g.beginPath(); g.arc(sx, sy, size * 0.45, 0, 7); g.fill(); }
    burstFrame(g, 0, fr, sx, sy, size * (fr === 2 ? 1.15 : 1), fr < 3 ? 1 : Math.max(0, 1 - (f.t - 15) / 17));
  } else if (f.k === 'boom') {
    const r = (f.sm ? 10 : 20) * Math.min(1, f.t / 8) + f.t * 0.4;
    g.globalAlpha = Math.max(0, 1 - f.t / 32);
    g.fillStyle = '#ff6a1a'; g.beginPath(); g.arc(sx, sy, r, 0, 7); g.fill();
    g.fillStyle = '#ffd23d'; g.beginPath(); g.arc(sx, sy, r * 0.65, 0, 7); g.fill();
    g.fillStyle = '#ffad3d'; g.beginPath(); g.arc(sx, sy, r * 0.3 * Math.max(0, 1 - f.t / 12), 0, 7); g.fill();
    g.globalAlpha = 1;
  } else if (f.k === 'ring') {
    g.strokeStyle = `rgba(255,255,255,${1 - f.t / 20})`; g.lineWidth = 3; g.beginPath(); g.ellipse(sx, sy, 10 + f.t * 4, 4 + f.t * 1.3, 0, 0, 7); g.stroke();
  } else if (f.k === 'text') {
    g.globalAlpha = Math.max(0, 1 - f.t / 60); text(g, f.tx, sx, sy - f.t * 0.6, 8, '#fff', 'center'); g.globalAlpha = 1;
  } else if (f.k === 'parry') {
    const a = Math.max(0, 1 - f.t / 16);
    g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = 3; g.beginPath(); g.arc(sx, sy, 8 + f.t * 2, 0, 7); g.stroke();
    g.fillStyle = `rgba(140,220,255,${a * .6})`; g.beginPath(); g.arc(sx, sy, 6, 0, 7); g.fill();
  } else if (f.k === 'wave' || f.k === 'thrust') {
    const a = Math.max(0, 1 - f.t / 18), d = f.sm || 1, len = f.k === 'wave' ? 170 : 150;
    g.fillStyle = f.k === 'wave' ? `rgba(255,190,90,${a * .55})` : `rgba(220,240,255,${a * .6})`;
    const x0 = sx, x1 = sx + d * len * Math.min(1, f.t / 6);
    g.fillRect(Math.min(x0, x1), sy - (f.k === 'wave' ? 6 : 3), Math.abs(x1 - x0), f.k === 'wave' ? 12 : 6);
  } else if (f.k === 'nova') {
    const r = 20 + f.t * 8, a = Math.max(0, 1 - f.t / 40);
    g.strokeStyle = `rgba(255,170,60,${a})`; g.lineWidth = 6; g.beginPath(); g.ellipse(sx, sy, r, r * .35, 0, 0, 7); g.stroke();
    g.strokeStyle = `rgba(255,255,200,${a})`; g.lineWidth = 2; g.beginPath(); g.ellipse(sx, sy, r * .8, r * .28, 0, 0, 7); g.stroke();
    if (f.t < 8) { g.fillStyle = `rgba(255,240,200,${0.35 * (1 - f.t / 8)})`; g.fillRect(0, 0, W, H); }
    const im = fxImg('burst');
    if (ready(im) && f.t < 24) { g.save(); g.translate(sx, sy); g.scale(1, 0.4); burstFrame(g, 1, Math.min(3, 1 + Math.floor(f.t / 8)), 0, 0, 60 + f.t * 6, 1 - f.t / 24); g.restore(); }
  } else if (f.k === 'bolt') {
    const a = Math.max(0, 1 - f.t / 18);
    g.strokeStyle = `rgba(160,235,255,${a})`; g.lineWidth = 3; g.beginPath();
    let bx = sx, by = 40; g.moveTo(bx, by);
    for (let k = 1; k <= 6; k++) { by = 40 + (sy - 30 - 40) * k / 6; bx = sx + (k < 6 ? ((f.id * 37 + k * 53) % 21) - 10 : 0); g.lineTo(bx, by); }
    g.stroke(); g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = 1; g.stroke();
    g.fillStyle = `rgba(160,235,255,${a * .5})`; g.beginPath(); g.ellipse(sx, sy, 16, 5, 0, 0, 7); g.fill();
  } else if (f.k === 'meteor') {
    const left = f.sm - f.t; // ticks until impact
    if (left > 0) {
      const k = Math.min(1, left / 40), mx = sx + k * 120, my = sy - 20 - k * 260;
      g.fillStyle = 'rgba(255,60,40,.25)'; g.beginPath(); g.ellipse(sx, FLOOR_TOP + f.y, Math.max(2, 14 * (1 - k * .5)), 5, 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(255,170,60,.7)'; g.lineWidth = 4; g.beginPath(); g.moveTo(mx + 20, my - 40); g.lineTo(mx, my); g.stroke();
      g.fillStyle = '#5a3a2a'; g.beginPath(); g.arc(mx, my, 7, 0, 7); g.fill(); g.fillStyle = '#ff8a3d'; g.beginPath(); g.arc(mx - 2, my - 2, 3, 0, 7); g.fill();
    }
  } else if (f.k === 'mark') {
    // Where a bomber's bomb will land: a red ring that closes in until impact.
    const k = Math.min(1, f.t / (f.sm || 1)), gy = FLOOR_TOP + f.y;
    // Searchlight narrowing as the bomb falls.
    const beam = g.createLinearGradient(0, 0, 0, gy);
    beam.addColorStop(0, 'rgba(255,90,60,0)'); beam.addColorStop(0.35, 'rgba(255,170,110,.08)'); beam.addColorStop(1, `rgba(255,130,90,${0.3 + 0.3 * k})`);
    g.fillStyle = beam; g.beginPath(); g.moveTo(sx - 6, 0); g.lineTo(sx + 6, 0); g.lineTo(sx + 30 - 12 * k, gy); g.lineTo(sx - 30 + 12 * k, gy); g.fill();
    warnLight(g, sx + 34, gy + 2, f.t, 0.7);
    g.fillStyle = `rgba(255,40,40,${0.25 + 0.3 * k})`; g.beginPath(); g.ellipse(sx, gy, 30, 14, 0, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,236,170,.95)'; g.lineWidth = 1; g.beginPath(); g.ellipse(sx, gy, 30, 14, 0, 0, 7); g.stroke();
    g.strokeStyle = '#ffb24f'; g.lineWidth = 2; g.beginPath(); g.ellipse(sx, gy, 30 * (1 - k) + 3, 14 * (1 - k) + 2, 0, 0, 7); g.stroke();
  } else if (f.k === 'shield') {
    g.strokeStyle = `rgba(120,255,140,${1 - f.t / 14})`; g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, 30, 0, 7); g.stroke();
  }
}

function bossExtraWarnings(g, boss, camX) {
  const attack = S.bossExtraAttack(boss.bi, boss.st);
  const color = attack.color || '#ffad68';
  g.save();
  for (const [x, depth, wide, deep, delay, rounded] of boss.az) {
    const until = attack.warning + delay - boss.t;
    if (until <= 0) continue;
    const cx = x - camX, y = FLOOR_TOP + depth;
    g.globalAlpha = 0.32 + 0.26 * (1 - Math.min(1, until / attack.warning));
    g.fillStyle = '#b42346'; g.strokeStyle = color; g.lineWidth = 2;
    g.beginPath();
    if (rounded) g.ellipse(cx, y, wide, deep, 0, 0, 7);
    else g.rect(cx - wide, y - deep, wide * 2, deep * 2);
    g.fill(); g.globalAlpha = 0.95; g.stroke();
    const scale = Math.min(1, until / attack.warning);
    g.globalAlpha = 0.8; g.lineWidth = 1; g.beginPath();
    if (rounded) g.ellipse(cx, y, wide * scale, deep * scale, 0, 0, 7);
    else g.rect(cx - wide * scale, y - deep * scale, wide * scale * 2, deep * scale * 2);
    g.stroke();
  }
  if (boss.t < attack.warning) {
    g.globalAlpha = 1;
    const special = boss.st === 'special';
    text(g, attack.name.toUpperCase(), W / 2, FLOOR_TOP - 15, special ? 10 : 8, color, 'center');
  }
  g.restore();
}

function floor(g, snap, camX, list) {
  // Lock the warning line to the host's actual aim path, with dash marks and a target cap.
  for (const e of snap.enemies) {
    const shot = S.ENEMY_WEAPONS[e.w]?.ranged;
    const end = shot && shot.startup + (shot.echo || 0);
    if (e.st !== 'ranged' || !shot || e.t >= end || e.ax === undefined) continue;
    const x = e.x + e.fc * 16 - camX, y = FLOOR_TOP + e.y;
    const ax = e.ax - camX, ay = FLOOR_TOP + e.ay;
    const k = e.t < shot.startup ? e.t / shot.startup : (e.t - shot.startup) / shot.echo;
    g.save();
    g.strokeStyle = `rgba(156,33,58,${0.5 + 0.32 * k})`;
    g.lineWidth = 11;
    g.beginPath(); g.moveTo(x, y); g.lineTo(ax, ay); g.stroke();
    g.strokeStyle = shot.echo ? '#fff1bb' : '#ffd395'; g.lineWidth = 1.5; g.setLineDash(shot.echo ? [8, 3, 2, 3] : [6, 4]);
    g.beginPath(); g.moveTo(x, y); g.lineTo(ax, ay); g.stroke();
    g.setLineDash([]);
    g.beginPath(); g.arc(ax, ay, 4, 0, 7); g.stroke();
    g.restore();
  }
  // Burning lanes left by a charger: they flicker, and fade as they burn out.
  for (const h of snap.hz || []) {
    const a = Math.min(1, (h.l - h.t) / 40), x = h.x0 - camX, w = h.x1 - h.x0, y = FLOOR_TOP + h.y;
    g.fillStyle = `rgba(255,90,20,${0.45 * a})`; g.fillRect(x, y - h.hf, w, h.hf * 2);
    g.fillStyle = `rgba(255,236,170,${0.8 * a})`; g.fillRect(x, y - h.hf - 1, w, 1); g.fillRect(x, y + h.hf, w, 1);
    const flame = fxImg('flame');
    if (ready(flame)) {
      const fh = Math.round(h.hf * 2.1), fw = Math.round(fh * 26 / 46);
      g.save(); g.globalAlpha = a;
      for (let fxn = x + ((h.id * 7) % 12) + fw / 2, k = 0; fxn < x + w; fxn += fw * 0.62, k++) {
        const f = (Math.floor(snap.t / 5) + k * 3 + h.id) % 4, dy = (k % 2) * 3 - 1;
        g.drawImage(flame, f * 26, 0, 26, 46, Math.round(fxn - fw / 2), y + h.hf * 0.5 + dy - fh, fw, fh);
      }
      g.restore();
    }
  }
  // Boss lane warnings: a red stripe along each lane about to be shot.
  const bw = snap.boss;
  if (bw?.az) bossExtraWarnings(g, bw, camX);
  if (bw && bw.wl && bw.st === 'fire' && bw.t < 30) {
    const k = bw.t / 30, x0 = bw.x - camX;
    // bo: a mid-arena boss fires both ways.
    const dirs = bw.bo ? [bw.fc, -bw.fc] : [bw.fc];
    for (const ly of bw.wl) {
      const y = FLOOR_TOP + ly;
      for (const d of dirs) {
        // Starts at 40% and is edged in a light colour so it reads on dark and light floors alike.
        const lx = d < 0 ? 0 : x0, lw = d < 0 ? x0 : W - x0;
        g.fillStyle = `rgba(255,40,40,${0.4 + 0.2 * k + (Math.floor(bw.t / 4) % 2 ? 0.12 : 0)})`;
        g.fillRect(lx, y - 6, lw, 12);
        g.fillStyle = `rgba(255,236,170,${0.75 + 0.25 * k})`;
        g.fillRect(lx, y - 7, lw, 1); g.fillRect(lx, y + 6, lw, 1);
        warnLight(g, x0 + d * ((bw.w || 150) * 0.55 + 8), y + 4, bw.t);
        warnLight(g, d < 0 ? 10 : W - 10, y + 4, bw.t + 2);
      }
    }
    if (Math.floor(bw.t / 6) % 2) for (const d of dirs) text(g, bw.bo ? 'BOTH SIDES!' : 'MOVE!', x0 + d * 90, FLOOR_TOP - 10, 8, '#ff6a6a', 'center');
  }
  // Rear sweep: the ground behind the boss is marked before it is hit (jump it, or get in front).
  if (bw && bw.st === 'sweep') {
    const rear = -bw.fc, reach = (bw.w || 150) / 2 + S.SWEEP_REACH, x0 = bw.x - camX, x1 = x0 + rear * reach;
    const lx = Math.max(0, Math.min(x0, x1)), lw = Math.min(W, Math.max(x0, x1)) - lx, warn = bw.t < S.SWEEP_WARN;
    const spikes = sweepSpikes(g, bw, camX, list, lx, lw);
    if (warn || bw.t < S.SWEEP_WARN + 8) {
      const k = bw.t / S.SWEEP_WARN;
      g.fillStyle = warn ? `rgba(${spikes ? '220,60,255' : '255,150,30'},${(spikes ? 0.16 : 0.3) + 0.3 * k + (Math.floor(bw.t / 4) % 2 ? 0.1 : 0)})` : 'rgba(239,157,72,.7)';
      g.fillRect(lx, FLOOR_TOP, lw, S.DEPTH);
      g.strokeStyle = 'rgba(255,236,170,.95)'; g.lineWidth = 1; g.strokeRect(lx + 0.5, FLOOR_TOP + 0.5, lw - 1, S.DEPTH - 1);
      if (warn && Math.floor(bw.t / 6) % 2) text(g, 'BEHIND! JUMP!', lx + lw / 2, FLOOR_TOP - 10, 8, '#ffb23d', 'center');
    }
  }
}

const THEMES = [
  { sky: ['#6ec6ff', '#d8f2ff'], far: ['waves', '#2f6fae'], mid: ['cranes', '#24476e'], floor: ['#8a5a32', '#6e4426', 'planks'] },
  { sky: ['#1a0b2e', '#4a1a5e'], far: ['buildings', '#2a1640'], mid: ['neon', '#ff4fd8'], floor: ['#2a2238', '#3a2f4e', 'checker'] },
  { sky: ['#5a4a32', '#9a845a'], far: ['hills', '#4a3a26'], mid: ['trench', '#3a2c1c'], floor: ['#5a4428', '#4a3820', 'mud'] },
  { sky: ['#ff8a3a', '#ffd27a'], far: ['hills', '#b05a2a'], mid: ['fence', '#5a2e1a'], floor: ['#a8743a', '#8a6230', 'dirt'] },
  { sky: ['#0a0a2a', '#2a1a5a'], far: ['buildings', '#1a1a40'], mid: ['neon', '#22e3e9'], floor: ['#2a2a34', '#34343e', 'road'] },
  { sky: ['#03140a', '#0a3a1e'], far: ['circuit', '#1a6a3a'], mid: ['pillars', '#0e2a18'], floor: ['#2a3a32', '#34463c', 'grid'] },
  { sky: ['#0a0e2a', '#3a3a6a'], far: ['moon', '#e8e8d0'], mid: ['castle', '#1e2036'], floor: ['#4a4a5a', '#3c3c4a', 'bricks'] },
  { sky: ['#3a1a08', '#7a4a10'], far: ['pillars', '#a8842a'], mid: ['banners', '#a8202a'], floor: ['#7a1a20', '#d8b04a', 'carpet'] },
  { sky: ['#3a0e2a', '#8a2a5a'], far: ['eggs', '#d87ab0'], mid: ['pipes', '#4a1a3a'], floor: ['#c8b8c8', '#a898a8', 'tiles'] },
  { sky: ['#02020a', '#10103a'], far: ['stars', '#ffffff'], mid: ['planets', '#6a5cff'], floor: ['#4a4252', '#3a3442', 'rock'] },
  { sky: ['#2a1a4a', '#ff7a5a'], far: ['buildings', '#3a2a5a'], mid: ['vents', '#2a2236'], floor: ['#5a5a62', '#4c4c54', 'gravel'] },
  { sky: ['#020c0a', '#0a2a24'], far: ['shaft', '#1a4a40'], mid: ['circuit', '#3affc8'], floor: ['#2a3432', '#3a4644', 'grid'] },
];
const bgCache = {};
function seeded(n) { let s = n * 9301 + 49297; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); }
function layer(type, color, h, seed) {
  const c = document.createElement('canvas'); c.width = 640; c.height = h; const g = c.getContext('2d'); const r = seeded(seed);
  g.fillStyle = color; g.strokeStyle = color;
  const base = h;
  switch (type) {
    case 'waves': g.fillRect(0, base - 60, 640, 60); g.fillStyle = 'rgba(255,255,255,.35)'; for (let x = 0; x < 640; x += 24) g.fillRect(x + (x / 24 % 2) * 8, base - 56 + (x % 3) * 12, 12, 2); break;
    case 'cranes': for (let x = 20; x < 640; x += 160) { g.fillRect(x, base - 120, 8, 120); g.fillRect(x - 30, base - 120, 110, 6); g.fillRect(x + 60, base - 114, 2, 40); g.fillRect(x + 54, base - 76, 14, 10); } g.fillRect(0, base - 18, 640, 18); break;
    case 'buildings': for (let x = 0; x < 640;) { const w = 40 + r() * 50, bh = 60 + r() * 110; g.fillStyle = color; g.fillRect(x, base - bh, w - 4, bh); g.fillStyle = 'rgba(255,230,140,.35)'; for (let wy = base - bh + 8; wy < base - 8; wy += 12) for (let wx = x + 5; wx < x + w - 10; wx += 9) if (r() < .45) g.fillRect(wx, wy, 4, 6); x += w; } break;
    case 'neon': for (let x = 30; x < 640; x += 120 + r() * 60) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(x - 4, base - 92, 76, 36); g.strokeStyle = color; g.lineWidth = 3; g.strokeRect(x, base - 88, 68, 28); g.fillStyle = color; g.fillRect(x + 8, base - 78, 52, 8); } g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(0, base - 30, 640, 30); break;
    case 'hills': g.beginPath(); g.moveTo(0, base); for (let x = 0; x <= 640; x += 32) g.lineTo(x, base - 40 - Math.sin(x / 90 + seed) * 25 - r() * 10); g.lineTo(640, base); g.fill(); break;
    case 'trench': for (let x = 0; x < 640; x += 64) { g.fillRect(x, base - 70 - r() * 20, 60, 100); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x + 4, base - 50, 52, 4); g.fillStyle = color; } break;
    case 'fence': for (let x = 0; x < 640; x += 28) g.fillRect(x, base - 46, 6, 46); g.fillRect(0, base - 40, 640, 5); g.fillRect(0, base - 22, 640, 5); g.fillRect(380, base - 120, 120, 90); g.beginPath(); g.moveTo(370, base - 120); g.lineTo(440, base - 160); g.lineTo(510, base - 120); g.fill(); break;
    case 'circuit': g.lineWidth = 2; for (let i = 0; i < 26; i++) { let x = r() * 640, y = r() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { if (k % 2) y += (r() - .5) * 60; else x += (r() - .5) * 120; g.lineTo(x, y); } g.stroke(); g.fillRect(x - 3, y - 3, 6, 6); } break;
    case 'pillars': for (let x = 20; x < 640; x += 110) { g.fillRect(x, 0, 30, base); g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x + 4, 0, 5, base); g.fillStyle = color; g.fillRect(x - 6, base - 14, 42, 14); } break;
    case 'moon': g.beginPath(); g.arc(470, 60, 34, 0, 7); g.fill(); g.fillStyle = 'rgba(0,0,0,.08)'; g.beginPath(); g.arc(460, 52, 8, 0, 7); g.arc(484, 72, 6, 0, 7); g.fill(); g.fillStyle = '#fff'; for (let i = 0; i < 50; i++) g.fillRect(r() * 640, r() * h * .7, 1, 1); break;
    case 'castle': g.fillRect(0, base - 70, 640, 70); for (let x = 0; x < 640; x += 20) g.fillRect(x, base - 82, 12, 12); for (let x = 60; x < 640; x += 200) { g.fillRect(x, base - 140, 50, 140); for (let k = 0; k < 4; k++) g.fillRect(x + k * 14, base - 152, 8, 12); g.fillStyle = '#ffd27a'; g.fillRect(x + 20, base - 116, 8, 14); g.fillStyle = color; } break;
    case 'banners': for (let x = 70; x < 640; x += 110) { g.fillRect(x, 10, 26, 80); g.beginPath(); g.moveTo(x, 90); g.lineTo(x + 13, 104); g.lineTo(x + 26, 90); g.fill(); g.fillStyle = '#d8b04a'; g.fillRect(x + 9, 30, 8, 8); g.fillStyle = color; } break;
    case 'eggs': for (let i = 0; i < 14; i++) { const x = r() * 640, y = base - 20 - r() * 100, s = 10 + r() * 16; g.globalAlpha = .5 + r() * .5; g.beginPath(); g.ellipse(x, y, s * .75, s, 0, 0, 7); g.fill(); } g.globalAlpha = 1; break;
    case 'pipes': for (let x = 0; x < 640; x += 90) { g.fillRect(x, 0, 14, base); g.fillRect(x, base - 40 - r() * 60, 90, 10); } break;
    case 'stars': for (let i = 0; i < 140; i++) { g.globalAlpha = r(); g.fillRect(r() * 640, r() * h, r() < .1 ? 2 : 1, r() < .1 ? 2 : 1); } g.globalAlpha = 1; break;
    case 'planets': g.beginPath(); g.arc(150, 70, 40, 0, 7); g.fill(); g.fillStyle = '#ff7ab0'; g.beginPath(); g.arc(520, 40, 16, 0, 7); g.fill(); g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 3; g.beginPath(); g.ellipse(150, 70, 66, 12, -0.3, 0, 7); g.stroke(); break;
    case 'vents': g.fillRect(0, base - 30, 640, 30); for (let x = 20; x < 640; x += 140) { g.fillRect(x, base - 64, 46, 34); g.fillStyle = 'rgba(255,255,255,.12)'; for (let k = 0; k < 4; k++) g.fillRect(x + 4, base - 58 + k * 7, 38, 3); g.fillStyle = color; g.fillRect(x + 90, base - 110, 4, 80); } break;
    case 'shaft': for (let x = 0; x < 640; x += 40) { g.fillRect(x, 0, 3, h); } for (let y = 10; y < h; y += 34) g.fillRect(0, y, 640, 2); break;
  }
  return c;
}
function floorTile(a, b, pat) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 140; const g = c.getContext('2d');
  g.fillStyle = a; g.fillRect(0, 0, 64, 140);
  g.fillStyle = b;
  switch (pat) {
    case 'planks': for (let y = 0; y < 140; y += 14) { g.fillRect(0, y, 64, 2); g.fillRect((y * 7) % 64, y, 2, 14); } break;
    case 'checker': for (let y = 0; y < 140; y += 20) for (let x = 0; x < 64; x += 32) g.fillRect(x + ((y / 20) % 2) * 16, y, 16, 20); break;
    case 'mud': for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse((i * 23) % 64, (i * 37) % 140, 10, 3, 0, 0, 7); g.fill(); } break;
    case 'dirt': for (let i = 0; i < 40; i++) g.fillRect((i * 29) % 64, (i * 53) % 140, 2, 2); break;
    case 'road': g.fillRect(0, 66, 30, 4); g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(0, 0, 64, 6); break;
    case 'grid': for (let y = 0; y < 140; y += 20) g.fillRect(0, y, 64, 1); g.fillRect(0, 0, 1, 140); g.fillRect(32, 0, 1, 140); break;
    case 'bricks': for (let y = 0; y < 140; y += 12) { g.fillRect(0, y, 64, 2); g.fillRect(((y / 12) % 2) * 16, y, 2, 12); g.fillRect(((y / 12) % 2) * 16 + 32, y, 2, 12); } break;
    case 'carpet': g.fillRect(0, 30, 64, 4); g.fillRect(0, 106, 64, 4); g.fillStyle = 'rgba(0,0,0,.15)'; for (let x = 0; x < 64; x += 8) g.fillRect(x, 34, 4, 72); break;
    case 'tiles': for (let y = 0; y < 140; y += 16) g.fillRect(0, y, 64, 1); for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 1, 140); break;
    case 'rock': for (let i = 0; i < 12; i++) { g.beginPath(); g.arc((i * 19) % 64, (i * 41) % 140, 2 + (i % 4), 0, 7); g.fill(); } break;
    case 'gravel': for (let i = 0; i < 70; i++) g.fillRect((i * 13) % 64, (i * 31) % 140, 1, 1); g.fillRect(0, 0, 64, 3); break;
  }
  return c;
}
function background(si) {
  if (bgCache[si]) return bgCache[si];
  const th = THEMES[si % THEMES.length];
  return bgCache[si] = { th, far: layer(th.far[0], th.far[1], FLOOR_TOP, si * 3 + 1), mid: layer(th.mid[0], th.mid[1], FLOOR_TOP, si * 3 + 2), floor: floorTile(...th.floor) };
}
function drawFallbackBackground(g, si, camX) {
  const bg = background(si); // drawn fallback while the stage art loads
  const grd = g.createLinearGradient(0, 0, 0, FLOOR_TOP);
  grd.addColorStop(0, bg.th.sky[0]); grd.addColorStop(1, bg.th.sky[1]);
  g.fillStyle = grd; g.fillRect(0, 0, W, FLOOR_TOP);
  const par = (c, f) => { const o = -Math.floor((camX * f) % 640); g.drawImage(c, o, 0); g.drawImage(c, o + 640, 0); };
  par(bg.far, 0.2); par(bg.mid, 0.5);
  const o = -Math.floor(camX % 64);
  for (let x = o; x < W; x += 64) g.drawImage(bg.floor, x, FLOOR_TOP - 8);
  g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, FLOOR_TOP - 8, W, 4);
}

// Pose + weapon angle for a fighter in a given state. Angles in degrees, 0 = forward, negative = up.
function fighterPose(o, wpn) {
  const t = o.t;
  switch (o.st) {
    case 'walk': return { pose: 'w0' + (Math.floor(t / 5) % 8), ang: -48 + Math.sin(t / 5) * 6, hand: 2 };
    case 'jump': return { pose: o.z > 30 && t < 14 ? 8 : 9, ang: -70 };
    case 'jumpatk': return { pose: 23, ang: Math.min(70, -60 + t * 18), swoosh: t < 10 };
    case 'land': return { pose: 10, ang: -20 };
    case 'dash': return { pose: 6, ang: -25 };
    case 'dashatk': return { pose: 12, ang: t < 9 ? -120 + t * 17 : 30, swoosh: t >= 2 && t <= 9 };
    case 'block': return { pose: 25, ang: -95 };
    case 'grab': return o.kn ? { pose: 16, ang: 70 } : { pose: 27, ang: 70 };
    case 'throw': return { pose: 28, ang: 20 };
    case 'slam': return { pose: 23, ang: 85, swoosh: true };
    case 'hit': return { pose: 24, ang: -10 };
    case 'knock': case 'lying': case 'down': case 'dead': return { pose: 24, ang: 0, lying: o.st !== 'knock' || o.z < 4, tilt: o.st === 'knock' };
    case 'special': return { pose: 31, ang: t * 32, swoosh: true };
    case 'attack': {
      const w = wpn || { startup: 6, active: 4, recovery: 8 };
      const cb = o.cb || 1;
      const a1 = w.startup, a2 = w.startup + w.active;
      const k = t <= a1 ? t / a1 : t <= a2 ? (t - a1) / w.active : 1;
      const phase = t <= a1 ? 0 : t <= a2 ? 1 : 2;
      if (cb === 2) return { pose: phase === 0 ? 14 : 15, ang: phase === 0 ? 40 + 20 * k : phase === 1 ? 60 - 170 * k : -110, swoosh: phase === 1 };
      if (cb === 3) return { pose: phase === 0 ? 29 : 30, ang: phase === 0 ? -60 - 110 * k : phase === 1 ? -170 + 225 * k : 55, swoosh: phase === 1 };
      return { pose: phase === 0 ? 11 : phase === 1 ? 12 : 13, ang: phase === 0 ? -50 - 80 * k : phase === 1 ? -130 + 150 * k : 20, swoosh: phase === 1 };
    }
    default: return { pose: Math.floor(t / 30) % 2, ang: -52 + Math.sin(t / 12) * 3 };
  }
}

function shadow(g, sx, sy, w) { g.fillStyle = 'rgba(0,0,0,.32)'; g.beginPath(); g.ellipse(sx, sy, w, w * 0.3, 0, 0, 7); g.fill(); }
function variantOf(snap, p) { let v = 0; for (const o of snap.players) if (o.s < p.s && o.f === p.f) v++; return v; }

function drawHead(g, fid, variant, x, y, size) {
  const f = M.fighters[fid], src = frameCanvas(fid, 0, variant);
  if (!src || (!ready(src) && !src.getContext)) return;
  g.drawImage(src, f.foot[0] - 18, f.box[1] - 3, 36, 30, x, y, size, size * 30 / 36);
}

function drawUfo(g, p, sx, sy) {
  const rear = img('assets/ufo/cockpit-rear.png'), front = img('assets/ufo/cockpit-front.png');
  if (!ready(rear) || !ready(front)) return;
  const sc = 0.62, face = p.fc || 1;
  g.save(); g.translate(Math.round(sx), Math.round(sy)); g.scale(face * sc, sc); g.translate(-94, -51);
  g.drawImage(rear, 0, 0);
  const f = M.fighters[p.f], src = frameCanvas(p.f, 0, 0);
  const [sx0, sy0, sw, sh] = [f.foot[0] - 18, f.box[1] - 3, 40, 32];
  const scale = Math.min(53 / sw, 43 / sh) * 1.05, w = sw * scale, h = sh * scale;
  if (src && (ready(src) || src.getContext)) g.drawImage(src, sx0, sy0, sw, sh, 100 - w / 2, 55 - h, w, h);
  g.drawImage(front, 0, 0);
  g.restore();
  if (p.inv > 0 && p.inv % 8 < 5) { const sh = img('assets/ufo/shield' + (1 + (Math.floor(p.t / 4) % 4)) + '.png'); if (ready(sh)) g.drawImage(sh, sx - sh.width * 0.35, sy - sh.height * 0.35, sh.width * 0.7, sh.height * 0.7); }
}

// Power-up icons: Sproto Storm (ring), Meteor Rain (meteor), Chain Lightning (bolt).
const POWER_COLORS = ['#ff9a3d', '#ff5a5a', '#5ad8ff'];
function powerIcon(g, pt, x, y, r) {
  const c = POWER_COLORS[pt] || '#fff';
  g.fillStyle = '#14121c'; g.beginPath(); g.arc(x, y, r + 1.5, 0, 7); g.fill();
  g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.arc(x - r * .3, y - r * .3, r * .35, 0, 7); g.fill();
  g.strokeStyle = '#14121c'; g.fillStyle = '#14121c'; g.lineWidth = Math.max(1, r / 4);
  if (pt === 0) { g.beginPath(); g.arc(x, y, r * .5, 0, 7); g.stroke(); g.beginPath(); g.arc(x, y, r * .15, 0, 7); g.fill(); }
  else if (pt === 1) { g.beginPath(); g.arc(x + r * .2, y + r * .2, r * .35, 0, 7); g.fill(); g.beginPath(); g.moveTo(x - r * .6, y - r * .6); g.lineTo(x + r * .05, y + r * .05); g.stroke(); }
  else { g.beginPath(); g.moveTo(x + r * .15, y - r * .7); g.lineTo(x - r * .35, y + r * .1); g.lineTo(x + r * .05, y + r * .1); g.lineTo(x - r * .15, y + r * .7); g.lineTo(x + r * .4, y - r * .15); g.lineTo(x, y - r * .15); g.closePath(); g.fill(); }
}
function drawItem(g, it, camX, t) {
  const sx = it.x - camX, sy = FLOOR_TOP + it.y;
  if (it.k === 'crate') {
    shadow(g, sx, sy, 14);
    g.fillStyle = '#14121c'; g.fillRect(sx - 13, sy - 24, 26, 24);
    g.fillStyle = '#b07a3a'; g.fillRect(sx - 12, sy - 23, 24, 22);
    g.fillStyle = '#8a5a2a'; g.fillRect(sx - 12, sy - 13, 24, 2); g.fillRect(sx - 1, sy - 23, 2, 22);
    g.fillStyle = '#d89a52'; g.fillRect(sx - 12, sy - 23, 24, 2);
  } else if (it.k === 'snack') {
    const bob = Math.sin(t / 8) * 2; shadow(g, sx, sy, 8);
    g.fillStyle = '#14121c'; g.fillRect(sx - 7, sy - 18 + bob, 14, 16);
    g.fillStyle = '#e83a3a'; g.fillRect(sx - 6, sy - 17 + bob, 12, 14);
    g.fillStyle = '#fff'; g.fillRect(sx - 6, sy - 12 + bob, 12, 4); g.fillStyle = '#c8d0e0'; g.fillRect(sx - 5, sy - 19 + bob, 10, 2);
  } else if (it.k === 'power') {
    const bob = Math.sin(t / 7 + it.id) * 3; shadow(g, sx, sy, 8);
    g.fillStyle = `rgba(255,255,255,${0.15 + 0.1 * Math.sin(t / 5)})`; g.beginPath(); g.arc(sx, sy - 16 + bob, 13, 0, 7); g.fill();
    powerIcon(g, it.pt, sx, sy - 16 + bob, 8);
  } else if (it.k === 'gem') {
    const bob = Math.sin(t / 8) * 2; shadow(g, sx, sy, 6);
    g.fillStyle = '#3affc8'; g.beginPath(); g.moveTo(sx, sy - 20 + bob); g.lineTo(sx + 7, sy - 12 + bob); g.lineTo(sx, sy - 4 + bob); g.lineTo(sx - 7, sy - 12 + bob); g.fill();
    g.fillStyle = '#fff'; g.fillRect(sx - 2, sy - 16 + bob, 2, 3);
  } else if (it.k === 'ufo') {
    // Empty saucer (cockpit layers only, no pilot) as the pickup icon.
    const rear = img('assets/ufo/cockpit-rear.png'), front = img('assets/ufo/cockpit-front.png'); const bob = Math.sin(t / 10) * 4;
    shadow(g, sx, sy, 22);
    g.fillStyle = `rgba(120,255,140,${0.18 + 0.1 * Math.sin(t / 6)})`; g.beginPath(); g.moveTo(sx - 10, sy - 40 + bob); g.lineTo(sx + 10, sy - 40 + bob); g.lineTo(sx + 24, sy); g.lineTo(sx - 24, sy); g.fill();
    if (ready(rear) && ready(front)) { g.drawImage(rear, sx - 47, sy - 70 + bob, 94, 51); g.drawImage(front, sx - 47, sy - 70 + bob, 94, 51); }
  }
}

function drawHud(g, snap) {
  const pw = W / S.SLOTS;
  snap.players.forEach((p, i) => {
    if (p.c === 'none') return; // an empty seat has no Sproto and no panel
    const x = i * pw + 2, y = 2, col = S.SLOT_COLORS[p.s];
    g.fillStyle = 'rgba(8,6,16,.95)'; g.fillRect(x, y, pw - 4, 38);
    g.fillStyle = col; g.fillRect(x, y, pw - 4, 2);
    drawHead(g, p.f, variantOf(snap, p), x + 2, y + 5, 22);
    text(g, 'P' + (p.s + 1), x + 26, y + 9, 8, col);
    text(g, p.c === 'cpu' ? 'CPU' : p.c === 'away' ? 'AWAY' : p.c === 'remote' ? 'NET' : '', x + 50, y + 9, 7, '#c8c6e0');
    text(g, p.n, x + 26, y + 19, 8, '#fff', 'left', pw - 35);
    if (p.st === 'dead') {
      text(g, 'DEAD', x + 26, y + 30, 7, '#ff4d4d');
    } else {
      g.fillStyle = '#300'; g.fillRect(x + 26, y + 25, pw - 34, 5);
      g.fillStyle = p.hp > 30 ? '#4dff7a' : '#ff4d4d'; g.fillRect(x + 26, y + 25, (pw - 34) * Math.min(1, p.hp / (p.mh || S.MAX_HP)), 5);
      if (p.c !== 'cpu') text(g, p.l > 1 ? '♥♥' : '♥', x + 3, y + 32, 6, '#ff5a7a');
      (p.pw || []).forEach((pt, k) => powerIcon(g, pt, x + 76 + k * 9, y + 34, 3.5));
      text(g, String(p.sc).padStart(6, '0'), x + 26, y + 34, 6, '#e8e6f8');
      if (p.st === 'down') text(g, 'DOWN ' + Math.ceil(p.dt / 60) + 'S', x + pw - 9, y + 9, 7, '#ff7777', 'right');
      else if (p.st === 'ufo') text(g, 'UFO ' + Math.ceil(p.ut / 60), x + pw - 9, y + 9, 7, '#7aff8a', 'right');
      else if (ROLE_COLORS[p.cl]) {
        const label = p.cl === 'mage' ? 'ORB' : p.cl === 'healer' ? 'MEND' : 'SHOT';
        const status = p.ac ? `${Math.ceil(p.ac / 60)}S` : 'READY';
        text(g, `${label} ${status}`, x + pw - 9, y + 9, 7, ROLE_COLORS[p.cl], 'right');
      }
    }
  });
  if (snap.god) text(g, 'GOD MODE · 2x ATTACK · UNLIMITED HP', W / 2, 58, 7, '#8ef8d6', 'center');
  const b = snap.boss;
  if (b) {
    g.fillStyle = 'rgba(8,6,16,.8)'; g.fillRect(120, H - 22, 400, 18);
    const label = b.st === 'transform' ? 'TRANSFORMING' : M.bosses[b.bi].machines[b.ph].toUpperCase();
    text(g, label, 126, H - 13, 7, '#ff8a8a', 'left', 168);
    g.fillStyle = '#300'; g.fillRect(300, H - 17, 214, 8);
    g.fillStyle = b.ph ? '#ff4d4d' : '#ffa23d'; g.fillRect(300, H - 17, 214 * Math.max(0, b.hp) / b.mh, 8);
    if (b.st === 'transform') {
      const progress = S.clamp(b.t / S.BOSS_TRANSFORM_TICKS, 0, 1);
      g.fillStyle = S.bossExtraAttack(b.bi, 'special').color;
      g.fillRect(300, H - 7, Math.round(214 * progress), 2);
    }
  }
}

// End-of-run panel. sum comes from Progress.summarize; info carries the reason, the best run and
// which seats are played here. Counters a snapshot does not carry are shown as dashes.
function drawSummary(g, sum, info) {
  const x = 70, y = 50, w = 500, h = 272, num = v => (v === undefined || v === null ? '-' : String(v));
  g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(10,8,22,.95)'; g.fillRect(x, y, w, h);
  g.fillStyle = sum.victory ? '#7aff8a' : '#ff5a5a'; g.fillRect(x, y, w, 3);
  text(g, sum.victory ? 'VICTORY!' : 'GAME OVER', W / 2, y + 24, 18, sum.victory ? '#7aff8a' : '#ff5a5a', 'center');
  if (info.why) text(g, info.why, W / 2, y + 44, 6, '#c8c6e0', 'center');
  text(g, 'STAGE ' + sum.stage + ' OF 12    TIME ' + root.Progress.clock(sum.ticks) + '    TEAM SCORE ' + sum.score, W / 2, y + 62, 7, '#ffd23d', 'center');
  const cols = [[x + 330, 'SCORE'], [x + 384, 'KOS'], [x + 438, 'REVIVES'], [x + 488, 'PARRIES']];
  for (const c of cols) text(g, c[1], c[0], y + 82, 6, '#c8c6e0', 'right');
  sum.rows.forEach((r, i) => {
    const ry = y + 98 + i * 15, col = S.SLOT_COLORS[r.slot], here = (info.local || []).indexOf(r.slot) >= 0;
    if (here) { g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(x + 8, ry - 7, w - 16, 14); }
    text(g, 'P' + (r.slot + 1), x + 14, ry, 7, col);
    text(g, r.name, x + 44, ry, 8, '#fff', 'left', 128);
    text(g, r.cpu ? 'CPU' : here ? 'YOU' : '', x + 185, ry, 7, r.cpu ? '#c8c6e0' : '#7aff8a');
    [r.score, r.kills, r.revives, r.parries].forEach((v, k) => text(g, num(v), cols[k][0], ry, 7, '#e8e6f8', 'right'));
  });
  const b = info.best;
  const line = info.god ? 'GOD MODE RUNS ARE NOT RECORDED' : info.newBest ? 'NEW BEST RUN!' : b ? 'BEST RUN: ' + (b.victory ? 'VICTORY' : 'STAGE ' + b.stage) + '  ·  SCORE ' + b.score + '  ·  ' + root.Progress.clock(b.ticks) : '';
  if (line) text(g, line, W / 2, y + 204, 7, info.newBest && !info.god ? '#7aff8a' : '#c8c6e0', 'center');
  if (info.prompt && info.blink) text(g, info.prompt, W / 2, y + 244, 8, '#fff', 'center');
}

function bossPose(b, sx) {
  const t = b.t;
  if (b.st === 'signature' || b.st === 'special') {
    const attack = S.bossExtraAttack(b.bi, b.st);
    const end = attack.warning + attack.zones[attack.zones.length - 1][4] + 6;
    const col = t < Math.ceil(attack.warning / 2) ? 0 : t < attack.warning ? 1 : t < end ? 2 : 3;
    return [b.ph, b.st === 'signature' ? 6 : b.ar === 2 ? 8 : 7, col];
  }
  if (b.st === 'fire') {
    const row = b.mi ? 3 : b.row === 2 ? 2 : 1;
    const multishot = row === 1 && b.ar !== 2 && b.ar !== 3;
    const active = multishot ? (b.ph ? 3 : 2) : 1;
    const age = t - 30;
    const firing = age % 8 < 4 && Math.floor(age / 8) < active;
    return [b.ph, row, age < 0 ? 0 : firing ? 1 : 2];
  }
  if (b.st === 'charge') {
    const remaining = b.fc < 0 ? sx - 60 : W - 60 - sx;
    return [b.ph, 4, t < (b.ar === 1 ? 36 : 24) ? 0 : remaining < 34 ? 2 : 1];
  }
  if (b.st === 'sweep') return [b.ph, 5, t < S.SWEEP_WARN ? 0 : t < S.SWEEP_WARN + 6 ? 1 : 2];
  if (b.st === 'idle' && b.ar === 2 && b.su !== undefined) return [b.ph, 7, b.su < 12 ? 1 : 2];
  return [b.ph, 0, b.st === 'dead' ? 0 : BOSS_WALK[Math.floor(t / 9) % BOSS_WALK.length]];
}

const ease = x => x * x * (3 - 2 * x);

function transformPulse(t, at, duration) {
  if (t < at || t >= at + duration) return 0;
  return Math.sin(Math.PI * (t - at) / duration);
}

function drawTransformDischarge(g, b, sx, sy, width, color, keys) {
  const finish = keys?.at(-1) ?? 442;
  const release = b.t >= finish;
  const groundPulse = release ? finish : (keys?.[1] ?? 96) - 20;
  const glow = transformPulse(b.t, groundPulse, 26);
  if (glow > 0) {
    const age = (b.t - groundPulse) / 26;
    const radius = Math.round(width * (0.2 + 0.55 * ease(age)));
    g.save();
    g.strokeStyle = color;
    g.globalAlpha = glow * 0.48;
    g.lineWidth = release ? 3 : 2;
    g.beginPath();
    g.ellipse(sx, sy, radius, Math.max(1, Math.round(radius * 0.22)), 0, 0, 2 * Math.PI);
    g.stroke();
    g.restore();
  }

  // Short jets from the changing joint, in the machine's accent color.
  // The planted actor stays drawn at the same ground origin throughout.
  if (!keys) return;
  const joint = keys.findIndex((tick, key) => key >= 2 && key <= 4 && b.t >= tick - 10 && b.t < tick + 14);
  if (joint < 0) return;
  const age = (b.t - keys[joint] + 10) / 24;
  const hinge = root.CoopBossMorphGuides?.[b.bi]?.[joint]?.[1] || [60, 134];
  const scale = BOSS_SPRITE_SIZE / BOSS_CELL;
  const x = sx + (hinge[0] - BOSS_CELL / 2) * -b.fc * scale;
  const y = sy + (hinge[1] - BOSS_FOOT) * scale;
  g.save();
  g.fillStyle = color;
  g.globalAlpha = Math.sin(Math.PI * age) * 0.7;
  for (let i = 0; i < 4; i++) {
    g.fillRect(Math.round(x + b.fc * age * (12 + 9 * i)),
      Math.round(y + (i - 1.5) * age * 18), 5, 2);
  }
  g.restore();
}

function drawBossCel(g, b, sx, sy, sprite, row, col) {
  const C = BOSS_CELL, size = BOSS_SPRITE_SIZE;
  g.save();
  g.imageSmoothingEnabled = false;
  if (b.st === 'dead') g.globalAlpha = b.t % 6 < 3 ? 0.5 : 1;
  g.translate(Math.round(sx), Math.round(sy));
  if (b.fc > 0) g.scale(-1, 1);
  if (b.fl > 0 && canFilter()) g.filter = 'brightness(0.92) sepia(0.4) saturate(1.3)';
  g.drawImage(sprite, col * C, row * C, C, C, -Math.round(size / 2), -BOSS_SPRITE_FOOT, size, size);
  g.restore();
}

function drawBossTransform(g, b, sx, sy) {
  const boss = M.bosses[b.bi], phases = boss.phases;
  const authored = root.CoopBossTransformPlayer?.shared();
  if (authored?.clipFor(boss.key)) {
    shadow(g, sx, sy, (phases[1].body[2] - phases[1].body[0]) * BS * 0.45);
    if (!authored.draw(g, boss.key, b.t, sx, sy, b.fc, BOSS_SPRITE_SIZE)) {
      const sheet = img(phases[0].sheet);
      if (ready(sheet)) drawBossCel(g, b, sx, sy, sheet, 0, 0);
    }
    return;
  }
  const morph = root.CoopBossMorph;
  const frame = morph?.pose(b.t);
  const [phase, row, col] = frame ? morph.poses[frame.key] : [b.t < 258 ? 0 : 1, 0, 0];
  const sheet = img(phases[phase].sheet);
  if (!ready(sheet)) return;
  const folded = morph?.generate(b.bi, frame, phases.map(p => img(p.sheet)));
  const first = morph?.keyTicks[0] ?? 28, last = morph?.keyTicks.at(-1) ?? 442;
  const p = ease(S.clamp((b.t - first) / (last - first), 0, 1));
  const width = (phases[0].body[2] - phases[0].body[0]) * (1 - p) +
    (phases[1].body[2] - phases[1].body[0]) * p;
  const color = S.bossExtraAttack(b.bi, 'special').color;
  shadow(g, sx, sy, width * BS * 0.45);
  drawTransformDischarge(g, b, sx, sy, width, color, morph?.keyTicks);
  drawBossCel(g, b, sx, sy, folded || sheet, folded ? 0 : row, folded ? 0 : col);
}

function drawBoss(g, b, camX) {
  const sx = b.x - camX, sy = FLOOR_TOP + b.y;
  if (b.st === 'transform') return drawBossTransform(g, b, sx, sy);
  const [phase, row, col] = bossPose(b, sx);
  const ph = M.bosses[b.bi].phases[phase], sheet = img(ph.sheet);
  shadow(g, sx, sy, (ph.body[2] - ph.body[0]) * BS * 0.45);
  if (!ready(sheet)) return;
  const shake = (b.st === 'charge' && col === 0) || (b.st === 'sweep' && col === 0) ? (b.t % 4 < 2 ? 2 : -2) : 0;
  drawBossCel(g, b, sx + shake, sy + (b.st === 'dead' ? b.t * 0.15 : 0), sheet, row, col);
  windup(g, b, sx, sy, ph);
  if (b.su !== undefined && b.st !== 'idle' && b.st !== 'dead') {
    g.save();
    g.globalAlpha = (27 - b.su) / 27;
    drawBossFx(g, ph, 3, Math.min(3, Math.floor(b.su / 7)), sx - b.fc * 62, sy - 74, 42, false);
    g.restore();
  }
}

function drawBossFx(g, ph, row, col, x, y, size, flip) {
  const sheet = img(ph.proj), C = BOSS_FX_CELL;
  if (!ready(sheet)) return false;
  g.save();
  g.translate(Math.round(x), Math.round(y));
  g.imageSmoothingEnabled = false;
  if (flip) g.scale(-1, 1);
  g.drawImage(sheet, col * C, row * C, C, C, -size / 2, -size / 2, size, size);
  g.restore();
  return true;
}

function drawProj(g, p, camX, shadowSheet) {
  const sx = p.x - camX, sy = FLOOR_TOP + p.y - p.z;
  if (projectile(g, p, sx, sy, shadowSheet)) return;
  if (p.k === 'boss') {
    const ph = M.bosses[p.bi].phases[p.ph];
    shadow(g, sx, FLOOR_TOP + p.y, 7);
    const row = p.r === 3 ? 2 : p.r === 1 ? 1 : 0;
    if (!drawBossFx(g, ph, row, Math.floor(p.t / 4) % 4, sx, sy, row === 2 ? 68 : 60, p.vx > 0)) {
      g.fillStyle = '#ff5'; g.fillRect(sx - 4, sy - 4, 8, 8);
    }
  } else if (p.k === 'laser') {
    const im = img('assets/ufo/laser.png'); if (!ready(im)) return;
    g.save(); g.translate(sx, sy); g.scale(p.vx < 0 ? -0.8 : 0.8, 0.8); g.drawImage(im, -im.width / 2, -im.height / 2); g.restore();
  } else if (p.k === 'ball') {
    shadow(g, sx, FLOOR_TOP + p.y, 8);
    const im = img('assets/ufo/beach-ball.png'); if (!ready(im)) return;
    g.save(); g.translate(sx, sy); g.rotate(p.t * 0.25); g.drawImage(im, -12, -12, 24, 24); g.restore();
  } else if (p.k === 'knife') {
    const wa = weapon('knife'); g.save(); g.translate(sx, sy); g.rotate(p.t * 0.6); g.drawImage(wa.c, -9, -3); g.restore();
  } else {
    g.fillStyle = p.k.startsWith('enemy') ? '#ff965c' : '#e6d9ff';
    g.fillRect(Math.round(sx - 4), Math.round(sy - 2), 8, 4);
  }
}

// A down-pointing arrow in the slot colour over a Sproto played on this device.
function localMarker(g, x, y, col) {
  const tri = (w, h, c) => { g.fillStyle = c; g.beginPath(); g.moveTo(x - w, y - h); g.lineTo(x + w, y - h); g.lineTo(x, y); g.fill(); };
  tri(8, 10, '#000'); tri(6, 8, '#fff'); tri(4, 6, col);
}
function drawBanner(g, snap) {
  const bn = snap.banner; if (!bn) return;
  if (bn.arrow) { if (Math.floor(snap.t / 12) % 2) text(g, 'GO! >>>', W - 20, 120, 16, '#ffd23d', 'right'); return; }
  const b = bn.boss && snap.boss;
  const name = b && M.bosses[b.bi].machines[b.ph].toUpperCase();
  const a = Math.min(1, bn.t / 20);
  if (b && b.st === 'transform') {
    g.save();
    g.globalAlpha = a;
    text(g, name, W / 2, 59, 12, S.bossExtraAttack(b.bi, 'special').color, 'center', W - 24);
    g.restore();
    return;
  }
  g.globalAlpha = a;
  g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, 128, W, bn.sub ? 62 : 44);
  text(g, name || bn.text, W / 2, 150, bn.boss ? 18 : 22, bn.power ? '#8ef8ff' : bn.boss ? '#ff6a6a' : '#ffd23d', 'center');
  if (bn.sub) text(g, bn.sub, W / 2, 176, 8, '#fff', 'center');
  g.globalAlpha = 1;
}

// opts.local: slots played on this device (they get a marker). opts.noBanner: the caller draws
// its own end-of-run panel instead of the banner.
function drawWorld(g, snap, opts) {
  root.CoopBossTransformPlayer?.shared().sync(snap);
  const mine = (opts && opts.local) || [];
  const camX = snap.camX;
  const sk = snap.sk || 0;
  const shadowPath = M.shadows?.sheets[snap.si];
  const shadowSheet = shadowPath && img(shadowPath);
  g.save();
  if (sk) g.translate(Math.round(Math.sin(snap.t * 1.7) * sk), Math.round(Math.cos(snap.t * 2.3) * sk * 0.6));
  drawBackground(g, snap.si, camX);
  if (snap.boss?.st === 'transform') {
    const t = snap.boss.t;
    const focus = ease(S.clamp((t - 14) / 64, 0, 1)) * ease(S.clamp((470 - t) / 62, 0, 1));
    g.fillStyle = `rgba(10,7,25,${0.38 * focus})`;
    g.fillRect(0, 0, W, H);
  }
  const list = [];
  for (const it of snap.items) list.push({ y: it.y - (it.k === 'ufo' ? 0.5 : 0), d: () => drawItem(g, it, camX, snap.t) });
  // Downed players are drawn first so standing teammates appear over them while reviving.
  for (const p of snap.players) {
    if (p.st === 'dead' || p.c === 'none') continue;
    const sx = p.x - camX, sy = FLOOR_TOP + p.y;
    list.push({ y: p.y - (p.st === 'down' ? 1 : 0), d: () => {
      shadow(g, sx, sy, p.st === 'ufo' ? 26 : 13);
      g.fillStyle = S.SLOT_COLORS[p.s]; g.fillRect(sx - 9, sy + 2, 18, 2);
      if (p.st === 'ufo') { drawUfo(g, p, sx, sy - p.z - 6); }
      else {
        const blink = p.inv > 0 && p.st !== 'attack' && Math.floor(p.inv / 3) % 2;
        drawFighter(g, p, sx, sy - p.z, variantOf(snap, p), S.WEAPONS[p.w].id, S.WEAPONS[p.w], blink ? 0.45 : 1);
      }
      const tagY = sy - p.z - (p.st === 'ufo' ? 60 : 72);
      text(g, 'P' + (p.s + 1), sx, tagY, 6, S.SLOT_COLORS[p.s], 'center');
      if (mine.indexOf(p.s) >= 0) localMarker(g, sx, tagY - 8 - (Math.floor(snap.t / 10) % 2), S.SLOT_COLORS[p.s]);
      if (p.st === 'down') {
        g.fillStyle = '#300'; g.fillRect(sx - 16, sy - 40, 32, 4);
        g.fillStyle = '#4dff7a'; g.fillRect(sx - 16, sy - 40, 32 * p.rv / S.REVIVE_TICKS, 4);
        const needHuman = p.nr; // this Sproto's one CPU revive is spent: only a human can help now
        text(g, String(Math.ceil(p.dt / 60)), sx, sy - 62, 10, p.dt < 180 ? '#ff4d4d' : '#fff', 'center');
        if (!needHuman && Math.floor(snap.t / 15) % 2) text(g, 'REVIVE!', sx, sy - 50, 6, '#ffd23d', 'center');
      }
    } });
  }
  for (const e of snap.enemies) {
    const sx = e.x - camX, sy = FLOOR_TOP + e.y, wpn = S.ENEMY_WEAPONS[e.w];
    list.push({ y: e.y, d: () => {
      shadow(g, sx, sy, 12);
      const body = e.st === 'grabbed' ? { ...e, st: 'hit' } : e;
      const weaponId = wpn.id === 'bow' && e.st === 'attack' ? 'knife' : wpn.id;
      const alpha = e.d && e.st === 'lying' && e.t > 20 && e.t % 6 < 3 ? 0.3 : 1;
      if (!drawShadow(g, shadowSheet, e, wpn, sx, sy - e.z, alpha)) {
        drawFighter(g, body, sx, sy - e.z, 'shadow', weaponId, wpn, alpha);
      }
      if (!e.d && (e.hp < e.mh || e.el)) { g.fillStyle = '#300'; g.fillRect(sx - 10, sy - 68 - e.z, 20, 3); g.fillStyle = e.el ? '#ffd23d' : '#ff4d4d'; g.fillRect(sx - 10, sy - 68 - e.z, 20 * e.hp / e.mh, 3); }
      // Elite: a gold bar, and a shield on the side it guards while the guard is up.
      const twin = M.shadows?.stages[snap.si]?.[e.sh]?.role === 'twin';
      if (!e.d && (e.el || twin)) {
        text(g, twin ? 'SHADOW TWINS' : 'ELITE', sx, sy - 76 - e.z, 5, '#ffd23d', 'center');
        if (e.el === 2 && (e.st === 'walk' || e.st === 'idle' || e.st === 'attack')) {
          const hx = sx + e.fc * 13, hy = sy - 30 - e.z;
          g.fillStyle = 'rgba(150,215,255,.45)'; g.strokeStyle = '#e8f6ff'; g.lineWidth = 2;
          g.beginPath(); g.ellipse(hx, hy, 6, 16, 0, 0, 7); g.fill(); g.stroke();
        }
      }
    } });
  }
  floor(g, snap, camX, list); // fire lanes, lane and sweep warnings
  if (snap.boss) list.push({ y: snap.boss.y, d: () => drawBoss(g, snap.boss, camX) });
  for (const p of snap.projs) list.push({ y: p.y + 0.1, d: () => drawProj(g, p, camX, shadowSheet) });
  list.sort((a, b) => a.y - b.y);
  for (const o of list) o.d();
  for (const f of snap.fx) drawFx(g, f, camX);
  g.restore();
  drawHud(g, snap);
  if (!(opts && opts.noBanner)) drawBanner(g, snap);
}

// Render-only blend between two Sim.snapshot views. A snapshot is not restart state.
function interpolateSnapshot(a, b, k) {
  if (!b) return a;
  if (!a || k >= 1) return b;
  const L = (x, y) => x + (y - x) * k;
  const byId = (arr, key) => { const m = new Map(); for (const o of arr || []) m.set(o[key], o); return m; };
  const pa = byId(a.players, 's'), ea = byId(a.enemies, 'id'), ra = byId(a.projs, 'id');
  const mix = (o, p) => (p ? Object.assign({}, o, { x: L(p.x, o.x), y: L(p.y, o.y), z: L(p.z, o.z) }) : o);
  const nextBoss = b.boss, previousBoss = a.boss;
  let boss = nextBoss;
  if (nextBoss && previousBoss && a.si === b.si && nextBoss.bi === previousBoss.bi) {
    boss = { ...nextBoss, x: L(previousBoss.x, nextBoss.x), y: L(previousBoss.y, nextBoss.y) };
    if (nextBoss.st === previousBoss.st && nextBoss.ph === previousBoss.ph && nextBoss.t >= previousBoss.t) {
      boss.t = L(previousBoss.t, nextBoss.t);
    }
  }
  return Object.assign({}, b, {
    camX: a.si === b.si ? L(a.camX, b.camX) : b.camX,
    players: (b.players || []).map(o => mix(o, pa.get(o.s))),
    enemies: (b.enemies || []).map(o => mix(o, ea.get(o.id))),
    projs: (b.projs || []).map(o => {
      const prev = ra.get(o.id);
      const projectile = mix(o, prev);
      if (prev && o.k === 'boss' && prev.k === o.k && a.si === b.si) projectile.t = L(prev.t, o.t);
      return projectile;
    }),
    boss,
  });
}

root.RenderFx = { pose, gear, trail, makeStageWeapon, drawFallbackBackground, drawWorld, drawSummary, interpolateSnapshot };
})(typeof window !== 'undefined' ? window : globalThis);
