// Sproto Coop Battle — canvas renderer. Draws a snapshot (see Sim.snapshot), never the live sim,
// so host and guests render exactly the same way.
(function (root) {
'use strict';
const S = root.Sim, M = root.MANIFEST;
const { W, H, FLOOR_TOP } = S;
const FS = 0.92;           // fighter draw scale (sprites are 128px cells)
const FONT = '"Press Start 2P", ui-monospace, monospace';

if (!root.AssetLoader) throw new Error('asset-loader.js must load before render.js');
const Cells = root.AssetLoader.lru(96);
const Tints = root.AssetLoader.lru(96);
const atlasBuffers = new Map();
function loader() { return root.AssetLoader.shared(); }
function img(src) { return loader().image(src); }
const ready = im => !!(im && im.complete && im.naturalWidth > 0);
let ufoQueued = false, fxRequested = false;
function preload(onProgress) {
  return loader().preload(root.AssetLoader.groups(M).startup, onProgress);
}
function enterStage(i) {
  const L = loader();
  L.enterStage(i, M);
  // UFO and combat art load after the title.
  if (!ufoQueued) {
    ufoQueued = true;
    const groups = root.AssetLoader.groups(M);
    L.prefetch(groups.ufo.concat(groups.fx));
  }
  loadFx();
}
function loadFx() {
  if (fxRequested || !root.document) return;
  fxRequested = true;
  const scripts = [
    ['CoopSpriteTimeline', 'sprite-timeline.js'],
    ['CoopSpriteClipPlayer', 'sprite-clip-player.js'],
    ['CoopBossActionSelection', 'boss-action-selection.js'],
    ['CoopBossActionPlayer', 'boss-action-player.js'],
    ['CoopBossTransformPlayer', 'boss-transform-player.js'],
    ['CoopBossMorphField', 'boss-morph-field.js'],
    ['CoopBossMorph', 'boss-morph.js'],
    ['RenderFx', 'render-fx.js'],
  ];
  for (const [global, file] of scripts) {
    if (root[global]) continue;
    const el = root.document.createElement('script');
    el.async = false;
    el.src = root.AssetLoader.resolve('js/' + file, root.document.baseURI);
    el.onerror = () => { root.setTimeout(() => { fxRequested = false; }, 1000); };
    root.document.head.appendChild(el);
  }
}
function bossImages(bi) { const b = M.bosses[bi]; return b.phases.map(p => [img(p.sheet), img(p.proj)]); }
function loadStatus() {
  const stat = loader().status();
  stat.cells = Cells.size;
  stat.tints = Tints.size;
  stat.atlasBuffers = atlasBuffers.size;
  stat.cellBytes = Cells.size * 128 * 128 * 4;
  stat.tintBytes = Tints.size * 128 * 128 * 4;
  stat.atlasBufferBytes = Array.from(atlasBuffers.values()).reduce((bytes, ctx) => bytes + ctx.canvas.width * ctx.canvas.height * 4, 0);
  return stat;
}

// ---------- tinted fighter frames ----------
let filterOK = null;
function canFilter() {
  if (filterOK === null) { const c = document.createElement('canvas').getContext('2d'); c.filter = 'hue-rotate(90deg)'; filterOK = c.filter === 'hue-rotate(90deg)'; }
  return filterOK;
}
const HUES = [0, 150, 235, 300, 60, 190];
// Copy one atlas cell with getImageData so the 128 canvas matches the pose PNG.
// The atlas image stays resident; cell and tint canvases are capped.
function atlasContext(path) {
  const cached = atlasBuffers.get(path);
  if (cached) return cached;
  const sheet = img(path);
  if (!ready(sheet)) return null;
  const c = document.createElement('canvas');
  c.width = sheet.naturalWidth; c.height = sheet.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  g.drawImage(sheet, 0, 0);
  atlasBuffers.set(path, g);
  return g;
}
function cellCanvas(fid, pose) {
  const f = M.fighters[fid];
  if (!f) return null;
  const separateMotion = !f.cell && typeof pose === 'number' && pose >= 40;
  const path = separateMotion ? root.AssetLoader.motionPath(f) : root.AssetLoader.atlasPath(f);
  if (!path) return null;
  const rect = root.AssetLoader.frameRect(pose, f.cell || (separateMotion ? 64 : 128), separateMotion);
  if (!rect) return null;
  const key = fid + '|' + rect.i;
  const hit = Cells.get(key);
  if (hit) return hit;
  const sheet = atlasContext(path);
  if (!sheet) return null;
  if (rect.x + rect.w > sheet.canvas.width || rect.y + rect.h > sheet.canvas.height) return null;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  if (rect.w === 128) g.putImageData(sheet.getImageData(rect.x, rect.y, rect.w, rect.h), 0, 0);
  else g.drawImage(sheet.canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, 128, 128);
  Cells.set(key, c);
  return c;
}
function frameCanvas(fid, pose, variant) { // variant: 0 = original, 1..5 = alt palette, 'shadow' = enemy
  const src = cellCanvas(fid, pose);
  if (!src) return null;
  if (!variant) return src;
  const key = fid + '|' + pose + '|' + variant;
  const hit = Tints.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  if (variant === 'shadow') {
    if (canFilter()) g.filter = 'saturate(0.35) brightness(0.55) contrast(1.2)';
    g.drawImage(src, 0, 0); g.filter = 'none';
    g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(110,30,140,0.35)'; g.fillRect(0, 0, 128, 128);
  } else if (canFilter()) { g.filter = `hue-rotate(${HUES[variant]}deg) saturate(1.2)`; g.drawImage(src, 0, 0); }
  else { g.drawImage(src, 0, 0); g.globalCompositeOperation = 'source-atop'; g.fillStyle = S.SLOT_COLORS[variant] + '66'; g.fillRect(0, 0, 128, 128); }
  Tints.set(key, c);
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
    default: return weapon('bo');
  }
  return weaponArt[id] = { c, gx, gy };
}
const weapon = id => weaponArt[id] || (root.RenderFx && root.RenderFx.makeStageWeapon(id)) || makeWeapon(id);

function drawFighter(g, o, sx, sy, variant, wpnId, wpnStats, alpha) {
  const f = M.fighters[o.f];
  if (!f) return;
  if (o.cl) {
    loadFx();
    const motion = root.AssetLoader.motionPath(f);
    if (motion && !atlasBuffers.has(motion)) atlasContext(motion);
  }
  const art = root.RenderFx;
  const P = art ? art.pose(o, wpnId, wpnStats) : { pose: Math.floor(o.t / 30) % 2, ang: -52 + Math.sin(o.t / 12) * 3 };
  let pose = P.pose;
  let fr = frameCanvas(o.f, pose, variant);
  if (!fr && P.fallback !== undefined) {
    pose = P.fallback;
    fr = frameCanvas(o.f, pose, variant);
  }
  const poseIdx = typeof pose === 'number' ? pose : (f.cell ? root.AssetLoader.poseIndex(pose) : (o.st === 'walk' ? 2 + (Math.floor(o.t / 5) % 4) : 0));
  const face = o.fc || 1;
  g.save();
  g.globalAlpha = alpha == null ? 1 : alpha;
  g.translate(Math.round(sx), Math.round(sy));
  if (P.lying) { g.rotate(-face * Math.PI / 2); g.translate(face * 10, 22); }
  else if (P.tilt) g.rotate(-face * 0.6);
  g.scale(face * FS, FS);
  g.translate(-f.foot[0], -f.foot[1]);
  // weapon behind body when raised back, in front otherwise
  const hand = (poseIdx >= 40 ? f.motionHands?.[poseIdx - 40] : f.hands[poseIdx]) || f.hands[0];
  const drawW = () => {
    if (art && art.gear(g, o, wpnId, P, hand, FS, wpnStats)) return;
    if (!wpnId) return;
    const wa = weapon(wpnId);
    g.save(); g.translate(hand[0] - 3, hand[1]); g.rotate(P.ang * Math.PI / 180); g.scale(1 / FS, 1 / FS);
    g.drawImage(wa.c, -wa.gx, -wa.gy);
    g.restore();
  };
  const behind = P.ang < -100 || P.ang > 200;
  const show = fr && (ready(fr) || fr.getContext);
  if (show && behind) drawW();
  if (show) g.drawImage(fr, 0, 0);
  if (show && !behind) drawW();
  if (show && P.swoosh && wpnId && !(art && art.trail(g, wpnId, P, hand))) {
    const len = weapon(wpnId).c.width - weapon(wpnId).gx;
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 3 / FS;
    g.beginPath(); const a = P.ang * Math.PI / 180;
    g.arc(hand[0], hand[1], len / FS, a - 0.9, a, false); g.stroke();
  }
  g.restore();
}

function drawPortrait(g, fid, cx, cy, size) {
  if (!M.fighters[fid]) return false;
  const portraits = img(root.AssetLoader.portraits);
  if (!ready(portraits)) return false;
  const cell = 28;
  g.drawImage(portraits, fid % 8 * cell, Math.floor(fid / 8) * cell, cell, cell,
    Math.round(cx - size / 2), Math.round(cy - size / 2), size, size);
  return true;
}

// ---------- backgrounds ----------
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
    return;
  }
  if (root.RenderFx) return root.RenderFx.drawFallbackBackground(g, si, camX);
  g.fillStyle = '#221b37'; g.fillRect(0, 0, W, FLOOR_TOP);
  g.fillStyle = '#352b36'; g.fillRect(0, FLOOR_TOP, W, H - FLOOR_TOP);
}

