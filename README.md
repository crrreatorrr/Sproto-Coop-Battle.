# Sproto Coop Battle

A 6-player co-op pixel beat-'em-up. Six armed Sprotos fight their way through Shadow Sproto gangs and twelve two-phase machine bosses. There are always six Sprotos on the field. Humans can play locally, online, or both at once, and a CPU Sproto fills any empty slot. A human can take over a CPU Sproto at any time by pressing ATTACK.

## Run it

```bash
npm install
npm start            # http://localhost:8080
```

`npm start` serves `public/` and runs the WebSocket relay for practice online play. Local play also works from any static host that serves `public/`. Relay play needs the Node server.

`npm start` does not serve `vendor/`, so the hub SDK (`vendor/hub-sdk/dist/hub-sdk.iife.js`) returns 404 there and the hub link stays offline. `npm run build` writes `dist/`: `public/`, that SDK file and `asset-manifest.json`. Serve `dist/` to try the hub link (for example `python3 -m http.server -d dist 8081`).

- **Local Play:** up to six people on one machine (two keyboard layouts plus up to four gamepads).
- **Host Online:** creates a 4-letter room code. The host's own local players join as usual.
- **Join Online:** enter the code. Each guest can bring several local players. Guests can also open `/?room=CODE`.
- **Mixed:** any mix of local, online and CPU players, always six in total.
- `/?demo=1` starts an all-CPU attract game.

## Controls

| | Move | Attack | Jump | Special / block | Power | Pause menu |
|---|---|---|---|---|---|---|
| Keys 1 (left side) | WASD | F | G or Space | H | R | Esc or P |
| Keys 2 (right side) | Arrows | `,` / K / Num1 | `.` / L / Num2 | `/` / ; / Num3 | `'` / Num4 | Esc or P |
| Gamepad | Left stick / D-pad | X (or RB) | A | B (or LB) | Y (or LT / RT) | Start |

Two people can share one keyboard, so WASD and the arrows are two separate players: the arrows never move the WASD player. Down + Special also fires a saved power-up. Dash is a double tap of left or right on any device. M mutes sound. B (the key) returns to the Bar from any screen; a live run asks first.

Any standard controller works with no setup (Xbox names; PlayStation and Switch pads work by button position). The pad shows up on its first press. Buttons held when a pad connects, such as the A that picked this game in the hub, are ignored until released. The prompts on screen follow the last device used.

| Screen | Keyboard | Gamepad |
|---|---|---|
| Menus (all) | W/S or arrows move, Enter / Space / Attack confirm, Esc or Jump back | D-pad or left stick move (held repeats), A confirms, B backs out |
| Title | RETURN TO BAR is the last item | same |
| Lobby | Attack takes a slot, left/right Sproto, up/down weapon, Jump leaves the slot, Enter picks a stage, Esc to the title | A (or X) takes a slot, left/right Sproto, up/down weapon, B leaves the slot, B again to the title, Start picks a stage |
| Stage select | Enter / Space / Attack fight, Esc or Jump back | A or Start fight, B back |
| Battle | Attack on a free keyboard side drops in | A or X on a free pad drops in |
| Pause menu (Resume, Sound, Return to Bar) | Esc or P opens and closes, Enter / Space selects | Start opens, A selects, B or Start resumes |
| Game over / victory | Enter back to the lobby (host) | Start back to the lobby (host) |
| Join dialog | type the code, Enter joins, Esc cancels | up/down change the letter, left/right move, X deletes, A joins, B cancels |
| Return to the Bar? | Attack, Enter or B again confirms; Jump or Esc cancels | A or Start confirms, B cancels |

Online guests wait for the host to pick the stage. In a server match Start / Enter in the lobby means ready. Local play pauses under the pause menu. Online and server matches keep running; the menu only holds the inputs of the device that opened it (both keyboard sides for the keyboard).

**Local multiplayer:** the device that picks LOCAL PLAY or HOST ONLINE is P1. Every other keyboard side or pad presses Attack (A on a pad) to take the next free slot, so pad 1 is P1 and pad 2 is P2 when they join in that order. Any pad can drive the menus.

**Why this pad layout:** A is jump, the most frequent button, and X attack sits right next to it, so the right thumb rolls between attack, jump and B block the way most beat-'em-ups play. Holding block on B while attacking on X is awkward on one thumb, so LB also blocks and RB also attacks for players who like the shoulders. Power-ups are rare and deliberate, so they go on Y and both triggers. Start is the only menu button; View and Home are unused.

Start / Enter in the lobby opens the **stage select**: pick any of the 12 Sproto Arcade stages, then fight. The run continues from that stage.

**God mode:** press **9 twice** quickly during a battle, the same input as Sproto Arcade. Human Sprotos get unlimited health and attack twice as fast (UFO lasers and bombs too). CPU teammates are unaffected. Press 9 twice again to turn it off. Online guests can toggle it too, and it applies to the whole team.

## How it plays

