# Sproto Coop Battle: gameplay improvement plan

## 1. Status

Implemented on branch `claude/trusting-ramanujan-63h582` (2026-11-11). Sections 2 to 10 are the plan
as it was written, and their line numbers refer to `ae9dd75`. What was built, what differs from the
plan and what was measured is in section 11.

- Audited 2026-11-09 at `ae9dd75`. Re-checked 2026-11-11: `main` is still `ae9dd75`, so every line
  number below is current.
- Line numbers refer to files under `public/js/` unless a path is given.
- "Pinned" means one of `sim.js`, `ai.js`, `net-protocol.js`, `manifest.js`. Any byte change to
  those needs the re-pin in section 6.

## 2. How this was audited and how far to trust it

| Evidence | What was done | Limits |
| --- | --- | --- |
| Browser | `public/` served locally, headless Chromium, keyboard input. Title, lobby, a full solo stage 1 to game over, a god-mode stage 1, screenshots, console (no errors). | One player, keyboard only. No stage past 1 was played in the browser. |
| Headless sim | `sim.js` and `ai.js` loaded in Node with the manifest, stepped at 60 ticks/s. A soft-lock reproduction, time-to-kill measurements and about 90 full runs. | "Human" seats were driven by the CPU brain (`SproAI.think`) with `ctrl` set so they take and deal human damage. That bot mashes attack, revives and uses power-ups but **never blocks or parries**, so absolute stage numbers are pessimistic. Relative differences between player counts are the useful part. |
| Code reading | Online and banked play, gamepads, everything not listed above. | Not run. |

`npm test` was not run during the audit. The throwaway scripts were not kept. To rebuild the
harness: create a state with `SproSim.create(slots, seed, firstStage)`, set `ctrl: 'cpu'` on CPU
seats, drive bot-human seats by calling `SproAI.think` and then restoring `ctrl: 'human'` before
`SproSim.step`, and record `state.stageIdx`, `state.mode` and `state.t` at game over. Six seeds per
configuration were used.

## 3. What already works and should be kept

- Hit feel: hit stop (`hs`), screen shake (`shake`, line 278) and sparks land on every hit.
- Six weapons that differ in reach, damage and timing (lines 11-18), each with its own finisher.
- Drop-in play and CPU fill for empty seats.
- Pacing between fights: about 16 s of walking between waves, and a full run is a sensible length
  (one six-bot win took 28 minutes).
- Every cleared wave leaves a power-up (line 805), and phase two of each boss drops a UFO and a
  power-up (lines 641-642).

## 4. Findings

Current tuning, for reference:

| Value | Where | Number |
| --- | --- | --- |
| Human health, lives | line 26 | 100 HP, 2 lives |
| CPU teammates | line 32 | deal 55%, take 135% |
| Grunt health | line 519 | `(26 + 4·s [+14 for club]) × (1 + 0.09·s)`: 26-40 on stage 1, 139-167 on stage 12 |
| Grunt damage | line 595 | `(weapon + floor(s/3)) × (0.8 + 0.1·s)` |
| Grunts per stage | lines 50-54 | 45 on stage 1 rising to 101 on stage 12, at most 12 on screen (line 34) |
| Boss health | line 623 | `2600 + 480·s`: 2,600 to 7,880 |
| Block | line 28 | 9 held ticks to raise; parry is the first 8 ticks of the block |
| Down timer, revive | line 30 | 600 ticks (10 s) to be revived; 70 ticks to revive |

(`s` is the zero-based stage index.)

### F1. A grabbed enemy freezes forever and locks the wave (High, bug, reproduced)

`updateGrab` (line 298) is the only code that releases a grabbed enemy, and it only runs while the
player is in the `grab` state. If the grabber is hit, `hurtPlayer` moves them to `hit`, `knock` or
`down` (lines 389-395) and the enemy stays `grabbed`. `updateEnemy` returns early for grabbed
enemies (line 554) and `meleeHit` skips them (line 322), so normal attacks can never kill it. The
wave only ends when no enemy is alive (line 802), so the stage is stuck. Reproduced in the headless
sim: the grabber was hit after 47 ticks, 30 s of katana swings did 0 damage, and the wave stayed at
`left = 0` with one enemy alive. Only hammer and spear finishers, power-ups or the UFO free it.
Grabs start automatically when a human walks into a dazed enemy (lines 229-237), so players trigger
this without choosing to.

