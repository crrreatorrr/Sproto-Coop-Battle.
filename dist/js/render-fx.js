// In-game effect drawing for render.js, loaded by Render.enterStage so the title screen's transfer
// budget does not pay for it: world fx, charger fire lanes, boss lane and rear-sweep warnings, and
// the boss attack effect sheets in assets/fx/ (layout in tools/build-boss-fx.py). Until it has
// loaded, render.js simply skips these layers.
(function (root) {
'use strict';
const S = root.Sim, R = root.Render;
const { W, H, FLOOR_TOP } = S;
const BS = S.BOSS_SCALE, img = R.img, ready = R.ready, text = R.text;
const fxImg = k => img('assets/fx/' + k + '.png');

// Flickering amber warning light standing at (x, y).
function warnLight(g, x, y, t, k) {
  const im = fxImg('lights'); if (!ready(im)) return;
  const f = (t >> 2) % 4, h = 30 * (k || 1), w = h * 19 / 56;
  g.save(); g.globalCompositeOperation = 'screen'; g.globalAlpha = Math.floor(t / 4) % 2 ? 1 : 0.55;
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
    g.fillStyle = '#fff'; g.beginPath(); g.arc(sx, sy, r * 0.3 * Math.max(0, 1 - f.t / 12), 0, 7); g.fill();
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
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.ellipse(sx, gy, 30 * (1 - k) + 3, 14 * (1 - k) + 2, 0, 0, 7); g.stroke();
  } else if (f.k === 'shield') {
    g.strokeStyle = `rgba(120,255,140,${1 - f.t / 14})`; g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, 30, 0, 7); g.stroke();
  }
}

function floor(g, snap, camX, list) {
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
      g.fillStyle = warn ? `rgba(${spikes ? '220,60,255' : '255,150,30'},${(spikes ? 0.16 : 0.3) + 0.3 * k + (Math.floor(bw.t / 4) % 2 ? 0.1 : 0)})` : 'rgba(255,240,200,.7)';
      g.fillRect(lx, FLOOR_TOP, lw, S.DEPTH);
      g.strokeStyle = 'rgba(255,236,170,.95)'; g.lineWidth = 1; g.strokeRect(lx + 0.5, FLOOR_TOP + 0.5, lw - 1, S.DEPTH - 1);
      if (warn && Math.floor(bw.t / 6) % 2) text(g, 'BEHIND! JUMP!', lx + lw / 2, FLOOR_TOP - 10, 8, '#ffb23d', 'center');
    }
  }
}

root.RenderFx = { fx: drawFx, floor, windup };
})(typeof window !== 'undefined' ? window : globalThis);
