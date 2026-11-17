// Render a complete, nearest-neighbor cel from one pose and its displacement field.
(function (root) {
'use strict';
const CELL = 220, GRID = 12, FRAME_TICKS = 3;
const KEYS = [0, 78, 159, 243, 336, 429];
const POSES = [[0, 0, 0], [0, 6, 0], [0, 6, 1], [0, 6, 2], [0, 6, 3], [1, 0, 0]];
const FIELD_SIZE = GRID * GRID * 2;
const EASE = x => x * x * (3 - 2 * x);
const indices = new Uint8Array(CELL), ratios = new Float32Array(CELL);
for (let x = 0; x < CELL; x++) {
  const point = x * (GRID - 1) / (CELL - 1);
  indices[x] = Math.min(GRID - 2, Math.floor(point));
  ratios[x] = point - indices[x];
}

function pose(t) {
  const tick = Math.max(0, Math.floor(t / FRAME_TICKS) * FRAME_TICKS);
  const end = KEYS.findIndex(key => tick < key);
  if (end < 0) return { key: KEYS.length - 1, progress: 0 };
  const gap = end - 1;
  const p = EASE((tick - KEYS[gap]) / (KEYS[end] - KEYS[gap]));
  const direction = p < 0.5 ? 0 : 1;
  return { tick, gap, key: gap + direction, progress: p };
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

function sampleIndex(x, y, direction) {
  const k = indices[x], u = ratios[x], dx = rowX[direction], dy = rowY[direction];
  const sx = Math.round(x - (dx[k] + (dx[k + 1] - dx[k]) * u));
  const sy = Math.round(y - (dy[k] + (dy[k + 1] - dy[k]) * u));
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
  const p = frame.progress, q = 1 - p;
  const stride = GRID * 2;
  for (let y = 0; y < CELL; y++) {
    for (let direction = 0; direction < 2; direction++) {
      const row = offset + direction * FIELD_SIZE + indices[y] * stride;
      const v = ratios[y], shift = direction ? q : p;
      for (let k = 0; k < GRID; k++) {
        const i = row + k * 2;
        rowX[direction][k] = shift * (field[i] + (field[i + stride] - field[i]) * v);
        rowY[direction][k] = shift * (field[i + 1] + (field[i + stride + 1] - field[i + 1]) * v);
      }
    }
    for (let x = 0; x < CELL; x++) {
      const ai = sampleIndex(x, y, 0), bi = sampleIndex(x, y, 1);
      const da = a.contour[ai] ?? outside, db = b.contour[bi] ?? outside;
      // A single opaque contour opens and retracts along its edges. Blending
      // two translucent silhouettes here would leave both weapon racks visible.
      let color = 0;
      if (da * q + db * p > 0) {
        // Keep the dominant cel's painted detail sharp. The other cel colors
        // only the patches exposed by the moving silhouette.
        color = da > 0 && (p < 0.5 || db < 0) ? a.rgba[ai] : b.rgba[bi];
      }
      pixels[y * CELL + x] = color;
    }
  }
  output.putImageData(image, 0, 0);
  lastTick = frame.tick;
  return output.canvas;
}

root.CoopBossMorph = { pose, generate, poses: POSES };
})(globalThis);
