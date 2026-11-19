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

## Checks

| Command | Phase 0 result |
| --- | --- |
| `npm ci` | ok |
| `npm test` | pass (Go 1.24.7 local; go.mod's 1.26 downloaded itself). goja p95 3.2 ms logged |
| `npm run build && npm run check:assets && npm run check:budgets` | pass |
| `npm run test:browser` | pass (Chromium only, see below) |
| `npm run test:e2e` | pass; Firefox leg reported unavailable |

Environment notes: the repo pins Playwright 1.65 (Chromium build 1254); the container ships build
1243, so `/opt/pw-browsers/chromium*-1254` were symlinked to 1243 outside the repo. `npx playwright
install firefox` fails here (download blocked by the network policy), so nothing ran in Firefox.
Test runs rewrite `tests/artifacts/*.json`; those rewrites were reverted, not committed.

## Cross-repo follow-ups

- None yet from Phase 0. The matchmaker `maxCount` is a client hint; if metaverse-hub's matchmaker
  hook has its own 6-player cap, it should be 4 too.

## Proposed repo-hygiene deletions (owner to decide)

(filled in by Phase 1)
