// Deterministic copy of runtime public files into dist/. Authoring tools,
// the practice server, tests, and secrets stay out of the static tree.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import { inventory, loadAssetLoader, loadManifest, scanTree, walkFiles } from './check-assets.mjs';

const SDK_REL = 'vendor/hub-sdk/dist/hub-sdk.iife.js';
const SDK_PIN = 'vendor/hub-sdk/SOURCE.pin.json';
const SDK_IIFE_SHA256 = 'd74ffe49c3a59390040e57ad0016d25db194bd68410fbcf5a0e199a1acbe17be';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const dist = path.join(root, 'dist');

export const APP_BUNDLE = 'js/app.bundle.js';
export const FX_BUNDLE = 'js/fx.bundle.js';

// The classic scripts index.html loads at startup, in page order.
export function startupScripts() {
  const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  return Array.from(html.matchAll(/<script src="(js\/[^"?#]+\.js)"><\/script>/g), match => match[1]);
}

// The in-game scripts render.js loads on the first stage, in its FX_SCRIPTS order.
export function fxScripts() {
  const source = fs.readFileSync(path.join(pub, 'js', 'render.js'), 'utf8');
  const block = source.match(/const FX_SCRIPTS = \[([\s\S]*?)\];/);
  if (!block) throw new Error('render.js FX_SCRIPTS list not found');
  const files = Array.from(block[1].matchAll(/\['[A-Za-z]+', '([a-z0-9-]+\.js)'\]/g), match => 'js/' + match[1]);
  if (!files.length) throw new Error('render.js FX_SCRIPTS list is empty');
  return files;
}

// Minify each classic script on its own (no module wrapping, no down-levelling: esbuild keeps
// top-level names and each file's own 'use strict'), then join them in load order. A bundle runs
// exactly like the separate tags did; public/ itself is unchanged, so npm start still serves
// the readable files.
const bundleCache = new Map();
export function makeBundle(bundlePath, sources) {
  const texts = sources.map(rel => fs.readFileSync(path.join(pub, rel), 'utf8'));
  const key = bundlePath + '\0' + crypto.createHash('sha256').update(sources.join('\0') + '\0' + texts.join('\0')).digest('hex');
  if (bundleCache.has(key)) return bundleCache.get(key);
  const code = sources.map((rel, i) => {
    const out = transformSync(texts[i], { loader: 'js', minify: true, target: 'esnext', charset: 'utf8', legalComments: 'none', sourcefile: rel }).code;
    return '/* ' + rel + ' */\n' + out.trimEnd() + '\n;\n';
  }).join('');
  const buf = Buffer.from(code);
  const bundle = { path: bundlePath, sources: sources.slice(), code, bytes: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'), gzipBytes: zlib.gzipSync(buf, { level: 9, mtime: 0 }).length,
    sourceBytes: texts.reduce((n, text) => n + Buffer.byteLength(text), 0) };
  bundleCache.set(key, bundle);
  return bundle;
}

export function runtimeBundles() {
  return [makeBundle(APP_BUNDLE, startupScripts()), makeBundle(FX_BUNDLE, fxScripts())];
}

// Every release requests matching scripts and image bytes, including legacy
// manifest filenames. A cached old atlas cannot accompany a new transformation.
// The startup tags become one minified bundle, and the page tells render.js to fetch the
// in-game scripts as one bundle too.
export function runtimeIndex(report, sdkHash = SDK_IIFE_SHA256) {
  const version = crypto.createHash('sha256').update(report.publicTreeSha256 + ':' + sdkHash).digest('hex').slice(0, 24);
  const bundles = runtimeBundles();
  const app = bundles.find(bundle => bundle.path === APP_BUNDLE);
  const fx = bundles.find(bundle => bundle.path === FX_BUNDLE);
  let html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  let placed = false;
  html = html.replace(/<script src="(js\/[^"?#]+\.js)"><\/script>\n?/g, (tag, source) => {
    if (!app.sources.includes(source)) return tag;
    if (placed) return '';
    placed = true;
    return `<script src="${APP_BUNDLE}"></script>\n`;
  });
  html = html.replace(/<script src="((?:js|vendor)\/[^"]+\.js)"/g,
    (_, source) => `<script src="${source}?v=${version}"`);
  html = html.replace('<script src=', `<script>globalThis.CoopAssetVersion="${version}";globalThis.CoopFxBundle="${path.posix.basename(fx.path)}";</script>\n<script src=`);
  return { version, html, bytes: Buffer.byteLength(html), sha256: crypto.createHash('sha256').update(html).digest('hex'), bundles };
}

