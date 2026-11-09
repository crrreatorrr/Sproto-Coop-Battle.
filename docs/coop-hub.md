# Sproto Coop Battle hub session (C1)

Game id `sproto-coop-battle` (no trailing dot). The GitHub repo name still ends with a dot. Coop Battle is a Bar cabinet game, the same kind of entry as Sproto Fighter and Sproto Arcade. There is no plaza portal. Return goes to the hub Bar at `#from=sproto-coop-battle`.

This phase is session init, Ticket balance, and return only. It does not award Tickets, submit scores, or report earn events.

## SDK pin

| Item | Value |
|---|---|
| Package | `@metaverse/hub-sdk` 0.6.3 |
| Hub commit | `5cc4e4809180f5bc0b016301d9222c26a80e6d4c` (PR #90, branch `main`) |
| Classic script | `vendor/hub-sdk/dist/hub-sdk.iife.js` |
| Global | `HubSDK` |
| IIFE sha256 | `4ceb36321fc09820c4ef6292b8bd31ebaa198f0a9b90d38bcbd458505222df76` |
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

Title, lobby, stage select, and a finished run (`gameover` / `victory`) return immediately. A live run asks once. Attack or a second `B` confirms. Jump or Esc cancels. The destination is the trusted hub URL plus `#from=sproto-coop-battle`:

- `play.<domain>` returns to `https://<domain>/hub/#from=sproto-coop-battle` (cross-origin, same site).
- Any other host returns to same-origin `/hub/#from=sproto-coop-battle`.
- A loopback page may use another loopback hub, such as `http://127.0.0.1:5173/hub/`.
- `?return=`, `javascript:`, and any other host are ignored.

Exit closes the practice socket, the audio context, and the page listeners, then calls `sdk.exit('return')`.

## Practice

Local play and the old relay are practice. The lobby says so. Room messages stay `economy: "none"`. This client does not call `earnTickets`, `reportEvent`, or `submitScore`. Banked writes from this page are 0.

## Hub status (updated 2026-11-08)

This page described phase C1. Since then:

- The hub's Bar cabinet lists Coop Battle next to Sproto Fighter and Sproto Arcade (metaverse-hub `apps/hub/src/realms/plaza/config.ts`), so the hub menu launches it.
- Banked play in the hub's `sproto_coop` match landed in C4 (`docs/coop-online.md`). Verified boss clears there pay 20 Tickets on the server (hub H3-C, migration `0041_coop_boss_receipt`; see `docs/coop-release.md`).

Practice play on this page still pays nothing.
