// Deterministic copy of runtime public files into dist/. Authoring tools,
// the practice server, tests, and secrets stay out of the static tree.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory, loadAssetLoader, loadManifest, scanTree, walkFiles } from './check-assets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const dist = path.join(root, 'dist');

export function buildDist() {
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
  const report = inventory();
  const manifestFiles = report.files.map(file => {
    const row = { path: file.path, bytes: file.bytes, sha256: file.sha256 };
    if (file.gzipBytes != null) row.gzipBytes = file.gzipBytes;
    if (file.width != null) {
      row.width = file.width;
      row.height = file.height;
      row.decodedBytes = file.decodedBytes;
    }
    return row;
  });
  const manifest = {
    kind: 'sproto-coop-battle-runtime',
    practiceRelay: true,
    economy: 'none',
    algorithm: 'sha256',
    assetCount: report.assetCount,
    assetBytes: report.assetBytes,
    publicFileCount: report.publicFileCount,
    publicBytes: report.publicBytes,
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
