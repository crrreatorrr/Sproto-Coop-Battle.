// Loader contracts: concurrency, retry, base path, and a bounded stage/boss cache.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadApi() {
  const sandbox = { window: {}, URL, performance, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'asset-loader.js'), 'utf8'), sandbox, { filename: 'asset-loader.js' });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'manifest.js'), 'utf8'), sandbox, { filename: 'manifest.js' });
  return { AssetLoader: sandbox.window.AssetLoader, manifest: sandbox.window.MANIFEST };
}

function sizeFor(src) {
  if (src.includes('/bosses/')) return [1024, 1024];
  if (src.includes('/atlas.png')) return [1024, 640];
  if (src.includes('-floor')) return [512, 150];
  return [640, 226];
}

function harness() {
  const pending = [];
  class FakeImage {
    constructor() {
      this.complete = false;
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      this.onload = null;
      this.onerror = null;
      this._src = '';
      this.hold = null;
    }
    set src(value) {
      this._src = value || '';
      if (!this._src) { this.complete = false; this.naturalWidth = 0; return; }
      pending.push(this);
    }
    get src() { return this._src; }
    decode() { return Promise.resolve(); }
    succeed() {
      const [w, h] = sizeFor(this._src);
      this.naturalWidth = w;
      this.naturalHeight = h;
      this.complete = true;
      if (this.onload) this.onload();
    }
  }
  const timers = [];
  const { AssetLoader, manifest } = loadApi();
  const loader = AssetLoader.create({
    Image: FakeImage,
    schedule: fn => { timers.push(fn); },
    now: () => 0,
  });
  async function drain() {
    for (let guard = 0; guard < 500; guard++) {
      const batch = pending.splice(0);
      batch.forEach(img => img.succeed());
      await Promise.resolve();
      const debug = loader.debug();
      if (!batch.length && !pending.length && !debug.queued && !debug.loadSlots && !debug.decodeSlots) break;
    }
  }
  return { AssetLoader, manifest, loader, pending, timers, drain, flush() { timers.splice(0).forEach(fn => fn()); } };
}

