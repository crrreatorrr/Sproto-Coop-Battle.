# Sproto Coop Battle authoritative client (C4)

The practice relay and local play are unchanged. A hub account can also join the Nakama match `sproto_coop`. That run is a banked candidate with rewards still at 0. It is not a local host, and a disconnect does not become one.

Game id: `sproto-coop-battle`. Entry remains the Bar cabinet. This phase does not add a plaza portal. Return is still `#from=sproto-coop-battle`.

## Pins

| Item | Value |
|---|---|
| Protocol | 1 |
| Content fingerprint | `f8705ec4b68e5643e7ce7e3f0014308e9546ddf43d55a506f4805e4091b07f1e` |
| Bundle sha256 | `28f9236d0df78c62cf600ad08c9924f8dd260b6948d7a73baf60230936934fac` |
| Hub match | `sproto_coop` (H2-C merge `469a69a52b029b6b7b431187ea779b988af56a89`) |
| Loop | 20 Hz, 3 substeps, snapshot every 2nd loop (10 Hz) |
| SDK | `@metaverse/hub-sdk` 0.6.2, IIFE `e23bbe9f6805cfd989a65d4279e56163e2d6f4497a0514c9c28ccc0f2adca2eb` |

`public/js/net-protocol.js`, `sim.js`, `ai.js`, and `manifest.js` were not edited, so the C3 pin still matches the vendored hub bundle. `coop.version` on that hub commit returns `enabled: true` (`CoopMatch.ENABLED`). This environment did not call a deployed Nakama. The source on hub main is the check.

## Wire

RPCs, game-scoped: `coop.version`, `coop.room_create`, `coop.room_join`, `coop.queue_cancel`, `coop.resume`, `coop.metrics`. No earn, score, or `session.event` call exists in this client.

Quick queue matchmaker properties: `game=sproto-coop-battle`, `v=1`, `sim=<fingerprint>`, count 1–6. Room codes are 12 characters from the server alphabet. A code locates a match for 600 seconds. It does not sign anyone in.

Opcodes match H2-C: 1 HELLO, 2 WELCOME, 3 READY, 4 START, 10 INPUT, 11 SNAPSHOT, 12 SEATS, 13 REJECT, 14 RESUME, 15 END, 16 RELEASE, 17/18 PING/PONG, 19 COMMAND. HELLO carries `{protocol, fingerprint, devices}` where devices are `k1`, `k2`, `gp0`–`gp3`. Fighter and weapon ids are sent only after the server says the match is still in the lobby. INPUT is one frame and only the seats this account owns. COMMAND `god`, `stage`, `state`, `seed`, `earn`, `score`, and `pause` are rejected by the server and never applied locally.

START is stage 0 with the server seed and a render snapshot. SNAPSHOT and the RESUME `full` export are not restart state. `restart` stays 0 and `acceptClientState` stays 0. The client does not call `Sim.importState`.

## Seats and reconnect

Six seats. One account may hold several devices. The server assigns the seat, the character, and the weapon. Releasing a device gives it to server AI and does not refill lives, hp, powers, or items. A dropped socket keeps the seat for 15 seconds under server AI. A new socket bumps the generation and the previous socket's input is rejected. Server restart is `coop.resume` only. `hostTakeover` is always 0.

The pause menu (Esc or P on the keyboard, Start on a pad) and a background tab hold this client's inputs: the keyboard's when the keyboard opened it, that pad's when a pad did. The match keeps simulating. Held input is neutral, so a long hold can look idle to H3-C. Esc in the lobby leaves the match. Jump in a running match is only a jump; it no longer releases the seat. Start, while reconnecting or after the match ends, begins a new local practice run. That run is not the banked one.

## What H3-C needs

- Rewards are still 0. This client has no payout, score, or ledger call. Do not treat a snapshot, a RESUME export, or a local practice clear as a receipt.
- Eligibility facts stay on the server: present at encounter start, reconnect grace, AFK from neutral input, one row per account. Six local devices are one account. A join after START is not present at the start.
- God Mode, stage select, pause, and client state are rejected. Practice still has them.
- Terminal day, boss id, and the 200-session cap are server concerns. The client must keep showing 0 until a server receipt exists.
- The authoritative client was exercised against a stand-in that runs the C3 sim and the H2-C opcodes over the real SDK WebSocket. It was not a deployed Nakama process.

## Evidence

`node tests/seat-ownership.test.js` and `node tests/reconnect.test.js` cover forged seats, a seventh seat, God Mode, ignored restart state, the 15 second AI hold, generation bump, late join, and input at 0/100/200 ms RTT with zero rejected frames on a constant delay.

`node tests/browser-hub-online.cjs` drives Chromium through the SDK client. Two browsers moved on stage 1. A dropped socket rejoined at generation 2 with the same lives, hp, and powers. One account held `k1`, `k2`, and `gp0` beside a remote account. Six accounts filled six seats. A second tab with the same account replaced the first. Measured ping after the samples were cleared: about 104 ms at a 100 ms delay (jitter 2) and about 205 ms at a 200 ms delay (jitter 2). Ledger writes were 0. Screenshots are `tests/artifacts/c4-*.png`.

`npm test` runs the seat and reconnect files. `npm run test:browser` runs `tests/browser-hub-online.cjs` after Chromium is installed, against the stand-in. CI already calls both scripts.

## Real Nakama

Hub main `469a69a52b029b6b7b431187ea779b988af56a89`, image `heroiclabs/nakama:3.41.0` with that commit's runtime module. The compose bridge could not complete a TCP handshake to Postgres (SYN_SENT, nftables delete failed in this VM), so Nakama was started from the same image on the host network against the compose Postgres on `127.0.0.1:5432`. No hub file was edited.

`coop.version` returned `enabled: true`, protocol 1, fingerprint `f8705ec4…`, `rewards: 0`. Two device accounts redeemed `portal.enter` tickets for `sproto-coop-battle` and joined room `LFZVTEMS6S4V`. A reset of the socket, then a new join of the same match, came back at generation 2 with the same lives, hp, and powers. `tickets.balance` stayed 0 for both accounts. `game.tickets_ledger` had 0 nonzero rows in that window.
