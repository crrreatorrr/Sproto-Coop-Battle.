# Sproto Coop Battle server contract (C3)

The seeded 60 Hz sim and CPU AI in `public/js/sim.js` and `public/js/ai.js` are unchanged. This phase adds a restart-state codec, a classic-script server bundle, and the banked ingress rules. It does not mint Tickets, submit scores, or make the practice relay authoritative.

Game id: `sproto-coop-battle` (no terminal dot). Practice play, God Mode, and stage select in the existing client are unchanged.

## Pins

| Item | Value |
|---|---|
| Gameplay base | `ef1f35a1311bd611f08eebd1ad9725fbdeb569bb` (C0) |
| Protocol / state version | 1 |
| Bundle | `build/coop-sim.js` |
| Bundle sha256 | `10804e5e4519e17074d4944b856f724fe8e54937af871f2019b6238f15e36f2c` |
| Content sha256 | `fb9f2679528b6810dfd3a42ce41bb6f2ed3ac8e75eb3741e2ad30ccd9a4b9a72` |
| `sim.js` | `e7f9edf12beb86eb3c4157e85a8084720c9877806a32d7a430e8e4cbdc43a878` |
| `ai.js` | `d582e77a0f6162969ec3927e65e7be5d6fa78355b5ba77a04e5b7b3b22a49b97` |
| `net-protocol.js` | `2be827ea6fefc3da16d6711b7fe111cc307221bc0f58089c8c58c0b38c61484b` |
| `manifest.js` | `76a5b9e847eedbd5abc6f53ce1a272314bddc2c25b27610aa5e332d3cd14d82a` |
| Goja | `github.com/dop251/goja v0.0.0-20261107161106-d6eaa50db8bc` (Go 1.26) |
| Node | `>=22` |
| Loop | 20 Hz Nakama tick, exactly 3 sim steps (60 Hz), snapshots every 2nd loop (10 Hz) |

`npm run build:server-sim` rewrites `build/coop-sim.js` and `build/coop-sim.pin.json`. H2-C must vendor this bundle and refuse a stale pin. 15 Hz is the measured upper snapshot rate (three snapshots across four loops), not a second sim rate. Do not drop the sim below 60 Hz.

## Restart state is not a snapshot

`Sim.snapshot` stays the render view. It omits the RNG seed, ids, velocities, hit sets, AI memory, and enemy targets. `Sim.importState` rejects it.

`Sim.exportState` returns `{ kind: 'sproto-coop-battle-state', version: 1, state }`. Objects use sorted keys. `hitDone` sets become `{ "$set": [...] }`. `enemy.target` becomes `{ "$ref": "player", slot }`. Import rebuilds the sets and relinks targets to the seat's player object. A packed state larger than 262144 UTF-16 JSON units is rejected, so an undrained event log cannot be used as a checkpoint. The host still drains `state.events` after each tick; draining does not change combat. Non-finite numbers, prototype keys, and the wrong version fail closed.

Join, release, and a new connection generation change `player.ctrl` and the seat row only. They do not change lives, hp, powers, down timer, or world item ids. The practice client's `claimSlot` still refills lives; that path is not the banked server.

## Seats

Four seats. A seat is `{ slot, accountId, generation, device, human }`. CPU seats have no account. One account may hold several local devices (`k1`, `k2`, `gp0`…`gp3`) and has one connection generation. A newer generation updates every seat of that account; the previous generation's input is rejected. Releasing a seat sets `ctrl` to `cpu` so server AI takes over without a new life or a new inventory.

## Banked ingress

Banked matches start at stage 0 from a server seed. The server rejects `god`, `stage`, `state`, `seed`, `earn`, and `score`. Practice may still toggle God Mode and call `startStage`. Neither mode accepts a client state or a payout.

Input messages are at most 768 bytes. Any message over 2048 bytes is rejected. A seat mask is an integer 0..255 with the same bits as `Input.pack`: `l r u d a j s p`. `NaN`, a non-integer mask, a frame at or behind `state.t`, and a frame more than 3 ticks ahead are rejected. Sequence numbers are strictly increasing per account and generation. Duplicates and older sequences are rejected. Each account may deliver 60 input messages per second with a burst of 12. A failed frame does not advance the match. Missed substeps apply neutral buttons. There is no client pause and no mint RPC.

The 15 second reconnect grace is the seat reservation H2-C enforces. This module records the generation so a stale socket cannot write after the grace hands the seat to AI.

## Bosses

Phase 1 and phase 2 are one canonical clear. Ids are the shipped manifest keys:

