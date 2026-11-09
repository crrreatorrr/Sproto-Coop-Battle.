# Test Lab plan: Sproto Co-op Battle

Status: plan only; nothing is built yet. Written on 7 November 2026 from a read-only pass over `main` at `ef1f35a`.
Implementer: Cursor, on branch `cursor/test-lab`. This repo has no `AGENTS.md`. Follow this plan and `README.md`.

## What the lab is for

`public/lab.html` is a static page that needs no WebSocket server. It shows:
- the 6 fighters, with all 32 poses plus the 8-frame walk, mapped to every player state;
- the hue variants and the shadow-enemy variant;
- the 4 enemy weapons;
- all 12 bosses in both phases, with every sheet row and projectile row;
- the procedural weapons, items, FX and UFO mode;
- reach and contact zones;
- a sandbox that runs the real `Sim` on any stage, where you can spawn any boss or enemy and force its attacks.

## Owner decisions (7 November 2026, the same for every game repo)

These answers came from the owner's Q&A and apply to every game. Repo-specific sections below may add to them, but never relax them.

1. **A separate page.** The lab is its own HTML entry, `lab.html`, at the root of the built site, with its own JS bundle. The game's `index.html` must not import, link to or preload anything from the lab.
   - Measure the game's load before and after: JS bytes, request count and time to first frame. Put both sets of numbers in the PR. The game's numbers must not change.
2. **A hidden URL in production.** The lab ships in the production build at `lab.html`, relative to the game's base path.
   - Nothing in the game links to it.
   - It has `<meta name="robots" content="noindex,nofollow">`.
   - It must pass every existing production check, including banned-string scans. The repo section lists them.
3. **Desktop browser only:** keyboard and mouse. No touch layout.
4. **Automated QA.** Expose a small automation API on `window.testLab`. Never reuse an existing debug handle name. It needs at least:
   - `list()`, which returns every entity with its id, kind and animations/attacks;
   - `select(id)`;
   - `play(clipOrAttack)`;
   - `step(n)`;
   - `state()`, which returns position, velocity, state, clip, frame and HP;
   - `ready`, a promise that resolves when the current view has finished loading and drawing.

   Add a headless script (Playwright or CDP) that opens `lab.html`, visits every entity and every animation, and fails on console errors, failed requests or a blank canvas. Wire it into the repo's checks where browser checks already exist.
5. **Interaction:**
   - **Playback controls:** play, pause, step ±1 frame or tick, speed from 0.1× to 4×, scrub and loop.
   - **Live sandbox:** drive the character with the game's own controls. Show a live readout of position, velocity, facing, state, current animation and frame.
   - **Overlays:** see item 8.
   - **Spawn and fire:** spawn any enemy or boss; force any boss phase or attack; set HP; freeze AI; give any weapon, item or power-up; fire any attack on demand.
6. **Extras:**
   - **Load-time panel.** For each asset show bytes, fetch ms, decode ms and whether it came from cache; show a total per character. Load each character only when it is selected, never the whole roster up front. Use `PerformanceResourceTiming` plus timing around decode.
   - **Side-by-side compare.** Two entities, or two phases or variants of one entity, on one shared clock.
   - **Share links.** Keep all view state in the URL hash, for example `#tab=anim&id=x&clip=y&frame=12`, so a reload restores the exact view. Add a "Save PNG" button.
7. **No sim edits.** The lab is lab-only code. Do not change gameplay or sim files, or anything that changes a sim fingerprint, server bundle, replay golden or gameplay hash.
   - If the lab needs a private value, such as a collision function the game does not export, mirror it in lab code.
   - Add a unit test that fails when the mirror drifts from the source, for example by comparing outputs on sample inputs.
8. **Overlays show the game's truth plus the art's bounds.** Draw exactly what gameplay uses (hit, hurt and collision shapes; anchors; muzzle and spawn points) in one colour, and the sprite or model bounds in another, so mismatches are obvious. Also draw a grid with world coordinates.
9. **Accepted art only.** The roster lists only art the game currently uses. Pending or archived art may appear only in a tab labelled "Archive (not in game)", never in the sandbox.
10. **Isolation.** The lab never writes the player's real save, never takes tab or writer locks, never initialises the hub and never sends scores or tickets. Use an in-memory save with everything unlocked.
11. **Free-form per repo.** Fit the layout to the game. There is no shared kit across repos.
12. **Branch and PR.** Work on `cursor/test-lab`. It was created from the latest `main` with this plan committed. Commit after each phase below, and open a PR into `main` when done. Never push to `main`. Run every repo check and report any you could not run. A different agent reviews the PR.

## Facts this plan relies on

### Code layout
- No bundler. Plain IIFE globals loaded by `<script>` tags in `public/index.html`, in this order: manifest, sim, ai, input, audio, net, render, main.
- `main.js` starts the game loop automatically. **The lab loads manifest, sim, ai and render, and never main.js.**
- `render.js` reads `root.Sim` and `root.MANIFEST` at load time.

