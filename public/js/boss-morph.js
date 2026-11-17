// Render a complete, nearest-neighbor cel from one pose and its displacement field.
(function (root) {
'use strict';
const CELL = 220, GRID = 12, FRAME_TICKS = 2;
const KEYS = [28, 96, 174, 258, 342, 442];
const POSES = [[0, 0, 0], [0, 6, 0], [0, 6, 1], [0, 6, 2], [0, 6, 3], [1, 0, 0]];
const FIELD_SIZE = GRID * GRID * 2;
const clamp = x => Math.max(0, Math.min(1, x));
const TOOL_TIMING = [0.42, 0.46, 0.32, 0.50, -0.24];
const STANCE_TIMING = [-0.30, -0.34, 0.17, 0.38, -0.20];
const indices = new Uint8Array(CELL), ratios = new Float32Array(CELL);
for (let x = 0; x < CELL; x++) {
  const point = x * (GRID - 1) / (CELL - 1);
  indices[x] = Math.min(GRID - 2, Math.floor(point));
  ratios[x] = point - indices[x];
}

function pose(t) {
  const tick = Math.max(0, Math.floor(t / FRAME_TICKS) * FRAME_TICKS);
  if (tick <= KEYS[0]) return { key: 0, progress: 0 };
  const end = KEYS.findIndex(key => tick < key);
  if (end < 0) return { key: KEYS.length - 1, progress: 0 };
  const gap = end - 1;
  let p = (tick - KEYS[gap]) / (KEYS[end] - KEYS[gap]);
  // Interior keys carry momentum into the next beat. Ease only from and to
  // the resting poses so the transformation plays as a single movement.
  if (gap === 0) p *= p * (2 - p);
  if (end === KEYS.length - 1) p += p * p * (1 - p);
  return { tick, gap, key: gap + Number(p >= 0.5), progress: p };
}

function context(read) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = CELL;
  return canvas.getContext('2d', read ? { willReadFrequently: true } : undefined);
}

let field, source, output, image, pixels, stage = -1, lastTick = -1;
const cells = new Map();
const rowX = [new Float32Array(GRID), new Float32Array(GRID)];
const rowY = [new Float32Array(GRID), new Float32Array(GRID)];
const outside = -64;

function contour(data) {
  const distance = new Int16Array(data.length).fill(96);
  const inside = i => i >= 0 && i < data.length && data[i] >>> 24 !== 0;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const i = y * CELL + x, ink = inside(i);
      if ((x === 0 ? ink : ink !== inside(i - 1)) ||
          (x === CELL - 1 ? ink : ink !== inside(i + 1)) ||
          ink !== inside(i - CELL) || ink !== inside(i + CELL)) distance[i] = 1;
    }
  }
  for (let i = 0; i < data.length; i++) {
    const x = i % CELL;
    if (x && i >= CELL) distance[i] = Math.min(distance[i], distance[i - CELL - 1] + 4);
    if (x < CELL - 1 && i >= CELL) distance[i] = Math.min(distance[i], distance[i - CELL + 1] + 4);
    if (x) distance[i] = Math.min(distance[i], distance[i - 1] + 3);
    if (i >= CELL) distance[i] = Math.min(distance[i], distance[i - CELL] + 3);
  }
  for (let i = data.length - 1; i >= 0; i--) {
    const x = i % CELL;
    if (x && i + CELL < data.length) distance[i] = Math.min(distance[i], distance[i + CELL - 1] + 4);
    if (x < CELL - 1 && i + CELL < data.length) distance[i] = Math.min(distance[i], distance[i + CELL + 1] + 4);
    if (x < CELL - 1) distance[i] = Math.min(distance[i], distance[i + 1] + 3);
    if (i + CELL < data.length) distance[i] = Math.min(distance[i], distance[i + CELL] + 3);
  }
  for (let i = 0; i < data.length; i++) distance[i] = Math.min(64, distance[i]) * (inside(i) ? 1 : -1);
  return distance;
}

function readCell(key, sheet) {
  if (!cells.has(key)) {
    const [, row, col] = POSES[key];
    source.clearRect(0, 0, CELL, CELL);
    source.drawImage(sheet, col * CELL, row * CELL, CELL, CELL, 0, 0, CELL, CELL);
    const rgba = new Uint32Array(source.getImageData(0, 0, CELL, CELL).data.buffer);
    cells.set(key, { rgba, contour: contour(rgba) });
  }
  return cells.get(key);
}

