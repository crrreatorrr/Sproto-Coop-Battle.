// Plays complete authored transformation cels against the authoritative snapshot clock.
(function (root) {
'use strict';
const DURATION = 480, ACTOR_ANCHOR = [110, 206];

function planClip(clip) {
  const positive = n => Number.isInteger(n) && n > 0;
  if (!clip || !Array.isArray(clip.cell) || clip.cell.length !== 2 ||
      !clip.cell.every(positive) || !Array.isArray(clip.anchor) || clip.anchor.length !== 2 ||
      !clip.anchor.every((n, i) => Number.isFinite(n) && n >= 0 && n < clip.cell[i]) ||
      !Array.isArray(clip.frameTicks) || clip.frameTicks.length < 2 || !clip.frameTicks.every(positive) ||
      clip.frameTicks.reduce((sum, ticks) => sum + ticks, 0) !== DURATION ||
      !Array.isArray(clip.pages) || !clip.pages.length) {
    throw new Error('Invalid authored boss transformation metadata');
  }
  let count = 0;
  const pages = clip.pages.map(page => {
    if (!page || !/^assets\/bosses\/transformations\/[a-z0-9/._-]+\.(png|webp)$/.test(page.src) ||
        page.src.split('/').includes('..') || !positive(page.columns) || !positive(page.frames)) {
      throw new Error('Invalid authored boss transformation page');
    }
    const first = count;
    count += page.frames;
    return { ...page, first, width: page.columns * clip.cell[0],
      height: Math.ceil(page.frames / page.columns) * clip.cell[1] };
  });
  if (count !== clip.frameTicks.length || new Set(pages.map(p => p.src)).size !== pages.length) {
    throw new Error('Authored boss transformation pages disagree with frame timings');
  }
  const ends = [];
  let end = 0;
  for (const ticks of clip.frameTicks) { end += ticks; ends.push(end); }
  function at(tick) {
    const time = Math.max(0, Math.min(DURATION - 1, Number.isFinite(tick) ? tick : 0));
    const frame = ends.findIndex(stop => time < stop);
    const page = pages.find(p => frame < p.first + p.frames);
    const local = frame - page.first;
    return { frame, page, x: (local % page.columns) * clip.cell[0],
      y: Math.floor(local / page.columns) * clip.cell[1] };
  }
  return { clip, pages, at };
}

function create(loader, manifest, registry) {
  const plans = new Map();
  let encounter = '', last = null, cachedFrame = -1, previousBoss = null;
  function clipFor(key) {
    const raw = registry?.clips?.[key];
    if (!raw) return null;
    const previous = plans.get(key);
    if (previous?.clip === raw) return previous;
    const plan = planClip(raw);
    plans.set(key, plan);
    return plan;
  }
  function sync(snapshot) {
    const key = manifest.bosses[snapshot.si]?.key;
    const boss = snapshot.boss;
    const restarted = previousBoss && boss &&
      ((previousBoss.ph > 0 && boss.ph === 0) ||
       (previousBoss.st === 'transform' && boss.st === 'transform' && boss.t < previousBoss.t));
    if (encounter !== key || restarted) {
      encounter = key;
      last = null;
      cachedFrame = -1;
    }
    if (boss?.st !== 'transform') { last = null; cachedFrame = -1; }
    previousBoss = boss ? { ph: boss.ph, st: boss.st, t: boss.t } : null;
    const plan = clipFor(key);
    if (!plan || (boss && boss.st !== 'transform' && boss.ph > 0)) {
      loader.setTransformPages([]);
      return;
    }
    const frame = plan.at(boss?.st === 'transform' ? boss.t : 0);
    const page = plan.pages.indexOf(frame.page);
    // Warm one page during phase one; playback retains only current + next.
    const count = boss?.st === 'transform' ? 2 : 1;
    loader.setTransformPages(plan.pages.slice(page, page + count).map(p => p.src));
  }
  function remember(picture, frame, plan) {
    if (cachedFrame === frame.frame) return;
    if (!last) {
      last = root.document.createElement('canvas');
      last.width = plan.clip.cell[0];
      last.height = plan.clip.cell[1];
    }
    const context = last.getContext('2d');
    context.clearRect(0, 0, last.width, last.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(picture, frame.x, frame.y, last.width, last.height, 0, 0, last.width, last.height);
    cachedFrame = frame.frame;
  }
  function draw(g, key, tick, x, y, facing, extent) {
    const plan = clipFor(key);
    if (!plan) return false;
    const frame = plan.at(tick);
    const image = loader.loaded(frame.page.src);
    let picture = image;
    let sx = frame.x, sy = frame.y;
    if (image && (image.naturalWidth !== frame.page.width || image.naturalHeight !== frame.page.height)) {
      throw new Error('Incorrect authored boss transformation page dimensions: ' + frame.page.src);
    }
    if (image) remember(image, frame, plan);
    else {
      picture = last;
      sx = sy = 0;
    }
    if (!picture) return false;
    const [w, h] = plan.clip.cell, [ax, ay] = plan.clip.anchor;
    // This uses the same world origin and game-space scale as the standing actor.
    const factor = extent / Math.max(w, h);
    g.save();
    g.imageSmoothingEnabled = false;
    g.translate(Math.round(x), Math.round(y));
    if (facing > 0) g.scale(-1, 1);
    g.drawImage(picture, sx, sy, w, h,
      -Math.round(ax * factor), -Math.round(ay * factor), Math.round(w * factor), Math.round(h * factor));
    g.restore();
    return true;
  }
  return { clipFor, sync, draw };
}

let player;
function shared() {
  if (!player) player = create(root.AssetLoader.shared(), root.MANIFEST, root.CoopBossTransformations);
  return player;
}
root.CoopBossTransformPlayer = { create, planClip, shared, duration: DURATION,
  actorAnchor: ACTOR_ANCHOR.slice() };
})(typeof window !== 'undefined' ? window : globalThis);
