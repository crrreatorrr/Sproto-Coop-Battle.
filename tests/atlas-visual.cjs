// Three cold loads record medians. The first also exercises fighter and boss
// atlas playback through the Canvas 2D renderer.
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(__dirname, 'artifacts'));

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function probe(url) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (res.ok && (await res.text()) === 'ok') return true;
    } catch (err) { /* starting */ }
    await delay(100);
  }
  return false;
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'server', 'server.js')], {
      cwd: root,
      env: { ...process.env, PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('server start timeout\n' + buf));
    }, 10000);
    const onData = chunk => {
      buf += chunk.toString();
      const match = buf.match(/http:\/\/localhost:(\d+)/);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ child, port: Number(match[1]) });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', code => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error('server exited ' + code + '\n' + buf));
      }
    });
  });
}

async function stopServer(child) {
  if (!child || child.killed || child.exitCode != null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    delay(2000).then(() => child.kill('SIGKILL')),
  ]);
}

async function coldPage(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const client = await page.context().newCDPSession(page);
  await client.send('Network.setCacheDisabled', { cacheDisabled: true });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.SprotoApp && window.SprotoApp.screen === 'title', null, { timeout: 20000 });
  return { page, errors };
}

async function measure(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    const same = resources.filter(entry => entry.name.startsWith(location.origin) && !entry.name.endsWith('/favicon.ico'));
    const transfer = same.reduce((sum, entry) => sum + (entry.transferSize || 0), 0) + (nav && nav.transferSize ? nav.transferSize : 0);
    const names = same.map(entry => new URL(entry.name).pathname);
    if (nav) names.unshift(new URL(nav.name).pathname);
    return { transfer, duration: nav ? nav.duration : 0, requests: names.length, names };
  });
}

async function compareCells(page) {
  await page.route('**/__atlas_reference__/*/*.png', route => {
    const reference = new URL(route.request().url()).pathname.match(/^\/__atlas_reference__\/([a-z0-9]+)\/((?:\d\d|w0\d)\.png)$/);
    if (!reference) return route.abort();
    return route.fulfill({ path: path.join(root, 'art', 'fighter-poses', reference[1], reference[2]), contentType: 'image/png' });
  });
  return page.evaluate(async () => {
    const originals = MANIFEST.fighters.filter(f => !f.cell);
    await AssetLoader.shared().preload(originals.map(AssetLoader.atlasPath));
    const load = src => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(src));
      image.src = src;
    });
    let checked = 0;
    let bad = 0;
    let first = '';
    for (let fid = 0; fid < originals.length; fid++) {
      const id = originals[fid].id;
      for (let i = 0; i < 40; i++) {
        const name = i < 32 ? String(i).padStart(2, '0') : 'w0' + (i - 32);
        const pose = i < 32 ? i : name;
        const png = await load('__atlas_reference__/' + id + '/' + name + '.png');
        const cell = Render.frameCanvas(fid, pose, 0);
        checked++;
        if (!cell) { bad++; first = first || id + ' ' + name + ' missing'; continue; }
        const got = cell.getContext('2d').getImageData(0, 0, 128, 128).data;
        const refc = document.createElement('canvas');
        refc.width = refc.height = 128;
        const g = refc.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.drawImage(png, 0, 0);
        const want = g.getImageData(0, 0, 128, 128).data;
        for (let p = 0; p < got.length; p += 4) {
          const alpha = want[p + 3];
          // WebP and PNG decoders can round premultiplied translucent edges differently.
          const tolerance = alpha === 255 ? 0 : 1;
          let mismatch = got[p + 3] !== alpha;
          for (let channel = 0; channel < 3; channel++) {
            const a = Math.round(got[p + channel] * alpha / 255);
            const b = Math.round(want[p + channel] * alpha / 255);
            if (Math.abs(a - b) > tolerance) mismatch = true;
          }
          if (mismatch) { bad++; first = first || id + ' ' + name + ' byte ' + p; break; }
        }
      }
    }
    return { checked, bad, first };
  });
}

async function verifyImportedFrames(page) {
  await page.evaluate(async () => {
    const plan = AssetLoader.groups(MANIFEST);
    await AssetLoader.shared().preload(plan.atlas.slice(6).concat(plan.motion, AssetLoader.portraits));
    Render.enterStage(0);
  });
  await page.waitForFunction(() => window.RenderFx);
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#201830'; ctx.fillRect(0, 0, 640, 256);
    let count = 0;
    for (const [fid, f] of MANIFEST.fighters.entries()) {
      if (f.cell) {
        const idle = Render.frameCanvas(fid, 0, 0);
        const a = Render.frameCanvas(fid, 'w00', 0);
        const b = Render.frameCanvas(fid, 'w04', 0);
        if (!idle || !a || !b || a.toDataURL() === b.toDataURL()) throw new Error(f.id + ' has no distinct walk frames');
        if (!Render.drawPortrait(ctx, fid, 48 + count % 5 * 128, 21 + Math.floor(count / 5) * 120, 36)) {
          throw new Error(f.id + ' has no roster thumbnail');
        }
        Render.drawFighter(ctx, { f: fid, st: 'walk', t: 15, z: 0, fc: 1, cl: 'fighter', w: 0 },
          64 + count % 5 * 128, 105 + Math.floor(count / 5) * 120, 0, 'katana', Sim.WEAPONS[0]);
        count++;
      }
      if (f.clips?.cast) {
        const w = Sim.weaponChoices('mage', 1)[0];
        const shot = Sim.classMoveTiming('mage', w, false);
        const at = t => RenderFx.pose({ f: fid, cl: 'mage', st: 'cast', t, w }, Sim.WEAPONS[w].id, Sim.WEAPONS[w]).pose;
        const before = at(shot.windup - 1), release = at(shot.windup);
        if (before < 40 || release !== before + 1 || !Render.frameCanvas(fid, release, 0)) {
          throw new Error(f.id + ' has no authored release frame at the cast tick');
        }
      }
    }
    return { count, png: canvas.toDataURL() };
  });
}

