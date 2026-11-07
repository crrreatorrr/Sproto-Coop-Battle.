// Sproto Coop Battle — canvas renderer. Draws a snapshot (see Sim.snapshot), never the live sim,
// so host and guests render exactly the same way.
(function (root) {
'use strict';
const S = root.Sim, M = root.MANIFEST;
const { W, H, FLOOR_TOP } = S;
const FS = 0.92;           // fighter draw scale (sprites are 128px cells)
const BS = S.BOSS_SCALE;   // boss draw scale (sheets are 4x4 cells of 256px)
const FONT = '"Press Start 2P", ui-monospace, monospace';

const images = {};
function img(src) {
  if (!images[src]) { const im = new Image(); im.src = src; images[src] = im; }
  return images[src];
}
const ready = im => im && im.complete && im.naturalWidth > 0;
function preload(onProgress) {
  const list = [];
  for (const f of M.fighters) { for (let i = 0; i < 32; i++) list.push(`assets/fighters/${f.id}/${String(i).padStart(2, '0')}.png`); for (let i = 0; i < 8; i++) list.push(`assets/fighters/${f.id}/w0${i}.png`); }
  for (const n of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']) { list.push(`assets/stages/${n}-back.jpg`); list.push(`assets/stages/${n}-floor.png`); }
  for (const n of ['cockpit-front', 'cockpit-rear', 'idle', 'laser', 'muzzle', 'beach-ball', 'shield1', 'shield2', 'shield3', 'shield4']) list.push(`assets/ufo/${n}.png`);
  let done = 0;
  return Promise.all(list.map(src => new Promise(res => { const im = img(src); const fin = () => { done++; onProgress && onProgress(done / list.length); res(); }; if (im.complete) fin(); else { im.onload = fin; im.onerror = fin; } })));
}
function bossImages(bi) { const b = M.bosses[bi]; return b.phases.map(p => [img(p.sheet), img(p.proj)]); }

// ---------- tinted fighter frames ----------
let filterOK = null;
function canFilter() {
  if (filterOK === null) { const c = document.createElement('canvas').getContext('2d'); c.filter = 'hue-rotate(90deg)'; filterOK = c.filter === 'hue-rotate(90deg)'; }
  return filterOK;
}
const HUES = [0, 150, 235, 300, 60, 190];
const tintCache = {};
function frameCanvas(fid, pose, variant) { // variant: 0 = original, 1..5 = alt palette, 'shadow' = enemy
  const f = M.fighters[fid];
  const src = img(typeof pose === 'number' ? `assets/fighters/${f.id}/${String(pose).padStart(2, '0')}.png` : `assets/fighters/${f.id}/${pose}.png`);
  if (!variant) return src;
  const key = fid + '|' + pose + '|' + variant;
  if (tintCache[key]) return tintCache[key];
  if (!ready(src)) return src;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  if (variant === 'shadow') {
    if (canFilter()) g.filter = 'saturate(0.35) brightness(0.55) contrast(1.2)';
    g.drawImage(src, 0, 0); g.filter = 'none';
    g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(110,30,140,0.35)'; g.fillRect(0, 0, 128, 128);
  } else if (canFilter()) { g.filter = `hue-rotate(${HUES[variant]}deg) saturate(1.2)`; g.drawImage(src, 0, 0); }
  else { g.drawImage(src, 0, 0); g.globalCompositeOperation = 'source-atop'; g.fillStyle = S.SLOT_COLORS[variant] + '66'; g.fillRect(0, 0, 128, 128); }
  tintCache[key] = c;
  return c;
}

// ---------- pixel weapons (procedural; every Sproto is armed) ----------
// Each weapon is drawn pointing right with its grip at (gx, gy).
const weaponArt = {};
function px(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }
function makeWeapon(id) {
  const c = document.createElement('canvas'); const g = c.getContext('2d');
  let gx = 6, gy = 4;
  const ol = '#14121c';
  switch (id) {
    case 'katana': c.width = 44; c.height = 9;
      px(g, 0, 3, 11, 3, ol); px(g, 1, 4, 9, 1, '#7a2a2a'); px(g, 3, 3, 1, 3, '#d8b04a'); px(g, 7, 3, 1, 3, '#d8b04a');
      px(g, 11, 1, 3, 7, ol); px(g, 12, 2, 1, 5, '#e8c45a');
      px(g, 14, 3, 28, 3, ol); px(g, 14, 4, 27, 1, '#eef4ff'); px(g, 14, 3, 26, 1, '#9fb2c8'); px(g, 41, 4, 2, 1, ol); gx = 5; break;
    case 'bo': c.width = 62; c.height = 6;
      px(g, 0, 1, 62, 4, ol); px(g, 1, 2, 60, 2, '#a86a32'); px(g, 1, 2, 60, 1, '#d89a52');
      px(g, 0, 1, 5, 4, '#3a3a48'); px(g, 57, 1, 5, 4, '#3a3a48'); px(g, 28, 1, 6, 4, '#c23a3a'); gx = 22; gy = 3; break;
    case 'hammer': c.width = 40; c.height = 18;
      px(g, 0, 7, 28, 4, ol); px(g, 1, 8, 26, 2, '#7a5a3a'); px(g, 2, 8, 6, 2, '#3a2a2a');
      px(g, 27, 0, 12, 18, ol); px(g, 28, 1, 10, 16, '#8a92a8'); px(g, 28, 1, 10, 3, '#c8d0e0'); px(g, 30, 7, 6, 4, '#d8b04a'); gx = 5; gy = 9; break;
    case 'spear': c.width = 70; c.height = 9;
      px(g, 0, 3, 56, 3, ol); px(g, 1, 4, 54, 1, '#b07a42');
      px(g, 54, 2, 3, 5, '#c23a3a');
      px(g, 57, 1, 12, 7, ol); px(g, 58, 2, 8, 5, '#dfe6f2'); px(g, 66, 3, 3, 3, '#dfe6f2'); px(g, 58, 4, 10, 1, '#8fa0b8'); gx = 24; break;
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
  return weaponArt[id] = { c, gx, gy };
}
const weapon = id => weaponArt[id] || makeWeapon(id);

// Pose + weapon angle for a fighter in a given state. Angles in degrees, 0 = forward, negative = up.
function fighterPose(o, wpn) {
  const t = o.t;
  switch (o.st) {
    case 'walk': return { pose: 'w0' + (Math.floor(t / 5) % 8), ang: -48 + Math.sin(t / 5) * 6, hand: 2 };
    case 'jump': return { pose: o.z > 30 && t < 14 ? 8 : 9, ang: -70 };
    case 'jumpatk': return { pose: 23, ang: Math.min(70, -60 + t * 18), swoosh: t < 10 };
    case 'land': return { pose: 10, ang: -20 };
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

function drawFighter(g, o, sx, sy, variant, wpnId, wpnStats, alpha) {
  const f = M.fighters[o.f];
  const P = fighterPose(o, wpnStats);
  const poseIdx = typeof P.pose === 'number' ? P.pose : (o.st === 'walk' ? 2 + (Math.floor(o.t / 5) % 4) : 0);
  const fr = frameCanvas(o.f, P.pose, variant);
  const face = o.fc || 1;
  g.save();
  g.globalAlpha = alpha == null ? 1 : alpha;
  g.translate(Math.round(sx), Math.round(sy));
  if (P.lying) { g.rotate(-face * Math.PI / 2); g.translate(face * 10, 22); }
  else if (P.tilt) g.rotate(-face * 0.6);
  g.scale(face * FS, FS);
  g.translate(-f.foot[0], -f.foot[1]);
  // weapon behind body when raised back, in front otherwise
  const hand = f.hands[poseIdx] || f.hands[0];
  const drawW = () => {
    if (!wpnId) return;
    const wa = weapon(wpnId);
    g.save(); g.translate(hand[0] - 3, hand[1]); g.rotate(P.ang * Math.PI / 180); g.scale(1 / FS, 1 / FS);
    g.drawImage(wa.c, -wa.gx, -wa.gy);
    g.restore();
  };
  const behind = P.ang < -100 || P.ang > 200;
  if (behind) drawW();
  if (ready(fr) || fr.getContext) g.drawImage(fr, 0, 0);
  if (!behind) drawW();
  if (P.swoosh && wpnId) {
    const len = weapon(wpnId).c.width - weapon(wpnId).gx;
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 3 / FS;
    g.beginPath(); const a = P.ang * Math.PI / 180;
    g.arc(hand[0], hand[1], len / FS, a - 0.9, a, false); g.stroke();
  }
  g.restore();
}

// ---------- backgrounds ----------
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
// Sproto Arcade stage art: scenery above the floor scrolls at half speed, the floor scrolls with
// the fighters. Copies alternate with mirrored copies so the panoramas loop without seams.
function mirrorTile(g, im, x0, y, h) {
  const w = im.width * (h / im.height);
  let k = Math.floor(-x0 / w), x = x0 + k * w;
  for (; x < W; x += w, k++) {
    if (k % 2 === 0) g.drawImage(im, Math.round(x), y, Math.ceil(w) + 1, h);
    else { g.save(); g.translate(Math.round(x + w), y); g.scale(-1, 1); g.drawImage(im, 0, 0, Math.ceil(w) + 1, h); g.restore(); }
  }
}
function drawBackground(g, si, camX) {
  const n = String(si % 12 + 1).padStart(2, '0');
  const back = img(`assets/stages/${n}-back.jpg`), floor = img(`assets/stages/${n}-floor.png`);
  if (ready(back) && ready(floor)) {
    mirrorTile(g, back, -camX * 0.5, 0, 226);
    mirrorTile(g, floor, -camX, FLOOR_TOP - 6, 150);
    const grd = g.createLinearGradient(0, FLOOR_TOP - 6, 0, FLOOR_TOP + 6);
    grd.addColorStop(0, 'rgba(0,0,0,.35)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, FLOOR_TOP - 6, W, 12);
    if (si < 11) { img(`assets/stages/${String(si + 2).padStart(2, '0')}-back.jpg`); img(`assets/stages/${String(si + 2).padStart(2, '0')}-floor.png`); }
    return;
  }
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

// ---------- entities ----------
function shadow(g, sx, sy, w) { g.fillStyle = 'rgba(0,0,0,.32)'; g.beginPath(); g.ellipse(sx, sy, w, w * 0.3, 0, 0, 7); g.fill(); }
function variantOf(snap, p) { let v = 0; for (const o of snap.players) if (o.s < p.s && o.f === p.f) v++; return v; }

function drawUfo(g, p, sx, sy) {
  const rear = img('assets/ufo/cockpit-rear.png'), front = img('assets/ufo/cockpit-front.png');
  if (!ready(rear) || !ready(front)) return;
  const sc = 0.62, face = p.fc || 1;
  g.save(); g.translate(Math.round(sx), Math.round(sy)); g.scale(face * sc, sc); g.translate(-94, -51);
  g.drawImage(rear, 0, 0);
  const f = M.fighters[p.f], src = frameCanvas(p.f, 0, 0);
  const [sx0, sy0, sw, sh] = [f.foot[0] - 18, f.box[1] - 3, 40, 32];
  const scale = Math.min(53 / sw, 43 / sh) * 1.05, w = sw * scale, h = sh * scale;
  if (ready(src)) g.drawImage(src, sx0, sy0, sw, sh, 100 - w / 2, 55 - h, w, h);
  g.drawImage(front, 0, 0);
  g.restore();
  if (p.inv > 0 && p.inv % 8 < 5) { const sh = img('assets/ufo/shield' + (1 + (Math.floor(p.t / 4) % 4)) + '.png'); if (ready(sh)) g.drawImage(sh, sx - sh.width * 0.35, sy - sh.height * 0.35, sh.width * 0.7, sh.height * 0.7); }
}

function drawBoss(g, b, camX) {
  const info = M.bosses[b.bi], ph = info.phases[b.ph];
  const sheet = img(ph.sheet);
  const sx = b.x - camX, sy = FLOOR_TOP + b.y;
  shadow(g, sx, sy, (ph.body[2] - ph.body[0]) * BS * 0.45);
  if (!ready(sheet)) return;
  let row = 0, col = Math.floor(b.t / 9) % 4;
  if (b.st === 'fire') { row = b.mi ? 3 : b.row; col = b.t < 12 ? 0 : b.t < 24 ? 1 : b.t < 36 ? 2 : 3; }
  const C = 256;
  g.save();
  if (b.st === 'dead') g.globalAlpha = b.t % 6 < 3 ? 0.5 : 1;
  if (b.st === 'transform' && b.t % 8 < 4) g.globalAlpha = 0.4;
  const shake = b.st === 'charge' && b.t < 30 ? (b.t % 4 < 2 ? 2 : -2) : 0;
  g.translate(Math.round(sx + shake), Math.round(sy + (b.st === 'dead' ? b.t * 0.15 : 0)));
  g.scale(b.fc > 0 ? -BS : BS, BS);
  const cx = (ph.body[0] + ph.body[2]) / 2, by = ph.body[3];
  g.drawImage(sheet, col * C, row * C, C, C, -cx, -by, C, C);
  if (b.fl > 0 && canFilter()) { g.globalAlpha = 0.6; g.filter = 'brightness(4) saturate(0)'; g.drawImage(sheet, col * C, row * C, C, C, -cx, -by, C, C); g.filter = 'none'; }
  g.restore();
}

function drawProj(g, p, camX) {
  const sx = p.x - camX, sy = FLOOR_TOP + p.y - p.z;
  if (p.k === 'boss') {
    const ph = M.bosses[p.bi].phases[p.ph], sheet = img(ph.proj);
    shadow(g, sx, FLOOR_TOP + p.y, 7);
    if (!ready(sheet)) { g.fillStyle = '#ff5'; g.fillRect(sx - 4, sy - 4, 8, 8); return; }
    const rb = ph.projRows[p.r], col = Math.floor(p.t / 4) % 4, C = 256;
    const sc = p.r === 3 ? 0.42 : 0.36;
    g.save(); g.translate(Math.round(sx), Math.round(sy)); g.scale(p.vx > 0 ? -sc : sc, sc);
    const w = rb[2] - rb[0], h = rb[3] - rb[1];
    g.drawImage(sheet, col * C + rb[0], p.r * C + rb[1], w, h, -w / 2, -h / 2, w, h);
    g.restore();
  } else if (p.k === 'laser') {
    const im = img('assets/ufo/laser.png'); if (!ready(im)) return;
    g.save(); g.translate(sx, sy); g.scale(p.vx < 0 ? -0.8 : 0.8, 0.8); g.drawImage(im, -im.width / 2, -im.height / 2); g.restore();
  } else if (p.k === 'ball') {
    shadow(g, sx, FLOOR_TOP + p.y, 8);
    const im = img('assets/ufo/beach-ball.png'); if (!ready(im)) return;
    g.save(); g.translate(sx, sy); g.rotate(p.t * 0.25); g.drawImage(im, -12, -12, 24, 24); g.restore();
  } else if (p.k === 'knife') {
    const wa = weapon('knife'); g.save(); g.translate(sx, sy); g.rotate(p.t * 0.6); g.drawImage(wa.c, -9, -3); g.restore();
  }
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

function drawFx(g, f, camX) {
  const sx = f.x - camX, sy = FLOOR_TOP + f.y - f.z;
  if (f.k === 'spark') {
    g.strokeStyle = f.t < 4 ? '#fff' : '#ffd23d'; g.lineWidth = 2;
    const r = 4 + f.t * 1.4;
    for (let i = 0; i < 6; i++) { const a = i * 1.047 + f.id; g.beginPath(); g.moveTo(sx + Math.cos(a) * r * .4, sy + Math.sin(a) * r * .4); g.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r); g.stroke(); }
  } else if (f.k === 'boom') {
    const r = (f.sm ? 10 : 20) * Math.min(1, f.t / 8) + f.t * 0.4;
    g.globalAlpha = Math.max(0, 1 - f.t / 32);
    g.fillStyle = '#ff6a1a'; g.beginPath(); g.arc(sx, sy, r, 0, 7); g.fill();
    g.fillStyle = '#ffd23d'; g.beginPath(); g.arc(sx, sy, r * 0.65, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(sx, sy, r * 0.3 * Math.max(0, 1 - f.t / 12), 0, 7); g.fill();
    g.globalAlpha = 1;
  } else if (f.k === 'ring') {
    g.strokeStyle = `rgba(255,255,255,${1 - f.t / 20})`; g.lineWidth = 3; g.beginPath(); g.ellipse(sx, sy, 10 + f.t * 4, 4 + f.t * 1.3, 0, 0, 7); g.stroke();
  } else if (f.k === 'text') {
    g.globalAlpha = Math.max(0, 1 - f.t / 60); text(g, f.tx, sx, sy - f.t * 0.6, 8, '#fff', 'center'); g.globalAlpha = 1;
  } else if (f.k === 'nova') {
    const r = 20 + f.t * 8, a = Math.max(0, 1 - f.t / 40);
    g.strokeStyle = `rgba(255,170,60,${a})`; g.lineWidth = 6; g.beginPath(); g.ellipse(sx, sy, r, r * .35, 0, 0, 7); g.stroke();
    g.strokeStyle = `rgba(255,255,200,${a})`; g.lineWidth = 2; g.beginPath(); g.ellipse(sx, sy, r * .8, r * .28, 0, 0, 7); g.stroke();
    if (f.t < 8) { g.fillStyle = `rgba(255,240,200,${0.35 * (1 - f.t / 8)})`; g.fillRect(0, 0, W, H); }
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
  } else if (f.k === 'shield') {
    g.strokeStyle = `rgba(120,255,140,${1 - f.t / 14})`; g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, 30, 0, 7); g.stroke();
  }
}

function text(g, s, x, y, size, color, align) {
  g.font = `${size}px ${FONT}`; g.textAlign = align || 'left'; g.textBaseline = 'middle';
  g.fillStyle = '#000'; g.fillText(s, x + 1, y + 1); g.fillText(s, x - 1, y + 1); g.fillText(s, x + 1, y - 1); g.fillText(s, x - 1, y - 1);
  g.fillStyle = color; g.fillText(s, x, y);
}

function drawHead(g, fid, variant, x, y, size) {
  const f = M.fighters[fid], src = frameCanvas(fid, 0, variant);
  if (!ready(src) && !src.getContext) return;
  g.drawImage(src, f.foot[0] - 18, f.box[1] - 3, 36, 30, x, y, size, size * 30 / 36);
}

function drawHud(g, snap) {
  const pw = W / 6;
  snap.players.forEach((p, i) => {
    const x = i * pw + 2, y = 2, col = S.SLOT_COLORS[p.s];
    g.fillStyle = 'rgba(8,6,16,.78)'; g.fillRect(x, y, pw - 4, 38);
    g.fillStyle = col; g.fillRect(x, y, pw - 4, 2);
    drawHead(g, p.f, variantOf(snap, p), x + 2, y + 5, 22);
    text(g, 'P' + (p.s + 1), x + 26, y + 9, 7, col);
    text(g, p.c === 'cpu' ? 'CPU' : p.c === 'remote' ? 'NET' : '', x + 50, y + 9, 6, '#9a98b8');
    text(g, String(p.n).slice(0, 15), x + 26, y + 18, String(p.n).length > 8 ? 4.5 : 6, '#fff');
    if (p.st === 'dead') {
      text(g, 'DEAD', x + 26, y + 30, 7, '#ff4d4d');
    } else {
      g.fillStyle = '#300'; g.fillRect(x + 26, y + 25, pw - 34, 5);
      g.fillStyle = p.hp > 30 ? '#4dff7a' : '#ff4d4d'; g.fillRect(x + 26, y + 25, (pw - 34) * p.hp / S.MAX_HP, 5);
      if (p.c !== 'cpu') text(g, p.l > 1 ? '♥♥' : '♥', x + 3, y + 32, 6, '#ff5a7a');
      (p.pw || []).forEach((pt, k) => powerIcon(g, pt, x + 76 + k * 9, y + 34, 3.5));
      text(g, String(p.sc).padStart(6, '0'), x + 26, y + 34, 5, '#c8c6e0');
      if (p.st === 'down') text(g, 'DOWN ' + Math.ceil(p.dt / 60) + 's', x + 64, y + 9, 5, '#ff4d4d');
      if (p.st === 'ufo') text(g, 'UFO ' + Math.ceil(p.ut / 60), x + 64, y + 9, 5, '#7aff8a');
    }
  });
  if (snap.god) text(g, 'GOD MODE · 2x ATTACK · UNLIMITED HP', W / 2, 48, 7, '#8ef8d6', 'center');
  const b = snap.boss;
  if (b) {
    const info = M.bosses[b.bi];
    g.fillStyle = 'rgba(8,6,16,.8)'; g.fillRect(120, H - 22, 400, 18);
    text(g, info.machines[b.ph].toUpperCase(), 126, H - 13, 7, '#ff8a8a');
    g.fillStyle = '#300'; g.fillRect(300, H - 17, 214, 8);
    g.fillStyle = b.ph ? '#ff4d4d' : '#ffa23d'; g.fillRect(300, H - 17, 214 * Math.max(0, b.hp) / b.mh, 8);
  }
}

function drawBanner(g, snap) {
  const bn = snap.banner; if (!bn) return;
  if (bn.arrow) { if (Math.floor(snap.t / 12) % 2) text(g, 'GO! >>>', W - 20, 120, 16, '#ffd23d', 'right'); return; }
  const a = Math.min(1, bn.t / 20);
  g.globalAlpha = a;
  g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, 128, W, bn.sub ? 62 : 44);
  text(g, bn.text, W / 2, 150, bn.boss ? 18 : 22, bn.power ? '#8ef8ff' : bn.boss ? '#ff6a6a' : '#ffd23d', 'center');
  if (bn.sub) text(g, bn.sub, W / 2, 176, 8, '#fff', 'center');
  g.globalAlpha = 1;
}

function drawWorld(g, snap) {
  const camX = snap.camX;
  drawBackground(g, snap.si, camX);
  const list = [];
  for (const it of snap.items) list.push({ y: it.y - (it.k === 'ufo' ? 0.5 : 0), d: () => drawItem(g, it, camX, snap.t) });
  // Downed players are drawn first so standing teammates appear over them while reviving.
  for (const p of snap.players) {
    if (p.st === 'dead') continue;
    const sx = p.x - camX, sy = FLOOR_TOP + p.y;
    list.push({ y: p.y - (p.st === 'down' ? 1 : 0), d: () => {
      shadow(g, sx, sy, p.st === 'ufo' ? 26 : 13);
      g.fillStyle = S.SLOT_COLORS[p.s]; g.fillRect(sx - 9, sy + 2, 18, 2);
      if (p.st === 'ufo') { drawUfo(g, p, sx, sy - p.z - 6); }
      else {
        const blink = p.inv > 0 && p.st !== 'attack' && Math.floor(p.inv / 3) % 2;
        drawFighter(g, p, sx, sy - p.z, variantOf(snap, p), S.WEAPONS[p.w].id, S.WEAPONS[p.w], blink ? 0.45 : 1);
      }
      text(g, 'P' + (p.s + 1), sx, sy - p.z - (p.st === 'ufo' ? 60 : 72), 6, S.SLOT_COLORS[p.s], 'center');
      if (p.st === 'down') {
        g.fillStyle = '#300'; g.fillRect(sx - 16, sy - 40, 32, 4);
        g.fillStyle = '#4dff7a'; g.fillRect(sx - 16, sy - 40, 32 * p.rv / S.REVIVE_TICKS, 4);
        const needHuman = p.c === 'cpu' || p.nr;
        text(g, String(Math.ceil(p.dt / 60)), sx, sy - 62, 10, p.dt < 180 ? '#ff4d4d' : '#fff', 'center');
        if (!needHuman && Math.floor(snap.t / 15) % 2) text(g, 'REVIVE!', sx, sy - 50, 6, '#ffd23d', 'center');
      }
    } });
  }
  for (const e of snap.enemies) {
    const sx = e.x - camX, sy = FLOOR_TOP + e.y, wpn = S.ENEMY_WEAPONS[e.w];
    list.push({ y: e.y, d: () => {
      shadow(g, sx, sy, 12);
      const st = e.st === 'attack' ? 'attack' : e.st;
      drawFighter(g, { f: e.f, st, t: e.st === 'attack' ? e.t * (8 / wpn.startup) : e.t, z: e.z, fc: e.fc, cb: 1 }, sx, sy - e.z, 'shadow', wpn.thrower && e.st === 'attack' && e.t > wpn.startup ? null : wpn.id, { startup: 8, active: 4, recovery: 10 }, e.d && e.st === 'lying' && e.t > 20 ? (e.t % 6 < 3 ? 0.3 : 1) : 1);
      if (!e.d && e.hp < e.mh) { g.fillStyle = '#300'; g.fillRect(sx - 10, sy - 68 - e.z, 20, 3); g.fillStyle = '#ff4d4d'; g.fillRect(sx - 10, sy - 68 - e.z, 20 * e.hp / e.mh, 3); }
    } });
  }
  // Boss lane warnings: a red stripe along each lane about to be shot.
  const bw = snap.boss;
  if (bw && bw.wl && bw.st === 'fire' && bw.t < 30) {
    const k = bw.t / 30, x0 = bw.x - camX;
    for (const ly of bw.wl) {
      const y = FLOOR_TOP + ly;
      g.fillStyle = `rgba(255,40,40,${0.18 + 0.25 * k + (Math.floor(bw.t / 4) % 2 ? 0.12 : 0)})`;
      if (bw.fc < 0) g.fillRect(0, y - 6, x0, 12); else g.fillRect(x0, y - 6, W - x0, 12);
    }
    if (Math.floor(bw.t / 6) % 2) text(g, 'MOVE!', x0 + bw.fc * 90, FLOOR_TOP - 10, 8, '#ff6a6a', 'center');
  }
  if (snap.boss) list.push({ y: snap.boss.y, d: () => drawBoss(g, snap.boss, camX) });
  for (const p of snap.projs) list.push({ y: p.y + 0.1, d: () => drawProj(g, p, camX) });
  list.sort((a, b) => a.y - b.y);
  for (const o of list) o.d();
  for (const f of snap.fx) drawFx(g, f, camX);
  drawHud(g, snap);
  drawBanner(g, snap);
}

root.Render = { W, H, img, ready, preload, bossImages, drawWorld, drawFighter, drawHead, drawBackground, text, weapon, frameCanvas, FONT };
})(window);
