// Pure presentation timeline: caller supplies the authoritative simulation age.
// No animation clock, networking, damage event or asset loading lives here.
(function (root) {
'use strict';
const positive = n => Number.isSafeInteger(n) && n > 0;
const nonnegative = n => Number.isSafeInteger(n) && n >= 0;

function plan(clip, options = {}) {
  const minimum = options.minFrames ?? 1;
  if (!clip || !Array.isArray(clip.cell) || clip.cell.length !== 2 || !clip.cell.every(positive) ||
      !Array.isArray(clip.anchor) || clip.anchor.length !== 2 || !clip.anchor.every(Number.isFinite) ||
      !Array.isArray(clip.frameTicks) || clip.frameTicks.length < minimum ||
      !clip.frameTicks.every(positive) || !Array.isArray(clip.pages) || !clip.pages.length) {
    throw new Error('Invalid sprite timeline metadata');
  }
  const cell = clip.cell.slice(), anchor = clip.anchor.slice();
  if (options.anchorInside && anchor.some((n, i) => n < 0 || n >= cell[i])) {
    throw new Error('Sprite anchor lies outside its cell');
  }
  const ends = [];
  let duration = 0;
  for (const ticks of clip.frameTicks) {
    duration += ticks;
    if (!positive(duration)) throw new Error('Sprite duration exceeds safe tick precision');
    ends.push(duration);
  }
  if (options.durationTicks !== undefined && duration !== options.durationTicks) {
    throw new Error('Sprite duration disagrees with the required state duration');
  }
  let count = 0;
  const pages = clip.pages.map(raw => {
    if (!raw || typeof raw.src !== 'string' || !raw.src ||
        (options.validateSource && !options.validateSource(raw.src)) ||
        !positive(raw.columns) || !positive(raw.frames) ||
        (raw.firstCell !== undefined && !nonnegative(raw.firstCell)) ||
        (raw.rows !== undefined && !positive(raw.rows))) {
      throw new Error('Invalid sprite timeline page');
    }
    if (raw.cells !== undefined && (!Array.isArray(raw.cells) || raw.cells.length !== raw.frames ||
        !raw.cells.every(nonnegative) || raw.firstCell !== undefined)) {
      throw new Error('Invalid sprite atlas cell sequence');
    }
    const cells = raw.cells?.slice();
    const firstCell = raw.firstCell ?? 0;
    const highest = cells ? cells.reduce((largest, index) => Math.max(largest, index), 0) : firstCell + raw.frames - 1;
    const rows = raw.rows ?? Math.floor(highest / raw.columns) + 1;
    const width = raw.columns * cell[0], height = rows * cell[1];
    const bytes = width * height * 4;
    if (!positive(width) || !positive(height) || !positive(bytes) || highest >= raw.columns * rows ||
        (options.maxTextureSide && Math.max(width, height) > options.maxTextureSide) ||
        (options.maxPageBytes && bytes > options.maxPageBytes)) {
      throw new Error('Sprite page exceeds its grid or resource budget');
    }
    const first = count;
    count += raw.frames;
    return { ...raw, cells, firstCell, first, rows, width, height, decodedBytes: bytes };
  });
  if (count !== ends.length || (!options.allowRepeatedSources && new Set(pages.map(p => p.src)).size !== pages.length)) {
    throw new Error('Sprite pages disagree with frame timing');
  }
  const pageEnds = pages.map(p => p.first + p.frames);
  function upperBound(stops, time) {
    let low = 0, high = stops.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (time < stops[middle]) high = middle;
      else low = middle + 1;
    }
    return low;
  }
  function at(tick, loop = false) {
    let time = Number.isFinite(tick) ? Math.max(0, tick) : 0;
    time = loop ? time % duration : Math.min(duration - 1, time);
    const frame = upperBound(ends, time);
    const pageIndex = upperBound(pageEnds, frame);
    const page = pages[pageIndex], local = frame - page.first;
    const sourceCell = page.cells ? page.cells[local] : page.firstCell + local;
    return { frame, page, pageIndex, sourceCell,
      x: (sourceCell % page.columns) * cell[0], y: Math.floor(sourceCell / page.columns) * cell[1],
      frameAge: time - (frame ? ends[frame - 1] : 0) };
  }
  return { clip, cell, anchor, duration, pages, at };
}

root.CoopSpriteTimeline = { plan };
if (typeof module !== 'undefined') module.exports = root.CoopSpriteTimeline;
})(typeof window !== 'undefined' ? window : globalThis);
