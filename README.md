# Sproto Coop Battle

A 6-player co-op pixel beat-'em-up. Six armed Sprotos fight their way through Shadow Sproto gangs and twelve two-phase machine bosses. There are always six Sprotos on the field. Humans can play locally, online, or both at once, and a CPU Sproto fills any empty slot. A human can take over a CPU Sproto at any time by pressing ATTACK.

## Run it

```bash
npm install
npm start            # http://localhost:8080
```

`npm start` serves the game and runs the WebSocket relay for online play. Local play also works from any static host that serves `public/`. Online play needs the Node server.

- **Local Play:** up to six people on one machine (two keyboard layouts plus up to four gamepads).
- **Host Online:** creates a 4-letter room code. The host's own local players join as usual.
- **Join Online:** enter the code. Each guest can bring several local players. Guests can also open `/?room=CODE`.
- **Mixed:** any mix of local, online and CPU players, always six in total.
- `/?demo=1` starts an all-CPU attract game.

## Controls

| | Move | Attack | Jump | Special |
|---|---|---|---|---|
| Keys 1 | WASD | F | G | H |
| Keys 2 | Arrows | `,` / K / Num1 | `.` / L / Num2 | `/` / ; / Num3 |
| Gamepad | Stick / D-pad | X (or RB) | A | B / Y |

Start / Enter begins the game from the lobby. In the lobby, LEFT/RIGHT changes your Sproto, UP/DOWN changes your weapon and JUMP leaves the slot. P pauses local games and M mutes sound.

**God mode:** press **9 twice** quickly during a battle, the same input as Sproto Arcade. Human Sprotos get unlimited health and attack twice as fast (UFO lasers and bombs too). CPU teammates are unaffected. Press 9 twice again to turn it off. Online guests can toggle it too, and it applies to the whole team.

## How it plays

- **Every Sproto is armed:** Katana, Bo Staff, War Hammer, Spear, Battle Axe or Chain Flail. Each has its own reach, speed and damage.
- **3-hit combo:** the last hit knocks the enemy down. Jump + Attack is a diving strike.
- **Special** (or Attack + Jump together): a spinning weapon sweep that hits all around you and costs a little health.
- **Revive:** a Sproto at 0 HP is down, not out. A teammate standing over them revives them before the timer runs out. Otherwise they lose a life and drop back in. Out of lives? Press ATTACK to continue.
- **The UFO (from Sproto Arcade):** a UFO beacon drops mid-stage and when a boss changes phase. Whoever grabs it pilots the saucer for 12 seconds. Attack fires the green laser, Jump/Special drops the beach-ball bomb, and the saucer's shield absorbs 4 hits.
- **Crates** hold health snacks and gems.
- **Bosses:** every stage ends with a Sproto Arcade machine. Each has three weapon attacks and a homing heavy missile. At half HP it transforms into its phase-2 machine, which fires more and adds a charge rush. Jump over low shots.

The twelve stages are Tidebreak Marina, Last Light Bar, Mudline Trenches, Sproto Ranch, Neon Tomorrow, Circuit Gate, Moonkeep Castle, Crown Relay Chamber, The Hatchery, Verse Gate, Rooftop Breakaway and Codebreak Ascent.

## Art sources

Only these sprites are reused:

- **Bosses:** the 24 boss phase sheets and 24 projectile sheets from [Sproto-Arcade](https://github.com/crrreatorrr/Sproto-Arcade) (`art/generated/bosses/*/p{1,2}.png`, `p{1,2}-projectiles.png`). They are downscaled to 1024² and palette-quantized in `public/assets/bosses/`. Row 0 is idle and rows 1–3 are the three firing weapons, which map to the boss's three attacks.
- **UFO:** the saucer (cockpit layers, laser, muzzle, beach ball and shield) from Sproto-Arcade `art/attacks/player/higgsfield/saucer*`.
- **Playable Sprotos:** three characters drawn at random from the [Sproto-Fighter](https://github.com/crrreatorrr/Sproto-Fighter) fighters that have complete pose sets (`public/fighters/poses/`). They are **Yannix** (`mox`), **VAMP** (`vamp`) and **Red Kev** (`guest09`), downscaled to 128². When two players pick the same Sproto, the duplicate gets a hue-shifted palette. Shadow Sprotos (the regular enemies) are darkened versions of the same three.

The weapons, backgrounds, items and effects are drawn in code (`public/js/render.js`). `tools/build-manifest.py` measures sprite bounds and hand positions and writes `public/js/manifest.js`.

## Code map

| File | Role |
|---|---|
| `public/js/sim.js` | Authoritative simulation: players, Shadow Sprotos, bosses, UFO, waves, snapshots |
| `public/js/ai.js` | CPU teammates |
| `public/js/render.js` | Canvas renderer; draws snapshots only, so host and guests look identical |
| `public/js/main.js` | Title, lobby, drop-in, game loop, netcode glue |
| `public/js/input.js`, `audio.js`, `net.js` | Devices, synthesized SFX, WebSocket client |
| `server/server.js` | Static server and room relay |

Netcode is host-authoritative. Guests send packed input bits every frame. The host simulates at 60 Hz and broadcasts ~1.2 KB snapshots at 30 Hz, which guests interpolate between.

## Tests

```bash
npm test                              # headless: six CPU Sprotos clear all 12 stages
npm start & node tests/browser-online.cjs   # host + guest in Chromium via Playwright
```