### Multiplayer
- The game is host-authoritative inside the browser. `server/server.js` only serves static files and relays rooms. The sim runs fully offline.

### Roster
- `MANIFEST.fighters` (generated by `tools/build-manifest.py`) lists `sproto3106`, `vamp`, `guest09`, `guest10`, `rivet` and `dumpstar`.
- Duplicate picks get hue variants 1–5 (`frameCanvas`, `variantOf`). Enemies use the `'shadow'` variant.
- `MANIFEST.bosses` has 12 entries × 2 phases. Each phase has its sheet, projectile sheet, body, bounds and projRows.

### Animation
- `fighterPose()` (`render.js:97-125`) maps state to pose, and is also where the weapon angle and swoosh come from.
- Poses 3–5, 7, 17–22 and 26 are never used. Those are *unused but accepted* fighter art, so show them in a separate "Unused poses" strip, not in the Archive tab.
- `ufo/red-laser.png` and `ufo/thrust.png` are unused. Those go in the Archive tab.
- Boss sheets are 4×4 grids of 256 px cells. Row 0 is idle and rows 1–3 are weapons A/B/C; the missile uses row 3. Projectile sheets are 4×4.

### States
- Player states: idle, walk, jump, land, attack, jumpatk, dashatk, dash, block, grab, throw, slam, special, hit, knock, lying, down, dead, out, ufo.
- Enemy states: walk, attack, hit, knock, lying, grabbed.
- Boss states: enter, idle, fire, charge, transform, dead.

### Weapons, items and effects
- Player weapons are in `WEAPONS` (`sim.js:11-18`) and enemy weapons in `ENEMY_WEAPONS` (`sim.js:19-24`).
- Procedural weapons from `makeWeapon`: katana, bo, hammer, spear, axe, flail, club, knife, pike.
- Power-ups: storm, meteor, bolt. Items: crate, snack, gem, power, ufo. FX kinds are listed in `render.js:368-418`.

### Collision
- There are no hitbox objects. Collision is done with inline distance checks:
  - `meleeHit` (`sim.js:317-364`)
  - enemy melee (`:593`)
  - projectile vs player (`:747`)
  - laser (`:755`)
  - boss contact (`:666-676`)
  - revive radius (`:134`)
- These are private, so **mirror them in `public/lab/` and add a drift test** (see the owner decisions below).

### Sim API
- Exported: `create`, `step`, `snapshot`, `toggleGod`, `startStage`, `alive`, `rng`, plus constants.
- Not exported: `spawnEnemy`, `startBoss` and `usePower`.
- The lab spawns by pushing correctly shaped objects into `state.enemies` and `state.boss`, built the way those internal functions build them. A drift test checks the shape against a snapshot taken after a real wave or boss start.
- `Sim.create` always needs 6 slots.
- `step()` also runs waves, the camera and game-over. The sandbox suppresses waves by leaving the camera locked and setting the wave list to empty on the lab's own state object. The sim file itself is not edited.

### Rendering helpers
- `Render` exposes `drawWorld`, `drawFighter`, `drawHead`, `drawBackground`, `frameCanvas`, `bossImages` and `preload`. `drawFighter` takes snapshot-shaped objects.
- `Render.preload()` loads 240 fighter PNGs and 24 stage images. **The lab must not call it**; load per fighter or per boss on demand.

### Existing hooks
- `?demo=1`, `window.SprotoApp`, god mode (press 9 twice), P to pause.
- The RNG is seeded mulberry32, so runs are reproducible.

### New on main (C0)
- Node 22 CI.
- `scripts/build.mjs` copies `public/` into `dist/` and writes `asset-manifest.json`.
- `scripts/check-assets.mjs` keeps a public-tree hash and a secrets scan.
- `scripts/check-budgets.mjs`.
- `tests/fixtures/asset-baseline.json` and `gameplay-hashes.json`.
- Playwright browser tests: `npm run test:browser`.

**Adding `public/lab.html` and `public/lab/` changes the public-tree hash.** Update the baseline fixture the same way C0 created it. Keep the preload numbers for `index.html` unchanged, and make sure `check-assets` still sees the game's preload pattern.

## Owner decisions applied here

- **Overlays.**
  - Game truth, drawn from the mirrored constants:
    - melee reach boxes per weapon (dx −10 to reach, |dy| ≤ 15, z window)
    - enemy melee zones
    - projectile contact boxes (|dx| < 14, |dy| < 9, z band)
    - laser lanes
    - boss half-width (w·0.42) and contact push-out
    - revive radius
    - the `FLOOR_TOP`/`DEPTH` belt with world `x,y,z` and screen-y mapping
  - Art bounds: the manifest `bounds`/`body` and the fighter foot box.
- **Boss control.**
  - Pick a stage and a boss phase.
  - Force a state: enter, fire with A/B/C/missile, charge, transform.
  - Set HP. Freeze the boss.
  - Play spreads and bursts on demand.
