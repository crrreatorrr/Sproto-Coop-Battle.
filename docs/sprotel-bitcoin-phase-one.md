# Sprotel Bitcoin — Last Call Bar

Stage 13 reuses Last Light Bar's background, floor, and Shadow Sproto roster. Clear Codebreak Ascent to unlock it, or enable Free Play on stage select. Existing twelve-stage victory saves open stage 13 automatically, without awarding its clear. The weapon ladder still ends at tier 13.

Only phase one is authored. Sprotel keeps this form below half health and reaches the normal defeat/stage-clear/victory flow at zero. Add a second phase to `tools/sprotel-bitcoin.json` when its art and behavior are ready; there is no duplicated placeholder phase.

| Attack | Trajectory | Response |
|---|---|---|
| Snack burst | Three fast, straight throws along the locked lane | Step out or jump |
| Beer lob | Ballistic arc to locked landing rings, 54 flight ticks | Leave the rings |
| Cocktail fan | Three shots diverge through the arena's depth | Move between the fan's lanes |
| Bouncing drinks | Two cups with gravity and staggered floor bounces | Avoid the landing lane or time a jump |
| Blue marlin | Repeating wave in height and arena depth | Follow the warned path and step aside |
| Shoulder charge | 24-tick windup, then a rush across the arena | Change lanes |
| Rear sweep | Standard rear-zone warning and low backhand | Jump or get in front |

The five throws cycle in order, followed by the charge. The usual rear-sweep trigger also applies. No bar projectile homes.

## Art and packing

The user's supplied reference is `art/sprotel-bitcoin/reference.png`. The final sprites preserve its tall silhouette, long limbs, turquoise/gold armor, open jukebox cockpit, and Santa-hat pilot. The source sheets were generated with the built-in `image_gen` tool. No Higgsfield jobs were submitted.

- 18 **2×2 mech sheets** in `art/sprotel-bitcoin/raw/`: 72 authored frames. Each throw, charge, and sweep has eight frames across two source sheets; idle, walk, hit and defeat each have four.
- Six **4×4 projectile/effect sheets**: 16 frames apiece for snacks, beer, cocktails, drinks, blue marlin, and impact; 96 total.
- `python3 tools/pack-sprotel-bitcoin.py` crops, anchors, mirrors, and packs the generated pixels. It writes one 8×9 actor atlas (220px cells) and one 16×6 projectile atlas (64px cells). `layout.json` records the rows. Source alpha is retained; runtime palettes reduce transfer size.
- `python3 tools/build-manifest.py` appends the authored single-phase boss metadata without changing the original bosses' geometry or fighter metadata.

## Validation and server handoff

`tests/sprotel-bitcoin.test.js` covers the five distinct trajectories, all phase-one attacks, back-facing beer targets, warning lifetime, exact state resume, save migration, tier cap, stage-12 progression and phase-one victory. `tests/browser-sprotel-bitcoin.cjs` starts stage 13 through the UI and verifies all 72 actor / 96 effect source rectangles. The shared `sprotel-bar-throws` golden executes the five throws and resume in Node, Chromium and Goja.

The public tree remains below the existing 10 MiB cap; title requests and first-stage budgets are unchanged. The first twelve bosses retain their prior gameplay hashes.

This intentionally changes pinned sim/content files. `build/coop-sim.js`, its pin, both client fingerprints, the hub-test bundle hash and sim goldens are updated. **After merge, metaverse-hub must re-vendor the bundle and pin and update its CoopProto constants**, following `AGENTS.md`, before banked online play can use this content. This change does not deploy or update that separate hub repository.
