# Handoff status: `CLAUDE_HANDOFF_OPTIMIZATION.md`

Branch `claude/happy-pasteur-0dhfzp`. Each item is marked done (commit), partial, skipped or blocked.
Line numbers in the handoff were checked against the code; where its claim was off, the note says so.

## Phase 0 — handoff §1 (non-pinned)

| Item | Status | Notes |
| --- | --- | --- |
| 1.1 60 Hz boss cache thrash | done `8aa69bb` | Confirmed, and worse than described: `Render.drawWorld` calls `enterStage` every frame, so `evict()` runs every frame and drops a ready next-boss sheet outside `stagePins` (during any transform/action clip, and always for the deferred stage 12/13 banks); `hostStep` then re-requested it at priority 0. Removed the calls in `hostStep`, `drawGame` (current boss, already pinned) and the banked subscribe path in `net-hub.js` (that one ran per stage change, not per tick). Test in `tests/boss-transform-loading.test.js`: 120 frames of per-frame `enterStage` during a clip load 0 next-boss sheets; the old pattern loads ≥40 in 10 frames. |
| 1.2 `maxCount: 6` | done `204869f` | Now `SEATS` (4). Test in `tests/reconnect.test.js`. |
| 1.3 Google Fonts blocks boot | done `4fe93ef` | Latin subset WOFF2 (12,512 B, OFL, from `@fontsource/press-start-2p` 5.3.0) at `public/fonts/` — not `public/assets/fonts/`, because `check:assets` fails any non-image under `assets/`. Local `@font-face` + `<link rel=preload>`. Boot font wait raced against 1.5 s. The subset carries `· — …`, the same glyphs Google served (`♥` was never in the font). |
| 1.4a Practice guest input rate | done `123cd58` | `Input.sendGate()`: a change goes out at the next 60 Hz slot, an unchanged input repeats at 15 Hz. 144 Hz with input changing every frame: 61 sends/s (was 144); idle: 15/s (was 144). |
| 1.4b `server/server.js` headers | done `80e4edf` | Gzip for text ≥ 1 KB when accepted (honours `q=0`), weak size/mtime ETag + 304 for every file. `Cache-Control` stays `no-cache` (dev files are unversioned). |
| Baseline tooling | done `bf455e8` | `UPDATE_BASELINE=1 node scripts/check-budgets.mjs` rewrites the measured fields of `tests/fixtures/asset-baseline.json` (every `public/` edit changes `publicTreeSha256`). Commits between `8aa69bb` and `80e4edf` fail `check:budgets` until this one. |

Pinned output: `npm run build:server-sim` after Phase 0 leaves `build/` byte-identical
(bundle `c9288850…9fa3`, content `3fddedd1…e97b`).

## Phase 1 — handoff §3 (non-pinned)

