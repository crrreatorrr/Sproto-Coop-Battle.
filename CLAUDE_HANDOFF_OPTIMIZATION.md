# Claude Code Implementation Handoff — `Sproto-Coop-Battle.`

**Branch:** `claude/netcode-load-optimization-handoff`  
**Scope:** Fix 60 Hz boss asset cache-thrashing bug, fix stale 6-seat matchmaking count, slash Nakama snapshot bandwidth (**175 KB/s → <50 KB/s**), eliminate Goja per-tick `JSON.parse(JSON.stringify)` overhead, bundle unminified startup scripts (**30/30 → ~15 requests**), fix blocking Google Fonts & `getImageData` render stalls, and clean up 447 MB of raw authoring art in Git.

---

## 0. Hard Invariants & Pinning Protocol (`AGENTS.md`)

- The hub game ID is `sproto-coop-battle` (no trailing dot).
- **Pinned files:** `public/js/combat.js`, `sim.js`, `ai.js`, `net-protocol.js`, and `manifest.js` are concatenated into `build/coop-sim.js` for Nakama's Goja `sproto_coop` match. **Any byte change** (even comments) changes `bundleSha256` and/or `contentSha256` (`FINGERPRINT`).
- **Whenever ANY pinned file changes (e.g., §2.1 & §2.2 below), you MUST re-pin in exact order:**
  1. `npm run build:server-sim` (rewrites `build/coop-sim.js` and `build/coop-sim.pin.json`).
  2. If `contentSha256` or behavior changed: `UPDATE_GOLDENS=1 node tests/goja-goldens.test.js` (rewrites `tests/fixtures/sim-goldens.json`), update `FINGERPRINT` in `public/js/net-hub.js` and `tests/browser-hub-online.cjs`.
  3. If `bundleSha256` changed: update `SIM` in `tests/hub.test.js`.
  4. **Document in PR:** `metaverse-hub` must copy `build/coop-sim.js` + pin into `server/modules/vendor/`, update `CoopProto` in `server/modules/src/games/coop_protocol.ts`, and run `node scripts/check-coop-sim-version.mjs`.
- **Non-pinned files** (`main.js`, `render.js`, `net.js`, `net-hub.js`, `boss-morph.js`, `scripts/build.mjs`, `public/index.html`, etc.) can be changed without touching `contentSha256`! Consider splitting non-pinned fixes (PR 1) from pinned `net-protocol.js` changes (PR 2) so hub CI stays green during rollout.

---

## 1. P0 — Critical Bugs & Quick Wins (Non-Pinned Files)

### 1.1 Fix 60 Hz Boss Cache-Thrashing Bug (`main.js`, `net-hub.js`)
- **Files:** `public/js/main.js:283`, `public/js/net-hub.js:948`, `public/js/render.js:55`, `public/js/asset-loader.js:459-492`
- **Current Problem:** `hostStep()` calls `R.bossImages(sim.stageIdx); if (sim.stageIdx + 1 < M.bosses.length) R.bossImages(sim.stageIdx + 1);` **every single 60 Hz tick**. `R.bossImages()` requests sheets at priority 0 with `pin: ''`, bypassing `AssetLoader.canPrefetchNext()` / `deferBossBanks()` (which explicitly defer Stages 12 & 13) AND fighting `AssetLoader.evict()` whenever `setTransformPages`/`setActionPages` drop next-boss sheets to stay under the 32 MiB boss VRAM cap—causing continuous **evict → re-fetch → re-decode thrashing** during boss fights!
- **Exact Changes:**
  1. Remove the per-tick `R.bossImages(...)` calls from `hostStep()` (`public/js/main.js:283`) and `drawGame()` (`public/js/net-hub.js:948`).
  2. Rely on `Render.enterStage(si)` (triggered on stage transitions) to pin current + prefetch next boss through `AssetLoader.canPrefetchNext()` / `deferBossBanks()`.
  3. Add a unit/browser test asserting `AssetLoader` does not re-queue evicted next-stage boss sheets during an active transformation/action clip.

### 1.2 Fix Stale 6-Player Matchmaking `maxCount`
- **File:** `public/js/net-hub.js:852`
- **Current Problem:** `NetHub.quickQueue()` passes `maxCount: 6` to `addMatchmaker(...)`, stale from before the 6 → 4 seat reduction (`Sim.SLOTS = 4`, `CoopProtocol.LIMITS.maxSeats = 4`).
- **Exact Changes:** Update `maxCount: 6` → `maxCount: 4` in `public/js/net-hub.js:852` (and verify any matching tests).

