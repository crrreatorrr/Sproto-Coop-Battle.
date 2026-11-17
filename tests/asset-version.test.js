'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  const {runtimeIndex} = await import('../scripts/build.mjs');
  const first = runtimeIndex({publicTreeSha256:'source-release-a'});
  const next = runtimeIndex({publicTreeSha256:'source-release-b'});
  const sdk = runtimeIndex({publicTreeSha256:'source-release-a'},'different-sdk');
  assert.notEqual(first.version,next.version,'changed art/code creates a new cache namespace');
  assert.notEqual(first.version,sdk.version,'vendored SDK changes also invalidate the release');
  assert.deepEqual(first,runtimeIndex({publicTreeSha256:'source-release-a'}));
  assert.ok(first.html.includes(`globalThis.CoopAssetVersion="${first.version}"`));
  const scripts = Array.from(first.html.matchAll(/<script src="([^"]+)"/g),m=>m[1]);
  assert.ok(scripts.length>0 && scripts.every(src=>src.endsWith('?v='+first.version)),
    'every startup script belongs to the matching release');
  const scope = {window:{CoopAssetVersion:first.version},URL};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/js/asset-loader.js'),'utf8'),scope);
  const L = scope.window.AssetLoader;
  const base = 'https://example.com/games/coop/index.html';
  const actor = 'assets/bosses/01-marina-bront-p1.webp';
  const a = L.resolve(actor,base);
  assert.equal(new URL(a).pathname,'/games/coop/'+actor);
  assert.equal(new URL(a).searchParams.get('v'),first.version);
  const warmCache = new Map([[a,'old-atlas-bytes']]);
  scope.window.CoopAssetVersion = next.version;
  assert.equal(warmCache.has(L.resolve(actor,base)),false,'new art cannot resolve to cached old atlas bytes');
  assert.equal(new URL(L.resolve('js/render-fx.js',base)).searchParams.get('v'),next.version);
  assert.equal(new URL(L.resolve('vendor/hub-sdk/dist/hub-sdk.iife.js',base)).searchParams.get('v'),next.version);
  assert.equal(L.resolve('assets/a.webp?quality=1#frame',undefined,'test'),'assets/a.webp?quality=1&v=test#frame');
  assert.equal(L.resolve('/other/path',undefined,'test'),'/other/path');
  assert.equal(L.resolve('https://cdn.example/a.png',undefined,'test'),'https://cdn.example/a.png');
  assert.equal(L.resolve('data:image/png;base64,AAAA',undefined,'test'),'data:image/png;base64,AAAA');
  assert.equal(L.resolve(actor,undefined,null),actor,'unbuilt development paths retain current behavior');
  assert.ok(Array.from(L.pageScripts(first.html)).every(src=>!src.includes('?')),'budget paths remain canonical');
  console.log('release-versioned scripts/images and warm-cache URL isolation ok');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
