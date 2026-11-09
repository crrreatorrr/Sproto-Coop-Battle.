// Staged image loader. Fighter bodies come from one atlas per character.
// Lobby art blocks the title; the current stage and its boss follow; the next
// stage is prefetched. Boss sheets stay lazy. Failures retry and then reject.
(function (root) {
'use strict';

const CELL = 128;
const COLS = 8;
const POSES = 40;
const ATTEMPTS = 3;
const LOAD_SLOTS = 4;
const DECODE_SLOTS = 2;
const STAGE_EXTRA = 8;
const UFO_EXTRA = 12;

function poseIndex(pose) {
  if (typeof pose === 'number' && pose >= 0 && pose < 32) return pose;
  if (typeof pose === 'string' && pose.charAt(0) === 'w') {
    const n = Number(pose.slice(2));
    if (n >= 0 && n < 8) return 32 + n;
  }
  return -1;
}

function frameRect(pose) {
  const i = poseIndex(pose);
  if (i < 0 || i >= POSES) return null;
  return { i: i, x: (i % COLS) * CELL, y: Math.floor(i / COLS) * CELL, w: CELL, h: CELL };
}

function atlasPath(id) { return 'assets/fighters/' + id + '/atlas.png'; }

function stageNo(i) { return String((i % 12) + 1).padStart(2, '0'); }

function scenery(i) {
  const n = stageNo(i);
  return ['assets/stages/' + n + '-back.jpg', 'assets/stages/' + n + '-floor.png'];
}

function bossPaths(manifest, i) {
  const out = [];
  const phases = manifest.bosses[i].phases;
  for (let p = 0; p < phases.length; p++) out.push(phases[p].sheet, phases[p].proj);
  return out;
}

// Drawn by render.js. idle.png and muzzle.png are on disk and unused.
const UFO = ['cockpit-front', 'cockpit-rear', 'laser', 'beach-ball', 'shield1', 'shield2', 'shield3', 'shield4']
  .map(function (name) { return 'assets/ufo/' + name + '.png'; });

function unique(list) {
  const seen = new Set();
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (seen.has(list[i])) continue;
    seen.add(list[i]);
    out.push(list[i]);
  }
  return out;
}

function groups(manifest) {
  const atlas = manifest.fighters.map(function (f) { return atlasPath(f.id); });
  const stages = [];
  const bosses = [];
  for (let i = 0; i < manifest.bosses.length; i++) {
    stages.push.apply(stages, scenery(i));
    bosses.push.apply(bosses, bossPaths(manifest, i));
  }
  // Title background is stage 1. The lobby backdrop is stage 5 (theme index 4).
  const startup = atlas.concat(scenery(0), scenery(4));
  const firstBoss = bossPaths(manifest, 0);
  return {
    atlas: atlas,
    startup: startup,
    firstBoss: firstBoss,
    ufo: UFO.slice(),
    stages: stages,
    bosses: bosses,
    all: unique(atlas.concat(stages, bosses, UFO)),
    scenery: scenery,
    boss: function (i) { return bossPaths(manifest, i); },
  };
}

function resolve(rel, base) {
  if (!base) return rel;
  try { return new URL(rel, base).href; }
  catch (err) { return rel; }
}

function pageScripts(html) {
  const out = [];
  const re = /<script\s+src="([^"]+)"/g;
  let match;
  while ((match = re.exec(html))) out.push(match[1]);
  return out;
}

function budgetOf(manifest, bytesOf, scriptPaths, htmlBytes) {
  const g = groups(manifest);
  const sum = function (list) {
    let n = 0;
    for (let i = 0; i < list.length; i++) n += bytesOf(list[i]);
    return n;
  };
  let scriptBytes = 0;
  for (let i = 0; i < scriptPaths.length; i++) scriptBytes += bytesOf(scriptPaths[i]);
  const titleBytes = htmlBytes + scriptBytes + sum(g.startup);
  const firstStageBytes = titleBytes + sum(g.firstBoss) + sum(g.ufo);
  return {
    titleBytes: titleBytes,
    firstStageBytes: firstStageBytes,
    criticalRequests: 1 + scriptPaths.length + g.startup.length + g.firstBoss.length,
    startupImages: g.startup.length,
    firstBossImages: g.firstBoss.length,
    ufoImages: g.ufo.length,
    scriptCount: scriptPaths.length,
  };
}

