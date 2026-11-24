# Sproto Coop Battle

A 4-player co-op pixel beat-'em-up. Four armed Sprotos fight their way through Shadow Sproto gangs and thirteen two-phase mecha bosses, including Sprotel Bitcoin in Last Call Bar. Every run has a four-seat party. Humans can play locally, online, or both, and CPU teammates fill the remaining seats. Press Attack on an unused device to take control of a CPU seat.

## Run it

```bash
npm install
npm start            # http://localhost:8080
```

`npm start` serves `public/` and runs the WebSocket relay for practice online play. Local play also works from any static host that serves `public/`. Relay play needs the Node server.

`npm start` does not serve `vendor/`, so the hub SDK (`vendor/hub-sdk/dist/hub-sdk.iife.js`) returns 404 there and the hub link stays offline. `npm run build` writes `dist/`: `public/`, that SDK file and `asset-manifest.json`. Serve `dist/` to try the hub link (for example `python3 -m http.server -d dist 8081`).

- **Local Play:** up to four people on one machine (any four of two keyboard layouts and up to four gamepads).
- **Host Online:** creates a 4-letter room code. The host's own local players join as usual.
- **Join Online:** enter the code. Each guest can bring several local players. Guests can also open `/?room=CODE`.
- **Mixed:** any mix of local and online players, up to four in total.

## Controls

| | Move | Attack | Jump | Special / block | Power | Pause menu |
|---|---|---|---|---|---|---|
| Keys 1 (left side) | WASD | F | G or Space | H | R | Esc or P |
| Keys 2 (right side) | Arrows | `,` / K / Num1 | `.` / L / Num2 | `/` / ; / Num3 | `'` / Num4 | Esc or P |
| Gamepad | Left stick / D-pad | X (or RB) | A | B (or LB) | Y (or LT / RT) | Start |

Two people can share one keyboard, so WASD and the arrows are two separate players. In battle, Power uses your class ability. Down + Special or Down + Power uses a saved power-up. The Fighter can also press Power alone to use a saved item. Dash is a double tap of left or right on any device. M mutes sound. B (the key) returns to the Bar from any screen and asks for confirmation during a run.

**N twice: send feedback.** When the hub opened the game and you are signed in, pressing N twice (or SEND FEEDBACK in the pause menu) opens the hub's feedback window with a screenshot. Local play freezes and resumes exactly where it was; online and server matches keep running. Without the hub it does nothing. See `docs/coop-hub.md`.

**Full screen and menus.** The game fills the browser window at the largest size that keeps its 16:9 shape (dark bars fill the rest; nothing is stretched or cut off). Every menu (the title, the lobby and stage select through their menu, the pause menu, and the game-over screen through it) offers MAIN MENU (not on the title; a live run asks first), RETURN TO BAR (the hub), CONTROLLER SETTINGS and FULL SCREEN, which turns the browser's full screen on and off (it is hidden when the browser does not allow it). The mouse works too: click a menu item, or the small MENU box at the top right of the lobby and stage select (and in a run while the mouse moves). In full screen, Esc only leaves full screen; P or Tab still opens the menu.

**Controller settings** show every action for each device (both keyboard sides and pads 1 to 4) and let you rebind it: pick the action, then press the new key, or the new button on that pad. Esc cancels a key; View or Esc cancels a button. A key or button already in use moves: the action it leaves keeps its other keys, or takes over the old one (a swap). Esc, Tab, P, B, M, N, 9 and the F keys are reserved. Each pad also has its left-stick dead zone (5–50%, default 20%). Reset to defaults resets both keyboard sides together, or one pad. Settings apply at once and are saved in this browser (`localStorage` key `sproto-coop-battle.controls.v1`). They only change what the input layer reports, so online play and the pinned sim are unaffected. The game has no rumble, so there is no vibration switch. Menus always use A to confirm and B to back out on a pad.

Any standard controller works with no setup (Xbox names; PlayStation and Switch pads work by button position). The pad shows up on its first press. Buttons held when a pad connects, such as the A that picked this game in the hub, are ignored until released. The prompts on screen follow the last device used.

