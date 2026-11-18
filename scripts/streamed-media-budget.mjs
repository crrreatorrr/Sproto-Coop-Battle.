// Build-time validation of registered, optional boss presentation media.
// Every public file stays in the inventory; only valid stream pages are split out.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scope = {};
scope.window = scope;
for (const name of ['sprite-timeline', 'boss-transform-player', 'boss-fx-selection', 'asset-loader']) {
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js', name + '.js'), 'utf8'), scope);
}

export const MEDIA_LIMITS = Object.freeze({
  optionalBytes: 64 * 1024 * 1024,
  encodedPageBytes: 1024 * 1024,
  decodedPageBytes: 8 * 1024 * 1024,
  textureSide: 2048,
  retainedPagesPerStream: 2,
  presentationBytes: 32 * 1024 * 1024,
});

// These are exactly the action names reachable through boss-action-selection.js.
export const ACTION_NAMES = Object.freeze(['walk', 'lane', 'spread', 'homing',
  'charge-windup', 'charge-rush', 'charge-brake', 'sweep', 'signature', 'special', 'dead', 'summon']);
export const LOOPING_ACTION_NAMES = Object.freeze(['walk', 'charge-rush']);
export const FX_NAMES = Object.freeze(Object.keys(scope.CoopBossFxSelection.rows));

export function canonicalStreamPath(src, kind) {
  if (!['transformations', 'actions', 'effects'].includes(kind)) return false;
  const suffix = kind === 'actions' ? 'webp' : '(?:png|webp)';
  return typeof src === 'string' &&
    new RegExp('^assets/bosses/' + kind + '/[a-z0-9][a-z0-9/._-]*\\.' + suffix + '$').test(src) &&
    src.split('/').every(part => part && part !== '.' && part !== '..') &&
    path.posix.normalize(src) === src;
}

const safe = value => Number.isSafeInteger(value) && value >= 0;
const unique = values => [...new Set(values)];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
// The FX selector owns serialized phases0/1, even if loader metadata has more.
const runtimeFxPhase = phase => phase === 0 || phase === 1;
const runtimeFxSource = src => typeof src === 'string' &&
  /^assets\/bosses\/[a-z0-9/._-]+\.(png|webp)$/.test(src) &&
  src.split('/').every(part => part && part !== '.' && part !== '..') &&
  !/^assets\/bosses\/(actions|transformations)\//.test(src);