| Item | Status | Notes |
| --- | --- | --- |
| 3.1a Bundle + minify startup scripts | done `8ff2d6b` | `npm run build` writes `dist/js/app.bundle.js` (17 startup scripts, index.html order) and `dist/js/fx.bundle.js` (render.js `FX_SCRIPTS`). esbuild 0.28.2 pinned; each file minified on its own (`target: esnext`, no wrapping), so top-level names and per-file `'use strict'` are kept (checked: no file has a file-level directive). `public/` and `npm start` unchanged. Bundles are in `asset-manifest.json` under `bundles`. No source maps (would push base bytes toward the 10 MiB cap); the readable files stay in `dist/js/`. New `tests/browser-dist.cjs` boots the built page. |
| 3.1b Extract `Progress` into `progress.js` | done `ef2b9d8` | Pure move. |
| 3.1c Re-vendor hub-sdk v0.9 | blocked | The brief forbids re-vendoring in this pass; hub SDK changes are unmerged. |
| 3.2a Fighter `getImageData` readbacks | done `b776344` | Cells drawn straight from the atlas image into the capped 128 px cell canvas; the per-fighter 1024×640 `willReadFrequently` staging canvas (2.6 MB each) and `getImageData` are gone. Kept the cell canvas (tinted/shadow variants and `frameCanvas` callers need it) rather than drawing atlas rects in `drawFighter`. atlas-visual's per-pixel check of all 240 cells passes. |
| 3.2b Sprotel morph `frameTicks` 1 → 2 | skipped | Owner set 60 Hz on purpose in `c06d92f` ("play at 60 Hz"), and `browser-sprotel-bitcoin.cjs` asserts it. Measured in Chromium: `generate` p50 0.7 ms, p95 0.9 ms per frame (max 39 ms is the one-off cel cache fill at each of the 17 gap changes). Not a main-thread stall; no change. |
| 3.3a Unused UFO PNGs | done `64ce891` | Moved to `art/ufo-unused/` (kept in git, out of `dist/`) instead of deleting. Manifest test now requires an empty unused list. |
| 3.3b PNG → lossless WebP | done `51120a9` | 10 roster `atlas.png` + 5 `motion.png` (not in the handoff, same treatment) + 12 floors + 12 shadows: 2,323,159 → 1,915,076 B (−17.6%, not the handoff's 33%). Every file decodes to identical RGBA; the PNGs had no gAMA/iCCP/sRGB chunks. `manifest.js` is pinned and still names the shadow sheets `.png`; `AssetLoader.shadowSheet` maps them. Import tools now write WebP. |
| 3.3c Move `source/` + `art/` to LFS / archive | skipped (owner) | Needs a history rewrite; not done. Already outside `dist/`. See hygiene list. |

## Phase 2 — handoff §2 (pinned; commits after all non-pinned work)

Order: `3da59aa` (client, non-pinned) → `1069f17`, `2701fe3` (pinned `net-protocol.js`) → `1371523`
(re-pin). Everything is opt-in, so until the hub advertises the features the wire traffic is
exactly what it was.

| Item | Status | Notes |
| --- | --- | --- |
| 2.1 Goja `JSON.parse(JSON.stringify)` rollback | done `1069f17` | Per-map / per-bucket copies, taken only once a loop has an input. V8 micro-bench: ~1,610 → ~165 ns per loop. The handoff's "28 ms p95" was not reproduced: `bench:goja` p95 is 1.8–4.8 ms before and 1.6–5.9 ms after on this (shared, not idle) container — noise, 5× under the 25 ms budget. The bench's frames are all `null`, so it barely exercises this path; the clone was never the bottleneck. |
| 2.2a Batch the 3 `OP.INPUT` frames | done, hub side pending | Client `3da59aa`: one `{ t: 'inputs', batch }` per burst when `coop.version` returns `features.inputBatch: true`. Bundle `2701fe3`: `CoopProtocol.splitInputBatch`. Seq, rate (60/s per account) and owner checks still run per item. Blocked on metaverse-hub calling it and advertising the feature. |
| 2.2b Delta snapshots + keyframes | done, hub side pending | `CoopProtocol.snapshotDelta` / `applySnapshotDelta` and a matching client patcher. Exact JSON round trip over 2,664 real snapshot pairs; deltas are **36.9 %** of full snapshot bytes (−63 %). The hub must send a full envelope on join/resume/stage change and at least every 60 loops (`LIMITS.snapshotKeyframeLoops`), and deltas only to presences whose join metadata has `snapDelta: '1'`. Contract in `docs/coop-server-contract.md`. Not done: dropping static fields or packing entities as tuples — the delta already omits unchanged fields, and tuples would change the render snapshot shape. |
| 2.2c Measure B/s down in `c5-reconnect-summary.json` | partial | The in-repo hub stand-in does not send deltas, so e2e still reports ~24.6 KB/s received (this stand-in, not the handoff's 175 KB/s live Nakama figure, which could not be checked here). Expect about −63 % of snapshot bytes once the hub sends deltas. |
| Re-pin | done `1371523` | `bundleSha256` `c9288850…9fa3` → `483d4094…9605` (174,879 B). `contentSha256` unchanged (`3fddedd1…e97b`; it does not cover `net-protocol.js`), so per AGENTS.md the goldens and `FINGERPRINT` (net-hub.js, browser-hub-online.cjs) stay as they are; `tests/fixtures/sim-goldens.json` is untouched and passes in Node, goja and Chromium. `SIM` in `tests/hub.test.js` updated. |

## Phase 3 — remaining P2/P3

Nothing beyond §1–§3 was left in the handoff. Its remaining items are listed above as blocked
(3.1c hub-sdk re-vendor) or skipped (3.2b Sprotel 30 fps, 3.3c moving raw art to LFS).

## Measurements

Boot to the title screen, Playwright Chromium against `server/server.js` (`npm start`), same
machine, `main` (`a87d3a7`) in a worktree vs this branch. Script: scratchpad `measure-boot.cjs`
(CDP `encodedDataLength`).

| | requests | transfer | ms to title | external hosts |
| --- | --- | --- | --- | --- |
| before, cold | 27 | 1,156,670 B | 538 | fonts.googleapis.com, fonts.gstatic.com |
| after Phase 0, cold | 26 | 861,858 B | 145 | none |
| before, warm reload | 27 | 1,142,095 B | 133 | 2 |
| after Phase 0, warm reload | 26 | 7,343 B | 109 | none |

Built `dist/` (what ships), served with gzip for html/js/json, cache disabled. Script:
scratchpad `measure-dist.cjs`. `main` = `a87d3a7` built in a worktree.

| | title requests | title scripts | title transfer | script transfer (title / with fx) | ms to title, unthrottled | ms to title, 10 Mbps 100 ms RTT |
| --- | --- | --- | --- | --- | --- | --- |
| before (`main`) | 27 | 16 | 858,302 B | 122,176 / 178,781 B (25 scripts) | 514 | 1,277 |
| after Phase 1 | 11 | 1 | 784,510 B | 79,544 / 124,900 B (2 scripts) | 125 | 1,063 |

Budget model (`npm run check:budgets`):

| | critical requests | title bytes | first-stage bytes | assets | base public |
| --- | --- | --- | --- | --- | --- |
| `main` | 30 / 30 | 1,134,814 | 2,597,393 | 274 files, 28,294,411 B | 10,077,852 (source tree) |
| after Phase 1 | 15 / 30 | 942,562 | 2,339,310 | 270 files, 27,834,472 B | 10,003,947 incl. 367,797 B of bundles (cap 10,485,760) |

## Checks

| Command | Phase 0 | Phase 1 | Phase 2 |
| --- | --- | --- | --- |
| `npm ci` | ok | ok (adds esbuild 0.28.2) | ok |
| `npm test` | pass (Go 1.24.7 local; go.mod's 1.26 downloaded itself). goja p95 3.2 ms logged | pass | pass (incl. new `snapshot-delta.test.js`) |
| `npm run build && npm run check:assets && npm run check:budgets` | pass | pass | pass |
| `npm run bench:goja` | — | — | pass ×3 before (p95 2.1 / 4.8 / 1.8 ms) and ×3 after (1.6 / 5.9 / 2.9 ms); container not idle |
| `npm run test:browser` | pass (Chromium only, see below) | pass, incl. new `browser-dist.cjs` | pass (browser goldens 49, content `3fddedd1…`) |
| `npm run test:e2e` | pass; Firefox leg reported unavailable | pass; Firefox unavailable | pass; Firefox unavailable |

Environment notes: the repo pins Playwright 1.65 (Chromium build 1254); the container ships build
1243, so `/opt/pw-browsers/chromium*-1254` were symlinked to 1243 outside the repo. `npx playwright
install firefox` fails here (download blocked by the network policy), so nothing ran in Firefox.
Test runs rewrite `tests/artifacts/*.json`; those rewrites were reverted, not committed.

## Cross-repo follow-ups

- The matchmaker `maxCount` is a client hint; if metaverse-hub's matchmaker hook has its own
  6-player cap, it should be 4 too (not checked: this session cannot read metaverse-hub).
- Whatever deploys `dist/` must ship `js/app.bundle.js` and `js/fx.bundle.js` (listed under
  `bundles` in `asset-manifest.json`, not under `files`) and `fonts/`.
- When `manifest.js` is next re-pinned, rename the shadow sheets to `.webp` there (and in
  `tools/shadow-roster.json`) and drop `AssetLoader.shadowSheet`.
- hub-sdk v0.9 re-vendor (handoff 3.1.3) once metaverse-hub ships it.
- **Re-pin in metaverse-hub** (bundleSha256 changed, content did not): copy `build/coop-sim.js` and
  `build/coop-sim.pin.json` into `server/modules/vendor/`, update the `CoopProto` constants in
  `server/modules/src/games/coop_protocol.ts`, run `node scripts/check-coop-sim-version.mjs`. Until
  then hub CI's comparison with this repo's `main` fails on `bundleSha256` once this merges.
- **Hub adoption of the wire savings** (`docs/coop-server-contract.md`, "Optional: input batches and
  snapshot deltas"): return `features: { inputBatch: true, snapshotDelta: true }` from
  `coop.version`; route `{ t: 'inputs' }` through `CoopProtocol.splitInputBatch`; keep the last sent
  envelope per match and send `snapshotDelta` to presences with `snapDelta: '1'`, with a full
  envelope on join, resume, stage change and every 60 loops. Then re-measure B/s down.

## Proposed repo-hygiene deletions (owner to decide)

Nothing below ships in `dist/` (the build copies only `public/` plus the SDK and bundles). The pack
is 466 MiB. Moving these to Git LFS or an archive bucket means rewriting history, so it was not done.

- `art/sprotel-bitcoin/` — 158 MB, mostly the four 22–24 MB Higgsfield PNGs
  `p1/hf-standing-{master,a,b,c}.png` added in `c06d92f`.
- `source/actions/` 146 MB, `source/effects/` 106 MB (one 19 MB `provider-original.png`),
  `source/transformations/` 23 MB, `source/endpoint-rigs/` 9.4 MB, `source/fallback-standing-holds/` 4.8 MB.
- Keep `art/fighter-poses/` (1.9 MB): `check:budgets` and `atlas-visual.cjs` read it.
- `art/ufo-unused/` (68 KB): the four UFO PNGs nothing requests; delete if not wanted.
