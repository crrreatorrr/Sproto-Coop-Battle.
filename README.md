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

| | Move | Attack | Jump | Special | Power |
|---|---|---|---|---|---|
| Keys 1 | WASD | F | G | H | R |
| Keys 2 | Arrows | `,` / K / Num1 | `.` / L / Num2 | `/` / ; / Num3 | `'` / Num4 |
| Gamepad | Stick / D-pad | X (or RB) | A | B / LB | Y / LT / RT |

Down + Special also fires a saved power-up.

Start / Enter in the lobby opens the **stage select**: pick any of the 12 Sproto Arcade stages with the arrows or stick, then Attack or Start to fight. The run continues from that stage. Jump or Esc goes back to the lobby. In the lobby, LEFT/RIGHT changes your Sproto, UP/DOWN changes your weapon and JUMP leaves the slot. P pauses local games and M mutes sound.

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
- **Bosses:** every stage ends with a Sproto Arcade machine. Bosses are tough: 3,400 HP on stage 1, rising 400 per stage. Weapons A and C fire 3-shot bursts, weapon B fires a 5-lane spread, and every third attack launches a homing missile. Every fifth attack is a charge rush. At half HP the boss transforms into its phase-2 machine: it attacks 40% faster, fires 5-shot bursts and 7-lane spreads, launches missiles in pairs and charges more often. Below 25% HP it enrages and speeds up again. Jump over low shots.

The twelve stages are Tidebreak Marina, Last Light Bar, Mudline Trenches, Sproto Ranch, Neon Tomorrow, Circuit Gate, Moonkeep Castle, Crown Relay Chamber, The Hatchery, Verse Gate, Rooftop Breakaway and Codebreak Ascent.

## Art sources

Only these sprites are reused:

- **Bosses:** the 24 boss phase sheets and 24 projectile sheets from [Sproto-Arcade](https://github.com/crrreatorrr/Sproto-Arcade) (`art/generated/bosses/*/p{1,2}.png`, `p{1,2}-projectiles.png`). They are downscaled to 1024² and palette-quantized in `public/assets/bosses/`. Row 0 is idle and rows 1–3 are the three firing weapons, which map to the boss's three attacks.
- **UFO:** the saucer (cockpit layers, laser, muzzle, beach ball and shield) from Sproto-Arcade `art/attacks/player/higgsfield/saucer*`.
- **Playable Sprotos:** six characters from the [Sproto-Fighter](https://github.com/crrreatorrr/Sproto-Fighter) fighters that have complete pose sets (`public/fighters/poses/`): **Sproto Sheriff** (`sproto3106`), **VAMP** (`vamp`), **Red Kev** (`guest09`), **Sprotel Bitcoin** (`guest10`), **Golden Sproto** (`rivet`) and **Dumpstar** (`dumpstar`), downscaled to 128². Each lobby slot starts on a different Sproto; if two players pick the same one, the duplicate gets a hue-shifted palette. Shadow Sprotos (the regular enemies) are darkened versions of the same six.

- **Stages:** the scenery is Sproto Arcade's stage art (`art/level-01…10.jpg`, `art/rooftop-chase/01.webp`, `art/codebreak/shaft.webp`), scrolling at half speed. The Arcade floors are thin side-on strips, so `tools/build-backgrounds.py` draws each fighting floor as pixel art in a style that fits the stage (pier planks, dance floor, mossy slabs, ranch dirt, wet neon street, steel plates, flagstones, tiles, hatchery stone, asteroid rock, rooftop), coloured from that stage's own Arcade floor. Codebreak's floor is its shaft's circuit traces laid flat.

The weapons, items and effects are drawn in code (`public/js/render.js`). `tools/build-manifest.py` measures sprite bounds and hand positions and writes `public/js/manifest.js`.

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
