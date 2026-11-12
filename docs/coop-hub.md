# Sproto Coop Battle hub session (C1)

Game id `sproto-coop-battle` (no trailing dot). The GitHub repo name still ends with a dot. Coop Battle is a Bar cabinet game, the same kind of entry as Sproto Fighter and Sproto Arcade. There is no plaza portal. Return goes to the hub Bar at `#from=sproto-coop-battle`.

This phase is session init, Ticket balance, and return only. It does not award Tickets, submit scores, or report earn events. The one event report, added later, is the Marina Anchor Relic (see below).

## SDK pin

| Item | Value |
|---|---|
| Package | `@metaverse/hub-sdk` 0.7.2 |
| Hub commit | `2a6a4bc` (branch `claude/nifty-einstein-ptgr08`, not merged to hub `main` yet) |
| Classic script | `vendor/hub-sdk/dist/hub-sdk.iife.js` |
| Global | `HubSDK` |
| IIFE sha256 | `25b989eb2cda2227e4395c84965c7a4bea5f937c3df442c08aad8ab8c40e5a35` |
| Pin | `vendor/hub-sdk/SOURCE.pin.json` |

Vendored with the hub repo's `node scripts/vendor-sdk.mjs` at that commit. The page loads the file from the game origin (`vendor/hub-sdk/dist/hub-sdk.iife.js` in `dist/`). It is not loaded from a CDN. `npm run build` copies that file into `dist/` and refuses to build if the hash or pin drifts, or if the script contains an HTTP key.

Nakama's HTTP key is not in this repo. The client server key is left empty except on loopback, where the public dev value `defaultkey` is used. A deploy may set `window.SPROTO_COOP_HUB.serverKey` to the public server key before `hub-config.js`. Do not commit that value.

## Session

`CoopHub.boot` runs once at startup, before the title is required to be interactive.

- `#t=` is redeemed with `init('sproto-coop-battle')` and then removed with `history.replaceState`, including when redeem fails.
- A second `init` after a failed ticket does not send the ticket again. It only resumes a saved session or stays standalone.
- `getSession()` decides the chip. A standalone profile (device id, no session) is **Offline**, not an account.
- A session token with a username (`usn`) is **Account**. A session without one is **Guest**.
- A saved session whose profile did not load (`serverTime === 0`) is **Hub error**, not connected.
- Account swap, expiry, logout, and another tab taking the hub tab key clear the balance and the displayed identity. An in-flight balance for the previous player is dropped.
- At most one `getTicketBalance` read is in flight. The number on screen is that result. There is no local cash balance.

Offline, a failed init, and a rejected ticket still reach local play.

## Return

Title, lobby, stage select, and a finished run (`gameover` / `victory`) return immediately. A live run asks once. Attack, Enter or a second `B` confirms. Jump or Esc cancels. On a pad, A or Start confirms and B cancels. Pads reach the return from RETURN TO BAR on the title and in the pause menu (Start). The destination is the trusted hub URL plus `#from=sproto-coop-battle`:

- `play.<domain>` returns to `https://<domain>/hub/#from=sproto-coop-battle` (cross-origin, same site).
- Any other host returns to same-origin `/hub/#from=sproto-coop-battle`.
- A loopback page may use another loopback hub, such as `http://127.0.0.1:5173/hub/`.
- `?return=`, `javascript:`, and any other host are ignored.

Exit closes the practice socket, the audio context, and the page listeners, then calls `sdk.exit('return')`.

## Practice

Local play and the old relay are practice. The lobby says `PRACTICE — NO TICKETS`. Room messages stay `economy: "none"`. This client does not call `earnTickets` or `submitScore`, and its only `reportEvent` is the Marina Anchor report below. Banked writes from this page are 0.

## Marina Anchor Relic (SDK 0.6.4)

Clearing stage 1 (Tidebreak Marina, boss `01-marina-bront`, `stageIdx` 0) grants the `marina_anchor` Relic. God Mode counts, and so does a run started on stage 1 from stage select. It pays no Tickets and does not count toward the Four Lights.