export function assertSdkPin() {
  const pin = JSON.parse(fs.readFileSync(path.join(root, SDK_PIN), 'utf8'));
  const bytes = fs.readFileSync(path.join(root, SDK_REL));
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const text = bytes.toString('utf8');
  const problems = [];
  if (pin.package !== '@metaverse/hub-sdk' || pin.version !== '0.9.0' || pin.global !== 'HubSDK' || pin.format !== 'iife') {
    problems.push('SOURCE.pin.json is not @metaverse/hub-sdk 0.9.0 IIFE global HubSDK');
  }
  if (pin.iifeSha256 !== SDK_IIFE_SHA256 || hash !== SDK_IIFE_SHA256) problems.push('iife sha256 does not match the pinned build');
  if (!text.includes('sproto-coop-battle') || !text.includes('Not a CDN import')) problems.push('iife is not the pinned classic build');
  if (/NAKAMA_HTTP_KEY/i.test(text) || /http[_-]?key\s*[:=]\s*['"][A-Za-z0-9]{8,}['"]/i.test(text)) problems.push('iife contains an HTTP key');
  if (problems.length) {
    const error = new Error(problems.join('; '));
    error.detail = { problems, hash };
    throw error;
  }
  return { hash, bytes };
}

export function buildDist() {
  const sdk = assertSdkPin();
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  const files = walkFiles(pub);
  const copied = [];
  for (const file of files) {
    const rel = path.relative(pub, file);
    const target = path.join(dist, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target);
    copied.push(rel.split(path.sep).join('/'));
  }
  const sdkTarget = path.join(dist, SDK_REL);
  fs.mkdirSync(path.dirname(sdkTarget), { recursive: true });
  fs.writeFileSync(sdkTarget, sdk.bytes);
  copied.push(SDK_REL);
  const report = inventory();
  const index = runtimeIndex(report, sdk.hash);
  fs.writeFileSync(path.join(dist, 'index.html'), index.html);
  for (const bundle of index.bundles) {
    if (copied.includes(bundle.path)) throw new Error(bundle.path + ' collides with a public file');
    fs.writeFileSync(path.join(dist, bundle.path), bundle.code);
    copied.push(bundle.path);
  }
  const bundleBytes = index.bundles.reduce((n, bundle) => n + bundle.bytes, 0);
  const manifestFiles = report.files.map(file => {
    const row = { path: file.path, bytes: file.bytes, sha256: file.sha256 };
    if (file.gzipBytes != null) row.gzipBytes = file.gzipBytes;
    if (file.width != null) {
      row.width = file.width;
      row.height = file.height;
      row.decodedBytes = file.decodedBytes;
    }
    if (file.path === 'index.html') {
      row.sourceBytes = row.bytes;
      row.sourceSha256 = row.sha256;
      row.bytes = index.bytes;
      row.sha256 = index.sha256;
      row.gzipBytes = zlib.gzipSync(index.html).length;
    }
    return row;
  });
  const manifest = {
    kind: 'sproto-coop-battle-runtime',
    practiceRelay: true,
    economy: 'none',
    algorithm: 'sha256',
    releaseVersion: index.version,
    runtimePublicBytes: report.publicBytes + bundleBytes + index.bytes - report.files.find(file => file.path === 'index.html').bytes,
    runtimeIndexSha256: index.sha256,
    assetCount: report.assetCount,
    assetBytes: report.assetBytes,
    publicFileCount: report.publicFileCount,
    publicBytes: report.publicBytes,
    basePublicBytes: report.basePublicBytes,
    runtimeBasePublicBytes: report.basePublicBytes + bundleBytes + index.bytes - report.files.find(file => file.path === 'index.html').bytes,
    optionalMediaCount: report.optionalMediaCount,
    optionalMediaBytes: report.optionalMediaBytes,
    optionalMediaTreeSha256: report.optionalMediaTreeSha256,
    optionalMediaPaths: report.streamedMedia.optionalPaths,
    presentationDecodedBytesMax: report.streamedMedia.maxPresentationDecodedBytes,
    fxScratchDecodedBytes: report.fxScratchDecodedBytes,
    mediaBudgetLimits: report.streamedMedia.limits,
    assetTreeSha256: report.assetTreeSha256,
    publicTreeSha256: report.publicTreeSha256,
    preloadCount: report.preloadCount,
    preloadBytes: report.preloadCost.bytes,
    preloadGzipBytes: report.preloadCost.gzipBytes,
    preloadDecodedBytes: report.preloadCost.decodedBytes,
    dynamicRefCount: report.dynamicRefCount,
    unused: report.unused,
    startup: loadAssetLoader().groups(loadManifest()).startup,
    files: manifestFiles,
    // Built, not in public/: minified copies of the startup and in-game classic scripts.
    bundles: index.bundles.map(bundle => ({ path: bundle.path, bytes: bundle.bytes, sha256: bundle.sha256,
      gzipBytes: bundle.gzipBytes, sourceBytes: bundle.sourceBytes, sources: bundle.sources })),
  };
  const body = JSON.stringify(manifest, null, 2) + '\n';
  fs.writeFileSync(path.join(dist, 'asset-manifest.json'), body);
  const scan = scanTree(dist);
  const distFiles = walkFiles(dist).map(file => path.relative(dist, file).split(path.sep).join('/')).sort();
  const extra = distFiles.filter(file => file !== 'asset-manifest.json' && !copied.includes(file));
  const missing = copied.filter(file => !distFiles.includes(file));
  if (scan.hits.length || scan.forbidden.length || extra.length || missing.length) {
    const error = new Error('dist failed the runtime/secret containment check');
    error.detail = { hits: scan.hits, forbidden: scan.forbidden, extra, missing };
    throw error;
  }
  return { manifest, distFiles, copied };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = buildDist();
    console.log(`dist files ${result.distFiles.length} (public ${result.copied.length} + asset-manifest.json)`);
    console.log(`asset tree ${result.manifest.assetTreeSha256}`);
    console.log(`public tree ${result.manifest.publicTreeSha256}`);
  } catch (err) {
    console.error(err.detail || err);
    process.exit(1);
  }
}
