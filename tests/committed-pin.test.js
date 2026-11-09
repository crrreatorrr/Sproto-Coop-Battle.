// The committed pin must describe the committed sim sources. Runs first in `npm test`, before any
// script could rebuild build/, and never writes: a stale pin fails here instead of being rewritten.
// The hub vendors build/coop-sim.js and checks it against build/coop-sim.pin.json, so any edit to
// the pinned files (even a comment) needs `npm run build:server-sim`, a commit of build/, and a
// hub re-pin.
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pinPath = path.join(root, 'build', 'coop-sim.pin.json');
const bundlePath = path.join(root, 'build', 'coop-sim.js');
const PINNED = ['manifest.js', 'sim.js', 'ai.js', 'net-protocol.js'];
const REPIN = 'Run `npm run build:server-sim`, commit build/, and re-pin the hub.';

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const pinText = fs.readFileSync(pinPath, 'utf8');
const pin = JSON.parse(pinText);
const bundle = fs.readFileSync(bundlePath);

// 1. Every pinned source file matches its committed hash.
assert.deepStrictEqual(Object.keys(pin.files).sort(), PINNED.slice().sort(), 'pin lists exactly the four sim files');
for (const name of PINNED) {
  const actual = sha256(fs.readFileSync(path.join(root, 'public', 'js', name)));
  assert.strictEqual(actual, pin.files[name], 'public/js/' + name + ' does not match build/coop-sim.pin.json. ' + REPIN);
}

// 2. The committed bundle matches the committed bundleSha256.
assert.strictEqual(sha256(bundle), pin.bundleSha256, 'build/coop-sim.js does not match bundleSha256. ' + REPIN);

// 3. A fresh in-memory build reproduces the committed bundle and pin byte for byte.
async function main() {
  const { composeServerSim } = await import('../scripts/build-server-sim.mjs');
  const fresh = composeServerSim();
  assert.ok(Buffer.from(fresh.bundle, 'utf8').equals(bundle), 'a fresh build differs from build/coop-sim.js. ' + REPIN);
  assert.strictEqual(fresh.pinText, pinText, 'a fresh build differs from build/coop-sim.pin.json. ' + REPIN);

  // 4. The online client announces the same content fingerprint the pin records.
  const NetHub = require(path.join(root, 'public', 'js', 'net-hub.js'));
  assert.strictEqual(NetHub.FINGERPRINT, pin.contentSha256, 'NetHub.FINGERPRINT in public/js/net-hub.js must equal pin.contentSha256');

  console.log('committed pin ok', pin.bundleSha256.slice(0, 12), 'content', pin.contentSha256.slice(0, 12));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
