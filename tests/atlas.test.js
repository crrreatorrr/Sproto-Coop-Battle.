// Pixel provenance for the six fighter atlases. Feet, hands, and boxes stay put.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const META = 'abf8ee18e934ecf5921aa92043d7fd45015f0db56592ad0a47c07282115d9748';

async function main() {
  const checked = spawnSync('python3', [path.join(root, 'tools', 'pack-fighter-atlases.py'), '--check'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.strictEqual(checked.status, 0, (checked.stdout || '') + (checked.stderr || ''));
  const doc = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'atlas-provenance.json'), 'utf8'));
  assert.strictEqual(doc.shipped, 'png');
  assert.strictEqual(doc.padding, 0);
  assert.strictEqual(doc.cell, 128);
  assert.strictEqual(doc.cols, 8);
  assert.strictEqual(doc.rows, 5);
  assert.strictEqual(doc.order.length, 40);
  assert.strictEqual(doc.webp.shipped, false);
  assert.strictEqual(doc.webp.exact, true);
  assert.ok(doc.webp.bytes < doc.pngBytes);
  assert.ok(doc.pngBytes < doc.sourcePoseBytes);
  for (const id of doc.fighters) {
    const atlas = doc.atlases[id];
    assert.ok(atlas.width <= 1024 && atlas.height <= 1024);
    assert.ok(fs.existsSync(path.join(root, 'public', 'assets', 'fighters', id, 'atlas.png')));
    for (const name of doc.order) {
      assert.ok(fs.existsSync(path.join(root, 'public', 'assets', 'fighters', id, name + '.png')));
    }
  }
  const budgets = await import('../scripts/check-budgets.mjs');
  assert.strictEqual(budgets.fighterMetaSha256(), META);
  const render = fs.readFileSync(path.join(root, 'public', 'js', 'render.js'), 'utf8');
  assert.ok(!render.includes('for (let i = 0; i < 32; i++) list.push'));
  assert.ok(render.includes('AssetLoader'));
  console.log('atlas ok');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
