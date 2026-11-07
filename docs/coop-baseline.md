# Sproto Coop Battle baseline (C0)

Recorded from `main` `06669ce163e1ecb7c2f0f1f62fcce5bd19e26e64` plus this phase's tooling. Gameplay, art, and the six-seat sim are unchanged. The Node relay remains **practice only** and has no hub ticket, score, or earn path.

## Pins

| Item | Pin |
|---|---|
| Game id (later phases) | `sproto-coop-battle` (no terminal dot) |
| GitHub repo | `crrreatorrr/Sproto-Coop-Battle.` |
| Runtime | Node.js 22 (`engines.node` is `>=22`). Local measurement used Node v22.23.4. |
| CI | `.github/workflows/ci.yml` on pull requests and `main`: `npm ci`, `npm test`, `npm run build`, `npm run check:assets`, `npm run check:budgets`, pinned Playwright Chromium |
| Playwright | `1.65.0` exact devDependency. CI installs the matching Chromium with `npx playwright install --with-deps chromium`. The local smoke used Chrome for Testing 158.0.8127.18 (Playwright Chromium build 1254). |
| WebSocket | `ws` `8.22.1` (lockfile) |
| Sim | `public/js/sim.js` seeded mulberry32, 60 Hz. Not a server authority and not a goja bundle. |

## Commands

```bash
npm ci
npm test                 # sim hashes, practice-relay security, asset manifest
npm run build            # dist/ = public runtime files + asset-manifest.json
npm run check:assets
npm run check:budgets
npm run test:browser     # starts the practice server unless :8080 or URL is already healthy
```

`npm start` is still the practice static server and relay. `PORT=0` is honored. `/healthz` returns `ok`.

## Asset snapshot

324 runtime files under `public/assets`, **9,027,457 bytes** (9.027457 MB decimal, 8.609 MiB). Public tree is 333 files and 9,155,084 bytes, under the 10 MiB static ceiling (10,485,760). Tree hashes:

- assets `e6676387a4e92beae1d84b8515280eb3dbf7111ead4e9abcf84f72e097918f48`
- public `8be72c1792a5ca687176856daf3d2c37ff836c54518286ffb774b6b19a675d20`

| Group | Files | Bytes | gzip-9 (mtime 0) | Decoded RGBA |
|---|---:|---:|---:|---:|
| Fighters | 240 | 1,163,757 | 1,155,657 | 15,728,640 |
| Stages | 24 | 1,519,769 | 1,517,486 | 10,655,568 |
| UFO | 12 | 186,245 | 186,462 | 808,156 |
| Bosses (not preloaded) | 48 | 6,157,686 | 6,008,693 | 201,326,592 |

Boss sheets are 1024². Loading all of them would decode about 192 MiB. They stay lazy. Gzip of already-compressed images does not shrink the UFO set; transfer cost is the file bytes.

Dynamic refs: 322 (274 preload paths plus 48 boss sheet/projectile paths from `manifest.js`). Two on-disk assets are unreferenced and were **not** deleted:

- `assets/ufo/red-laser.png`
- `assets/ufo/thrust.png`

`assets/stages/` and `assets/ufo/shield` are dynamic prefixes in `main.js` / `render.js`. The checker requires every prefix to match a real file and every literal file path to exist.

## 274-image preload waterfall

`Render.preload` requests every image below in one `Promise.all`. There is no concurrency cap. `onerror` resolves as success, so a missing file still finishes the loading bar. Same-origin startup is 1 HTML + 8 blocking classic scripts + 274 images = **283 requests**, then the external Press Start 2P stylesheet. That font is not part of the static byte budget.

Order:

1. Each fighter in manifest order (`sproto3106`, `vamp`, `guest09`, `guest10`, `rivet`, `dumpstar`): poses `00`–`31`, then `w00`–`w07`. 240 requests, 128², 15,728,640 decoded bytes.
2. Stages `01`–`12`: `back.jpg` then `floor.png`. 24 requests, 10,655,568 decoded bytes.
3. UFO `cockpit-front`, `cockpit-rear`, `idle`, `laser`, `muzzle`, `beach-ball`, `shield1`–`shield4`. 10 requests. `red-laser` and `thrust` are not in this list.

Preload totals: **2,842,143 transfer bytes**, gzip-9 2,831,926 bytes, **27,107,840 decoded bytes** (25.85 MiB). These numbers are the baseline, not the later C2 request budget.

`dist/` is a sorted copy of `public/` plus `asset-manifest.json` (sha256, bytes, gzip, dimensions, decoded size). `server/`, `tools/`, `tests/`, authoring scripts, and secret-shaped text fail the build. The practice-server marker `SPROTO_PRACTICE_RELAY_NO_ECONOMY` must not appear in `dist/`.

## Six-seat gameplay hashes

Hashes are sha256 of `JSON.stringify(Sim.snapshot(state))`.

| Run | Result | Snapshot sha256 |
|---|---|---|
| 6 CPU, seed 42, through the existing campaign loop | `gameover`, stage 1, t=6957, 6 players, 0 UFO ticks | `c6ae6107e5bcbd4889664a9ce77c9426e154f35075b8065c2f813424347635d9` |
| 2 local + 4 CPU, seed 7, 1800 ticks | `play`, stage 1, t=1800 | `89ecbf4b26032462e367e666f5ebec9ca2853ca392d97461ec937a284818841b` |
| 6 scripted local devices, seed 99, 1800 ticks | `play`, stage 1, t=1800 | `d753a4cd1c37252f9f6c1a1cf7e104095183191de865df54b78762f3990b36c2` |

Input schedules are in `tests/fixtures/gameplay-hashes.json`. Browser smoke (`tests/browser-online.cjs`) checks the lobby (1 local + 5 CPU), `/?demo=1` (6 CPU), and a host plus one remote guest. Screenshots from the local run are in `tests/fixtures/screenshots/`. A browser cannot attach six physical keyboards; the six-device and mixed hashes above are the sim smoke.

## Practice relay limits

Observed busy snapshots peaked near 4 KB. The relay caps a frame at 32 KB, 240 input/snapshot messages per second with a burst of 120, 8 sockets per IP, 5 guest sockets per room, and 4 rooms per IP. Malformed URLs, null bytes, backslashes, and `..` segments fail closed. Percent-decoding happens once. Oversized WebSocket payloads and repeated malformed frames close the socket. Foreign `Origin` values are rejected; browsers always send `Origin`, so a web page on another host cannot attach. Responses carry `X-Sproto-Relay: practice; economy=none`. Room and join messages set `practice: true`, `economy: "none"`, and `hubRewards: false`. There is no ticket, score, or earn route. POST is 405.

## Explicitly not in this phase

No hub SDK, Nakama authority, goja parity, atlas packing, art generation, or economy. God Mode, stage select, and the practice relay still behave as they do today and are not bankable. C2 owns the 274-request preload. C3 owns server-sim parity.