async function paintBoss(page) {
  await page.evaluate(() => Render.enterStage(0));
  await page.waitForFunction(() => window.RenderFx);
  return page.evaluate(async () => {
    const plan = AssetLoader.groups(MANIFEST);
    await AssetLoader.shared().preload(plan.firstBoss);
    const canvas = document.createElement('canvas');
    canvas.width = Sim.W; canvas.height = Sim.H;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const snap = {
      camX: 0, sk: 0, si: 0, t: 12, items: [], players: [], enemies: [], fx: [], banner: null,
      boss: { bi: 0, ph: 0, x: 420, y: 36, z: 0, t: 12, st: 'idle', fc: -1, fl: 0, mi: 0, row: 0, hp: 1800, mh: 2600 },
      projs: [{ k: 'boss', bi: 0, ph: 0, r: 0, t: 8, x: 220, y: 48, z: 45, vx: -4 }],
    };
    // Compare above each ground shadow and outside the HUD against the same
    // background. Counting opaque pixels would also pass without either sprite.
    const read = (...rect) => ctx.getImageData(...rect).data;
    const actor = [340, 100, 160, 120], shot = [192, 193, 56, 56];
    Render.drawWorld(ctx, { ...snap, boss: null, projs: [] });
    const bgActor = read(...actor), bgShot = read(...shot);
    Render.drawWorld(ctx, snap);
    const changed = (after, before) => {
      let count = 0;
      for (let i = 0; i < after.length; i += 4) {
        if (after[i] !== before[i] || after[i + 1] !== before[i + 1] || after[i + 2] !== before[i + 2]) count++;
      }
      return count;
    };
    return {
      actor: changed(read(...actor), bgActor), shot: changed(read(...shot), bgShot),
      errors: Render.loadStatus().errors, png: canvas.toDataURL('image/png'),
    };
  });
}