async function main() {
  const { AssetLoader } = loadApi();
  assert.strictEqual(AssetLoader.poseIndex(0), 0);
  assert.strictEqual(AssetLoader.poseIndex(31), 31);
  assert.strictEqual(AssetLoader.poseIndex('w00'), 32);
  assert.strictEqual(AssetLoader.poseIndex('w07'), 39);
  assert.strictEqual(AssetLoader.poseIndex('nope'), -1);
  const rect = AssetLoader.frameRect('w00');
  assert.deepStrictEqual({ x: rect.x, y: rect.y, w: rect.w, h: rect.h }, { x: 0, y: 512, w: 128, h: 128 });
  const base = 'https://play.example/sproto-coop-battle/';
  assert.strictEqual(AssetLoader.resolve('assets/fighters/vamp/atlas.png', base), base + 'assets/fighters/vamp/atlas.png');
  assert.strictEqual(
    AssetLoader.resolve('assets/fighters/vamp/atlas.png', 'https://play.example/sproto-coop-battle/index.html'),
    base + 'assets/fighters/vamp/atlas.png',
  );
  assert.strictEqual(AssetLoader.resolve('assets/a.png'), 'assets/a.png');

  const cache = AssetLoader.lru(3);
  cache.set('a', 1); cache.set('b', 2); cache.set('c', 3); cache.set('d', 4);
  assert.strictEqual(cache.size, 3);
  assert.strictEqual(cache.get('a'), undefined);
  cache.get('b');
  cache.set('e', 5);
  assert.strictEqual(cache.get('c'), undefined);
  assert.strictEqual(cache.get('b'), 2);

  const limited = harness();
  const jobs = [];
  for (let i = 0; i < 20; i++) jobs.push(limited.loader.request('assets/stages/batch-' + i + '.png').promise);
  assert.strictEqual(limited.loader.debug().peakLoad, limited.AssetLoader.LOAD_SLOTS);
  assert.strictEqual(limited.loader.debug().loadSlots, limited.AssetLoader.LOAD_SLOTS);
  assert.strictEqual(limited.pending.length, limited.AssetLoader.LOAD_SLOTS);
  const first = limited.pending.splice(0, limited.AssetLoader.LOAD_SLOTS);
  first.forEach(img => img.succeed());
  assert.strictEqual(limited.loader.debug().peakDecode, limited.AssetLoader.DECODE_SLOTS);
  assert.strictEqual(limited.loader.debug().decodeSlots, limited.AssetLoader.DECODE_SLOTS);
  await limited.drain();
  await Promise.all(jobs);

  const flaky = harness();
  let tries = 0;
  class Flaky {
    constructor() { this.onload = null; this.onerror = null; this.naturalWidth = 0; this.naturalHeight = 0; this.complete = false; }
    set src(_value) {
      tries++;
      if (tries < 3) { if (this.onerror) this.onerror(); return; }
      this.naturalWidth = 4; this.naturalHeight = 4; this.complete = true;
      if (this.onload) this.onload();
    }
    get src() { return 'x'; }
    decode() { return Promise.resolve(); }
  }
  const flakyLoader = flaky.AssetLoader.create({ Image: Flaky, schedule: fn => { flaky.timers.push(fn); }, now: () => 0 });
  const recovered = flakyLoader.preload(['assets/stages/01-back.jpg']);
  assert.strictEqual(tries, 1);
  flaky.flush();
  assert.strictEqual(tries, 2);
  flaky.flush();
  assert.strictEqual(tries, 3);
  await recovered;

  const broken = harness();
  let fails = 0;
  class Boom {
    constructor() { this.onload = null; this.onerror = null; this.naturalWidth = 0; this.complete = false; }
    set src(_value) { fails++; if (this.onerror) this.onerror(); }
    get src() { return ''; }
  }
  const boom = broken.AssetLoader.create({ Image: Boom, schedule: fn => { broken.timers.push(fn); }, attempts: 3 });
  let rejected = null;
  const failing = boom.preload(['assets/bosses/missing.png']).catch(err => { rejected = err; });
  broken.flush();
  broken.flush();
  await failing;
  assert.strictEqual(fails, 3);
  assert.ok(rejected && /asset failed/.test(rejected.message));
  assert.strictEqual(boom.status().error, 1);

  const memory = harness();
  const plan = memory.AssetLoader.groups(memory.manifest);
  assert.strictEqual(plan.startup.length, 10);
  assert.strictEqual(plan.firstBoss.length, 4);
  assert.strictEqual(plan.ufo.length, 8);
  assert.ok(plan.all.includes('assets/fighters/vamp/atlas.png'));
  assert.ok(!plan.all.some(src => /\/(?:\d\d|w0\d)\.png$/.test(src)));
  const startup = memory.loader.preload(plan.startup);
  await memory.drain();
  await startup;
  assert.strictEqual(memory.loader.status().resident.fighter, 6);
  for (let i = 0; i < 12; i++) {
    memory.loader.enterStage(i, memory.manifest);
    await memory.drain();
  }
  const stat = memory.loader.status();
  assert.ok(stat.resident.boss <= 8, 'boss resident ' + stat.resident.boss);
  assert.ok(stat.decoded.boss <= 8 * 1024 * 1024 * 4, 'boss decoded ' + stat.decoded.boss);
  assert.ok(stat.resident.stage <= plan.startup.filter(src => src.includes('/stages/')).length + 2 + memory.AssetLoader.STAGE_EXTRA);
  assert.strictEqual(stat.resident.fighter, 6);
  assert.strictEqual(stat.error, 0);
  console.log('loading ok');
}

const hung = setTimeout(() => {
  console.error('loading test hung');
  process.exit(1);
}, 5000);
main().then(() => { clearTimeout(hung); }, err => {
  clearTimeout(hung);
  console.error(err);
  process.exit(1);
});