- **Every Sproto is armed:** Katana, Bo Staff, War Hammer, Spear, Battle Axe or Chain Flail. Each has its own reach, speed and damage.
- **Combos:** Attack strings a 3-hit combo (4 on the Katana); the last hit knocks down. Hits freeze attacker and target for a moment (hitstop) and big hits shake the screen. Jump + Attack is a diving strike.
- **Dash:** double-tap left or right. The first frames dodge through attacks; Attack during a dash is a knockdown dash strike. The end of any attack can be cancelled into a dash.
- **Block and parry:** hold Special to block (75% less damage from the front). Start blocking just before a hit lands to **parry**: no damage, and the attacker is left dazed.
- **Grab and throw:** walk into a dazed enemy (after a parry or a long combo) to grab it. Attack knees it twice, then throws it; push a direction while pressing Attack to throw that way. A thrown Sproto knocks down everyone it flies into.
- **Launcher and juggles:** Up + Attack launches an enemy into the air; anyone can keep hitting it to juggle (each juggle hit does 15% less).
- **Ground slam:** Down + Attack in the air slams down with a shockwave that also hits enemies lying on the floor.
- **Weapons play differently:** Katana: 4-hit combo. Bo Staff: hit 2 strikes behind you too. War Hammer: the finisher sends a shockwave along the lane. Spear: the finisher pierces the whole lane. Battle Axe: hits make enemies bleed. Chain Flail: hits pull enemies toward you.
- **Special** (a quick tap, or Attack + Jump together): a spinning weapon sweep that hits all around you and costs a little health.
- **Down, dead, game over:** a Sproto at 0 HP is down for **10 seconds**. Human players can revive anyone by standing over them. CPU Sprotos never revive other CPUs, and they revive a human only **once per life**. Nobody comes back on their own: a Sproto nobody revives in time dies. Dead CPUs sit out the rest of the stage and return at the next one. A human who dies drops back in once (shown as ♥♥ → ♥ in the HUD). **The second death of any human player is game over, and so is every Sproto on screen being down or dead.**
- **Dodging:** before a boss fires, red stripes mark the lanes it will shoot along. Shots fly straight down those lanes and low to the ground: **stand in a stripe and you get hit; step out of it or jump over the shot and you don't.** Spreads always leave gaps. A weapon swing knocks thrown knives and homing missiles out of the air.
- **Difficulty:** four waves of 12+ Shadow Sprotos per stage (up to 12 on screen), tougher and more aggressive as stages go on, with harder bosses that call in reinforcements. CPU teammates are deliberately weaker than humans (55% damage dealt, 135% damage taken), so the team will lose Sprotos.
- **The UFO (from Sproto Arcade):** an empty saucer drops mid-stage and when a boss changes phase. **Only human players can take it**; CPU Sprotos ignore it. The player who grabs it pilots the saucer for 12 seconds. Attack fires the green laser, Jump/Special drops the beach-ball bomb, and the saucer's shield absorbs 4 hits.
- **Crates** hold health snacks, gems and power-ups.
- **Power-ups (save them for big crowds):** human players can hold up to 3 (shown in the HUD) and fire one with the Power button. They drop from crates, every cleared wave, the boss phase change and the occasional defeated enemy. CPU Sprotos never take them.
    - **Sproto Storm:** a shockwave around you that knocks down everything within about 260 px and wipes out enemy shots.
    - **Meteor Rain:** 12 meteors land on the enemies across the whole screen over 1.5 seconds.
    - **Chain Lightning:** lightning strikes the 10 nearest enemies on screen, and the boss.
- **Rescue:** the first time a human player goes down, the nearest CPU Sproto sprints over to revive them.
- **Bosses:** every stage ends with a Sproto Arcade machine. Bosses are tough: 2,600 HP on stage 1, rising 480 per stage to 7,880 on stage 12. Weapons A and C fire 2-shot bursts, weapon B fires a 3-lane spread, and every third attack launches a homing missile. Every fifth attack is a charge rush. At half HP the boss transforms into its phase-2 machine: it attacks 40% faster, fires 3-shot bursts and 5-lane spreads, launches missiles in pairs and charges every fourth attack. Below 25% HP it enrages and speeds up again. Jump over low shots.

The twelve stages are Tidebreak Marina, Last Light Bar, Mudline Trenches, Sproto Ranch, Neon Tomorrow, Circuit Gate, Moonkeep Castle, Crown Relay Chamber, The Hatchery, Verse Gate, Rooftop Breakaway and Codebreak Ascent.

## Server loop budget

The hub runs the pinned sim in a 20 Hz loop (50 ms), and one loop's three 60 Hz substeps should take under 25 ms in goja at p95. That budget is enforced only by `npm run bench:goja` (ten parallel goja VMs; needs Go, with `GOTOOLCHAIN=auto` to fetch the 1.26 toolchain), not by `npm test` or CI: the number depends on the machine and its load, so `npm test` only logs it and warns when it is over. Run the bench on an otherwise idle machine before and after changing a pinned file.

## Art sources

Only these sprites are reused:

