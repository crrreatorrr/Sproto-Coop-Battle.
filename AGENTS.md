# Sproto Coop Battle

A 6-player co-op pixel beat-'em-up on Canvas 2D, written as plain classic scripts with no engine
and no bundler. `README.md` describes the modes and controls. `docs/` holds the phase notes:
`coop-server-contract.md` is the pin contract, `coop-online.md` the banked client and
`coop-release.md` the release pins.

- The hub game id is `sproto-coop-battle`, with no trailing dot. Only the GitHub repo name ends in a
  dot.
- `public/js/sim.js`, `ai.js`, `net-protocol.js` and `manifest.js` are pinned. The hub runs them,
  concatenated as `build/coop-sim.js`, in its banked `sproto_coop` match. Any byte change to one of
  them, comments included, changes the sha256 pins and needs a re-pin. Every other file is free to
  change.
- Re-pin, only for an intended change:
  1. `npm run build:server-sim` rewrites `build/coop-sim.js` and `build/coop-sim.pin.json`.
  2. If behaviour changed, `UPDATE_GOLDENS=1 node tests/goja-goldens.test.js` rewrites
     `tests/fixtures/sim-goldens.json`. Say so in the PR.
  3. If `contentSha256` changed, update `FINGERPRINT` in `public/js/net-hub.js` and
     `tests/browser-hub-online.cjs`. If `bundleSha256` changed, update `SIM` in `tests/hub.test.js`.
  4. After the merge, metaverse-hub copies the bundle and pin into `server/modules/vendor/`,
     updates the `CoopProto` constants in `server/modules/src/games/coop_protocol.ts` and runs
     `node scripts/check-coop-sim-version.mjs`. Until then, hub CI fails its comparison with this
     repo's `main`, and the live match refuses new clients with `version_mismatch`.
- `npm start` serves `public/` only. `vendor/` is outside it, so the hub SDK
  (`vendor/hub-sdk/dist/hub-sdk.iife.js`) returns 404 there and the hub link stays offline. To try
  the hub link, run `npm run build` and serve `dist/`.
- `vendor/hub-sdk` comes from `metaverse-hub`. It is the IIFE build (global `HubSDK`), recorded in
  `vendor/hub-sdk/SOURCE.pin.json`. `npm run build` refuses a copy whose hash or version differs
  from that pin, so update the pin, `scripts/build.mjs` and `docs/coop-hub.md` together when you
  re-vendor.

## Checks

```bash
npm ci
npm test
npm run build && npm run check:assets && npm run check:budgets
npm run test:browser
npm run test:e2e
```

`npm test` runs the goja goldens with `go run`, so it needs Go. The runner's `go.mod` asks for Go
1.26; an older Go downloads 1.26 by itself unless `GOTOOLCHAIN=local` is set. `npm test` stops at
its first failing file. The goja p95 timing assertion in `tests/goja-goldens.test.js` can fail on a
busy machine; when it does, run the remaining files one by one. `test:browser` and `test:e2e` need
Playwright's Chromium and Firefox (`npx playwright install chromium firefox`).

## Art generation

Follow `docs/higgsfield-workflow-guide.md`. This repo uses the **sprite sheet** workflow. If the owner says to skip approvals, follow that section of the guide.

## Working with other agents

Claude Code, Codex, Cursor and Grok Bot all work on this repo.

- Start each task on its own branch from the latest `main`, named `<agent>/<slug>`. Never push to
  `main`; open a pull request.
- On the owner's machine, `agent-task new Sproto-Coop-Battle. <slug> --agent <name>` creates that
  branch in its own worktree.
- Don't edit files that another active task is changing.
- Run the checks before opening a pull request, and report any you could not run.
- A different agent reviews the work: `agent-task review <path>`, or `/codex:adversarial-review` in
  Claude Code.