function lru(cap) {
  const map = new Map();
  return {
    get: function (key) {
      if (!map.has(key)) return undefined;
      const value = map.get(key);
      map.delete(key);
      map.set(key, value);
      return value;
    },
    set: function (key, value) {
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      while (map.size > cap) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
    },
    get size() { return map.size; },
    clear: function () { map.clear(); },
  };
}

function groupOf(src) {
  if (src.indexOf('/fighters/') >= 0) return 'fighter';
  if (src.indexOf('/bosses/') >= 0) return 'boss';
  if (src.indexOf('/stages/') >= 0) return 'stage';
  if (src.indexOf('/ufo/') >= 0) return 'ufo';
  return 'other';
}

function create(opts) {
  opts = opts || {};
  const records = new Map();
  const queue = [];
  const decodeQueue = [];
  const maxLoad = opts.loadSlots || LOAD_SLOTS;
  const maxDecode = opts.decodeSlots || DECODE_SLOTS;
  const maxAttempts = opts.attempts || ATTEMPTS;
  const base = opts.base;
  const delays = opts.delays || [150, 400];
  const schedule = opts.schedule || function (fn, ms) { setTimeout(fn, ms); };
  const now = opts.now || function () { return root.performance && root.performance.now ? root.performance.now() : Date.now(); };
  let loadSlots = 0;
  let decodeSlots = 0;
  let peakLoad = 0;
  let peakDecode = 0;
  let clock = 0;
  let stagePins = new Set();
  const timings = [];

  function newImage() {
    if (opts.Image) return new opts.Image();
    return new root.Image();
  }

  function enqueue(rec) {
    if (rec.priority <= 0) {
      let i = 0;
      while (i < queue.length && queue[i].priority <= 0) i++;
      queue.splice(i, 0, rec);
    } else queue.push(rec);
  }

  function pump() {
    while (loadSlots < maxLoad) {
      let idx = -1;
      for (let i = 0; i < queue.length; i++) if (queue[i].state === 'queued') { idx = i; break; }
      if (idx < 0) break;
      const rec = queue.splice(idx, 1)[0];
      startLoad(rec);
    }
    while (decodeSlots < maxDecode && decodeQueue.length) startDecode(decodeQueue.shift());
  }

  function startLoad(rec) {
    rec.state = 'loading';
    loadSlots++;
    if (loadSlots > peakLoad) peakLoad = loadSlots;
    const token = ++rec.token;
    const img = rec.img;
    const fail = function () {
      if (rec.token !== token || rec.state !== 'loading') return;
      loadSlots = Math.max(0, loadSlots - 1);
      retry(rec);
      pump();
    };
    const ok = function () {
      if (rec.token !== token || rec.state !== 'loading') return;
      if (!(img.naturalWidth > 0)) { fail(); return; }
      rec.state = 'downloaded';
      loadSlots = Math.max(0, loadSlots - 1);
      decodeQueue.push(rec);
      pump();
    };
    img.onload = ok;
    img.onerror = fail;
    try { img.src = resolve(rec.src, base); }
    catch (err) { fail(); return; }
    if (img.complete && img.naturalWidth > 0) ok();
  }

  function startDecode(rec) {
    rec.state = 'decoding';
    decodeSlots++;
    if (decodeSlots > peakDecode) peakDecode = decodeSlots;
    const token = rec.token;
    const finish = function () {
      if (rec.token !== token || rec.state !== 'decoding') {
        decodeSlots = Math.max(0, decodeSlots - 1);
        pump();
        return;
      }
      rec.state = 'ready';
      rec.decoded = rec.img.naturalWidth * rec.img.naturalHeight * 4;
      rec.ms = now() - rec.t0;
      timings.push({ src: rec.src, ms: rec.ms });
      decodeSlots = Math.max(0, decodeSlots - 1);
      const waiters = rec.waiters.splice(0);
      for (let i = 0; i < waiters.length; i++) waiters[i].resolve();
      pump();
    };
    const bad = function () {
      if (rec.token !== token || rec.state !== 'decoding') {
        decodeSlots = Math.max(0, decodeSlots - 1);
        pump();
        return;
      }
      decodeSlots = Math.max(0, decodeSlots - 1);
      retry(rec);
      pump();
    };
    let pending = null;
    try { if (typeof rec.img.decode === 'function') pending = rec.img.decode(); }
    catch (err) { pending = Promise.reject(err); }
    if (pending && typeof pending.then === 'function') pending.then(finish, bad);
    else finish();
  }

  function retry(rec) {
    rec.attempts++;
    if (rec.attempts >= maxAttempts) {
      rec.state = 'error';
      const waiters = rec.waiters.splice(0);
      const err = new Error('asset failed: ' + rec.src);
      err.src = rec.src;
      for (let i = 0; i < waiters.length; i++) waiters[i].reject(err);
      return;
    }
    rec.state = 'backoff';
    const delay = delays[Math.min(rec.attempts - 1, delays.length - 1)];
    schedule(function () {
      if (rec.state !== 'backoff') return;
      rec.state = 'queued';
      rec.priority = 0;
      enqueue(rec);
      pump();
    }, delay);
  }

  function request(src, opts2) {
    opts2 = opts2 || {};
    clock++;
    let rec = records.get(src);
    if (rec && rec.state === 'error' && opts2.retry) {
      records.delete(src);
      rec = null;
    }
    const priority = opts2.prefetch ? 1 : 0;
    if (!rec) {
      rec = {
        src: src, group: groupOf(src), state: 'queued', attempts: 0, token: 0,
        waiters: [], pin: opts2.pin || '', used: clock, t0: now(), img: newImage(),
        decoded: 0, priority: priority, ms: 0,
      };
      records.set(src, rec);
      enqueue(rec);
      pump();
    } else {
      rec.used = clock;
      if (opts2.pin) rec.pin = opts2.pin;
      if (rec.state === 'queued' && priority < rec.priority) {
        rec.priority = priority;
        const at = queue.indexOf(rec);
        if (at >= 0) queue.splice(at, 1);
        enqueue(rec);
        pump();
      }
    }
    let promise;
    if (rec.state === 'ready') promise = Promise.resolve();
    else if (rec.state === 'error') promise = Promise.reject(Object.assign(new Error('asset failed: ' + src), { src: src }));
    else promise = new Promise(function (resolvePromise, rejectPromise) { rec.waiters.push({ resolve: resolvePromise, reject: rejectPromise }); });
    return { promise: promise, record: rec };
  }

  function image(src, opts2) {
    const job = request(src, opts2);
    job.promise.catch(function () {});
    return job.record.img;
  }

  function preload(list, onProgress) {
    if (!list.length) {
      if (onProgress) onProgress(1);
      return Promise.resolve();
    }
    let done = 0;
    return Promise.all(list.map(function (src) {
      const pin = src.indexOf('/fighters/') >= 0 ? 'fighter' : 'startup';
      return request(src, { pin: pin, retry: true }).promise.then(function () {
        done++;
        if (onProgress) onProgress(done / list.length);
      });
    }));
  }

  function prefetch(list) {
    for (let i = 0; i < list.length; i++) request(list[i], { prefetch: true }).promise.catch(function () {});
  }

  function drop(rec) {
    if (rec.state === 'loading') loadSlots = Math.max(0, loadSlots - 1);
    if (rec.state === 'decoding') decodeSlots = Math.max(0, decodeSlots - 1);
    rec.state = 'dead';
    rec.token++;
    const at = queue.indexOf(rec);
    if (at >= 0) queue.splice(at, 1);
    const dec = decodeQueue.indexOf(rec);
    if (dec >= 0) decodeQueue.splice(dec, 1);
    if (rec.img) {
      rec.img.onload = null;
      rec.img.onerror = null;
      try { rec.img.src = ''; } catch (err) { /* fake images may reject an empty src */ }
    }
    const waiters = rec.waiters.splice(0);
    records.delete(rec.src);
    const err = new Error('evicted ' + rec.src);
    for (let i = 0; i < waiters.length; i++) waiters[i].reject(err);
  }

  function evict() {
    const extra = { boss: 0, stage: STAGE_EXTRA, ufo: UFO_EXTRA };
    Object.keys(extra).forEach(function (group) {
      const loose = [];
      records.forEach(function (rec) {
        if (rec.group !== group || rec.state === 'dead') return;
        if (rec.pin === 'fighter' || rec.pin === 'startup') return;
        if (stagePins.has(rec.src)) return;
        if (rec.waiters.length && rec.state !== 'ready') return;
        loose.push(rec);
      });
      loose.sort(function (a, b) { return a.used - b.used; });
      while (loose.length > extra[group]) drop(loose.shift());
    });
    pump();
  }

  function enterStage(index, manifest) {
    if (index < 0 || index >= manifest.bosses.length) return;
    const current = scenery(index).concat(bossPaths(manifest, index));
    const next = index + 1 < manifest.bosses.length ? scenery(index + 1).concat(bossPaths(manifest, index + 1)) : [];
    stagePins = new Set(current.concat(next));
    for (let i = 0; i < current.length; i++) request(current[i], { pin: 'stage' }).promise.catch(function () {});
    for (let i = 0; i < next.length; i++) request(next[i], { pin: 'stage', prefetch: true }).promise.catch(function () {});
    evict();
  }

  function status() {
    const resident = { boss: 0, stage: 0, fighter: 0, ufo: 0, other: 0 };
    const decoded = { boss: 0, stage: 0, fighter: 0, ufo: 0, other: 0 };
    const errors = [];
    let pending = 0;
    let ready = 0;
    records.forEach(function (rec) {
      if (rec.state === 'ready') {
        ready++;
        resident[rec.group] = (resident[rec.group] || 0) + 1;
        decoded[rec.group] = (decoded[rec.group] || 0) + rec.decoded;
      } else if (rec.state === 'error') errors.push(rec.src);
      else if (rec.state !== 'dead') pending++;
    });
    return { pending: pending, ready: ready, error: errors.length, errors: errors, resident: resident, decoded: decoded, timings: timings.slice() };
  }

  function debug() {
    return { loadSlots: loadSlots, decodeSlots: decodeSlots, peakLoad: peakLoad, peakDecode: peakDecode, queued: queue.length, records: records.size };
  }

  return { request: request, image: image, preload: preload, prefetch: prefetch, enterStage: enterStage, status: status, debug: debug };
}

let singleton = null;
function shared() {
  if (!singleton) {
    const base = root.document && root.document.baseURI ? root.document.baseURI : undefined;
    singleton = create({ base: base });
  }
  return singleton;
}

root.AssetLoader = {
  CELL: CELL,
  COLS: COLS,
  LOAD_SLOTS: LOAD_SLOTS,
  DECODE_SLOTS: DECODE_SLOTS,
  ATTEMPTS: ATTEMPTS,
  STAGE_EXTRA: STAGE_EXTRA,
  poseIndex: poseIndex,
  frameRect: frameRect,
  atlasPath: atlasPath,
  groups: groups,
  resolve: resolve,
  pageScripts: pageScripts,
  budgetOf: budgetOf,
  lru: lru,
  create: create,
  shared: shared,
};
})(typeof window !== 'undefined' ? window : this);