- **Bosses:** the 24 boss phase sheets and 24 projectile sheets from [Sproto-Arcade](https://github.com/crrreatorrr/Sproto-Arcade) (`art/generated/bosses/*/p{1,2}.png`, `p{1,2}-projectiles.png`). They are downscaled to 1024² and palette-quantized in `public/assets/bosses/`. Row 0 is idle and rows 1–3 are the three firing weapons, which map to the boss's three attacks.
- **UFO:** the saucer (cockpit layers, laser, muzzle, beach ball and shield) from Sproto-Arcade `art/attacks/player/higgsfield/saucer*`.
- **Playable Sprotos:** six characters from the [Sproto-Fighter](https://github.com/crrreatorrr/Sproto-Fighter) fighters that have complete pose sets (Sproto-Fighter `public/fighters/poses/`): **Sproto Sheriff** (`sproto3106`), **VAMP** (`vamp`), **Red Kev** (`guest09`), **Sprotel Bitcoin** (`guest10`), **Golden Sproto** (`rivet`) and **Dumpstar** (`dumpstar`), downscaled to 128². Here they live in `public/assets/fighters/<id>/`. The game loads one `atlas.png` per character (`tools/pack-fighter-atlases.py`); the 40 single-pose PNGs next to it are the atlas sources and are not requested. Each lobby slot starts on a different Sproto; if two players pick the same one, the duplicate gets a hue-shifted palette. Shadow Sprotos (the regular enemies) are darkened versions of the same six.

- **Stages:** the half-speed scenery comes from Sproto Arcade (`art/level-01…10.jpg`, `art/rooftop-chase/01.webp`, and `art/codebreak/shaft.webp`). The shipped fighting floors in `public/assets/stages/` were generated with Higgsfield using each backdrop and original floor as references, then sized and color-matched for the game. `tools/build-backgrounds.py` regenerates the original procedural floor art and overwrites these assets.

The weapons, items and effects are drawn in code (`public/js/render.js`). `tools/build-manifest.py` measures sprite bounds and hand positions and writes `public/js/manifest.js`.

## Code map

| File | Role |
|---|---|
| `public/js/sim.js` | Simulation: players, Shadow Sprotos, bosses, UFO, waves, snapshots, restart state. **Pinned** |
| `public/js/ai.js` | CPU teammates. **Pinned** |
| `public/js/net-protocol.js` | Banked-match rules (seats, input limits, terminal facts). Runs only inside the server bundle; `index.html` does not load it. **Pinned** |
| `public/js/manifest.js` | Sprite bounds and hand positions, generated by `tools/build-manifest.py`. **Pinned** |
| `public/js/render.js` | Canvas renderer; draws snapshots only, so every client looks identical |
| `public/js/main.js` | Title, lobby, drop-in, game loop, relay netcode glue |
| `public/js/asset-loader.js` | Staged image loading: fighter atlases, stages, bosses, UFO |
| `public/js/input.js`, `gamepad.js`, `audio.js`, `net.js` | Keyboard layouts and devices; pure gamepad mapping (deadzone, latch on connect, menu repeat); synthesized SFX; relay WebSocket client |
| `public/js/hub-config.js`, `hub-link.js` | Hub settings, and the hub session (ticket redeem, balance chip, Return to Hub) |
| `public/js/net-hub.js` | Client for the hub's authoritative `sproto_coop` match (banked play) |
| `server/server.js` | Practice static server and room relay |
| `scripts/build.mjs`, `build-server-sim.mjs` | `dist/` build; the server bundle `build/coop-sim.js` and its pin |
| `scripts/check-assets.mjs`, `check-budgets.mjs` | Asset inventory and transfer budgets |

The four **pinned** files are hashed into `build/coop-sim.pin.json`, which the hub vendors. See `AGENTS.md` before editing them.

There are two kinds of online play:

- **Practice relay** (`npm start`): host-authoritative. Guests send packed input bits every frame. The host simulates at 60 Hz and sends snapshots at 30 Hz, which guests interpolate between. A snapshot is usually 1.5–3.5 KB of JSON (about 2 KB typical), with busy moments near 4 KB. It never pays Tickets. When the hub opened the page, clearing stage 1 in local or relay play earns the hub's Marina Anchor Relic (God Mode counts); see `docs/coop-hub.md`.
- **Banked** (from the hub's Bar cabinet): the hub's Nakama match `sproto_coop` runs the pinned sim at 60 Hz in a 20 Hz loop and sends snapshots at 10 Hz. Verified boss clears pay Tickets on the server, and a stage 1 clear grants the Marina Anchor there. See `docs/coop-online.md`.

## Tests

```bash
npm test                 # sim, relay, protocol, goja goldens, assets, hub link (needs Go)
npm run test:browser     # relay host + guest, atlas visuals, browser goldens, banked client (Playwright)
npm run test:e2e         # hub round trip, authority, rewards, reconnect
```

The headless campaign check runs six CPU Sprotos on seed 42 until the run ends. CPU teammates are deliberately weak, so that team reaches game over on stage 1 (tick 6957 in `tests/fixtures/gameplay-hashes.json`); it does not clear the 12 stages. `AGENTS.md` lists the full check order.