- **README drift.** The README disagrees with the code in a few places: boss HP is 3400+400 in the README but 2600+480 in code, spreads are 5/7 vs 3/5, bursts are 3/5 vs 2/3, and the poses path is wrong. The lab shows the code's real numbers. Fix the README in the same PR, as documentation only.

## Tabs

1. **Fighters**: pick a fighter, then hue variant 0–5 or shadow. Show every state's pose sequence with playback and weapon phase (startup, active, recovery), every procedural weapon held, and the unused-poses strip.
2. **Enemies**: shadow fighters × 4 enemy weapons, with every enemy state and its reach overlay.
3. **Bosses**: 12 × 2. Show the sheet rows with frame stepping, the projectile rows and the bounds. Force states and attacks.
4. **Sandbox**: the real `Sim` on any stage (`startStage`).
   - You control P1 with the real input; the other 5 slots are CPU or idle.
   - Spawn any enemy, crate, item or power, or start a boss.
   - Give power-ups.
   - Pause, step one tick, set the time scale.
   - Inspector: `x/y/z`, `vx/vy/vz`, `st`, timers, HP.
5. **Effects & items**: every FX kind, item kind, power-up strike and UFO mode, playable on demand.
6. **Stages**: all 12 backdrops and floors with parallax, stage length, wave x positions and bossX markers.
7. **Compare** and **Loading** (the loading view reuses `asset-manifest.json` sizes).

## Files

- Add:
  - `public/lab.html`
  - `public/lab/*.js` (IIFE style, like the game)
  - `tests/lab.test.js`: every manifest fighter and boss is covered; collision mirrors match `sim.js` behaviour on sample positions, using `Sim.create` and the real `step`; spawned objects match real shapes; hash round-trip
  - `tests/lab-browser.cjs` (Playwright)
- Edit:
  - `package.json` scripts: add the lab test to `npm test` and the lab browser test to `test:browser`
  - `tests/fixtures/asset-baseline.json`, regenerated
  - `README.md`: the lab section plus the drift fixes
  - `.github/workflows/ci.yml`, only if needed
- Do not touch: `public/js/sim.js`, `ai.js`, `main.js`, `net.js`, `server/**`, `tests/fixtures/gameplay-hashes.json`.

## Phases

1. Skeleton page with the lab loader. Confirm `npm run build`, `check:assets` and `check:budgets` pass with the updated baseline.
2. Fighters, Enemies and Bosses tabs, with the overlay mirrors and the drift test.
3. Sandbox and Effects tabs.
4. Stages, Compare, Loading, PNG export, `window.testLab`, the browser smoke test, the README and the PR.

## Acceptance

- `npm test`, `npm run build && npm run check:assets && npm run check:budgets`, and `npm run test:browser` all pass.
- The gameplay hashes are unchanged.
- Opening `/lab.html` preloads nothing until a fighter or boss is selected.
- Every boss phase, every row and every fighter state renders without errors.

## Cursor prompt

The owner pastes this into Cursor:

```text
You are working in the Sproto Co-op Battle repo (crrreatorrr/Sproto-Coop-Battle.). Check out the existing branch `cursor/test-lab`. It was created from the latest `main` and already contains `docs/test-lab-plan.md`.

1. Read `README.md` and `docs/coop-baseline.md` (this repo has no `AGENTS.md`), then read `docs/test-lab-plan.md` in full. That plan is the spec. It records the owner's answers, so follow it exactly and don't re-ask anything it already settles.
2. Build the Test Lab phase by phase as the plan lays out, and commit after each phase. The lab is a separate, unlinked `lab.html` page with `noindex` and its own bundle. It loads each character only when that character is selected. It ships hidden in the production build.
3. Repo-specific hard rules:
   - Use plain IIFE scripts, like the game. `public/lab.html` loads manifest, sim, ai and render, but never `main.js`. Never call `Render.preload()`.
   - Don't edit `public/js/sim.js`, `ai.js`, `main.js`, `net.js`, `server/**` or `tests/fixtures/gameplay-hashes.json`. Mirror the inline collision checks and the spawn shapes in lab code, with drift tests against the real `Sim`.
   - Regenerate `tests/fixtures/asset-baseline.json` for the new public files, without changing the game's preload numbers.
   - Fix the README numbers that disagree with the code (boss HP, spreads, bursts, the poses path). This is documentation only.
4. Never write the real save, never take tab or writer locks, and never initialise the hub. Use `window.testLab` as the automation handle.
5. When done, run: `npm test`, `npm run build && npm run check:assets && npm run check:budgets`, and `npm run test:browser`. Then open a PR from `cursor/test-lab` into `main` titled "Add Test Lab (lab.html)". In the PR, report:
   - the game page's load numbers (JS bytes, request count, time to first frame) before and after;
   - the result of every check, and any check you could not run, with the reason;
   - every place you mirrored private code, and the drift test that guards it.
6. If part of the plan can only be done by breaking one of these rules, stop and ask me rather than editing a protected file.
```
