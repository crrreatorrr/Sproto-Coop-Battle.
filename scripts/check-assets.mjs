// Inventory the runtime public tree, dynamic asset refs, and preload cost.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');

const SECRET_RES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{20,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bsk_live_[A-Za-z0-9]{8,}/,
  /\bAIza[0-9A-Za-z\-_]{35}\b/,
  /NAKAMA_HTTP_KEY/i,
  /SPROTO_PRACTICE_RELAY_NO_ECONOMY/,
];

export function walkFiles(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function treeHash(files, base) {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const rel = path.relative(base, file).split(path.sep).join('/');
    const buf = fs.readFileSync(file);
    hash.update(rel + '\0' + sha256(buf) + '\0' + buf.length + '\n');
  }
  return hash.digest('hex');
}

function pngSize(buf) {
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length - 8) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0xd9) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

export function imageSize(file, buf) {
  if (file.endsWith('.png')) return pngSize(buf);
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return jpegSize(buf);
  return null;
}

export function loadManifest() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(pub, 'js', 'manifest.js'), 'utf8'), sandbox, { filename: 'manifest.js' });
  if (!sandbox.window.MANIFEST) throw new Error('manifest.js did not set window.MANIFEST');
  return sandbox.window.MANIFEST;
}

function quotedList(source) {
  return [...source.matchAll(/'([^']+)'/g)].map(match => match[1]);
}

export function preloadList(renderSource, manifest) {
  const pose = renderSource.match(/for \(let i = 0; i < (\d+); i\+\+\) list\.push\(`assets\/fighters\/\$\{f\.id\}\/\$\{String\(i\)\.padStart\(2, '0'\)\}\.png`\)/);
  const weapon = renderSource.match(/for \(let i = 0; i < (\d+); i\+\+\) list\.push\(`assets\/fighters\/\$\{f\.id\}\/w0\$\{i\}\.png`\)/);
  const stages = renderSource.match(/for \(const n of \[([^\]]+)\]\) \{ list\.push\(`assets\/stages\/\$\{n\}-back\.jpg`\); list\.push\(`assets\/stages\/\$\{n\}-floor\.png`\); \}/);
  const ufos = renderSource.match(/for \(const n of \[([^\]]+)\]\) list\.push\(`assets\/ufo\/\$\{n\}\.png`\)/);
  if (!pose || !weapon || !stages || !ufos) {
    throw new Error('render.js preload pattern changed; asset check failed closed');
  }
  const poseCount = Number(pose[1]);
  const weaponCount = Number(weapon[1]);
  const list = [];
  for (const fighter of manifest.fighters) {
    for (let i = 0; i < poseCount; i++) list.push(`assets/fighters/${fighter.id}/${String(i).padStart(2, '0')}.png`);
    for (let i = 0; i < weaponCount; i++) list.push(`assets/fighters/${fighter.id}/w0${i}.png`);
  }
  for (const n of quotedList(stages[1])) {
    list.push(`assets/stages/${n}-back.jpg`);
    list.push(`assets/stages/${n}-floor.png`);
  }
  for (const n of quotedList(ufos[1])) list.push(`assets/ufo/${n}.png`);
  return list;
}

export function dynamicRefs(renderSource, manifest) {
  const refs = new Set(preloadList(renderSource, manifest));
  for (const boss of manifest.bosses) {
    for (const phase of boss.phases) {
      refs.add(phase.sheet);
      refs.add(phase.proj);
    }
  }
  return refs;
}

