# Crapto and Rune phase-one rear sweep QA

Both four-cel sheets pass visual and runtime QA. Independent source replay reproduced the measured matte, the bounded perimeter mask, the fixed nearest-neighbor coordinate transform and the full packed RGBA page exactly. No source image pixels reach a crop seam. See the per-page hashes and sample counts in exact-review.json.

- Crapto keeps the sloped front plow, stable open cockpit and small blue, yellow-eyed pilot. The original articulated rear canister lowers and rakes into the marked rear lane. The canister reaches about 107 game pixels behind the actor at impact and 119 in follow-through, inside the native rear sweep envelope. The cylinder rim in follow-through passes about two packed pixels below its fixed sole baseline.
- Rune keeps the planted boots, front sword and recognizable blue two-faced pilot. Its connected red-chevron shield swings low toward the rear. The shield reaches about 115 game pixels at release, inside the native rear sweep envelope. The shield resumes its upright guard in the final pose.

I inspected both facings at game scale against dark and pale backgrounds and in the actual arenas. Fine green edge pixels remain on both sheets. The most affected registered cel has 19 saturated samples, concentrated around existing hard edges and contacts. No detached white areas, added limbs, or blocking floor line appeared. The live sweep flash and rear-zone markers stay visible.

The exact candidate page for each boss passed all 124 browser snapshots, including both facings, the tick-36 nova, decoded release cel, local state roundtrip, and idle return at tick 61. No combat logic changes are needed.