### 1.3 Stop Blocking Title Screen on External Google Fonts
- **Files:** `public/index.html:7-8`, `public/js/main.js:1183, 1205`
- **Current Problem:** `bootAssets()` awaits `Promise.all([R.preload(...), fontReady])` where `fontReady = document.fonts.load('10px "Press Start 2P"')` with **no timeout**. Slow or firewalled access to `fonts.googleapis.com` hangs the title screen indefinitely on `LOADING SPROTOS…`.
- **Exact Changes:**
  1. Self-host `Press Start 2P` WOFF2 (~15 KB) under `public/assets/fonts/` and declare `@font-face` locally (removing the third-party Google Fonts `<link>`).
  2. Still guard `fontReady` in `public/js/main.js:1183` with `Promise.race([fontReady, new Promise((r) => setTimeout(r, 500))])` so font loading can never deadlock boot.

### 1.4 Throttle Practice Relay Guest Input Rate & Fix `server/server.js` Headers
- **Files:** `public/js/main.js:1121-1124`, `server/server.js:133, 204-207`
- **Current Problem:** Practice relay guest sends `{ t: 'in', inp }` on every `requestAnimationFrame` (**120–144 msg/s** on high-refresh monitors) even though host runs at 60 Hz; `server/server.js` serves assets uncompressed with `Cache-Control: no-cache`.
- **Exact Changes:**
  1. Throttle guest input sends in `public/js/main.js:1121-1124` to 60 Hz fixed cadence (or send immediately on bitmask change + 15 Hz heartbeat).
  2. Add gzip compression and ETag / short cache headers for static assets in `server/server.js`.

---

## 2. P1 — Goja Performance & Nakama Bandwidth Optimization (Pinned Files — Re-Pin Required)

### 2.1 Eliminate Per-Tick `JSON.parse(JSON.stringify(...))` Inside Goja `stepLoop()`
- **File:** `public/js/net-protocol.js:448-449`
- **Current Problem:** Every 20 Hz server loop tick inside Nakama's Goja runtime executes `JSON.parse(JSON.stringify(session.seq))` and `JSON.parse(JSON.stringify(session.limiters))` purely for validation rollback. Under 10 concurrent matches on 4 cores, p95 loop time already hits **28 ms (105 ms max)** against the 25 ms budget.
- **Exact Changes:**
  1. Replace both `JSON.parse(JSON.stringify(...))` calls with either a fast shallow-clone helper over the small account-keyed maps (`Object.create(null)` copy of `{ ... }` per account) OR a pure validate-then-mutate two-pass check over the 3 substeps so no rollback clone is needed at all.
  2. Benchmark with `npm run bench:goja` before and after on an idle machine and record the p50/p95/max reduction in the PR.

### 2.2 Batch 3 Client Input Frames & Delta-Encode 10 Hz Snapshots (Cut 175 KB/s Egress by 60–80%)
- **Files:** `public/js/net-hub.js:750-775`, `public/js/net-protocol.js`, `public/js/sim.js:1707-1721`
- **Current Problem:**
  1. `NetHub.pump()` (`net-hub.js:763-769`) sends **3 separate WebSocket `OP.INPUT` frames** every 50 ms instead of 1 batched message, tripling WebSocket/Base64/JSON parse overhead on Nakama.
  2. Live Nakama egress averages **`175,066 B/s` (~175 KB/s) down per client** (**~3.8 GB/match-hour**!) because every 10 Hz `OP.SNAPSHOT` sends full uncompressed JSON (including static fields like `len`, `n`, `mh`, `cl`, `w`, `f`, unchanged players/enemies) Base64-wrapped inside Nakama's JSON WS envelope.
- **Exact Changes:**
  1. Extend `OP.INPUT` in `net-protocol.js` and `net-hub.js:763-769` to accept a batched frame array `{ frames: [{ frame, seats }, ...] }` (up to 3 substeps per 50 ms packet, still respecting existing `seq` & 60/s rate limits).
  2. Split `OP.SNAPSHOT` into:
     - **Full Keyframe** (on join, stage transition, and every ~30 ticks / 3 s).
     - **Compact Delta Snapshot** (at 10 Hz) omitting static stage/fighter/boss metadata (`len`, `n`, `mh`, `cl`, `w`, `f`) and unchanged entities, and shortening repeated numeric arrays (e.g., flat coordinate tuples `[id, x, y, hp, st, d]` for projectiles/enemies).
  3. Re-pin (`npm run build:server-sim`, goldens, `FINGERPRINT`) and measure updated `B/s` down in `tests/artifacts/c5-reconnect-summary.json`.