| Screen | Keyboard | Gamepad |
|---|---|---|
| Menus (all) | W/S or arrows move, Enter / Space / Attack confirm, Esc or Jump back | D-pad or left stick move (held repeats), A confirms, B backs out |
| Title | the hub items, then RETURN TO BAR, CONTROLLER SETTINGS and FULL SCREEN | same |
| Lobby | Attack takes a slot, left/right picks a Sproto, up/down picks a weapon, Power cycles class, Jump leaves the slot, Enter picks a stage, Esc backs out, Tab opens the menu | A or X takes a slot, left/right picks a Sproto, up/down picks a weapon, Y cycles class, B leaves the slot, Start picks a stage, View opens the menu |
| Stage select | Enter / Space / Attack fight, Esc or Jump back, Tab menu | A or Start fight, B back, View menu |
| Battle | Attack on a free keyboard side drops in | A or X on a free pad drops in |
| Pause menu (Resume, Sound, Send Feedback when signed in to the hub, Controller Settings, Full Screen, Main Menu, Return to Bar) | Esc, P or Tab opens and closes, Enter / Space selects | Start or View opens, A selects, B, Start or View resumes |
| Lobby and stage menu (Back, Sound, Controller Settings, Full Screen, Main Menu, Return to Bar) | Tab opens, Esc or Tab closes | View opens, B or View closes |
| Game over / victory | Enter back to the lobby (host), Esc the menu | Start back to the lobby (host), View the menu |
| Join dialog | type the code, Enter joins, Esc cancels | up/down change the letter, left/right move, X deletes, A joins, B cancels |
| Return to the Bar? | Attack, Enter or B again confirms; Jump or Esc cancels | A or Start confirms, B cancels |
| Leave the run for the main menu? | Attack or Enter confirms; Jump or Esc cancels | A or Start confirms, B cancels |
| Controller settings | up/down row, left/right device (or the dead zone), Enter / Attack rebinds, Esc back | same with the pad; A rebinds, B back |

The party editor shows all 16 Sprotos and separates character, class, and weapon. Press Special (LB on a pad), or click a seat, to open it. Special switches between seats you can edit. The room host can configure the CPU teammates. Online guests wait for the host to pick the stage. In a server match Start / Enter in the lobby means ready. Local play pauses under the pause menu. Online and server matches keep running; the menu only holds the inputs of the device that opened it (both keyboard sides for the keyboard).

**Local multiplayer:** the device that picks LOCAL PLAY or HOST ONLINE is P1. Every other keyboard side or pad presses Attack (A on a pad) to take the next free slot, so pad 1 is P1 and pad 2 is P2 when they join in that order. Any pad can drive the menus.

**Why this pad layout:** A jumps, X attacks, and B blocks. LB and RB also block and attack so you can use those actions together. Y and both triggers are Power. Start opens the battle menu, and View opens the lobby menu.

Start / Enter in the lobby opens the **stage select**: pick any of the 13 stages, then fight. The run continues from that stage.

**God mode:** press **9 twice** quickly during a battle, the same input as Sproto Arcade. Human Sprotos get unlimited health and attack twice as fast (UFO lasers and bombs too). Press 9 twice again to turn it off. Online guests can toggle it too, and it applies to the whole team.

## How it plays

| Class | Starting weapon and health | Ground attack | Power ability |
|---|---|---|---|
| Fighter | Katana · 100 HP | Melee combos | Uses a saved power-up |
| Mage | Apprentice Wand · 65 HP | Strong arcane bolt. Takes 30% more damage from attacks. | **Arcane Orb** pierces up to three targets. 4.5 second cooldown. |
| Healer | Mending Rod · 80 HP | Light bolt | **Mend** restores 24 HP with the starting rod. It heals the most injured living teammate in range, or the Healer if no nearby teammate needs it. 5 second cooldown. |
| Ranged | Shortbow · 90 HP | Quick arrows with medium damage | **Power Shot** pierces up to two targets. 3.5 second cooldown. |