### F2. Difficulty runs backwards with the number of humans (High, measured)

Nothing scales with human count: wave sizes (line 50), grunt health (line 519) and boss health
(line 623) depend only on the stage. CPUs fill the empty seats but are much weaker (line 32) and die
permanently on their first death (line 402).

| Humans (rest CPU) | Furthest stage reached, 6 seeds |
| --- | --- |
| 0 | 1 (dies at the boss, about 100 s) |
| 1 | 2-3 |
| 2 | 4-5 |
| 3 | 5-8 |
| 4 | 6-10 |
| 6 | 7-12, one full win in 28 minutes |

Starting directly on stage 12, one human was wiped in 23-78 s; six humans won 5 of 5. In the
browser, all five CPU teammates died at the stage 1 boss.

### F3. Three unfair ways to lose (High, two observed, one measured)

- **Killed by a dead boss.** When the boss reaches 0 HP it enters `dead` for 150 ticks (lines
  659-661) but its shots stay live. Observed: a leftover shot downed the last Sproto and the run
  ended in GAME OVER during the boss's explosion.
- **Solo player with a spare life gets game over on the first down.** The "everyone is down" check
  at line 837 fires as soon as no Sproto is standing. A solo human whose CPUs are dead never reaches
  the respawn in `die` (line 405), because that only runs when the 10 s down timer expires.
- **One player's second death ends the run for all six** (line 404). This ended 4 of 16 six-human
  bot runs.

### F4. One boss script and one grunt brain; the late game is a health sponge (High, measured)

`updateBoss` (lines 648-705) is the same for all twelve bosses: drift, a three-step fire cycle, a
charge every fifth attack (every fourth in phase two), periodic adds. The boss id only selects
sprites. Grunts are four weapon kits (lines 19-24) on one approach-and-swing routine (lines
602-615). Measured katana time-to-kill per grunt: 0.5 s on stage 1, 2.5 s on stage 6, 6.3 s on
stage 12, while the count more than doubles. The README's boss numbers no longer match line 623.

### F5. Enter on the title skips the lobby (Medium, observed 5 of 5)

One Enter press goes from title to stage select and the next starts stage 1, so the Sproto and
weapon pick is never seen. Cause: Enter is shared by both keyboard layouts and the START tap is
deliberately kept for the other layout (`input.js:94-97`), so a single press is read twice
(`main.js:259`). Space behaves correctly.

### F6. Everyone stacks into one blob (Medium, observed)

Enemies all stand off at the same point relative to their target (line 606); the `offX` field is
created at line 525 and never used. CPU teammates path to the same spot (`ai.js:52`, `ai.js:69`).
Screenshots show five Sprotos and several enemies inside about 80 px with player 1 hidden. The hub
status strip (`main.js:663`) also covers the "P1" labels at the top of the HUD.

### F7. Defence is slow to come out (Medium, read)

- Block needs Special held for 9 ticks (line 234) and the parry window is the first 8 ticks after
  that (line 370). The press must therefore land 150-283 ms before impact. A knife's startup is 10
  ticks, so reacting to it is not possible.
- Releasing Special before the block rises triggers the spin attack, which costs 6 HP (line 26).
- There is no attack buffer: a press during recovery is lost.
- Dash is double-tap only (14-tick window, line 28).

### F8. No reason to replay (Medium, read)

All stages are unlocked, nothing is saved, the end screen is a banner with no statistics, the six
characters differ only in looks, and there is no music (`audio.js` synthesises effects only).

### F9. The boss has a safe side and a faint warning (Medium, observed)

The boss faces the average position of the group (line 684) and only fires that way. Standing
behind it, 22 s of attacks drew no damage. The lane warning starts at alpha 0.18 for half a second
(`render.js:563`) and is hard to see on the wooden floor.

### F10. Smaller items (Low)

- With an idle human, the CPUs walked ahead and triggered wave 1 after 3 s.
- Banked play sends snapshots at 10 Hz with no prediction against an 8-tick parry window
  (unverified; read only).

## 5. The plan

Effort: S is under a day, M a few days, L a week or more. Proposed numbers are starting points to
tune with the bot sweep in section 9.

### Phase A: fix what is broken

**A1. Release a grabbed enemy when the grab ends for any reason** (F1). Pinned: `sim.js`.

