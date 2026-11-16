# One combat simulation, multiple hosts

Local play, a practice relay host, and a banked server run the same 60 Hz simulation. The owning process steps it. Everyone else sends input and renders snapshots. The practice relay does not run a second simulation, and the banked client cannot replace one.

| Layer | Contract |
| --- | --- |
| `public/js/combat.js` | Portable rules with no DOM, network, timers, random inputs, or content dependencies: active frames, direction vectors, healing bounds, and swept box collision. Import with `require('./combat.js')` or load it as a classic script (`CombatKernel`). |
| `public/js/sim.js` | Sproto adapter. Its class and weapon catalogs define role, tier, action timing and effects. The stage supplies movement, range, lane and height rules, team eligibility, NPC behavior, and hitboxes. `create` and `step` are the match entry points. |
| `public/js/net-protocol.js` | The server checks owned devices, class and weapon IDs, and earned tiers. Its tick loop accepts only input. Healing, damage, projectile hits, and cooldowns run inside the simulation. |
| `public/js/render.js` and `render-fx.js` | Read snapshots. Weapon profiles choose sprite art; attack state and elapsed ticks choose windup, release, and recovery frames. Drawing never decides whether a hit landed. |

When porting this to another fighting game, keep its own roster, hitboxes, movement axes, and presentation. A 1v1 fighter can hold the depth coordinate fixed in the sweep; an arena game can supply both floor axes. Convert bindings to the game's action intents before stepping. Change the host and snapshot readers to add online play; reuse the same gameplay rules. Use stable IDs for loadouts and serialize the current move and cooldown with the rest of the match. Do not use render frame rate, timestamps, or picture overlap to drive combat.

## Equipment and progression

All four classes have a starter weapon and 12 more tiers. An earned tier applies to every class. Practice records stage clears on the device or the signed-in Hub profile; Free Play can open a stage for practice but does not earn weapons for skipped stages. An out-of-order clear is remembered. Banked play has a separate server-verified record, because the practice profile can be edited by clients. The server advances that record on confirmed stage clears and uses it to check lobby loadouts. Credit does not depend on the class or on a Ticket payment. A reconnect restores the chosen class, weapon, HP, and ability cooldown from the match.

Banked lobby messages may contain `loadouts: { device: { fighter?, classId?, weapon? } }`. Acknowledged seats expose `classId` and `weaponTier`. Only the owner can configure a seat, with a matching generation, before play. The host supplies the validated tier; the message never supplies HP, damage, or progression.

## Release

Use `npm run build:server-sim` to produce the exact bundle used by Nakama. The bundle includes the combat kernel ahead of the Sproto adapter and embeds the authoritative loadout parser. Ship matching `build/coop-sim.pin.json` and client fingerprint with the Hub wrapper and vendored bundle. A mismatched client falls back to practice rather than assuming ownership of a banked match.
