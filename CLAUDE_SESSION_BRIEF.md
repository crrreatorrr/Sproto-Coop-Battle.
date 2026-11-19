# Session brief: optimization handoff implementation

You are one of nine parallel Claude Code sessions implementing the load-time, security and multiplayer handoffs across the Sproto metaverse game repos. An orchestrating session coordinates the nine. It will read your pushed branch and your status file. Work only in this one repository.

## Setup
- You are on branch `claude/happy-pasteur-0dhfzp`, which is `main` plus the handoff doc `CLAUDE_HANDOFF_OPTIMIZATION.md` (from `claude/netcode-load-optimization-handoff`) and this brief, `CLAUDE_SESSION_BRIEF.md`. Do all work on this branch. Push only to it with `git push -u origin claude/happy-pasteur-0dhfzp`, retrying network failures with backoff. Never push to `main` or any other branch, never force-push and never rewrite history. Do not open a pull request; the owner will ask for those separately. This overrides any "open a PR" or "push to main" line in AGENTS.md or in the handoff.
- Before you change anything, read `AGENTS.md` (and any file it imports) and `CLAUDE_HANDOFF_OPTIMIZATION.md` in full. Where they conflict, the AGENTS.md hard rules win.

## How to treat the handoff
- Another agent wrote it from a static read. Line numbers, sizes and some claims may be stale or wrong. Verify each item against the code before acting on it. If an item is wrong, already done, unsafe, or would change gameplay, skip it and record why.
- Gameplay, balance, roster, levels, determinism and pinned hashes must not change unless a handoff item explicitly calls for the change and AGENTS.md allows it. Existing golden and replay tests must keep passing.
- Generate no new art: no Higgsfield and no image generators. You may re-encode existing assets (WebP, meshopt/KTX2, texture downscaling, decimation, audio transcoding) only when the result looks or sounds the same at game resolution. Spot-check before and after, for example with screenshots from the preinstalled Playwright Chromium.
- Do not delete archived authoring, reference or QA material from the git tree. Exclude it from builds and `dist/` instead, and list proposed repo-hygiene deletions in the status file for the owner to decide. You may delete runtime files only after proving they are unreferenced (grep, then build and tests).
- Make no production deploys and no changes to live infrastructure, and commit no real keys or secrets.
- Do not edit other repositories. Where an item needs work in another repo, build your side so it works whether or not the other side has landed (feature-detect, with a fallback), and record the dependency. You may read the other repos through the GitHub MCP tools (owner `crrreatorrr`). The other sessions push to `claude/happy-pasteur-0dhfzp` in their repos.
- Do not re-vendor `hub-sdk` from metaverse-hub in this pass. The hub's SDK changes are unmerged. Make game-side fixes that do not depend on them.

## Order of work
Work in phases. Commit and push at the end of each phase, so earlier phases land even if you run out of time.
- Phase 0: the P0 security fixes, bug fixes and quick wins listed below for this repo.
- Phase 1: the asset and cold-boot items.
- Phase 2: the multiplayer and online items.
- Phase 3: the remaining P2/P3 items, as far as they can be taken safely.
Commit each logical change separately, with a clear message. After each phase, run the repo's checks (the "Checks" section of AGENTS.md) and fix whatever you broke. If a check cannot run here (missing service, network or toolchain), record exactly which check and why. Measure before and after for every load-time claim, such as `dist/` byte counts and the number of requests at boot through Playwright, and record the numbers.

## Status file
Keep `CLAUDE_HANDOFF_STATUS.md` at the repo root and commit it with each phase. Give every handoff item one line marked done (with the commit sha), partial (with what remains), skipped (with why) or blocked (with which repo or what it waits on). Also include the check results with their commands, the before/after measurements, and a "Cross-repo follow-ups" section listing things like a hub re-vendor or re-pin, or an SDK re-sync.

## Finish
When you are done, or can go no further, review your full diff against `main` (use /code-review if it is available) and fix the real findings. Then push, and end with a short summary: which phases are complete, which items are done, skipped or blocked, the check results, and the follow-ups.

# Repository: crrreatorrr/Sproto-Coop-Battle. (handoff branch claude/netcode-load-optimization-handoff)

## Phases for this repo
- Phase 0, handoff §1: the 60 Hz boss cache thrash, the stale 6-seat `maxCount`, the blocking Google Fonts, and the practice relay input rate plus the `server/server.js` headers. These are all non-pinned files, so `contentSha256` and `bundleSha256` must not change in this phase. Confirm that by running `npm run build:server-sim` and diffing `build/`.
- Phase 1, §3: bundle and minify the startup scripts, fix the `getImageData` readbacks and the CPU pixel-morph loop, and remove unused shipped files and convert PNG atlases. Do not delete the 447 MB of raw art from the git tree; exclude it from `dist/` and list it for the owner. Phase 1 stays non-pinned.
- Phase 2, §2, pinned: the Goja `JSON.parse(JSON.stringify)` removal, input batching and delta snapshots.
  - Put these commits after all the non-pinned work, so the owner can merge the non-pinned work on its own first.
  - Run `npm run bench:goja` before and after, and record the p95 figures.
  - Follow the AGENTS.md re-pin protocol exactly: `npm run build:server-sim`, the goldens, `FINGERPRINT` in both files, and `SIM` in `tests/hub.test.js`. Record the hub follow-up: metaverse-hub must copy the bundle and pin into `server/modules/vendor/`, update `CoopProto`, and run `scripts/check-coop-sim-version.mjs`.
  - Determinism and outcomes must be unchanged. Any golden change must be explained by encoding alone.
- Checks: `npm ci`, `npm test` (needs Go; the go.mod asks for 1.26, which downloads itself), `npm run build && npm run check:assets && npm run check:budgets`, `npm run test:browser`, `npm run test:e2e`. The browser suites need Playwright Chromium and Firefox; if Firefox cannot be installed, record that.