- Change: add `releaseGrab(state, p)` that finds the enemy with `id === p.grab`, sets it back to
  `walk` with `t = 0` if it is still `grabbed`, and clears `p.grab`. Call it from `setState` when a
  player leaves `grab`, or explicitly at the three exits in `hurtPlayer` (lines 389-395) and in
  `die`. As a second guard, in `updateEnemy` line 554 release any grabbed enemy whose holder is no
  longer in `grab`.
- Tests: `tests/sim.test.js` gains "grabber is hit, enemy returns to walk within one tick and can be
  killed".
- Acceptance: the reproduction from F1 ends with the enemy dead and the wave cleared.
- Effort S.

**A2. Clear enemy shots when the boss dies** (F3). Pinned: `sim.js`.

- Change: in `hurtBoss` line 646, when `b.hp <= 0`, drop every projectile with `enemy: true` and
  give all living players `inv = 150` for the death sequence.
- Tests: `tests/sim.test.js`: a boss killed with a shot in flight cannot cause game over.
- Effort S.

**A3. Let a downed human with a spare life respawn before game over** (F3). Pinned: `sim.js`.

- Change: at line 837, before calling `gameOver`, look for a downed human with `lives > 1`; if one
  exists, call `die` on them immediately (which decrements the life and respawns) instead of ending
  the run.
- Tests: solo human, CPUs dead, first down leads to a respawn; the second ends the run.
- Effort S.

**A4. Fix the Enter skip** (F5). Not pinned: `input.js`, `main.js`.

- Change: consume the START tap once a menu action has been taken in the same frame; `main.js:259`
  already returns after `chooseMenu`, so clear `tapped` for Enter there.
- Tests: `tests/input.test.js` case for one Enter press producing one menu action.
- Effort S.

**A5. Readability quick wins** (F6, F9). Not pinned: `render.js`, `main.js`.

- Raise the lane warning from alpha 0.18 to about 0.40 at the start and outline it in a light
  colour so it reads on dark and light floors (`render.js:563`).
- Draw a marker (arrow and slot colour) over the local player.
- Move the hub strip (`main.js:660-665`) below the player labels or shorten it.
- Update `tests/hud-copy.test.js` if any strings move. Effort S.

**A6. Correct the README boss numbers** to match line 623. Effort S.

### Phase B: rebalance and feel (all pinned unless stated)

**B1. Scale to the number of humans** (F2). `sim.js`, `ai.js`.

- Let `h` be the number of human seats at stage start (1-6). Proposed starting values:

  | Quantity | Now | Proposed |
  | --- | --- | --- |
  | Wave count | `per` | `round(per × (0.55 + 0.075·h))`: 62% solo, 100% at six |
  | Grunt health | formula at line 519 | multiply by `0.7 + 0.05·h` |
  | Boss health | `2600 + 480·s` | multiply by `0.45 + 0.09·h` |
  | CPU damage dealt / taken | 0.55 / 1.35 | 0.75 / 1.15 when `h ≤ 2`, unchanged otherwise |
  | CPU death | permanent | CPUs may be revived like humans (they already go `down` first) and revive each other |

- Store `h` in the state at `startStage` so a drop-in mid-stage does not change the stage in
  progress.
- Tests: `tests/sim.test.js` for each formula; golden fixtures change.
- Acceptance (bot sweep, six seeds): one human reaches stage 6 or later in at least half of runs;
  two humans reach stage 9; six humans are no easier than today.
- Effort M. Depends on the owner's answer to 8.1.

**B2. Block on press and a short attack buffer** (F7). `sim.js`.

- Block rises on the tick Special is pressed while standing (remove the 9-tick hold for raising;
  keep `tapS` for the spin by reading release within 6 ticks without a hit taken).
- Parry window: first 8 ticks from the press, unchanged in length.
- Buffer an attack press for 6 ticks during recovery (`startAttack`, line 263).
- Do not add a dash button: it would need a ninth input bit and a protocol change.
- Tests: timing cases in `tests/sim.test.js`. Effort M.

**B3. Spread the crowd** (F6). `sim.js`, `ai.js`.

- Give each enemy an `offX` of ±0-28 px at spawn (line 525) and add it to the stand-off point at
  line 606. In `ai.js`, offset each CPU's target by its slot so teammates fan out.