---

## 3. P2 — Script Bundling, Rendering Stalls & Asset/Repo Cleanup

### 3.1 Bundle & Minify Startup Scripts (Free 15 of 30 Critical Requests)
- **Files:** `scripts/build.mjs`, `public/index.html:41-56`, `public/js/render.js` (`loadFx()`), `scripts/check-budgets.mjs`
- **Current Problem:** Startup fires **16 separate unbundled classic `<script>` tags** (~402 KB raw), hitting the exact **30 / 30** critical request budget (which forced `Progress` to be stuffed inside `audio.js`). Entering a fight fires **11 more sequential `async=false` `<script>` requests** (~156 KB).
- **Exact Changes:**
  1. Use esbuild (or Rollup) inside `scripts/build.mjs` to bundle & minify the 16 startup classic scripts into **1 `app.bundle.js`** (~140 KB raw / ~45 KB gzip) and the 9 `loadFx()` scripts into **1 `fx.bundle.js`** (keeping `public/` untouched for zero-build `npm start` dev mode).
  2. Freeing 15 critical requests allows extracting `Progress` cleanly out of `public/js/audio.js:132-319` into `public/js/progress.js`!
  3. Once `metaverse-hub` ships lean `@metaverse/hub-sdk` v0.9 (without 23 KB `mock.js` and with lazy `modern-screenshot.js` 55 KB), re-vendor to cut `hub-sdk.iife.js` from 236 KB → ~120 KB.

### 3.2 Eliminate Fighter `getImageData` Readbacks & 60 FPS CPU Pixel-Morph Loop
- **Files:** `public/js/render.js:76-109`, `public/js/boss-morph.js:45-176`
- **Current Problem:**
  1. `render.js:76-109` allocates a `1024×640` (`2.62 MB`) `willReadFrequently: true` 2D staging canvas per fighter on first draw and extracts every 128×128 pose via `getImageData`/`putImageData` (forcing CPU readbacks + ~15–20 MB wasted memory).
  2. `boss-morph.js:45-176` runs a pure-JS 31k–48k pixel nested loop + `putImageData()` at **60 fps (`frameTicks: 1`)** for Sprotel Bitcoin transformations on the main thread.
- **Exact Changes:**
  1. Draw untinted fighter poses directly via `ctx.drawImage(atlasImg, rect.x, rect.y, rect.w, rect.h, dx, dy, dw, dh)` (just like `drawPortrait` already does), reserving offscreen canvas caching strictly for tinted/hue-rotated overlays if needed.
  2. Lower Sprotel Bitcoin's `boss-morph.js` `frameTicks` from `1` → `2` (30 fps matching other bosses), or pack an authored WebP transformation clip like Bosses 1–12.

### 3.3 Clean Up Unused Shipped Files, Convert Remaining PNG Atlases, & Archive 447 MB of Raw Art
- **Targets:**
  1. Delete 4 unused shipped files: `public/assets/ufo/{idle,muzzle,red-laser,thrust}.png` (update `tests/fixtures/asset-baseline.json`).
  2. Convert the 10 added-roster fighter `atlas.png`, 12 `shadows/*.png`, and 12 `stages/*-floor.png` to lossless WebP (`exact=True`, matching the ~33% savings achieved on the 6 classic fighters).
  3. Move `source/` (**287 MB**) and `art/` (**160 MB**, incl. four 22–23 MB Higgsfield PNGs in `art/sprotel-bitcoin/p1/hf-standing-*.png`) out of raw Git to Git LFS or an external archive bucket (cuts repo size from **929 MB → ~35 MB**).

---

## 4. Verification Checklist

Run before opening PR (from `AGENTS.md`):
```bash
npm ci
npm test
npm run bench:goja     # MUST stay < 25 ms p95 on an idle machine!
npm run build && npm run check:assets && npm run check:budgets
npm run test:browser
npm run test:e2e
```
If any pinned file (`net-protocol.js`, `sim.js`, `combat.js`, `ai.js`, `manifest.js`) was modified, explicitly list the updated `bundleSha256` / `contentSha256` in the PR and follow up in `metaverse-hub` (`server/modules/vendor/`, `coop_protocol.ts`, `node scripts/check-coop-sim-version.mjs`).
