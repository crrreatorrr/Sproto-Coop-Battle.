# Sproto Coop Battle release pins (C5)

Prepared for H5. This document does not deploy, flip a public flag, or change gameplay. The sim bytes below are the bytes on game main `171a7e9` and they still match the hub pin.

**Superseded pins.** The gameplay improvement plan (`docs/gameplay-improvement-plan.md`) changed the sim after this release, so the sim hashes, the content fingerprint and the hub golden in the matrix below are the C5 record, not the current pin. The current pin is `build/coop-sim.pin.json` (also quoted in `docs/coop-server-contract.md`), and the hub must re-vendor it before banked play matches again.

## What was exercised

The Bar cabinet on hub main `05859c8e` lists three games. Sproto Coop Battle is the third. Signing in, pressing E at the machine, and choosing 3 opens this game with a redeemed account and a live Ticket balance. Return lands on `/hub/#from=sproto-coop-battle` at the cabinet. Screenshots from that run are `tests/artifacts/c5-bar-*.png`.

Local and relay play stay practice and write 0 Tickets. A banked Nakama match is `sproto_coop`. The client still has no `earnTickets`, `reportEvent`, `submitScore`, or `tickets.earn` call.

## Pin matrix

| Item | Pin |
|---|---|
| Game repo | `crrreatorrr/Sproto-Coop-Battle.` |
| Gameplay base | `171a7e9b1325f14c9d6e1b83843221517c1e0d1d` (C4, Coop #6) |
| Hub | `05859c8e29b31e519835d17fbed0a60b1c8641d0` (H3-C, hub #86) |
| H1 cabinet | `a689da3cadf59dcccac6cd2b6e31b531f4effa09` (hub #83) |
| H2-C match | `469a69a52b029b6b7b431187ea779b988af56a89` (hub #84) |
| Game id | `sproto-coop-battle` |
| Nakama match | `sproto_coop` |
| Protocol / state | 1 / 1 |
| Loop | 20 Hz, 3 substeps, 60 Hz sim, snapshot 10 Hz |
| Content fingerprint | `f8705ec4b68e5643e7ce7e3f0014308e9546ddf43d55a506f4805e4091b07f1e` |
| Bundle sha256 | `28f9236d0df78c62cf600ad08c9924f8dd260b6948d7a73baf60230936934fac` |
| `sim.js` | `08611f8cc60d9102a6a729f81351431d595b85565ba5e8c59895f8050759a368` |
| `ai.js` | `a484504b1b415cfa5f7c3deaaeb6bf4b77317483152d087f3a264532a1ea61ae` |
| `manifest.js` | `76a5b9e847eedbd5abc6f53ce1a272314bddc2c25b27610aa5e332d3cd14d82a` |
| `net-protocol.js` | `c8a09e9ffd76d0f852242262bcb57d62fda3e322bb45c4b0809986958a1a25b4` |
| Golden (hub match) | tick `7734`, state `3ec543448ecd6aafb53de3056c2425955733d2002ef65bfc117b11d531255494`, end `gameover`. This is the hub's seed-3 run through the 20 Hz match, not this repo's offline `human-seed3-stage1` fixture (tick 7154); see `docs/coop-server-contract.md` § Goldens and goja |
| SDK | `@metaverse/hub-sdk` 0.7.2, IIFE `770e8e1b41ad1abef33eb0d04ef9c7eec8fda723336e5149a7809d902042013c` |
| Nakama image | `heroiclabs/nakama:3.41.0` (`3.41.0+cab8af5`, Go 1.27.1 in that image) |
| Postgres | `postgres:16.8-alpine` |
| Migration | `0041_coop_boss_receipt` |
| Payout | 20 Tickets, reason `srv_coop_boss_clear`, board `coop_stage_clear_ms_v1` |
| Caps | 200 per game session, 1,000 per account per game per UTC day |
| Reconnect grace | 15 s |
| Goja | `github.com/dop251/goja v0.0.0-20261107161106-d6eaa50db8bc` |
| Node | 22 (`v22.23.4` on the evidence VM) |

`coop.version` on this hub returns `commit` `9a0b5d9f97460617b4b2bb8445dae6849f163d51`. That label is the hub pin's recorded commit. The four sim files and the bundle hash above still match it. Later game commits did not change those bytes. H5 should keep shipping the hash, and can refresh the commit label when the hub pin is rewritten.

## Receipts

Hub `DUP_ONLY=coop` against this Nakama, from `server/test/dup/coop_rewards.ts` at `05859c8e`:

| Check | Result |
|---|---|
| Client `tickets.earn` / `session.event` / `score.submit` naming the coop payout | rejected (`server_reason`, `bad_event`, `bad_board`) |
| 100 retries, delayed retry, both phases, six local seats | one payment |
| 20 races, new keys, rooms, and sessions | one payment |
| God Mode, practice, AFK, late join, CPU takeover | zero |
| Closed session, expired lease, replacement session | no duplicate |
| UTC day stays on the terminal day; the next day can pay again | passed |
| 12×20 = 240 sweep | session cap stops it at 200 |

After that run the database held 18 `game.coop_receipt` rows and 18 `srv_coop_boss_clear` ledger rows. Both sums are 360. Every delta is 20. The six-seat row is one receipt: `tickets = 20`, `slots = 6`, boss `01-marina-bront`, assistance `all_human`. Restarting the Nakama process left both totals at 18 and 360.

The suite's own restart step did not run. It calls `docker compose restart nakama`, and that container could not bind `127.0.0.1:7349` because the process under test was already the host-network server. The manual restart above is the one that matches the server that wrote the rows. The wallet-fault half of that same test case did not run.

Hub CI for `05859c8e` was still in progress while this was written: https://github.com/crrreatorrr/metaverse-hub/actions/runs/42491384839

## Loading, soak, latency, egress

Evidence VM: hostname `cursor`, Linux `6.12.113+`, Intel Xeon, 4 cores, 16,780,623,872 bytes reported by the OS. No discrete GPU. Chromium used SwiftShader. Browsers: Headless Chrome `158.0.8127.18` and Firefox `159.0`.

| Measurement | Result |
|---|---|
| Cold title, cache empty | 209 ms, 24 resource entries, 1,442,285 bytes |
| Warm title, same browser context | 127 ms, 24 entries, 1,441,453 bytes |
| JS heap over 20 minutes (`?demo=1`, 40 samples) | first 2,217,956, peak 5,962,636, last 4,887,960, DOM nodes stayed 303 |
| Six Nakama accounts, one client, 2.5 s | RTT 56 ms, upload 2,079 B/s, download 175,066 B/s, six balances stayed 0 |
| Stand-in six accounts, same shape | RTT 39 ms, upload 4,721 B/s, download 43,525 B/s, ledger writes 0 |

The 24 resource entries include the Google font stylesheet. The local byte gate is unchanged and still passes (`budgets ok`: title 1,437,302, first stage 2,059,540, critical requests 27, static 10,234,705). Budgets were not relaxed.

The heap figure is V8 `JSHeapUsedSize`. It moved up and down during the 20 minutes (one late sample was 3,030,308 while the stage was still in play). It is not a decoded-image total. Decoded atlas and boss caps stay the ones in `docs/coop-performance.md`.

A full match at the measured 175 KB/s download, held for an hour by six clients, is about 3.8 GB of snapshot traffic per match-hour. That is one localhost sample while one player held right, not a capacity promise.

## Capacity limit

`scripts/load/coop-bots.ts` on this same VM, while the browser soak was on a core:

- Golden seed-3 reached tick 7734, `gameover`, hash `3ec54344…`, rewards 0, in 141,835 ms. Ten account balances stayed 0.
- Ten concurrent matches, one seat each, ran about 8 s. Nine p95 samples were 17–24 ms. One was 28 ms. The worst max was 105 ms. The script's "under 25 ms p95" check failed.
- Those bench rooms are one device, not six humans.

Do not treat ten six-seat matches as proven headroom on a 4-core VM. H5 should repeat the bench on the staging host with the soak off before anyone quotes a concurrency number.

## Rollback for H5

1. Stop new bankable runs first. Leave login, the cabinet, and practice up.
2. Drain or end matches already running. `hostTakeover` stays 0. A client snapshot is not a resume (`coop.resume` with client `hp`/`lives` returned `rejected`).
3. Keep `game.coop_receipt`, `game.coop_eligibility`, and `game.tickets_ledger`. A Nakama process restart did not drop them. There is no down migration.
4. Ship this bundle hash, protocol 1, and SDK 0.7.2 together. A different fingerprint is `version_mismatch` and pays nothing.
5. Leave the 200 session cap and the 1,000 daily cap where they are. A 12-boss sweep is 240 on paper and 200 in one session.
6. Practice, God Mode, stage select, AFK, late join, and CPU-only play stay at 0 Tickets.

## Flags and open issues

- Banked HUD copy says `TICKETS PAID BY SERVER, SEE BALANCE`. The match opcode `rewards` stays 0 and is not shown as an award. `+20 TICKETS` and `ALREADY CLAIMED TODAY` appear only for a receipt object, which this client does not receive. Practice says no Tickets. A stage 1 clear in practice reports only the Marina Anchor Relic (`docs/coop-hub.md`).
- The hub compose Nakama service did not become healthy on this VM. Published ports came up, then `nakama migrate` did not finish, matching the bridge failure noted in C4. Evidence used the image built from hub `server/Dockerfile` (`heroiclabs/nakama:3.41.0` plus that commit's runtime) with host networking against the compose Postgres on `127.0.0.1:5432`.
- Ten-match p95 on this VM missed 25 ms by one match, under soak load, at one seat. See Capacity limit.
- No phone, console, or named GPU was available. The browsers above are the hardware evidence.

## Tests

`npm test` runs the existing node suites, including goja goldens (40 cases, stage 1 UFO/revive/power/down). `npm run test:e2e` runs:

- `tests/e2e/hub-roundtrip.spec.js` — return URL, Chromium and Firefox title/practice/confirm, cold/warm title. `C5_BAR=1` drives the live cabinet.
- `tests/e2e/coop-authority.spec.js` — four humans, one account, mixed seats, twelve stage hashes, UFO/revive/power/down, AFK, late join, God Mode and practice isolation, stage screenshots. `C5_SOAK_MS=1200000` is the 20-minute heap soak.
- `tests/e2e/rewards.spec.js` — one participation row for four seats; the client cannot mint. `C5_LIVE=1` checks Nakama.
- `tests/e2e/reconnect.spec.js` — stale fingerprint, oversized input, expired session, checkpoint restore, six-player bytes. `C5_LIVE=1` repeats the six-player sample on Nakama.

CI runs `npm test`, the build and budget gates, then `npm run test:e2e` on Chromium and Firefox. The soak, the live Nakama sample, and the Bar cabinet are evidence runs, not part of the 30-minute PR job. Raw numbers are in `tests/artifacts/c5-*-summary.json` and `tests/artifacts/c5-soak.json`.