- Acceptance: with six Sprotos and twelve enemies, no more than three bodies overlap within 30 px in
  a sampled frame. Effort S-M.

**B4. Decide the shared-loss rule** (F3). Depends on 8.3. If changed: a human's second death takes
that human out and the run ends only when no human is left. One line at 404. Effort S.

**B5. Close the boss's safe side** (F9). Have the boss pick the denser side every cycle rather than
the average, and add a rear sweep when two or more Sprotos stand behind it for more than 3 s. Effort
S-M.

### Phase C: feedback and reasons to replay (not pinned)

**C1. End-of-run summary and local bests.** Show stage reached, time, score, kills, revives and
parries per player on game over and victory; keep bests in `localStorage`. The score is already in
the snapshot. `render.js`, `main.js`. Effort S-M.

**C2. Music and a stronger boss warning sound.** Synthesise loops in `audio.js`; the asset budget is
about 9.2 MB of a 10 MiB ceiling, so do not add audio files without checking
`npm run check:budgets`. Effort S-M.

**C3. Stage unlocks.** Unlock stage N+1 on clearing N, saved locally, with all stages still open in
a "free play" toggle so drop-in groups are not blocked. Effort S.

### Phase D: larger content

**D1. Boss archetypes.** Three or four scripts keyed by `b.bi % 4`, reusing the existing sheet rows:
the current "gunner"; a "charger" that charges every second attack and leaves a burning lane; a
"summoner" with fewer shots and adds every 150 ticks; a "bomber" that fires lobbed area shots with
ground markers. `sim.js` (pinned), `render.js`. Effort L. Possibly no new art (8.4).

**D2. One elite grunt.** A shielded grunt that must be parried, launched or hit from behind, at most
two on screen. `sim.js`, `ai.js` (pinned). Effort M.

**D3. Character differences.** Small passive per Sproto (for example +10% health, faster revive,
longer parry). `sim.js` and `manifest.js` (pinned). Effort M.

## 6. Order and batching

Not pinned, ship any time: A4, A5, A6, then C1, C2, C3.

Pinned work in as few re-pins as possible:

| Batch | Items | Changes `contentSha256`? |
| --- | --- | --- |
| 1 | A1, A2, A3 | No content table changes, but `bundleSha256` changes. Behaviour changes, so goldens change. |
| 2 | B1, B2, B3, B4, B5 | Yes if any constant in the content block changes; treat as yes. |
| 3 | D1, D2, D3 | Yes. |

Re-pin checklist for each batch, from `AGENTS.md`:

1. Run `npm run bench:goja` on an idle machine before the change and note the p95.
2. Make the change. `npm run build:server-sim` rewrites `build/coop-sim.js` and
   `build/coop-sim.pin.json`.
3. `UPDATE_GOLDENS=1 node tests/goja-goldens.test.js` rewrites `tests/fixtures/sim-goldens.json`.
4. If `contentSha256` changed, update `FINGERPRINT` in `public/js/net-hub.js` and
   `tests/browser-hub-online.cjs`. If `bundleSha256` changed, update `SIM` in `tests/hub.test.js`.
5. `npm test`, then `npm run bench:goja` again; the 25 ms budget must hold.
6. Say in the pull request which hashes changed.
7. After the merge, metaverse-hub copies the bundle and pin into `server/modules/vendor/`, updates
   the `CoopProto` constants and runs `node scripts/check-coop-sim-version.mjs`. Hub CI is red from
   the merge until this lands. When `contentSha256` changed, banked clients are refused with
   `version_mismatch` until the hub is deployed, so merge and hub deploy should be close together.

## 7. Hub integration