// ---------- entities ----------
function text(g, s, x, y, size, color, align, width) {
  if (!s) return;
  g.save();
  g.font = `${Math.round(size)}px ${FONT}`;
  g.textAlign = align || 'left';
  g.textBaseline = 'middle';
  if (width && g.measureText(s).width > width) {
    const letters = Array.from(s);
    while (letters.length && g.measureText(letters.join('') + '…').width > width) letters.pop();
    s = letters.join('') + '…';
  }
  x = Math.round(x);
  y = Math.round(y);
  g.fillStyle = '#0a0814';
  g.fillText(s, x + 1, y + 1);
  g.fillStyle = color;
  g.fillText(s, x, y);
  g.restore();
}

function drawSummary(g, sum, info) { if (root.RenderFx) root.RenderFx.drawSummary(g, sum, info); }

// Fetch the in-game renderer by the time the lobby preview is on screen.
function drawWorld(g, snap, opts) {
  enterStage(snap.si);
  if (root.RenderFx) return root.RenderFx.drawWorld(g, snap, opts);
  drawBackground(g, snap.si, snap.camX);
  // Keep basic silhouettes visible while the in-game script downloads or retries.
  for (const p of snap.players) {
    if (p.c !== 'none' && p.st !== 'dead') {
      const wpn = S.WEAPONS[p.w];
      drawFighter(g, p, p.x - snap.camX, FLOOR_TOP + p.y - p.z, 0, wpn.id, wpn);
    }
  }
  for (const e of snap.enemies) drawFighter(g, e, e.x - snap.camX, FLOOR_TOP + e.y - e.z, 'shadow');
}

root.Render = { W, H, img, ready, preload, enterStage, bossImages, loadStatus, drawWorld, drawSummary, drawFighter, drawPortrait, drawBackground, text, weapon, frameCanvas, canFilter, FONT,
  interpolateSnapshot: (a, b, k) => root.RenderFx ? root.RenderFx.interpolateSnapshot(a, b, k) : b || a };
})(window);
