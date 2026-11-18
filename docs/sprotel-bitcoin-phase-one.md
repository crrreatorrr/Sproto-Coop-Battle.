# Sprotel Bitcoin — Last Call Bar

Stage 13 repeats Last Light Bar's scenery and shadow roster. Clearing Codebreak Ascent opens Last Call Bar; existing 12-stage winners can enter it immediately. The weapon cap stays at tier 13.

The initial tall turquoise/gold jukebox mech preserves the owner's reference proportions and the visible Santa-hat pilot. It has five throws: straight snack bursts, ballistic beer mugs with locked landing positions, cocktail fans, bouncing soda cups, and blue marlins that weave through depth and height. It also charges and sweeps behind itself.

At half health, an eight-second mechanical transformation folds it into the supplied cobalt-blue/silver marlin blueprint. The same pilot stays in the open cockpit. Its bill fires fast descending laser lances aimed at the locked target. A matching dorsal pod extends, fires five rapid missiles, and retracts. Deadly bubbles descend from the speaker outlets, then drift in a fan. Aim stays locked after release. All bosses rely on their attack animations and projectiles; explicit warning overlays and alert sounds are absent. The marlin also charges and attacks behind itself with its tail.

Both forms use generated 2×2 source sheets for every mech action; projectiles and impacts use 4×4 sheets. Each ranged attack has eight mech frames, and each projectile/effect has sixteen. The final runtime set contains 136 actor frames (including eight transformation keys) and 160 projectile/effect frames. Idle, locomotion, hit, defeat, charge, and sweep poses are included. Sources and layout are under `art/sprotel-bitcoin/`; `python3 tools/pack-sprotel-bitcoin.py` rebuilds compact lossless WebP actors and indexed PNG effects without redrawing the sources. Actor cells are 176px and effect cells 64px; original bosses keep their existing layouts. The public tree remains below the existing 10 MiB cap.

## Validation

`npm test` covers both phases, trajectories, fast projectile collision, eight-second transformation, stage-13 victory, saved unlocks and deterministic export/resume. Shared golden scenarios cover the added stage and all eight ranged attacks in Node, Goja and Chromium. `tests/browser-sprotel-bitcoin.cjs` starts stage 13 through the menu and checks playback of every actor/projectile frame. Standard browser, end-to-end, asset, build and budget checks remain applicable.

## Authoritative server handoff

This is an intended simulation/content change. The committed server bundle, pin, Node/Goja goldens and client/test fingerprints are updated together. After merge, **metaverse-hub must copy the new bundle/pin and update its CoopProto constants**, following `AGENTS.md` and `docs/coop-server-contract.md`. The client will reject an old banked hub authority with `version_mismatch` until that separate handoff is deployed. Local and practice-relay play use this checkout directly.