From the hub audit of 2026-11-09 (the hub has changed a great deal since; re-check against the
hub's own plan before acting):

- Tickets: 20 per boss per day, up to 12, settled by the server from the banked match.
- The server leaderboard exists but was not shown in the plaza.
- The Marina Anchor Relic is live and gave no in-game benefit.
- This game has no screen to exchange Tickets for Verse; that is planned on the hub side.
- B1 changes how fast bosses fall, and so how fast Tickets are earned. The daily limit of 12 bounds
  it; mention it in the hub re-vendor request.

## 8. Decisions for the owner

1. **Should one human with five CPUs be able to win?** Options: (a) yes, scale as in B1
   (recommended); (b) solo is meant to be a short practice mode, in which case say so on the lobby
   screen and scale only for 2-5 humans; (c) leave as is.
2. **Is one re-pin and hub re-vendor acceptable now for batch 1?** Recommended: yes; it removes a
   soft lock.
3. **Keep "any human's second death ends the run for everyone"?** Recommended: change it (B4); the
   rule punishes the group for its weakest player.
4. **Boss variety with existing sheets only, or is new art allowed?** D1 is written for existing
   sheets.

## 9. How to verify

- Re-run the bot sweep (0, 1, 2, 3, 4, 6 humans, six seeds, from stage 1 and from stage 12) after
  each pinned batch and compare with the table in F2 and the targets in B1.
- Re-measure katana time-to-kill per grunt on stages 1, 6 and 12 after B1.
- Human playtest checklist, with 1, 2 and 6 players:
  - Can a new player find block, parry and dash without being told?
  - Does anyone lose sight of their Sproto in a wave of twelve?
  - Does any game over feel undeserved? Note the cause.
  - Does stage 6 feel different from stage 2 beyond taking longer?
  - Do solo players want another run after losing?

## 10. Not audited

Online relay play, banked play against a live hub, gamepads, Firefox, mobile, and frame rate on real
hardware.

## 11. Implementation record (2026-11-11)

### What was built

| Item | State | Notes |
| --- | --- | --- |
| A1 | Done | `releaseGrab` on every hit, on death, and a guard in `updateEnemy`. Also fixed while testing it: a knee strike that killed the held enemy stood the dead enemy back up as a Shadow Sproto that attacked but could not be hit. |
| A2 | Done | Enemy shots removed, remaining Shadow Sprotos fall, 150 ticks of invulnerability. |
| A3 | Done | All downed humans with a spare life use it when nobody is standing. |
| A4 | Done | Keyboard edges are settled for both layouts at the end of every frame. |
| A5 | Done | Lane warning at 40% with a light edge, arrow over your own Sproto, hub tag under the player panels. |
| A6 | Done | README boss numbers, then rewritten again for B1 and D1. |
| B1 | Done | Tuned, see below. The human count is taken when the stage's first fight starts, not in `startStage`: banked seats are assigned after `create`, so `startStage` would always count zero. |
| B2 | Done | Plus a 24-tick parry lock after a block, because block-on-press alone made parries mashable. |
| B3 | Partly | Much better, not at the target. See the crowd numbers below. |
| B4 | Done | Recommended option taken. A human who is put out returns at the next stage on one life, as dead CPUs already did. |
| B5 | Done | Rear sweep after 3 s with two Sprotos behind, 5 s with one (the observed exploit was one human). |
| C1 | Done | `public/js/progress.js`; KOs, revives and parries are counted in the sim. |
| C2 | Done | Three synthesized loops and a boss klaxon. Nobody has listened to them: they were only checked for scheduling in `tests/audio.test.js` and for errors in headless Chromium. |
| C3 | Done | Power on the stage screen toggles free play. |
| D1 | Done | Existing sheets only. The summoner's adds are the old "periodic adds", which could never fire (`b.t` never reached 150). |
| D2 | Done | Six blocked hits also break the guard, so an elite can never stall a wave for players who do not parry or launch. |
| D3 | Done | Passives live in `sim.js` by fighter index. `manifest.js` is generated and was not edited. |
| F10 | Partly | CPUs no longer run ahead of the lead human or chase items behind the camera. Banked prediction was not touched. |

### B1 numbers

| Quantity | Plan | Shipped |
| --- | --- | --- |
| Wave count | `0.55 + 0.075·h` | `0.5 + 0.1·h` |
| Grunt health | `0.7 + 0.05·h` | `0.58 + 0.102·h` |
| Boss health | `0.45 + 0.09·h` | `0.35 + 0.15·h` |
| CPU dealt / taken, `h ≤ 2` | 0.75 / 1.15 | 0.75 / 1.15 |

The slopes are steeper than planned because B4 and A3 make deaths much cheaper for large groups:
with the planned values six bot-humans won 9 of 12 runs against 2 of 12 before.

### Bot sweep

The harness was rebuilt as section 2 describes (CPU brain on human seats, plus mashing attack,
reviving and firing power-ups; never blocks, parries, dashes or launches). It also stops swinging
while a boss winds up a charge or the bot stands in a marked area, and walks on when the screen is
empty. "Before" is `ae9dd75` under the same harness, so it differs from the table in F2. Furthest
stage reached from stage 1, six seeds (`W` is a win):

| Humans | Before | After |
| --- | --- | --- |
| 0 | 1 1 1 1 1 1 | 2 2 2 2 2 5 |
| 1 | 2 1 2 2 3 2 | 6 6 7 7 6 6 |
| 2 | 4 6 5 3 5 3 | 7 10 10 9 9 7 |
| 3 | 7 8 6 6 8 6 | 10 9 10 11 10 9 |
| 4 | 9 11 11 10 10 11 | W 10 11 11 11 11 |
| 6 | 11 12 9 11 W 12 | 11 9 8 11 8 W |

Twelve seeds: one human reached stage 6 or later in 12 of 12 runs (median 7); two humans reached
stage 9 in 8 of 12 (median 9); six humans won 2 of 12 with a median of stage 11. Before, over the same twelve seeds: one human
never passed stage 3 (median 2), two humans never passed stage 6 (median 4), and six humans won 2
of 12 with a median of stage 11.

Starting on stage 12, wins out of six: one human 0 (before 0), two 1 (0), three 3 (0), four 5 (3),
six 5 (6).

Against the acceptance targets: one human past stage 6 in half of runs, met. Two humans reach stage
9, met in two thirds of runs. Six humans no easier than today, met on win rate, at the cost of
longer fights for six (below).

### Other measurements

- Katana time-to-kill on one passive Shadow Sproto, stages 1 / 6 / 12: before 0.7 / 4.2 / 9.9 s.
  After, one human 0.5 / 2.4 / 5.9 s; six humans 0.7 / 4.3 / 11.5 s. The late-game sponge (F4) is
  smaller for small groups and slightly larger for six.
- Crowd (B3): sampled frames with six Sprotos up and at least nine Shadow Sprotos on stage 6, the
  largest number of bodies inside one 30 px circle. Before: median 5, worst 8, more than three in
  76% to 87% of frames. After: median 2 to 3, worst 4, more than three in 4% to 19% of frames. The
  target was never more than three.
- Soft lock (F1): the reproduction now ends with the wave cleared (`tests/sim.test.js`).
- goja: the machine was shared and busy (load average 15 to 40), so `npm run bench:goja` could not
  be compared with its 25 ms budget; the old bundle itself measured 18 to 56 ms there against 16 ms
  earlier the same day. Interleaved, one goja VM over the 36 stage cases took 1.9 to 2.8 ms per
  3-step loop before and 2.7 to 3.1 ms after. Run `npm run bench:goja` on an idle machine.

### Pins

| Batch | `bundleSha256` | `contentSha256` |
| --- | --- | --- |
| Before | `28f9236d0df78c62cf600ad08c9924f8dd260b6948d7a73baf60230936934fac` | `f8705ec4b68e5643e7ce7e3f0014308e9546ddf43d55a506f4805e4091b07f1e` |
| 1 (A1 to A3) | `22a104e0c3a41e62318aab8f2e5cbc4f802a8cf98170cc46888ed6ce668f1c31` | unchanged |
| 2 (B1 to B5) | `1c344819e8dd5bf9d1fd34cf1c469a2cf6e064c83d0d1332bf44662e3b49a1a4` | unchanged |
| 3 (D1 to D3) | `bb02957d4a6fda819dec4e42cd856a26f14f55e82b193d520bc4db4948193483` | `fb9f2679528b6810dfd3a42ce41bb6f2ed3ac8e75eb3741e2ad30ccd9a4b9a72` |

`contentSha256` changed in batch 3 because `contentManifest` now lists each stage's boss script and
each fighter's passive. The hub has to copy `build/coop-sim.js` and its pin, update `CoopProto`, and
record its own seed-3 golden again. B1 changes how fast bosses fall (section 7).

### Not done, and worth a look first

- No human has played any of this. Section 9's playtest checklist is still open, and the bot never
  blocks, so block-on-press, the parry lock and the elite guard are only covered by unit tests.
- The music and the klaxon have not been heard by anyone.
- `public/js/progress.js` is the 30th startup script: the critical-request cap of 30 is now exactly
  met, and the title transfer is 1,514,129 of 1,572,864 bytes.
- Firefox, gamepads, online relay play with real latency and banked play against a live hub were
  not run. The Chromium browser and e2e suites pass.