export function literalAssetRefs(sources) {
  const refs = new Set();
  const re = /['"`](assets\/[A-Za-z0-9_./+-]+)['"`]/g;
  for (const source of sources) {
    for (const match of source.matchAll(re)) refs.add(match[1]);
  }
  return refs;
}

export function missingRefs(refs, files) {
  return [...refs].filter(ref => !files.has(ref)).sort();
}

const FILE_REF = /\.(png|jpe?g|webp|gif|json)$/i;

export function literalProblems(literals, files) {
  const missing = [];
  const prefixes = [];
  for (const ref of [...literals].sort()) {
    if (FILE_REF.test(ref)) {
      if (!files.has(ref)) missing.push(ref);
    } else {
      prefixes.push(ref);
      const covered = [...files].some(file => file.startsWith(ref));
      if (!covered) missing.push(ref);
    }
  }
  return { missing, prefixes };
}

function addCost(bucket, bytes, gzipBytes, decoded) {
  bucket.count++;
  bucket.bytes += bytes;
  bucket.gzipBytes += gzipBytes;
  bucket.decodedBytes += decoded;
}

export function inventory() {
  const manifest = loadManifest();
  const renderSource = fs.readFileSync(path.join(pub, 'js', 'render.js'), 'utf8');
  const jsDir = path.join(pub, 'js');
  const sources = fs.readdirSync(jsDir).filter(name => name.endsWith('.js')).sort().map(name => fs.readFileSync(path.join(jsDir, name), 'utf8'));
  sources.push(fs.readFileSync(path.join(pub, 'index.html'), 'utf8'));
  const publicFiles = walkFiles(pub);
  const assetFiles = publicFiles.filter(file => file.split(path.sep).includes('assets'));
  const assetSet = new Set(assetFiles.map(file => path.relative(pub, file).split(path.sep).join('/')));
  const refs = dynamicRefs(renderSource, manifest);
  const literals = literalAssetRefs(sources);
  const preload = preloadList(renderSource, manifest);
  const files = [];
  let assetBytes = 0;
  let publicBytes = 0;
  const preloadSet = new Set(preload);
  const preloadCost = { count: 0, bytes: 0, gzipBytes: 0, decodedBytes: 0 };
  const categories = {
    fighter: { count: 0, bytes: 0, gzipBytes: 0, decodedBytes: 0 },
    stage: { count: 0, bytes: 0, gzipBytes: 0, decodedBytes: 0 },
    ufo: { count: 0, bytes: 0, gzipBytes: 0, decodedBytes: 0 },
    boss: { count: 0, bytes: 0, gzipBytes: 0, decodedBytes: 0 },
  };
  const unreadable = [];
  for (const file of publicFiles) {
    const rel = path.relative(pub, file).split(path.sep).join('/');
    const buf = fs.readFileSync(file);
    publicBytes += buf.length;
    const record = { path: rel, bytes: buf.length, sha256: sha256(buf) };
    if (rel.startsWith('assets/')) {
      assetBytes += buf.length;
      const gzipBytes = zlib.gzipSync(buf, { level: 9, mtime: 0 }).length;
      const dim = imageSize(file, buf);
      record.gzipBytes = gzipBytes;
      if (!dim) unreadable.push(rel);
      else {
        record.width = dim.width;
        record.height = dim.height;
        record.decodedBytes = dim.width * dim.height * 4;
      }
      const decoded = record.decodedBytes || 0;
      let cat = 'ufo';
      if (rel.startsWith('assets/fighters/')) cat = 'fighter';
      else if (rel.startsWith('assets/stages/')) cat = 'stage';
      else if (rel.startsWith('assets/bosses/')) cat = 'boss';
      addCost(categories[cat], buf.length, gzipBytes, decoded);
      if (preloadSet.has(rel)) addCost(preloadCost, buf.length, gzipBytes, decoded);
    }
    files.push(record);
  }
  const unused = [...assetSet].filter(rel => !refs.has(rel)).sort();
  const literalsReport = literalProblems(literals, assetSet);
  return {
    files,
    assetCount: assetFiles.length,
    assetBytes,
    publicFileCount: publicFiles.length,
    publicBytes,
    assetTreeSha256: treeHash(assetFiles, pub),
    publicTreeSha256: treeHash(publicFiles, pub),
    preload,
    preloadCount: preload.length,
    preloadCost,
    categories,
    dynamicRefCount: refs.size,
    literalRefCount: literals.size,
    literalPrefixes: literalsReport.prefixes,
    missingDynamic: missingRefs(refs, assetSet),
    missingLiterals: literalsReport.missing,
    unused,
    unreadable,
    manifestBosses: manifest.bosses.length,
    manifestFighters: manifest.fighters.length,
  };
}

export function scanText(text) {
  const hits = [];
  for (const re of SECRET_RES) if (re.test(text)) hits.push(re.source);
  return hits;
}

export function scanTree(dir) {
  const hits = [];
  const forbidden = [];
  if (!fs.existsSync(dir)) return { hits, forbidden };
  for (const file of walkFiles(dir)) {
    const rel = path.relative(dir, file).split(path.sep).join('/');
    const base = path.basename(file).toLowerCase();
    if (rel.startsWith('server/') || rel.startsWith('tools/') || rel.startsWith('tests/') || rel.endsWith('.py') || base === '.env' || base.endsWith('.pem') || base === 'id_rsa' || base.includes('credentials')) {
      forbidden.push(rel);
    }
    const ext = path.extname(file);
    if (['.js', '.html', '.json', '.css', '.svg', '.txt', '.map', '.mjs'].includes(ext)) {
      const found = scanText(fs.readFileSync(file, 'utf8'));
      if (found.length) hits.push({ path: rel, found });
    }
  }
  return { hits, forbidden };
}

function printReport(report) {
  const lines = [
    `assets ${report.assetCount} files, ${report.assetBytes} bytes (${(report.assetBytes / 1e6).toFixed(6)} MB decimal, ${(report.assetBytes / 1024 / 1024).toFixed(3)} MiB)`,
    `public ${report.publicFileCount} files, ${report.publicBytes} bytes`,
    `asset tree ${report.assetTreeSha256}`,
    `public tree ${report.publicTreeSha256}`,
    `preload ${report.preloadCount} images, transfer ${report.preloadCost.bytes} bytes, gzip-9 ${report.preloadCost.gzipBytes} bytes, decoded RGBA ${report.preloadCost.decodedBytes} bytes`,
    `dynamic refs ${report.dynamicRefCount}, literal refs ${report.literalRefCount}`,
    `missing dynamic ${report.missingDynamic.length}, missing literals ${report.missingLiterals.length}, unreadable ${report.unreadable.length}`,
    `unused (reported, not deleted): ${report.unused.join(', ') || 'none'}`,
  ];
  for (const [name, cat] of Object.entries(report.categories)) {
    lines.push(`${name}: ${cat.count} files, ${cat.bytes} bytes, gzip-9 ${cat.gzipBytes}, decoded ${cat.decodedBytes}`);
  }
  console.log(lines.join('\n'));
}

function fail(report) {
  return report.missingDynamic.length || report.missingLiterals.length || report.unreadable.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = inventory();
  printReport(report);
  if (fail(report)) process.exit(1);
}
