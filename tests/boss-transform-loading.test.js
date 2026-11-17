'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  const pending = [], decodes = [];
  class Image {
    constructor() { this.complete = false; this.naturalWidth = this.naturalHeight = 0; }
    set src(value) {
      this._src = value;
      if (value) pending.push(this);
      else { this.complete = false; this.naturalWidth = this.naturalHeight = 0; }
    }
    get src() { return this._src; }
    decode() { return new Promise(resolve => decodes.push({ image: this, resolve })); }
    succeed() {
      if (!this.src) return;
      this.complete = true;
      this.naturalWidth = this.src.includes('/transformations/') ? 1760 : 880;
      this.naturalHeight = this.src.includes('/transformations/') ? 1100 : 1540;
      this.onload?.();
    }
  }
  const scope = { window: {}, performance, setTimeout, clearTimeout, URL };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/asset-loader.js'), 'utf8'), scope);
  const loader = scope.window.AssetLoader.create({ Image });
  const manifest = { stages: [{ back: 'assets/stages/01.png' }, { back: 'assets/stages/02.png' }],
    bosses: [0, 1].map(n => ({ key: 'boss-' + n, phases: [0, 1].map(ph => ({
      sheet: `assets/bosses/b${n}-${ph}.png`, proj: `assets/bosses/b${n}-${ph}-shots.png`,
    })) })) };
  const pages = Array.from({ length: 5 }, (_, i) => `assets/bosses/transformations/test-${i}.webp`);
  async function drain() {
    for (let n = 0; n < 100; n++) {
      pending.splice(0).forEach(image => image.succeed());
      decodes.splice(0).forEach(job => job.resolve());
      await Promise.resolve();
      if (!pending.length && !decodes.length && !loader.debug().loadSlots && !loader.debug().decodeSlots) return;
    }
    throw new Error('loader failed to settle');
  }
  manifest.fighters = [];
  const before = scope.window.AssetLoader.budgetOf(manifest, () => 1, [], 1);
  scope.window.CoopBossTransformations = { version: 1, clips: { 'boss-0': { pages: pages.map(src => ({ src })) } } };
  const groups = scope.window.AssetLoader.groups(manifest);
  assert.ok(pages.every(src => groups.all.includes(src)), 'authored pages participate in dynamic asset inventory');
  const after = scope.window.AssetLoader.budgetOf(manifest, src => src.includes('/transformations/') ? 1234 : 1, [], 1);
  assert.equal(after.firstStageBytes - before.firstStageBytes, 1234, 'first-stage accounting includes exactly one warmed authored page');
  assert.equal(after.criticalRequests - before.criticalRequests, 1);
  loader.enterStage(0, manifest);
  await drain();
  assert.equal(loader.status().resident.boss, 8);
  loader.setTransformPages(pages.slice(0, 2));
  await drain();
  assert.equal(loader.status().resident.boss, 4, 'transform playback releases next-stage boss decode residency');
  assert.equal(loader.status().resident.transform, 2);
  assert.equal(loader.status().decoded.transform, 2 * 1760 * 1100 * 4);
  assert.ok(loader.loaded(pages[0]));
  loader.setTransformPages(pages.slice(2, 4));
  assert.equal(loader.loaded(pages[0]), null, 'old page is released before loading distant snapshot pages');
  pending.splice(0).forEach(image => image.succeed());
  assert.equal(loader.debug().decodeSlots, 2);
  const stale = decodes.splice(0);
  loader.setTransformPages([pages[4]]);
  pending.splice(0).forEach(image => image.succeed());
  assert.equal(loader.debug().decodeSlots, 1);
  stale.forEach(job => job.resolve());
  await Promise.resolve();
  assert.equal(loader.debug().decodeSlots, 1, 'completion of cancelled old decodes never releases the active page slot');
  await drain();
  assert.equal(loader.status().resident.transform, 1);
  assert.ok(loader.loaded(pages[4]));
  assert.equal(loader.loaded(pages[2]), null);
  assert.equal(loader.debug().peakDecode, 2);
  loader.setTransformPages([]);
  await drain();
  assert.equal(loader.status().resident.transform, 0, 'phase-two idle releases all clip pages');
  assert.equal(loader.status().resident.boss, 8, 'next-stage prefetch resumes after playback');
  loader.setTransformPages(pages.slice(0, 2));
  await drain();
  loader.enterStage(1, manifest);
  await drain();
  assert.equal(loader.status().resident.transform, 0, 'stage changes discard old clip pages');
  assert.equal(loader.status().error, 0);
  assert.throws(() => loader.setTransformPages(pages), /at most two/);
  console.log('authored clip current/next page residency, cancellation, and stage release ok');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