- Banked runs (the hub's `sproto_coop` match) are granted on the server. `net-hub.js` reports nothing.
- Local, hosted and relay-guest runs report from the page. When the sim's `'clear'` event fires with `stageIdx` 0, `main.js` calls `CoopHub.session.reportStageClear(stageIdx, godMode, runId)`, which sends `reportEvent('coop.stage_clear', { stage: 1, godMode }, 'coop.stage_clear:1:<runId>')` once per run. The host and local roles watch `sim.events` in `hostStep`. A relay guest watches the snapshot's `ev` list with `si` 0 and `god` from the same snapshot, so each hub account on its own device earns its own Relic.
- Nothing is sent unless the hub opened the page (a redeemed `#t=` ticket or the saved hub session) and this device has a human in the run, so standalone play and the all-CPU demo report nothing. The run id is new for each `startGame` (local, host) and each run a guest enters, so the key is unique per run and its body never changes.
- A failed report is logged and resolves `null`. It never throws into the game loop. A first grant shows the toast `Relic: Marina Anchor`.

## Feedback window (SDK 0.7.0, screenshot fixed in 0.7.2)

Pressing **N twice** opens the hub's feedback window (`HubSDK.installFeedback`; behaviour in metaverse-hub `docs/feedback.md`). `public/js/feedback-link.js` is the game's adapter. `main.js` hands it the promise from `CoopHub.boot`, and it installs the window once, with `feedbackTransportFromSdk(CoopHub.session.sdk())`, only when the SDK loaded. Standalone play (no ticket, no saved hub session) never loads the SDK, so nothing is installed and N does nothing. Only signed-in hub accounts can send.

- **Pause.** Local play freezes: the adapter sets `app.frozen`, and while it is set `main.js` runs no sim step and reads no menu or pad input. `app.paused`, the pause menu and the screen are not touched, so closing the window restores exactly what was there (still paused, still in the menu, or playing). Host, guest and server (banked) play return `false`: the match keeps running, the window says so, and no server hold is taken.
- **Keys.** The SDK swallows key events in a window capture listener while the window is open, and the N key always. The game has no capture listeners of its own. Held keys are dropped (`Input.keys.clear()`) when the window opens and closes. Typing N in the join dialog's fields works as usual.
- **Context.** Stage (`01 Tidebreak Marina`), mode and role, the local player's position, character, weapon, health, lives, score and combo, the stage clock (`snap.t / 60`), and extras: screen, section (`play` / `clear` / ...), camera progress, waves done (local and host only, where this page runs the sim), boss name, phase and health, player and human counts, God Mode, and the content fingerprint. It reads the snapshot `drawGame` last drew (`app.view`), so every role reports the same way.
- **Version.** `0.1.0+<first 8 of the content fingerprint>`.
- **Screenshot.** The whole page as the player sees it, taken before the window appears. The adapter names the `#game` canvas, which the SDK copies directly; the title, lobby, HUD and pause menu are drawn on that canvas. Since SDK 0.7.2 the SDK also draws the page's HTML over it, which here is the JOIN ONLINE dialog and the crash panel. Before 0.7.2 only the canvas was copied, so a report sent with the join dialog open showed only the game behind it. The Google Fonts `<link>` in `index.html` carries `crossorigin="anonymous"` so Press Start 2P is drawn in the screenshot instead of a system font. `overlay` is left at its default (on). SDK 0.7.1's additive `tickets` field on `reportEvent` is not used here (the Marina Anchor pays no Tickets).
- **Errors.** The crash guard's distinct errors (`CrashGuard.onCrash`), newest last, up to ten.
- **Breadcrumbs.** `role_change`, `stage_start`, `wave_start`, `boss_start`, `boss_phase`, `player_down`, `stage_clear` and `run_end`, noted by `main.js` from the snapshot being drawn.
- **Pause menu.** Signed-in accounts get a SEND FEEDBACK item. It closes the menu for the screenshot and reopens it when the window closes.

The window uses the join dialog's look: Press Start 2P, `#14112a` panel, `#ffd23d` frame and accent, square corners.

## Hub status (updated 2026-11-08)

This page described phase C1. Since then:

- The hub's Bar cabinet lists Coop Battle next to Sproto Fighter and Sproto Arcade (metaverse-hub `apps/hub/src/realms/plaza/config.ts`), so the hub menu launches it.
- Banked play in the hub's `sproto_coop` match landed in C4 (`docs/coop-online.md`). Verified boss clears there pay 20 Tickets on the server (hub H3-C, migration `0041_coop_boss_receipt`; see `docs/coop-release.md`).

Practice play on this page still pays nothing.