const mentionsEffects = clip => Array.isArray(clip?.pages) && clip.pages.some(page =>
  typeof page?.src === 'string' && /^assets\/bosses\/effects\//.test(page.src));

function fxPlan(clip) {
  if (!clip || typeof clip !== 'object') throw Error('FX clip must be an object');
  const plan = scope.CoopSpriteTimeline.plan(clip, {
    anchorInside: true, maxTextureSide: MEDIA_LIMITS.textureSide,
    maxPageBytes: MEDIA_LIMITS.decodedPageBytes, allowRepeatedSources: true,
    validateSource: runtimeFxSource,
  });
  if (plan.cell.some(n => n !== 96) || clip.frameTicks.length > 64 ||
      plan.coreRect.some((n, i) => n !== [0, 0, 96, 96][i]))
    throw Error('not a runtime-valid native FX plan');
  return plan;
}

export function analyzeStreamedMedia(manifest, registry, files) {
  const byPath = new Map(files.map(file => [file.path, file]));
  const bosses = new Map(manifest.bosses.map((boss, index) => [boss.key, { boss, index }]));
  const errors = [], clips = [], optional = new Map();
  const fail = (owner, message) => errors.push({ owner, message });
  if (!object(registry)) fail('registry', 'expected an object');
  const animations = registry?.animations?.bosses === undefined ? {} : registry.animations.bosses;
  if (registry?.animations !== undefined && !object(registry.animations)) fail('animations', 'expected an object');

  // The real loader retains both fallback phases and their registered FX.
  // Byte classification never changes this stage-lifetime decoded residency.
  function fallbackPaths(boss, index) {
    const paths = boss.phases.flatMap(phase => scope.AssetLoader.stageOnlyBoss(manifest, index)
      ? [phase.sheet, scope.AssetLoader.lowerBossActorPath(phase), phase.proj] : [phase.sheet, phase.proj]).filter(Boolean);
    const rawPhases = animations?.[boss.key]?.phases;
    const phases = Array.isArray(rawPhases) ? rawPhases : [];
    for (const phase of phases) for (const fx of Object.values(phase?.fx || {})) {
      for (const page of Array.isArray(fx?.pages) ? fx.pages : []) {
        const src = page?.src;
        if (runtimeFxSource(src)) paths.push(src);
      }
    }
    return unique(paths);
  }
  const fallback = manifest.bosses.map(fallbackPaths);
  // Only original manifest fallback ownership forbids optional classification.
  // Additional registered FX still appear in fallback above, even when optional.
  const alwaysBase = new Set(manifest.bosses.flatMap(boss =>
    boss.phases.flatMap(phase => [phase.sheet, phase.proj]).filter(Boolean)));
  let fxScratchDecodedBytes = 0;
  const fxScratchPlans = [], ignoredFxScratchPlans = [];
  for (const boss of manifest.bosses) {
    const phases = animations?.[boss.key]?.phases;
    if (!Array.isArray(phases) || phases.length > boss.phases.length || phases.some(phase => !object(phase))) continue;
    phases.forEach((phase, index) => {
      if (!runtimeFxPhase(index)) return;
      for (const [purpose, clip] of Object.entries(phase.fx || {})) {
        const owner = boss.key + '/' + index + '/fx/' + purpose;
        if (!Object.prototype.hasOwnProperty.call(scope.CoopBossFxSelection.rows, purpose)) continue;
        try {
          // Match drawRegisteredBossFx's runtime plan options and its strict
          // native96/full-core/64-frame checks. Reserve
          // for a valid plan even before decode, since it may allocate later.
          const plan = fxPlan(clip);
          const bytes = plan.cell[0] * plan.cell[1] * 4;
          fxScratchDecodedBytes = Math.max(fxScratchDecodedBytes, bytes);
          fxScratchPlans.push({ owner, cell: plan.cell.slice(), decodedBytes: bytes });
        } catch (error) { ignoredFxScratchPlans.push({ owner, reason: error.message }); }
      }
    });
  }

  function register(owner, kind, clip, bossIndex, phase, loop = false) {
    let plan;
    try {
      if (kind === 'transformations') plan = scope.CoopBossTransformPlayer.planClip(clip);
      else if (kind === 'effects') plan = fxPlan(clip);
      else plan = scope.CoopSpriteTimeline.plan(clip, {
        anchorInside: true, maxTextureSide: MEDIA_LIMITS.textureSide,
        maxPageBytes: MEDIA_LIMITS.decodedPageBytes, allowRepeatedSources: true,
        validateSource: src => canonicalStreamPath(src, kind),
      });
      const cell = plan.cell || clip.cell;
      for (const page of plan.pages) {
        if (kind !== 'effects' && !canonicalStreamPath(page.src, kind)) throw Error('noncanonical stream source');
        if (kind === 'effects' && /^assets\/bosses\/effects\//.test(page.src) &&
            !canonicalStreamPath(page.src, kind)) throw Error('noncanonical effects source');
        const file = byPath.get(page.src);
        if (!file) throw Error('missing registered page: ' + page.src);
        if (alwaysBase.has(page.src) && (kind !== 'effects' || canonicalStreamPath(page.src, kind)))
          throw Error('stream source is also retained manifest fallback media: ' + page.src);
        const decoded = page.width * page.height * 4;
        if (!safe(page.width) || !safe(page.height) || !safe(decoded) ||
            !page.width || !page.height || Math.max(page.width, page.height) > MEDIA_LIMITS.textureSide ||
            decoded > MEDIA_LIMITS.decodedPageBytes) throw Error('page exceeds texture/decoded limits: ' + page.src);
        if (file.width !== page.width || file.height !== page.height || file.decodedBytes !== decoded)
          throw Error('page image dimensions disagree with complete runtime grid: ' + page.src);
        if (!safe(file.bytes) || !file.bytes || file.bytes > MEDIA_LIMITS.encodedPageBytes)
          throw Error('page exceeds encoded limit: ' + page.src);
        if (!safe(cell[0] * cell[1] * 4)) throw Error('unsafe held cel size');
      }
      const record = { owner, kind, bossIndex, phase, loop, cell: cell.slice(), pages: plan.pages };
      clips.push(record);
      // A clip is atomic: no page is exempted if any of its metadata/files fail.
      for (const page of plan.pages) {
        if (kind !== 'effects' || canonicalStreamPath(page.src, kind)) optional.set(page.src, byPath.get(page.src));
      }
    } catch (error) { fail(owner, error.message); }
  }

  if (registry?.clips !== undefined && !object(registry.clips)) fail('clips', 'expected an object');
  else for (const [key, clip] of Object.entries(registry?.clips || {})) {
    const entry = bosses.get(key);
    if (!entry) fail('clips/' + key, 'unknown manifest boss');
    else register('clips/' + key, 'transformations', clip, entry.index, null);
  }
  if (!object(animations)) fail('animations/bosses', 'expected an object');
  else for (const [key, value] of Object.entries(animations)) {
    const entry = bosses.get(key), owner = 'animations/bosses/' + key;
    if (!entry) { fail(owner, 'unknown manifest boss'); continue; }
    if (!Array.isArray(value?.phases) || value.phases.length > entry.boss.phases.length) {
      fail(owner, 'invalid manifest phase registration'); continue;
    }
    let invalidPhase = false;
    // AssetLoader.actionPaths dereferences every present phase entry. Its
    // flatMap and this forEach both skip sparse holes, but not null/undefined.
    value.phases.forEach((phase, index) => {
      if (!object(phase)) { fail(owner + '/' + index, 'phase must be an object'); invalidPhase = true; }
    });
    if (invalidPhase) continue;
    value.phases.forEach((phase, index) => {
      if (phase.actions !== undefined && !object(phase.actions)) fail(owner + '/' + index, 'actions must be an object');
      for (const [name, clip] of Object.entries(object(phase.actions) ? phase.actions : {})) {
        const actionOwner = owner + '/' + index + '/actions/' + name;
        if (!ACTION_NAMES.includes(name)) fail(actionOwner, 'unreachable action name');
        else register(actionOwner, 'actions', clip, entry.index, index, LOOPING_ACTION_NAMES.includes(name));
      }
      // Legacy-only malformed FX keeps its existing fallback semantics. New
      // dedicated files qualify only through complete, recognized registrations.
      for (const [purpose, clip] of Object.entries(object(phase.fx) ? phase.fx : {})) {
        if (!mentionsEffects(clip)) continue;
        const fxOwner = owner + '/' + index + '/fx/' + purpose;
        if (!runtimeFxPhase(index)) fail(fxOwner, 'unreachable FX phase');
        else if (!FX_NAMES.includes(purpose)) fail(fxOwner, 'unreachable FX purpose');
        else register(fxOwner, 'effects', clip, entry.index, index);
      }
    });
  }

  // Bespoke banks loaded only after entering their own stage can join the
  // optional download budget. Validate ownership and exact decoded geometry
  // atomically. They still count in that stage's resident presentation.
  manifest.bosses.forEach((boss, index) => {
    if (!scope.AssetLoader.stageOnlyBoss(manifest, index)) return;
    const owner = boss.key + '/stage-only-banks';
    const banks = [];
    for (const [phaseIndex, phase] of boss.phases.entries()) {
      const stem = 'assets/bosses/' + boss.key + '-p' + (phaseIndex + 1);
      const actorRows = scope.AssetLoader.barActorPageRows, width = phase.actorCell * phase.columns;
      banks.push(
        { src: phase.sheet, expectedSrc: stem + '.webp',
          width, height: phase.actorCell * actorRows },
        { src: scope.AssetLoader.lowerBossActorPath(phase), expectedSrc: stem + '-lower.webp',
          width, height: phase.actorCell * ((phaseIndex ? 9 : 10) - actorRows) },
        { src: phase.proj, expectedSrc: stem + '-projectiles.png',
          width: phase.fxCell * phase.fxColumns, height: phase.fxCell * (phase.impactRow + 1) });
    }
    const retainedElsewhere = new Set(fallback.flatMap((paths, i) => i === index ? [] : paths));
    const entries = banks.map(({ src, expectedSrc, width, height }) => {
      const file = byPath.get(src), decodedBytes = width * height * 4;
      if (!/^assets\/bosses\/[a-z0-9-]+\.(?:webp|png)$/.test(src) ||
          src !== expectedSrc || retainedElsewhere.has(src) || optional.has(src))
        fail(owner, 'noncanonical or shared stage bank: ' + src);
      else if (!safe(width) || !safe(height) || !file ||
          !width || !height || file.width !== width || file.height !== height ||
          !safe(file.bytes) || !file.bytes || file.bytes > MEDIA_LIMITS.encodedPageBytes ||
          file.decodedBytes !== decodedBytes || decodedBytes > MEDIA_LIMITS.decodedPageBytes ||
          Math.max(width, height) > MEDIA_LIMITS.textureSide)
        fail(owner, 'invalid stage bank dimensions or byte limit: ' + src);
      else return file;
      return null;
    });
    if (entries.length !== 6) fail(owner, 'expected two phases with three banks each');
    else if (entries.every(Boolean)) entries.forEach(file => optional.set(file.path, file));
  });

  const paths = [...optional.keys()].sort();
  for (const file of files) {
    if (/^assets\/bosses\/(actions|transformations|effects)\//.test(file.path) && !optional.has(file.path))
      fail(file.path, 'unregistered or invalid stream file remains base media');
  }
  const optionalBytes = paths.reduce((sum, src) => sum + optional.get(src).bytes, 0);
  const publicBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const tree = crypto.createHash('sha256');
  for (const src of paths) {
    const file = optional.get(src);
    tree.update(src + '\0' + file.sha256 + '\0' + file.bytes + '\n');
  }

  const checkedFallback = new Set();
  function decoded(paths, owner) {
    return unique(paths).reduce((sum, src) => {
      const file = byPath.get(src);
      if (!file || !safe(file.decodedBytes) || !file.decodedBytes) {
        if (!checkedFallback.has(src)) { fail(owner, 'missing/unreadable retained image: ' + src); checkedFallback.add(src); }
        return sum;
      }
      return sum + file.decodedBytes;
    }, 0);
  }
  const scenes = [];
  function scene(bossIndex, state, phase, transformPaths, actionPaths, heldBytes, basePaths = fallback[bossIndex]) {
    const all = unique(basePaths.concat(transformPaths, actionPaths));
    scenes.push({ boss: manifest.bosses[bossIndex].key, state, phase,
      fallbackDecodedBytes: decoded(basePaths, 'retained-fallback'),
      transformDecodedBytes: decoded(transformPaths, 'transform-stream'),
      actionDecodedBytes: decoded(actionPaths, 'action-stream'), heldCelBytes: heldBytes,
      fxScratchDecodedBytes,
      retainedTransformPages: unique(transformPaths).length, retainedActionPages: unique(actionPaths).length,
      decodedBytes: decoded(all, 'presentation-scene') + heldBytes + fxScratchDecodedBytes });
  }
  for (let i = 0; i < manifest.bosses.length; i++) {
    // With neither stream pinned the existing loader warms the next boss too.
    scene(i, 'fallback-and-next-prefetch', null, [], [], 0, fallback[i].concat(scope.AssetLoader.canPrefetchNext(manifest, i) ? fallback[i + 1] : []));
    const transform = clips.find(c => c.bossIndex === i && c.kind === 'transformations');
    if (transform) {
      scene(i, 'phase-one-transform-standby', 0, [transform.pages[0].src], [], 0);
      for (let p = 0; p < transform.pages.length; p++) {
        scene(i, 'transform-page-' + p, 1, transform.pages.slice(p, p + 2).map(page => page.src), [],
          transform.cell[0] * transform.cell[1] * 4);
      }
    }
    for (const action of clips.filter(c => c.bossIndex === i && c.kind === 'actions')) {
      for (let p = 0; p < action.pages.length; p++) {
        // Action selection releases its stream during transformation. P1
        // actions coexist with just the first T page; P2 releases all T pages.
        const standby = action.phase === 0 && transform ? [transform.pages[0].src] : [];
        const next = action.pages[p + 1] || (action.loop ? action.pages[0] : null);
        scene(i, action.owner + '/page-' + p, action.phase, standby,
          [action.pages[p], next].filter(Boolean).map(page => page.src), action.cell[0] * action.cell[1] * 4);
      }
    }
  }
  const limitErrors = [];
  if (optionalBytes > MEDIA_LIMITS.optionalBytes) limitErrors.push('optional encoded media exceeds 64 MiB');
  for (const row of scenes) {
    if (row.retainedTransformPages > 2 || row.retainedActionPages > 2)
      limitErrors.push(row.boss + '/' + row.state + ': more than two retained pages per stream');
    if (row.decodedBytes > MEDIA_LIMITS.presentationBytes)
      limitErrors.push(row.boss + '/' + row.state + ': retained presentation exceeds 32 MiB');
  }
  return {
    policyVersion: 1, limits: MEDIA_LIMITS, optionalPaths: paths, optionalCount: paths.length,
    optionalBytes, optionalTreeSha256: tree.digest('hex'), basePublicBytes: publicBytes - optionalBytes,
    maxEncodedPageBytes: paths.reduce((n, src) => Math.max(n, optional.get(src).bytes), 0),
    maxDecodedPageBytes: paths.reduce((n, src) => Math.max(n, optional.get(src).decodedBytes), 0),
    maxPresentationDecodedBytes: scenes.reduce((n, row) => Math.max(n, row.decodedBytes), 0),
    registeredTransformClips: clips.filter(c => c.kind === 'transformations').length,
    registeredActionClips: clips.filter(c => c.kind === 'actions').length,
    fxScratchDecodedBytes, fxScratchPlans, ignoredFxScratchPlans,
    validationErrors: errors, limitErrors, scenes,
    residencyScope: 'Retained boss fallback body/FX banks, legal stream overlap, held cel and one global maximum valid registered-FX scratch. Persistent fighter/scenery/UFO/other loader residency is reported separately, not hidden inside this envelope.',
  };
}