- **Weapons:** Start with one weapon per class. Campaign clears open the next tier for every class, so you can switch roles and equip the weapons you've earned. Each class has 13 weapons, including the final weapon earned by clearing stage 12. Free Play opens stages for practice. Stage clears earn weapons.
- **CPU teammates:** They use their chosen class, including healing and ranged attacks. Players take over the existing Sproto when they join, keeping its health and inventory. Difficulty scales with the human party size.
- **Combos:** The Fighter's ground Attack strings a 3-hit combo (4 on the Katana), and the last hit knocks down. An Attack press up to 0.1 seconds early is remembered. Every class can use melee launchers, dash strikes, spin attacks, throws and the Jump + Attack diving strike.
- **Dash:** double-tap left or right. The first frames dodge through attacks; Attack during a dash is a knockdown dash strike. The end of any attack can be cancelled into a dash.
- **Block and parry:** Special blocks **the moment it is pressed** (75% less damage from the front) for as long as it is held. A hit that lands in the first 8 ticks after the press is a **parry**: no damage, and the attacker is left dazed. A block raised within 0.4 s of the last one still blocks but cannot parry, so parries are timed, not mashed. A quick tap of Special (let go within 0.1 s without blocking anything) is the spin attack, which costs 6 HP.
- **Grab and throw:** walk into a dazed enemy (after a parry or a long combo) to grab it. Attack knees it twice, then throws it; push a direction while pressing Attack to throw that way. A thrown Sproto knocks down everyone it flies into.
- **Launcher and juggles:** Up + Attack launches an enemy into the air; anyone can keep hitting it to juggle (each juggle hit does 15% less).
- **Ground slam:** Down + Attack in the air slams down with a shockwave that also hits enemies lying on the floor.
- **Weapons play differently:** The Scimitar strikes quickly for light damage, and the Mace trades speed for much stronger hits. The Bo Staff's second hit strikes behind you. The War Hammer's finisher sends a shockwave along the lane. The Spear's finisher pierces the lane. The Battle Axe makes enemies bleed, and the Chain Flail pulls them in. Caster weapons and bows trade damage, speed and range. Healer weapons can also improve Mend.
- **Special** (a quick tap, or Attack + Jump together): a spinning weapon sweep that hits all around you and costs a little health.
- **Down, dead, game over:** a Sproto at 0 HP is down for **10 seconds**. Players can revive anyone, as often as needed, by standing over them. A Sproto nobody revives in time dies. A human who dies drops back in once (shown as ♥♥ → ♥ in the HUD); a second death puts that human out for the rest of the stage. Dead Sprotos return at the next stage on one life. If every Sproto is down at once, downed humans with a spare life use it on the spot. **The run is lost when no human is left in it, or when every Sproto on screen is down or dead.**
- **Dodging:** read boss attack animations and dodge the projectiles themselves. Bosses have no danger stripes, landing rings, warning labels, flashing warning lights or alert sounds. Spreads leave gaps. A weapon swing knocks thrown knives and homing missiles out of the air.
- **Difficulty:** four waves of Shadow Sprotos per stage (up to 12 on screen), tougher and more aggressive as stages go on. **Everything scales with the number of human players**, counted when a stage's first fight starts (in local and relay play a later drop-in grows what is left of that stage to the new count; it never shrinks): with `h` humans, waves are `50% + 10%·h` of full size, Shadow Sproto health is `58% + 10.2%·h` and boss health is `35% + 15%·h` (one human: 60% / 68% / 50%; four: 90% / 99% / 95%). Shadow Sprotos spread over the team and take the emptier side of whoever they pick. The screen stops waiting for a player who has pressed nothing for five seconds. Such a player also revives nobody, so seats left idle next to each other cannot hold a wave open forever. **The stage ramp flattens after stage 6:** stages 1 to 6 each add a full step of wave size, Shadow and boss health and damage; every later stage adds 30% of a step, so stage 13 is the hardest but stays beatable with sidegrade weapons. Summoner bosses past stage 6 call Shadows a quarter as often, and only while fewer Shadows than human players are up.
- **Shadow roles:** every stage fields a different mix of melee and ranged Shadows. Ranged Shadows show where they will shoot before releasing a projectile. Paired Shadows appear as **Shadow Twins**: the dashed warning remains after the first shot because a second one is coming. Step out of the line or interrupt their windup.
- **The UFO (from Sproto Arcade):** an empty saucer drops mid-stage and when a boss changes phase. The player who grabs it pilots the saucer for 12 seconds. Attack fires the green laser, Jump/Special drops the beach-ball bomb, and the saucer's shield absorbs 4 hits.
- **Crates** hold health snacks, gems and power-ups.
- **Power-ups (save them for big crowds):** human players can hold up to 3, shown in the HUD. Fire one with Down + Special or Down + Power. The Fighter can use Power alone. They drop from crates, every cleared wave, the boss phase change and the occasional defeated enemy.
    - **Sproto Storm:** a shockwave around you that knocks down everything within about 260 px and wipes out enemy shots.
    - **Meteor Rain:** 12 meteors land on the enemies across the whole screen over 1.5 seconds.
    - **Chain Lightning:** lightning strikes the 10 nearest enemies on screen, and the boss.
