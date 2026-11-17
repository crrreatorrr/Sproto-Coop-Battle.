'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const clip = {
  cell: [220, 220], anchor: [110, 206],
  frameTicks: Array(160).fill(3),
  pages: Array.from({ length: 4 }, (_, i) => ({
    src: 'assets/bosses/transformations/test-' + i + '.webp', columns: 8, frames: 40,
  })),
};
const key = '01-marina-bront';
const manifest = { bosses: [{ key }, { key: '02-last-light-vela' }] };

function harness() {
  const ready = new Map(), pinCalls = [], saved = [];
  const loader = { setTransformPages: pages => pinCalls.push(pages), loaded: src => ready.get(src) };
  const contexts = [];
  const scope = { window: {}, document: { createElement() {
    const canvas = { width: 0, height: 0 };
    const context = { clearRect() {}, drawImage(...args) { saved.push(args); } };
    canvas.getContext = () => context;
    contexts.push(context);
    return canvas;
  } } };
  scope.window = scope;
  vm.createContext(scope);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/boss-transform-player.js'), 'utf8'), scope);
  const player = scope.CoopBossTransformPlayer.create(loader, manifest, { version: 1, clips: { [key]: clip } });
  const draws = [];
  const g = { save() {}, restore() {}, translate(...xy) { draws.push(['translate', ...xy]); },
    scale(...xy) { draws.push(['scale', ...xy]); }, drawImage(...args) { draws.push(['draw', ...args]); } };
  const snapshot = (tick, phase = 1, stage = 0) => ({ si: stage, boss: { st: 'transform', t: tick, ph: phase } });
  function showPage(index) { ready.set(clip.pages[index].src, { naturalWidth: 1760, naturalHeight: 1100, index }); }
  return { scope, player, ready, pinCalls, saved, draws, g, snapshot, showPage };
}

const h = harness();
const plan = h.player.clipFor(key);
for (let tick = 0; tick < 480; tick++) {
  assert.equal(plan.at(tick).frame, Math.floor(tick / 3));
}
assert.equal(plan.at(479).frame, 159);
assert.equal(plan.at(480).frame, 159);
assert.equal(plan.at(-8).frame, 0);
h.player.sync({ si: 0, boss: { st: 'idle', t: 4, ph: 0 } });
assert.deepEqual(Array.from(h.pinCalls.at(-1)), [clip.pages[0].src], 'phase one warms only the first page');
h.player.sync(h.snapshot(300));
assert.deepEqual(Array.from(h.pinCalls.at(-1)), clip.pages.slice(2).map(p => p.src), 'late snapshot requests its current page directly');
assert.equal(h.player.draw(h.g, key, 300, 310.6, 282.4, -1, 243), false, 'no decoded actor means the caller keeps its standing fallback');

h.showPage(2);
assert.equal(h.player.draw(h.g, key, 300, 310.6, 282.4, -1, 243), true);
const first = h.draws.find(call => call[0] === 'draw');
assert.deepEqual(first.slice(2), [880, 440, 220, 220, -122, -228, 243, 243]);
assert.deepEqual(h.draws[0], ['translate', 311, 282]);
assert.equal(h.g.imageSmoothingEnabled, false);
assert.equal(h.saved.length, 1, 'one complete fallback cel is retained');
h.draws.length = 0;
h.player.draw(h.g, key, 301, 310, 282, 1, 243);
assert.deepEqual(h.draws[1], ['scale', -1, 1], 'right-facing preview mirrors the whole registered frame');
assert.equal(h.saved.length, 1, 'a repeated display frame does not re-copy the fallback');

h.player.sync(h.snapshot(360));
assert.deepEqual(Array.from(h.pinCalls.at(-1)), [clip.pages[3].src]);
h.draws.length = 0;
assert.equal(h.player.draw(h.g, key, 360, 310, 282, -1, 243), true, 'a slow page holds the last complete frame');
assert.equal(h.draws.find(call => call[0] === 'draw')[1].width, 220);
h.showPage(3);
h.draws.length = 0;
h.player.draw(h.g, key, 402, 310, 282, -1, 243);
assert.equal(h.draws.find(call => call[0] === 'draw')[1].index, 3, 'recovering pages resume at snapshot time without replaying earlier frames');

h.player.sync({ si: 0, boss: { st: 'idle', ph: 1, t: 0 } });
assert.deepEqual(Array.from(h.pinCalls.at(-1)), [], 'phase two releases transformation pages');
h.ready.clear();
h.player.sync({ si: 0, boss: { st: 'idle', ph: 0, t: 0 } });
assert.equal(h.player.draw(h.g, key, 0, 0, 0, -1, 243), false, 'retrying the same stage clears the previous complete-frame fallback');
h.player.sync(h.snapshot(50, 0, 1));
assert.equal(h.player.clipFor(manifest.bosses[1].key), null);
h.ready.clear();
h.player.sync(h.snapshot(0));
assert.equal(h.player.draw(h.g, key, 0, 0, 0, -1, 243), false, 'a new encounter never holds another boss canvas');

h.showPage(0);
h.ready.get(clip.pages[0].src).naturalHeight = 100;
assert.throws(() => h.player.draw(h.g, key, 0, 0, 0, -1, 243), /dimensions/);
for (const invalid of [
  { ...clip, frameTicks: [480] },
  { ...clip, frameTicks: [239, 240] },
  { ...clip, anchor: [110, 220] },
  { ...clip, pages: [{ ...clip.pages[0], frames: 159 }] },
  { ...clip, pages: [{ ...clip.pages[0], src: 'assets/bosses/transformations/../escape.png' }] },
]) assert.throws(() => h.scope.CoopBossTransformPlayer.planClip(invalid), /transformation/);
console.log('authored boss frames, paging, late snapshots, facing, fallback, and metadata validation ok');