function sampleIndex(x, y, direction, strength) {
  const k = indices[x], u = ratios[x], dx = rowX[direction], dy = rowY[direction];
  const sx = Math.round(x - strength * (dx[k] + (dx[k + 1] - dx[k]) * u));
  const sy = Math.round(y - strength * (dy[k] + (dy[k + 1] - dy[k]) * u));
  return sx >= 0 && sx < CELL && sy >= 0 && sy < CELL ? sy * CELL + sx : -1;
}

function generate(index, frame, sheets) {
  if (!frame.progress || !root.CoopBossMorphField) return null;
  if (!field) field = Int8Array.from(root.atob(root.CoopBossMorphField), c => c.charCodeAt(0));
  const offset = (index * (KEYS.length - 1) + frame.gap) * FIELD_SIZE * 2;
  if (offset + FIELD_SIZE * 2 > field.length) return null;
  const at = frame.gap;
  const fromSheet = sheets[POSES[at][0]], toSheet = sheets[POSES[at + 1][0]];
  if (!fromSheet.naturalWidth || !toSheet.naturalWidth) return null;
  if (!output) {
    source = context(true);
    output = context(false);
    image = output.createImageData(CELL, CELL);
    pixels = new Uint32Array(image.data.buffer);
  }
  if (stage !== index) {
    cells.clear();
    stage = index;
    lastTick = -1;
  }
  if (lastTick === frame.tick) return output.canvas;

  const a = readCell(at, fromSheet), b = readCell(at + 1, toSheet);
  const fieldAnchors = root.CoopBossMorphGuides?.[index];
  const [[ax, ay], [hx, hy]] = fieldAnchors?.[at] || [[112, 118], [60, 134]];
  const [[bx, by], [jx, jy]] = fieldAnchors?.[at + 1] || [[ax, ay], [hx, hy]];
  const p = frame.progress, q = 1 - p;
  const hingeX = hx * q + jx * p, hingeY = hy * q + jy * p;
  const pilotX = ax * q + bx * p, pilotY = ay * q + by * p;
  const stance = p * q * STANCE_TIMING[at], tool = p * q * TOOL_TIMING[at];
  const stride = GRID * 2;
  const toolDirection = 2 * clamp((hingeX - pilotX) / 48 + 0.5) - 1;
  const toolReach = Math.max(26, Math.abs(hingeX - pilotX) + 16);
  for (let y = 0; y < CELL; y++) {
    const footProgress = stance * clamp((y - pilotY - 18) / 54);
    const toolProgress = tool * (1 - clamp(Math.abs(y - hingeY) / 65));
    const plateHeight = 0.26 * (clamp((y - pilotY + 48) / 114) - 0.5);
    for (let direction = 0; direction < 2; direction++) {
      const row = offset + direction * FIELD_SIZE + indices[y] * stride;
      const v = ratios[y];
      for (let k = 0; k < GRID; k++) {
        const i = row + k * 2;
        rowX[direction][k] = field[i] + (field[i + stride] - field[i]) * v;
        rowY[direction][k] = field[i + 1] + (field[i + stride + 1] - field[i + 1]) * v;
      }
    }
    for (let x = 0; x < CELL; x++) {
      // The forward mechanism and planted base move on separate beats.
      // Their timing tapers into the cockpit instead of moving every part
      // at the same rate or switching the entire painted image together.
      const forward = clamp(((x - pilotX) * toolDirection + 12) / toolReach);
      const time = clamp(p + footProgress + toolProgress * forward);
      const inverse = 1 - time;
      const ai = sampleIndex(x, y, 0, time), bi = sampleIndex(x, y, 1, inverse);
      const da = a.contour[ai] ?? outside, db = b.contour[bi] ?? outside;
      // A single opaque contour opens and retracts along its edges. Blending
      // two translucent silhouettes here would leave both weapon racks visible.
      let color = 0;
      if (da * inverse + db * time > 0) {
        // Refinish each region as it seats. Use actual cel colors so the
        // change of armor never averages two misaligned textures together.
        const plateDepth = 0.72 * (0.5 - clamp(Math.abs(x - pilotX) / 76));
        const finish = time + p * q * (plateHeight + plateDepth);
        color = da > 0 && (finish < 0.5 || db < 0) ? a.rgba[ai] : b.rgba[bi];
      }
      pixels[y * CELL + x] = color;
    }
  }
  output.putImageData(image, 0, 0);
  lastTick = frame.tick;
  return output.canvas;
}

root.CoopBossMorph = { pose, generate, poses: POSES, keyTicks: KEYS };
})(globalThis);