| Stage | Id | Display | Pilot | Machines |
|---|---|---|---|---|
| 1 | `01-marina-bront` | Tidebreak Marina | bront | Breakwater Tug / Dry Dock Press |
| 2 | `02-last-light-vela` | Last Light Bar | vela | Prism Projector / Mirror Gantry |
| 3 | `03-mudline-crapto` | Mudline Trenches | crapto | Sludge Dredger / Floodgate Pump |
| 4 | `04-ranch-zephyr` | Sproto Ranch | zephyr | Lantern Harvester / Harvest Express |
| 5 | `05-neon-sproto102` | Neon Tomorrow | sproto102 | Salvage Strider / Billboard Rig |
| 6 | `06-circuit-rune` | Circuit Gate | rune | Relay Walker / Gate Spider |
| 7 | `07-moonkeep-bigswole` | Moonkeep Castle | bigswole | Siege Dragon / Rampart Dragon |
| 8 | `08-crown-alpha777` | Crown Relay Chamber | alpha777 | Jackpot Knight / Crown Joust Rig |
| 9 | `09-hatchery-highsproto` | The Hatchery | highsproto | Incubator Crane / Brood Crawler |
| 10 | `10-verse-sprotosales` | Verse Gate | sprotosales | Sales Carrier / Orbital Showroom |
| 11 | `11-rooftop-sproto1668` | Rooftop Breakaway | sproto1668 | Pursuit Jetpack / Intercept Glider |
| 12 | `12-codebreak-sproto3106` | Codebreak Ascent | sproto3106 | Warrant Rig / Summit Lockdown |

`terminalFacts` and `participationFacts` always report `tickets: 0` and `scoreSubmitted: 0`. One account controlling six local seats is one participation row. A late join after the first tick of the encounter is not present at the start. AFK means no non-neutral input and at least 300 alive ticks of neutral input after a 180-tick grace. Time spent down or dead does not count as that idle time, so a downed teammate is not marked AFK. Since a human's second death now puts only that human out, each row also carries `out`: 1 when every seat of that account was dead at the moment the boss fell (latched once per encounter, on the first tick the boss is `dead` or the stage is `clear`). `eligible` is `presentAtStart && !afk && !out`, so an account that was out for the kill is not eligible for that boss; a seat that was only down is. The seat returns at the next stage and starts the next encounter clean. These are facts for H3-C. This bundle cannot pay them.

## Goldens and goja

`tests/fixtures/sim-goldens.json` locks 41 cases: the published six-CPU, mixed, and six-local snapshot hashes; two six-human stage-1 fights (seeds 3 and 5, the same policy); and every stage from 0 to 11 under six-human, mixed, and CPU input. The seed-3 fight reaches UFO, revives, deaths, saved power-ups, and boss phase 2, then `gameover` at tick 12755. Its restart state is 6186 bytes, sha256 `d2ce008a3994eee2cd26d8dcaff960d1a8cb54e4b4a374c776aae2686da2f7ca`. The seed-5 fight was added with the gameplay improvement plan so boss phase 2 under six humans does not hang on one seed. A second import of that state at tick 2000, stepped 120 ticks twice, matches. Node, goja, and headless Chromium hash the same bundle.

This offline golden (`human-seed3-stage1`: tick 12755, state `d2ce008a…`) is not the golden in `docs/coop-release.md` (tick 7734, state `3ec54344…`), and they check different runs. The release golden was recorded on the sim before the gameplay improvement plan; the hub has to record it again when it re-vendors. This one (`tests/fixtures/scenarios.js`) reads the sim and picks inputs every tick, and `npm test` here locks it. The release golden is metaverse-hub's: the same seed and fight policy sent through the 20 Hz `sproto_coop` match, where each loop sends three frames chosen from the state at the start of that loop. The inputs differ, so the fight ends differently. The hub's `server/test/games/coop_match.test.ts` and `scripts/load/coop-bots.ts` lock it.

On this 4-thread host (Node v22.23.4, `go1.26.0`, Intel Xeon), the stage-1 fight itself took 1175 ms inside goja, including the tick-2000 resume check. The full 40-case set took 1308 ms in Node and 10082 ms inside goja. Ten warmed goja VMs then ran the 3-step loop across 400 samples: mean 0.86 ms, p95 3.20 ms, max 18.6 ms. That p95 is under the 25 ms share of the 50 ms server loop on this machine. Those timings are from the C3 bundle on an idle host. The gameplay improvement plan's bundle was only measured on a busy shared host (load average 15 to 40), where the old and new bundles could be compared with each other but not against the 25 ms budget: in interleaved runs, a single goja VM running the 36 stage cases took 1.9 to 2.8 ms per 3-step loop on the old bundle and 2.7 to 3.1 ms on the new one (roughly 15% to 40% more). `npm run bench:goja` should be run again on an idle machine. H2-C still has to time the same bundle inside Nakama before the capacity gate is closed. This is not a browser-host substitute.

## What is left

At the time of this phase, H2-C owned Nakama rooms, the 15 s reservation, and zero-reward matches; H3-C owned the 20-Ticket boss receipt; and C4 owned the client adapter. All three have since landed: H2-C and H3-C in metaverse-hub (`server/modules/src/games/coop_match.ts`, `coop_rewards.ts`), and C4 as `public/js/net-hub.js` (`docs/coop-online.md`). `public/index.html` still does not load `net-protocol.js`. That file runs only inside the server bundle, so the practice page is the same game.