async function verifyBossPlayback(page) {
  const reviewed = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/boss-import-source-checks.json'), 'utf8'));
  const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  for (const [asset, bank] of Object.entries(reviewed.banks)) {
    if (digest(fs.readFileSync(path.join(root, 'public', asset))) !== bank.runtimeEncodedSha256) {
      throw new Error(asset + ' encoded bytes differ from the reviewed import');
    }
    if (bank.sourceOriginalPngBase64 && digest(Buffer.from(bank.sourceOriginalPngBase64, 'base64')) !== bank.sourceOriginalEncodedSha256) {
      throw new Error(asset + ' original FX reference bytes differ');
    }
  }
  return page.evaluate(async reviewed => {
    const ACTOR = 220, FX = 96;
    const transformKeys = [28, 96, 174, 258, 342, 442];
    const reviewTicks = [0, 62, 96, 134, 174, 216, 258, 300, 342, 392, 442, 480];
    const summoners = new Set(['crapto', 'bigswole', 'sproto1668']);
    const plan = AssetLoader.groups(MANIFEST), loader = AssetLoader.shared();
    const canvas = document.createElement('canvas');
    canvas.width = Sim.W; canvas.height = Sim.H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    const actorLayer = document.createElement('canvas'); actorLayer.width = actorLayer.height = 256;
    const actorContext = actorLayer.getContext('2d', { willReadFrequently: true });
    const calls = [], drawImage = ctx.drawImage.bind(ctx), scratchLineage = new WeakMap();
    let registeredFxDraws = 0;
    const nativeDraw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
      if (this.canvas.width === FX && this.canvas.height === FX && image instanceof HTMLImageElement) {
        const asset = new URL(image.src).pathname.replace(/^\//, '');
        if (asset.startsWith('assets/bosses/')) {
          if (args.length !== 8 || args.slice(2).join(',') !== [FX,FX,0,0,FX,FX].join(',')) {
            throw new Error('Registered FX scratch must copy exactly one native cel');
          }
          scratchLineage.set(this.canvas, { asset, source: args.slice(0,4) });
        }
      }
      return nativeDraw.call(this, image, ...args);
    };
    ctx.drawImage = (image, ...args) => {
      let asset, source;
      if (image instanceof HTMLImageElement) {
        const assetPath = new URL(image.src).pathname.replace(/^\//, '');
        if (assetPath.startsWith('assets/bosses/')) asset = assetPath;
      } else if (image instanceof HTMLCanvasElement && image.width === ACTOR && image.height === ACTOR) {
        asset = null;
      }
      if (image instanceof HTMLCanvasElement && image.width === FX && image.height === FX) {
        const origin = scratchLineage.get(image);
        if (!origin) throw new Error('Registered FX scratch lost its source lineage');
        asset = origin.asset; source = origin.source;
        if (args.slice(0,4).join(',') !== [0,0,FX,FX].join(',')) throw new Error('FX draw did not use the native scratch origin');
        registeredFxDraws++;
      }
      if (asset !== undefined) {
        const matrix = ctx.getTransform();
        if (args[2] === ACTOR && args[3] === ACTOR) {
          actorContext.save(); actorContext.imageSmoothingEnabled = false;
          actorContext.setTransform(matrix.a,matrix.b,matrix.c,matrix.d,128,240);
          actorContext.globalAlpha = ctx.globalAlpha; actorContext.filter = ctx.filter;
          actorContext.drawImage(image,...args); actorContext.restore();
        }
        calls.push({
          asset, source: source || args.slice(0, 4), facing: Math.sign(matrix.a), alpha: ctx.globalAlpha,
          image: asset === null ? image : undefined,
        });
      }
      return drawImage(image, ...args);
    };
    const check = (predicate, message) => { if (!predicate) throw new Error(message); };
    const expected = (asset, cell, row, col, facing) => ({ asset, source: [col * cell, row * cell, cell, cell], facing });
    const expectedFx = (bi, ph, purpose, age, row, col, facing = 1) => {
      const clip = CoopBossFxSelection.clipFor(CoopBossTransformations.animations, MANIFEST,
        { bossIndex: bi, phase: ph, purpose });
      if (!clip) return expected(MANIFEST.bosses[bi].phases[ph].proj, FX, row, col, facing);
      const frame = CoopSpriteTimeline.plan(clip).at(age, false);
      return { asset: frame.page.src, source: [frame.x, frame.y, FX, FX], facing };
    };
    const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map(n => n.toString(16).padStart(2,'0')).join('');
    const renderSnapshot = state => JSON.parse(JSON.stringify(Sim.snapshot(state)));
    const draw = snap => {
      calls.length = 0; actorContext.clearRect(0,0,256,256);
      Render.drawWorld(ctx, snap, { noBanner: true });
      return calls;
    };
    const checkDrawCalls = (actual, wanted, label) => {
      const keys = records => records.map(({ asset, source, facing }) => JSON.stringify([asset, source, facing])).sort().join('\n');
      check(keys(actual) === keys(wanted), label + ' drew ' + JSON.stringify(actual) +
        ' expected ' + JSON.stringify(wanted));
    };
    const checkDraw = (snap, wanted, label) => checkDrawCalls(draw(snap), wanted, label);
    const panelsPerSheet = 4, panelWidth = 152, panelHeight = 166;
    const contactSheets = Array.from({ length: Math.ceil(MANIFEST.bosses.length / panelsPerSheet) }, () => {
      const sheet = document.createElement('canvas');
      sheet.width = reviewTicks.length * panelWidth;
      sheet.height = panelsPerSheet * panelHeight;
      return sheet;
    });
    const drawReviewFrame = (snapshot, tick, pilot) => {
      const column = reviewTicks.indexOf(tick);
      if (column < 0) return;
      const boss = snapshot.boss, row = boss.bi % panelsPerSheet;
      const target = contactSheets[Math.floor(boss.bi / panelsPerSheet)].getContext('2d');
      const x = column * panelWidth, y = row * panelHeight;
      const center = Math.round(boss.x - snapshot.camX);
      const bottom = Math.round(Sim.FLOOR_TOP + boss.y + 4);
      target.imageSmoothingEnabled = false;
      target.drawImage(canvas, center - 124, bottom - 245, 248, 245, x, y, panelWidth, panelHeight - 16);
      target.fillStyle = '#171422';
      target.fillRect(x, y + panelHeight - 16, panelWidth, 16);
      target.font = '10px monospace';
      target.fillStyle = '#f5e9db';
      target.fillText(pilot + '  ' + (tick / 60).toFixed(2) + 's', x + 3, y + panelHeight - 5);
    };
    const actorPixels = snapshot => {
      const center = Math.round(snapshot.boss.x - snapshot.camX);
      const floor = Math.round(Sim.FLOOR_TOP + snapshot.boss.y);
      // Include the complete foot plane and shadow but stay above the HUD.
      return ctx.getImageData(center - 122, 40, 244, floor - 32).data;
    };
    const paletteCanvas = document.createElement('canvas');
    paletteCanvas.width = paletteCanvas.height = ACTOR;
    const paletteCtx = paletteCanvas.getContext('2d', { willReadFrequently: true });
    const rgbAt = (rgba, i) => (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    const paletteFor = ([sheet, row, col]) => {
      paletteCtx.clearRect(0, 0, ACTOR, ACTOR);
      paletteCtx.drawImage(Render.img(sheet), col * ACTOR, row * ACTOR, ACTOR, ACTOR, 0, 0, ACTOR, ACTOR);
      const rgba = paletteCtx.getImageData(0, 0, ACTOR, ACTOR).data;
      const colors = new Set();
      for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i + 3] === 255) colors.add(rgbAt(rgba, i));
      }
      return colors;
    };
    const morphPixels = (cel, firstColors, nextColors, label) => {
      const rgba = cel.getContext('2d').getImageData(0, 0, ACTOR, ACTOR).data;
      let ink = 0, grounded = 0, blended = 0, hash = 2166136261;
      for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i + 3] === 0) continue;
        ink++;
        if (i >= 198 * ACTOR * 4) grounded++;
        if (rgba[i + 3] === 255) {
          const color = rgbAt(rgba, i);
          if (!firstColors.has(color) && !nextColors.has(color)) blended++;
        }
        for (let channel = 0; channel < 4; channel++) {
          hash = Math.imul(hash ^ rgba[i + channel], 16777619);
        }
      }
      check(ink > 500 && ink < ACTOR * ACTOR, label + ' has missing artwork or an opaque background');
      check(grounded > 2, label + ' does not reach the standing foot plane');
      check(blended === 0, label + ' mixes the texture colors of adjacent poses in ' + blended + ' pixels');
      return hash;
    };
    const verifyLegacyTransformation = (state, firstSheet, secondSheet, pilot) => {
      const duration = Sim.BOSS_TRANSFORM_TICKS;
      check(duration === 480, 'transformation must run for eight seconds at 60 Hz');
      const poses = [[firstSheet, 0, 0], [firstSheet, 6, 0], [firstSheet, 6, 1],
        [firstSheet, 6, 2], [firstSheet, 6, 3], [secondSheet, 0, 0]];
      const palettes = poses.map(paletteFor);
      const finalKey = transformKeys.length - 1;
      const sampledMorphs = new Set();
      let lastSnapshot;
      let renders = 0, morphs = 0;
      for (let tick = 0; tick <= duration; tick++) {
        if (tick > 0) Sim.step(state);
        const transforming = tick < duration;
        check(state.boss.phase === 1 && state.boss.st === (transforming ? 'transform' : 'idle') &&
          state.boss.t === (transforming ? tick : 0), pilot + ' unexpected transform state at tick ' + tick);
        if (tick % 2 !== 0 && tick !== duration - 1) continue;

        const snapshot = renderSnapshot(state);
        const art = { ...snapshot, players: [], enemies: [], items: [], projs: [], fx: [], hz: [] };
        const key = tick <= transformKeys[0] ? 0
          : tick >= transformKeys[finalKey] ? finalKey : transformKeys.indexOf(tick);
        for (const facing of [-1, 1]) {
          const frame = { ...art, boss: { ...art.boss, fc: facing, fl: 0, su: undefined } };
          const caption = pilot + ' transform tick ' + tick + (facing < 0 ? ' left' : ' right');
          const actual = draw(frame);
          check(actual.length === 1 && actual[0].alpha === 1, caption + ' must draw exactly one opaque actor');
          if (key >= 0) {
            const [sheet, row, col] = poses[key];
            checkDrawCalls(actual, [expected(sheet, ACTOR, row, col, -facing)], caption);
          } else {
            checkDrawCalls(actual, [expected(null, ACTOR, 0, 0, -facing)], caption);
            morphs++;
            if (facing === -1) {
              const nextKey = transformKeys.findIndex(at => at > tick);
              const hash = morphPixels(actual[0].image, palettes[nextKey - 1], palettes[nextKey], caption);
              if (reviewTicks.includes(tick)) sampledMorphs.add(hash);
            }
          }
          if (facing === -1) drawReviewFrame(frame, tick, pilot);
          if (tick === 0 || tick === duration - 1) {
            const transformed = actorPixels(frame);
            draw({ ...frame, boss: { ...frame.boss, st: 'idle', ph: Number(tick > 0), t: 0 } });
            const actorPixelsIdle = actorPixels(frame);
            check(transformed.every((byte, i) => byte === actorPixelsIdle[i]), caption + ' mismatches the idle sprite');
          }
          renders++;
        }

        if (reviewTicks.includes(tick) && key < 0) {
          const newer = { ...art, boss: { ...art.boss, t: tick + 6 } };
          const blend = Render.interpolateSnapshot(art, newer, 0.25);
          check(blend.boss.t === tick + 1.5 && !('z' in blend.boss) && newer.boss.t === tick + 6,
            pilot + ' lost sub-tick progress between online snapshots');
        }
        if (tick === duration - 1) lastSnapshot = snapshot;
        if (tick === duration) {
          const handoff = Render.interpolateSnapshot(lastSnapshot, snapshot, 0.5);
          check(handoff.boss.st === 'idle' && handoff.boss.t === 0, pilot + ' interpolated across the Phase 2 handoff');
        }
      }
      check(sampledMorphs.size === transformKeys.length - 1, pilot + ' has repeated representative morph frames');
      return { renders, morphs };
    };
    const verifyAuthoredTransformation = async (state, firstSheet, secondSheet, pilot) => {
      const duration = Sim.BOSS_TRANSFORM_TICKS, key = MANIFEST.bosses[state.stageIdx].key;
      const clip = CoopBossTransformations.clips[key], source = reviewed.transformations[key];
      check(duration === 480 && clip.frameTicks.length === 160 && clip.frameTicks.every(n => n === 3),
        pilot + ' must use its complete160-cel/eight-second authored sequence');
      check(clip.cell.join(',') === '220,220' && clip.anchor.join(',') === '110,206' &&
        clip.pages.length === 4 && clip.pages.every(p => p.columns === 8 && p.frames === 40),
        pilot + ' authored source geometry changed');
      const sampled = new Set(), hashes = new Map();
      let renders = 0, lastSnapshot;
      for (let tick = 0; tick <= duration; tick++) {
        if (tick > 0) Sim.step(state);
        const transforming = tick < duration;
        check(state.boss.phase === 1 && state.boss.st === (transforming ? 'transform' : 'idle') &&
          state.boss.t === (transforming ? tick : 0), pilot + ' authored clock/state mismatch at ' + tick);
        if (tick % 2 !== 0 && tick !== duration - 1) continue;
        const snapshot = renderSnapshot(state);
        const art = { ...snapshot, players: [], enemies: [], items: [], projs: [], fx: [], hz: [] };
        for (const facing of [-1,1]) {
          const frame = { ...art, boss: { ...art.boss, fc: facing, fl: 0, su: undefined } };
          CoopBossTransformPlayer.shared().sync(frame);
          const started = performance.now();
          while (loader.status().pending || loader.debug().loadSlots || loader.debug().decodeSlots || loader.debug().queued) {
            check(performance.now() - started < 15000, pilot + ' authored page decode timeout');
            await new Promise(resolve => setTimeout(resolve,2));
          }
          check(!loader.status().error && loader.status().resident.transform <= 2,
            pilot + ' failed decode or retained more than two transformation pages');
          const actual = draw(frame), caption = pilot + ' authored tick ' + tick;
          check(actual.length === 1 && actual[0].alpha === 1, caption + ' must draw one opaque actor');
          if (transforming) {
            const index = Math.floor(tick / 3), local = index % 40;
            const asset = clip.pages[Math.floor(index / 40)].src, sx = local % 8 * ACTOR, sy = Math.floor(local / 8) * ACTOR;
            checkDrawCalls(actual, [{ asset, source: [sx,sy,ACTOR,ACTOR], facing: -facing }], caption);
            if (!hashes.has(index)) {
              paletteCtx.clearRect(0,0,ACTOR,ACTOR);
              paletteCtx.drawImage(Render.img(asset),sx,sy,ACTOR,ACTOR,0,0,ACTOR,ACTOR);
              hashes.set(index,await sha256(paletteCtx.getImageData(0,0,ACTOR,ACTOR).data));
            }
            check(hashes.get(index) === source.rgbaSha256[index], caption + ' differs from reviewed source cel ' + index);
            sampled.add(index);
          } else {
            checkDrawCalls(actual,[expected(secondSheet,ACTOR,0,0,-facing)],caption + ' standing handoff');
            check(loader.status().resident.transform === 0, pilot + ' retained T pages after phase-two handoff');
          }
          if (facing === -1) drawReviewFrame(frame,tick,pilot);
          if (tick === 0 || tick === duration - 1) {
            // Compare the actor layer: the authored path intentionally uses the
            // phase-two ground shadow throughout, while P1 idle has its own.
            const transformed = actorContext.getImageData(0,0,256,256).data;
            draw({ ...frame, boss: { ...frame.boss, st: 'idle', ph: Number(tick > 0), t: 0 } });
            const standing = actorContext.getImageData(0,0,256,256).data;
            check(transformed.every((byte,i) => byte === standing[i]),caption + ' differs from exact standing endpoint');
          }
          renders++;
        }
        if (reviewTicks.includes(tick) && tick < duration - 6) {
          const newer = { ...art, boss: { ...art.boss, t: tick + 6 } };
          const blend = Render.interpolateSnapshot(art,newer,0.25);
          check(blend.boss.t === tick + 1.5 && !('z' in blend.boss) && newer.boss.t === tick + 6,
            pilot + ' lost authored sub-tick progress');
        }
        if (tick === duration - 1) lastSnapshot = snapshot;
        if (tick === duration) {
          const handoff = Render.interpolateSnapshot(lastSnapshot,snapshot,0.5);
          check(handoff.boss.st === 'idle' && handoff.boss.t === 0, pilot + ' interpolated across authored phase-two handoff');
        }
      }
      check(sampled.size === 160, pilot + ' did not exercise every authored source cel');
      return { renders, cels: sampled.size };
    };
    const projectileArt = new Set();
    // Lightly tinted steel can read as white at game scale. Saturated
    // colored glows and emissive paint remain available to each boss.
    const isPale = (r, g, b) => {
      const low = Math.min(r, g, b);
      return low >= 164 && Math.max(r, g, b) - low <= 49;
    };
    let exactSourceCells = 0, acceptedFxCells = 0;
    const assertAtlas = async (asset, cell, rows) => {
      const image = Render.img(asset), reviewedBank = reviewed.banks[asset];
      check(reviewedBank && reviewedBank.cell === cell && reviewedBank.rows === rows, asset + ' lacks reviewed source geometry');
      check(Render.ready(image) && image.naturalWidth === 4 * cell && image.naturalHeight === rows * cell,
        asset + ' has incorrect atlas dimensions');
      // Browser-native comparison keeps original partial-alpha premultiplication
      // exact, while Node verifies the reference's original encoded SHA above.
      let legacyFxPixels;
      if (cell === FX) {
        const reference = new Image(); reference.src = 'data:image/png;base64,' + reviewedBank.sourceOriginalPngBase64;
        await reference.decode();
        const sourceCanvas = document.createElement('canvas'); sourceCanvas.width = sourceCanvas.height = 4 * FX;
        legacyFxPixels = sourceCanvas.getContext('2d', { willReadFrequently: true }); legacyFxPixels.drawImage(reference,0,0);
      }
      const sheet = document.createElement('canvas');
      sheet.width = image.naturalWidth; sheet.height = image.naturalHeight;
      const pixels = sheet.getContext('2d', { willReadFrequently: true }); pixels.drawImage(image, 0, 0);
      for (let row = 0; row < rows; row++) {
        const frames = new Set();
        for (let col = 0; col < 4; col++) {
          const rgba = pixels.getImageData(col * cell, row * cell, cell, cell).data;
          let ink = 0, white = 0, hash = 2166136261;
          for (let i = 0; i < rgba.length; i++) {
            if (i % 4 === 3 && rgba[i] > 0) { ink++; if (isPale(rgba[i-3],rgba[i-2],rgba[i-1])) white++; }
            hash = Math.imul(hash ^ rgba[i], 16777619);
          }
          const sourceHash = await sha256(rgba);
          const expectedHash = cell === FX && row < 4
            ? await sha256(legacyFxPixels.getImageData(col*FX,row*FX,FX,FX).data)
            : reviewedBank.rgbaSha256[row*4+col];
          check(sourceHash === expectedHash, asset + ' differs from exact reviewed source in cell ' + row + '/' + col);
          exactSourceCells++;
          check(ink > 100 && ink < cell * cell, asset + ' has an empty or opaque cell ' + row + '/' + col);
          const approvedStanding = cell === ACTOR && row === 0 && col === 0;
          const approvedAppendedFx = cell === FX && row >= 4 && reviewedBank.acceptedAppendedSourceEncodedSha256;
          if (approvedStanding) check(sourceHash === reviewedBank.standingCol0Sha256, asset + ' standing endpoint differs');
          else if (approvedAppendedFx) acceptedFxCells++;
          else check(white === 0, asset + ' has pale-neutral highlights in untouched fallback cell ' + row + '/' + col);
          if (cell === FX && row < 4 && col === 0) {
            check(!projectileArt.has(hash), asset + ' reuses projectile art in row ' + row); projectileArt.add(hash);
          }
          frames.add(hash);
        }
        const distinct = cell === ACTOR && asset.endsWith('-p2.webp') && row === rows - 1 ? 4 : 3;
        check(frames.size >= distinct, asset + ' has too few distinct frames in row ' + row);
      }
    };

    const verifyZephyrClawClearance = (asset, phase) => {
      // The second claw used to fill these spaces in the authored cels.
      const windows = phase === 0 ? [[6, 1, 28, 138], [6, 2, 40, 150], [6, 3, 36, 151]] : [
        [0, 0, 45, 161], [0, 1, 44, 162], [0, 2, 40, 163], [0, 3, 44, 162],
        [1, 1, 54, 160], [2, 1, 39, 148], [3, 1, 40, 151], [4, 2, 35, 177],
        [5, 1, 25, 129], [6, 0, 47, 159], [7, 1, 151, 57], [7, 2, 149, 52],
      ];
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 8;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      for (const [row, col, x, y] of windows) {
        if (row === 0 && col === 0) continue; // Exact reviewed standing SHA replaces only this legacy pose.
        ctx.clearRect(0, 0, 8, 8);
        ctx.drawImage(Render.img(asset), col * ACTOR + x, row * ACTOR + y, 8, 8, 0, 0, 8, 8);
        const data = ctx.getImageData(0, 0, 8, 8).data;
        check(data.every((value, index) => index % 4 !== 3 || value === 0),
          asset + ' has a second claw in cell ' + row + '/' + col);
      }
    };

    const verifyExtraAttack = (state, mode, sheet, proj, row, label) => {
      const player = state.players[0];
      player.inv = 1000;
      for (let waited = 0; waited < 480 && state.boss.st !== mode; waited++) Sim.step(state);
      const start = renderSnapshot(state);
      const spec = Sim.bossExtraAttack(state.boss.bi, mode);
      const name = label + ' ' + spec.name;
      check(start.boss.ph === 1 && start.boss.st === mode && start.boss.t === 0 &&
        start.boss.az?.length === spec.zones.length, name + ' did not publish its locked areas on entry');

      // Other weapons, hazards and Shadow Sprotos are unrelated to this hit.
      state.enemies = [];
      state.projs = [];
      state.items = [];
      state.fx = [];
      state.hazards = [];
      state.boss.addT = 0;
      const [x, y] = start.boss.az.find(zone => zone[4] === 0);
      Object.assign(player, { x, y, z: 0, vx: 0, vy: 0, vz: 0, st: 'idle', inv: 0, hp: Sim.MAX_HP });

      const ready = renderSnapshot(state), facing = -ready.boss.fc;
      const actor = col => expected(sheet, ACTOR, row, col, facing);
      checkDraw(ready, [actor(0)], name + ' ready');
      const warning = ctx.getImageData(0, Sim.FLOOR_TOP - 16, Sim.W, Sim.DEPTH + 20).data;
      draw({ ...ready, boss: { ...ready.boss, az: [] } });
      const clean = ctx.getImageData(0, Sim.FLOOR_TOP - 16, Sim.W, Sim.DEPTH + 20).data;
      check(warning.some((byte, i) => byte !== clean[i]), name + ' floor warning did not paint');

      const lock = JSON.stringify(start.boss.az);
      const preImpactHp = player.hp;
      const midpoint = Math.ceil(spec.warning / 2);
      for (let tick = 1; tick < spec.warning; tick++) {
        Sim.step(state);
        const warningSnap = renderSnapshot(state);
        check(player.hp === preImpactHp && JSON.stringify(warningSnap.boss.az) === lock &&
          !warningSnap.fx.some(f => f.k === 'bossImpact' || f.k === 'bossSpecialImpact'),
        name + ' damaged a player or moved its warning before the strike at tick ' + tick);
        if (tick === midpoint - 1 || tick === midpoint ||
            tick === spec.warning - 1) {
          checkDraw(warningSnap, [actor(tick < midpoint ? 0 : 1)], name + ' warning frame at tick ' + tick);
        }
      }

      const eventKind = mode === 'special' ? 'bossSpecialImpact' : 'bossImpact';
      const verifyWave = (snap, delay) => {
        const zones = start.boss.az.filter(zone => zone[4] === delay);
        const effects = snap.fx.filter(f => f.k === eventKind && f.t === 1);
        check(effects.length === zones.length && zones.every(([x, y]) => effects.some(f =>
          f.x === x && f.y === y && f.bi === state.boss.bi && f.ph === 1)),
        name + ' impact did not match the locked areas at delay ' + delay);
        return effects;
      };
      Sim.step(state);
      const strike = renderSnapshot(state);
      const effects = verifyWave(strike, 0);
      check(player.hp < preImpactHp, name + ' did not damage the marked player on release');
      const art = effects.map(effect => expectedFx(state.boss.bi, 1, mode, effect.t, 3, 0));
      checkDraw(strike, [actor(2), ...art], name + ' strike');

      player.inv = 1000;
      const lastDelay = Math.max(...start.boss.az.map(zone => zone[4]));
      for (let tick = 1; tick <= lastDelay + 6; tick++) {
        Sim.step(state);
        verifyWave(renderSnapshot(state), tick);
      }
      // Existing impact effects use their own timeline, so isolate the
      // actor's recovery frame here.
      const recovery = renderSnapshot(state);
      checkDraw({ ...recovery, fx: [] }, [actor(3)], name + ' recovery');
    };

    check(Array.isArray(window.CoopBossMorphGuides) &&
      CoopBossMorphGuides.length === 12 && CoopBossMorphGuides.every(stage => stage && stage.length === 6),
    'every boss needs six registered cockpit and weapon poses');
    const fxSheets = ['lights', 'burst', 'spikes', 'flame'].map(name => 'assets/fx/' + name + '.png');
    await loader.preload(fxSheets);
    const effect = document.createElement('canvas');
    const effectContext = effect.getContext('2d', { willReadFrequently: true });
    for (const asset of fxSheets) {
      const sheet = Render.img(asset);
      check(Render.ready(sheet), asset + ' did not load');
      effect.width = sheet.naturalWidth;
      effect.height = sheet.naturalHeight;
      effectContext.drawImage(sheet, 0, 0);
      const rgba = effectContext.getImageData(0, 0, effect.width, effect.height).data;
      for (let i = 0; i < rgba.length; i += 4) {
        check(!rgba[i + 3] || !isPale(rgba[i], rgba[i + 1], rgba[i + 2]), asset + ' has pale-neutral highlights');
      }
    }

    let phases = 0, launched = 0, impacts = 0, summons = 0, transitions = 0, extraAttacks = 0;
    let transformRenders = 0, transformMorphs = 0, legacyTransformRenders = 0, registeredTransformCels = 0;
    for (const [bi, boss] of MANIFEST.bosses.entries()) {
      Render.enterStage(bi);
      await loader.preload([...plan.boss(bi), ...plan.scenery(bi)]);
      const snap = { si: bi, t: 12, sk: 0, camX: 0, items: [], players: [], enemies: [], fx: [], projs: [] };
      const ar = bi % Sim.BOSS_ARCHETYPES.length;
      for (const [ph, { sheet, proj }] of boss.phases.entries()) {
        await assertAtlas(sheet, ACTOR, 7 + ph + Number(summoners.has(boss.pilot)));
        await assertAtlas(proj, FX, reviewed.banks[proj].rows);
        if (boss.pilot === 'zephyr') verifyZephyrClawClearance(sheet, ph);
        const status = { bi, ph, ar, x: 420, y: 36, fc: -1, hp: 50, mh: 100, fl: 0, w: 130 };
        const label = boss.pilot + ' phase ' + (ph + 1);
        const pose = (state, row, col, caption) => {
          const b = { ...status, ...state };
          checkDraw({ ...snap, boss: b }, [expected(sheet, ACTOR, row, col, -b.fc)], label + ' ' + caption);
        };
        pose({ st: 'idle', t: 0 }, 0, 0, 'idle');
        pose({ st: 'idle', t: 0, fc: 1 }, 0, 0, 'idle right');
        pose({ st: 'enter', t: 9, fc: 1 }, 0, 1, 'walk right');
        for (const [row, attack] of [[1, 'lane or lob'], [2, 'spread'], [3, 'homing']]) {
          const firing = { st: 'fire', row, mi: Number(row === 3) };
          pose({ ...firing, t: 4 }, row, 0, attack + ' wind-up');
          pose({ ...firing, t: 30 }, row, 1, attack + ' release');
          pose({ ...firing, t: 50 }, row, 2, attack + ' recovery');
        }
        if (ar < 2) {
          pose({ st: 'fire', row: 1, t: 34 }, 1, 2, 'lane shot between releases');
          pose({ st: 'fire', row: 1, t: 38 }, 1, 1, 'lane shot second release');
          pose({ st: 'fire', row: 1, t: 46 }, 1, ph ? 1 : 2, 'lane shot final release only in phase two');
        }
        const chargeAt = ar === 1 ? 36 : 24;
        pose({ st: 'charge', t: 2 }, 4, 0, 'charge wind-up');
        pose({ st: 'charge', t: chargeAt }, 4, 1, 'charge starts moving');
        pose({ st: 'charge', t: chargeAt + 15, x: 76 }, 4, 2, 'charge brakes near arena edge');
        pose({ st: 'sweep', t: 2 }, 5, 0, 'rear sweep wind-up');
        pose({ st: 'sweep', t: Sim.SWEEP_WARN, fc: 1 }, 5, 1, 'rear sweep release');
        pose({ st: 'sweep', t: Sim.SWEEP_WARN + 22 }, 5, 2, 'rear sweep recovery');

        // The authoritative sim writes row 3 for tracking shots and row 0 for
        // lobs. Exercise production snapshots on either side of the release.
        const s = Sim.create([{ fid: 0, weapon: 0, ctrl: 'local' }], 7, bi);
        for (const w of s.stage.waves) w.done = true;
        s.camX = s.stage.len - Sim.W + 150;
        s.players[0].x = s.camX + 100;
        Sim.step(s);
        for (const [row, shotRow, visualRow] of [[1, 0, 0], [2, 1, 1], [3, 3, 2]]) {
          Object.assign(s.boss, {
            phase: ph, st: 'fire', t: 28, x: s.camX + 420, face: -1, row,
            missile: row === 3, lob: row === 1 && ar === 3, marks: [[s.players[0].x, s.players[0].y]],
            warn: [s.players[0].y], both: true,
          });
          s.projs = [];
          s.fx = [];
          Sim.step(s);
          const windup = renderSnapshot(s);
          check(windup.projs.length === 0, label + ' launched before the release tick');
          checkDraw(windup, [expected(sheet, ACTOR, row, 0, 1)], label + ' last wind-up tick');
          Sim.step(s);
          const release = renderSnapshot(s);
          check(release.projs.length > 0, label + ' missing projectile at release');
          check(release.projs.every(p => p.k === 'boss' && p.bi === bi && p.ph === ph && p.r === shotRow),
            label + ' snapshot has incorrect projectile provenance');
          const shots = release.projs.map(p => expected(proj, FX, visualRow, 0, p.vx > 0 ? -1 : 1));
          checkDraw(release, [expected(sheet, ACTOR, row, 1, 1), ...shots], label + ' live projectile row ' + row);
          launched += shots.length;

          // Put the released projectile within one tick of a player hit or
          // let a lob's flight complete. The sim still produces the event.
          const player = s.players[0], shot = s.projs.find(p => p.vx < 0);
          Object.assign(player, { st: 'idle', inv: 0, z: 0, vx: 0, vy: 0, vz: 0, hp: Sim.MAX_HP });
          if (shot.lob) {
            Object.assign(shot, { t: shot.lob - 1, tx: player.x, ty: player.y });
          } else {
            Object.assign(shot, { x: player.x + Math.abs(shot.vx) + 12, y: player.y, z: 24, vy: 0 });
          }
          s.projs = [shot];
          s.fx = [];
          Sim.step(s);
          const impact = renderSnapshot(s);
          check(impact.projs.length === 0 &&
            impact.fx.some(f => f.k === 'bossImpact' && f.bi === bi && f.ph === ph && f.t === 1),
          label + ' shot did not report an impact with its boss and phase');
          checkDraw(impact, [expected(sheet, ACTOR, row, 1, 1), expectedFx(bi, ph, 'impact', 1, 3, 0)],
            label + ' themed impact for attack row ' + row);
          impacts++;
        }

        if (summoners.has(boss.pilot)) {
          // Jump the summoner clock to just before its normal Shadow pair.
          Object.assign(s.boss, { st: 'idle', t: 0, addT: (ph === 1 ? 132 : 220) - 1 });
          s.fx = [];
          Sim.step(s);
          const arrival = renderSnapshot(s);
          check(arrival.enemies.length === 2 && arrival.boss.su === 0, label + ' did not report the Shadow pair summon');
          checkDraw(arrival, [expected(sheet, ACTOR, 7, 1, 1)], label + ' summon release');
          for (let i = 0; i < 12; i++) Sim.step(s);
          checkDraw(renderSnapshot(s), [expected(sheet, ACTOR, 7, 2, 1)], label + ' summon recovery');
          summons++;
        }
        if (ph === 0) {
          // Cross the health threshold through ordinary projectile damage.
          // Check the source artwork and the eight-second handoff.
          s.enemies = [];
          s.fx = [];
          s.projs = [];
          s.boss.hp = Math.floor(s.boss.maxHp / 2) + 1;
          // Storm resolves in updatePlayer, before the boss clock, and laser
          // resolves in updateProjs after it. Both must start at render tick 0.
          const player = s.players[0];
          if (bi === 0) {
            Object.assign(player, { st: 'idle', x: s.boss.x - 215, z: 0, vx: 0, vy: 0, vz: 0, powers: [0] });
            player.in.p = 1;
          } else {
            s.projs.push({
              id: s.nextId++, kind: 'laser', owner: 0, t: 0, life: 10, hit: [],
              x: s.boss.x, y: s.boss.y, z: 0, vx: 0, vy: 0, vz: 0, dmg: 2,
            });
          }
          Sim.step(s);
          player.in.p = 0;
          const secondSheet = boss.phases[1].sheet;
          const clip = CoopBossTransformations.clips[boss.key];
          check(clip, boss.pilot + ' requires its accepted authored transformation');
          delete CoopBossTransformations.clips[boss.key];
          try {
            const legacy = verifyLegacyTransformation(structuredClone(s), sheet, secondSheet, boss.pilot);
            legacyTransformRenders += legacy.renders; transformMorphs += legacy.morphs;
          } finally { CoopBossTransformations.clips[boss.key] = clip; }
          const transform = await verifyAuthoredTransformation(s, sheet, secondSheet, boss.pilot);
          transformRenders += transform.renders; registeredTransformCels += transform.cels;
          transitions++;
          s.items = [];
          const secondProj = boss.phases[1].proj;
          verifyExtraAttack(s, 'signature', secondSheet, secondProj, 6, boss.pilot);
          verifyExtraAttack(s, 'special', secondSheet, secondProj, summoners.has(boss.pilot) ? 8 : 7, boss.pilot);
          extraAttacks += 2;
        }
        phases++;
      }
    }
    CanvasRenderingContext2D.prototype.drawImage = nativeDraw;
    return {
      phases, launched, impacts, summons, transitions, extraAttacks, transformRenders, transformMorphs,
      legacyTransformRenders, registeredTransformCels, registeredFxDraws, exactSourceCells, acceptedFxCells,
      projectileDesigns: projectileArt.size, contacts: contactSheets.map(sheet => sheet.toDataURL('image/png')),
    };
  }, reviewed);
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const started = await startServer();
  const url = 'http://127.0.0.1:' + started.port + '/';
  if (!await probe(url + 'healthz')) {
    await stopServer(started.child);
    throw new Error('healthz failed');
  }
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const runs = [];
  let bossPlayback;
  try {
    for (let i = 0; i < 3; i++) {
      const opened = await coldPage(browser, url);
      if (opened.errors.length) throw new Error('page errors: ' + opened.errors.join(' | '));
      const sample = await measure(opened.page);
      const poses = sample.names.filter(name => /\/fighters\/[^/]+\/(?:\d\d|w0\d)\.png$/.test(name));
      if (poses.length) throw new Error('startup requested pose pngs: ' + poses.join(','));
      runs.push(sample);
      if (i === 0) {
        await opened.page.screenshot({ path: path.join(out, 'c2-title.png') });
        const cells = await compareCells(opened.page);
        if (cells.bad || cells.checked !== 240) throw new Error('atlas cells differ from poses: ' + JSON.stringify(cells));
        const roster = await verifyImportedFrames(opened.page);
        if (roster.count !== 10) throw new Error('expected ten imported fighters');
        fs.writeFileSync(path.join(out, 'coop-imported-fighters.png'), Buffer.from(roster.png.replace(/^data:image\/png;base64,/, ''), 'base64'));
        const boss = await paintBoss(opened.page);
        if (boss.errors.length) throw new Error('boss load errors: ' + boss.errors.join(','));
        if (boss.actor < 1000 || boss.shot < 100) throw new Error('boss and shot pixels did not paint: ' + boss.actor + ', ' + boss.shot);
        fs.writeFileSync(path.join(out, 'c2-boss-phase.png'), Buffer.from(boss.png.replace(/^data:image\/png;base64,/, ''), 'base64'));
        const { contacts, ...coverage } = await verifyBossPlayback(opened.page);
        bossPlayback = coverage;
        if (bossPlayback.phases !== 24 || bossPlayback.impacts !== 72 || bossPlayback.summons !== 6 ||
            bossPlayback.transitions !== 12 || bossPlayback.extraAttacks !== 24 ||
            bossPlayback.transformRenders !== 5808 || bossPlayback.transformMorphs !== 4848 ||
            bossPlayback.projectileDesigns !== 96 || bossPlayback.legacyTransformRenders !== 5808 ||
            bossPlayback.registeredTransformCels !== 1920 || bossPlayback.exactSourceCells !== 1160 ||
            bossPlayback.acceptedFxCells !== 32 || bossPlayback.registeredFxDraws < 1) {
          throw new Error('missing boss playback coverage: ' + JSON.stringify(bossPlayback));
        }
        for (const [i, png] of contacts.entries()) {
          fs.writeFileSync(path.join(out, 'c2-boss-transformations-' + (i + 1) + '.png'),
            Buffer.from(png.replace(/^data:image\/png;base64,/, ''), 'base64'));
        }
        if (opened.errors.length) throw new Error('page errors during atlas playback: ' + opened.errors.join(' | '));
      }
      await opened.page.close();
    }
    const titleCap = Math.round(1.5 * 1024 * 1024);
    for (const run of runs) {
      if (run.transfer > titleCap) throw new Error('title transfer ' + run.transfer + ' exceeds ' + titleCap);
      if (run.requests > 30) throw new Error('title requests ' + run.requests);
    }
    const throttled = [];
    for (let i = 0; i < 3; i++) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const client = await page.context().newCDPSession(page);
      await client.send('Network.setCacheDisabled', { cacheDisabled: true });
      await client.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 100,
        downloadThroughput: (10 * 1000 * 1000) / 8,
        uploadThroughput: (10 * 1000 * 1000) / 8,
      });
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForFunction(() => window.SprotoApp && window.SprotoApp.screen === 'title', null, { timeout: 20000 });
      throttled.push(await measure(page));
      await page.close();
    }
    const transfers = runs.map(run => run.transfer);
    const durations = runs.map(run => run.duration);
    const summary = {
      browser: 'playwright-chromium',
      url: 'localhost',
      runs: runs.map(run => ({ transfer: run.transfer, duration: run.duration, requests: run.requests })),
      medianTransfer: median(transfers),
      medianDurationMs: median(durations),
      throttled: throttled.map(run => ({ transfer: run.transfer, duration: run.duration, requests: run.requests })),
      medianThrottledMs: median(throttled.map(run => run.duration)),
      throttle: '10 Mbps, 100 ms RTT, cache disabled, no CPU throttle',
      poseRequests: 0,
      cells: 240,
      bossPlayback,
    };
    fs.writeFileSync(path.join(out, 'c2-load-medians.json'), JSON.stringify(summary, null, 2) + '\n');
    if (process.env.C2_SAVE_FIXTURES === '1') {
      const shots = path.join(root, 'tests', 'fixtures', 'screenshots');
      fs.copyFileSync(path.join(out, 'c2-title.png'), path.join(shots, 'c2-title.png'));
      fs.copyFileSync(path.join(out, 'c2-boss-phase.png'), path.join(shots, 'c2-boss-phase.png'));
      fs.copyFileSync(path.join(out, 'c2-load-medians.json'), path.join(root, 'tests', 'fixtures', 'c2-load-medians.json'));
    }
    console.log('atlas visual ok', JSON.stringify(summary));
  } finally {
    await browser.close().catch(() => {});
    await stopServer(started.child);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