- **Last Call Bar:** Sprotel Bitcoin throws straight snacks, arcing beer mugs, cocktail fans, bouncing drinks and weaving blue marlins. At half health, his tall jukebox mecha folds into a blue/silver marlin. Phase two fires aimed bill lasers, fast five-missile bursts from a retractable dorsal launcher and drifting deadly bubbles. Both forms can charge and sweep behind themselves.
- **Bosses:** each stage ends with a Sproto-piloted mecha. Boss health is `(4,200 + 440 per stage) × human scale` (half that for chargers); past stage 6 each stage adds 132 instead of 440, which makes 7,324 on stage 13. At half HP, the boss runs a complete eight-second sequence from the Phase 1 standing pose to the Phase 2 standing pose. The cockpit, weapon and base follow separate movement tracks at 30 frames per second. Phase 2 attacks faster and adds a signature weapon attack and a unique special. Watch the attack animation and move or jump before impact. The original narrow shots, spread volleys, homing shots, charges, and rear sweeps still apply.
- **Sound:** effects and music are synthesized in the browser (no audio files). There are three loops: menus, stages (the key changes from stage to stage) and a faster one for bosses. M, or SOUND in the pause menu, mutes everything.
- **Four boss scripts:** each mecha runs one of four scripts, in stage order and repeating every four stages, named on its entrance banner. **Gunner** (stages 1, 5, 9): the attacks above. **Charger** (2, 6, 10): every third attack is a charge (every second in phase 2) after a longer wind-up, for less damage, and the lane it drove along **burns** for about 3 seconds (two lanes at most, ending short of the machine); standing in the fire costs a little health every 0.6 s. It spends much of the fight out of reach, so it has half the health of the other scripts. **Summoner** (3, 7, 11): single shots and a slower rhythm, but it keeps calling plain Shadow Sprotos, two at a time, while fewer than one more than the number of humans are standing. **Bomber** (4, 8, 12): weapon A lobs bombs at locked target positions under two Sprotos (three in phase 2) instead of firing along a lane; the bomb lands 1.3 s after the attack begins and only hurts whoever is still on it.
- **Elite Shadow Sprotos:** from stage 2, some Shadow Sprotos are elites (gold bar, ELITE tag, never more than two at once, never among a summoner's adds). They carry a club or a pike, have 60% more health, hit 25% harder and hold a **guard** that stops every hit from the front. Get behind them, **launch** them (Up + Attack goes under the guard), **parry** them, or use a power-up; six blocked hits also break the guard and leave them dazed. A broken guard returns after 5 seconds.
- **Sproto passives:** each Sproto has one small passive, shown in the lobby. Sproto Sheriff is a **Duelist** (parry window +50%), VAMP a **Leech** (+2 health per KO), Red Kev a **Brawler** (+10% weapon damage), Sprotel Bitcoin a **Medic** (revives 40% faster), Golden Sproto is **Tough** (+10 max health) and Dumpstar a **Sprinter** (walks 10% faster).
- **Stages, unlocks and bests:** clearing a stage unlocks the next one. On the stage screen, Power (R, ', or Y on a pad) toggles **free play**, which opens all thirteen for groups that just want to pick one; free play is a setting kept in that browser. Every run ends on a summary: stage reached, time, and each Sproto's score, KOs, revives and parries, next to the best run so far. Unlocks and the best run belong to whoever earned them: on a hub visit, the hub player (account or guest), whose progress is kept in the hub cloud save and loads on any device; outside the hub, that browser. Neither ever moves into the other. God Mode runs are shown but never recorded, and no Tickets or scores are sent to the hub. See `docs/coop-hub.md`.

The thirteen stages are Tidebreak Marina, Last Light Bar, Mudline Trenches, Sproto Ranch, Neon Tomorrow, Circuit Gate, Moonkeep Castle, Crown Relay Chamber, The Hatchery, Verse Gate, Rooftop Breakaway, Codebreak Ascent and Last Call Bar.

[Last Call Bar / Sprotel Bitcoin two-phase art, attacks and server handoff](docs/sprotel-bitcoin-phase-one.md).

## Server loop budget

The hub runs the pinned sim in a 20 Hz loop (50 ms), and one loop's three 60 Hz substeps should take under 25 ms in goja at p95. That budget is enforced only by `npm run bench:goja` (ten parallel goja VMs; needs Go, with `GOTOOLCHAIN=auto` to fetch the 1.26 toolchain), not by `npm test` or CI: the number depends on the machine and its load, so `npm test` only logs it and warns when it is over. Run the bench on an otherwise idle machine before and after changing a pinned file.

## Art sources

Only these sprites are reused:

- **Boss sprites:** Sprotel Bitcoin loads two pages of 176px actor frames and one 64px projectile atlas per phase on entering Last Call Bar, using generated 2×2 mech and 4×4 projectile sheets (see `art/sprotel-bitcoin/layout.json`). The original bosses in `public/assets/bosses/` use 24 lossless WebP mecha phase atlases with 220 px actor cells and 24 matching atlases with 96 px projectile cells. Actor rows cover walking, lane attacks or bomb lobs, spreads, homing attacks, charges, rear sweeps, and a transition or signature row. The last Phase 2 row is the special attack. Summoners also have a summon row. Projectile rows cover lane attacks or bomb lobs, spreads, homing shots, and impacts. `tools/boss-combat-geometry.json` preserves the calibrated collision and shot origins independently of the art.
- **Boss attack effects:** four small sheets in `public/assets/fx/` (13 KB in all), reused from the sibling games and packed at half size by `python3 tools/build-boss-fx.py` (it reads `../Sproto-Arcade` and `../Sproto-Fighter` in place). The rear sweep erupts as a rippling field of crystal floor spikes on impact (Arcade's ground eruption), charger fire lanes burn with animated flames (Arcade's barn fire), and explosions use Fighter's 4-frame impact bursts. `render.js` falls back to the old procedural drawing until a sheet has loaded.
- **UFO:** the saucer (cockpit layers, laser, muzzle, beach ball and shield) from Sproto-Arcade `art/attacks/player/higgsfield/saucer*`.
- **Playable Sprotos:** sixteen characters from the [Sproto-Fighter](https://github.com/crrreatorrr/Sproto-Fighter) fighters. The original six keep their 128px poses in lossless WebP. The additional ten are a seeded sample of solo fighters with authored walk and action sheets. `tools/import-playable-roster.py` builds their compact atlases, the portrait grid, and supplemental attack clips. The original source poses are preserved under `art/fighter-poses/`.
- **Shadows:** `tools/import-shadow-roster.py` reads the 254 playable identities, source poses and projectile art or signatures from Sproto Fighter commit `0e9af196`. It applies a dark palette inspired by Sproto Buddha and creates one atlas for each stage in `public/assets/shadows/`. It reads Git objects without modifying the Fighter repository. `tools/build-manifest.py` folds the generated roster into Coop's runtime manifest.

- **Stages:** the half-speed scenery comes from Sproto Arcade (`art/level-01…10.jpg`, `art/rooftop-chase/01.webp`, and `art/codebreak/shaft.webp`). The shipped fighting floors in `public/assets/stages/` were generated with Higgsfield using each backdrop and original floor as references, then sized and color-matched for the game. `tools/build-backgrounds.py` regenerates the original procedural floor art and overwrites these assets.

The class weapons and combat effects use an animated pixel sheet made with `tools/build-combat-sprites.py`, aligned to the characters by `public/js/render-fx.js`. `tools/build-manifest.py` measures sprite bounds and hand positions and writes `public/js/manifest.js`.

## Code map

[Combat architecture and host contract](docs/combat-architecture.md).

| File | Role |
|---|---|
| `public/js/combat.js` | Portable combat kernel for hit windows, healing, aim and swept collisions. **Pinned** |
| `public/js/sim.js` | Simulation: players, Shadow Sprotos, bosses, UFO, waves, snapshots, restart state. **Pinned** |
| `public/js/ai.js` | Class-aware CPU teammates. **Pinned** |
| `public/js/net-protocol.js` | Banked-match rules (seats, input limits, terminal facts). Runs only inside the server bundle; `index.html` does not load it. **Pinned** |
| `public/js/manifest.js` | Sprite bounds and hand positions, generated by `tools/build-manifest.py`. **Pinned** |
| `public/js/render.js` | Canvas renderer; draws snapshots only, so every client looks identical |
| `public/js/main.js`, `party-picker.js` | Title, party roster editor, drop-in, game loop and relay client |
| `public/js/asset-loader.js` | Staged image loading: fighter atlases, stages, bosses, UFO |
| `public/js/input.js`, `gamepad.js`, `audio.js`, `progress.js`, `net.js` | Keyboard layouts and devices, and the controller settings (`Input.Controls`: bindings, storage, press-to-bind; `tests/controls.test.js`); pure gamepad mapping (deadzone, latch on connect, menu repeat); synthesized SFX and music; the `Progress` module (best run and stage unlocks, owned by the device or the hub player through the hub SDK's progress store; `tests/progress.test.js`, `tests/account-progress.test.js`); relay WebSocket client |
| `public/js/hub-config.js`, `hub-link.js` | Hub settings, and the hub session (ticket redeem, balance chip, Return to Hub) |
| `public/js/feedback-link.js` | Adapter for the hub's feedback window (N twice): freeze, context, theme |
| `public/js/net-hub.js` | Client for the hub's authoritative `sproto_coop` match (banked play) |
| `server/server.js` | Practice static server and room relay |
| `scripts/build.mjs`, `build-server-sim.mjs` | `dist/` build; the server bundle `build/coop-sim.js` and its pin |
| `scripts/check-assets.mjs`, `check-budgets.mjs` | Asset inventory and transfer budgets |

The five **pinned** files are hashed into `build/coop-sim.pin.json`, which the hub vendors. See `AGENTS.md` before editing them.

There are two kinds of online play:

- **Practice relay** (`npm start`): host-authoritative. Guests send packed input bits every frame. The host simulates at 60 Hz and sends snapshots at 30 Hz, which guests interpolate between. A snapshot is usually 1.5–3.5 KB of JSON (about 2 KB typical), with busy moments near 4 KB. It never pays Tickets. When the hub opened the page, clearing stage 1 in local or relay play earns the hub's Marina Anchor Relic (God Mode counts); see `docs/coop-hub.md`.
- **Banked** (from the hub's Bar cabinet): the hub's Nakama match `sproto_coop` runs the pinned sim at 60 Hz in a 20 Hz loop and sends snapshots at 10 Hz. Verified boss clears pay Tickets on the server, and a stage 1 clear grants the Marina Anchor there. See `docs/coop-online.md`.

## Tests

```bash
npm test                 # sim, relay, protocol, goja goldens, assets, hub link (needs Go)
npm run test:browser     # relay host + guest, atlas visuals, browser goldens, banked client, menus and controller settings (Playwright)
npm run test:e2e         # hub round trip, authority, rewards, reconnect
```

The headless campaign check runs four CPU Sprotos on seed 42 until the run ends. CPU teammates are deliberately weak, so that team reaches game over on stage 3 (tick 17896 in `tests/fixtures/gameplay-hashes.json`); it does not clear the 12 stages. `AGENTS.md` lists the full check order.
