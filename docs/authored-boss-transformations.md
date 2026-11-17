# Authored boss transformation clips

`public/js/boss-transformations.js` is an unpinned presentation registry. It ships empty until accepted art is available. A registered boss uses complete authored frames; a missing clip keeps the existing presentation. No simulation, collision, attack, or network pins change.

The actor origin remains `[110,206]` in each `220×220` transparent cel. Its game-space extent is 243 pixels, matching the standing actors. Use the same registered feet, pilot, facing, and framing as the accepted actor endpoints. Author in the existing left-facing orientation. The renderer mirrors the entire frame for a right-facing boss. The first and final frame must exactly match the phase-one and phase-two standing idle cels, including placement. Mechanical part travel, cockpit continuity, weapons, and supported ground contact must be authored and visually reviewed before packing; the runtime does not create those frames.

## Pack accepted frames

Use Python 3 with Pillow supporting exact lossless WebP (`python3 -m pip install -r tools/requirements-boss-transform.txt`). CI installs this pinned dependency before running the packing tests. A spec beside the accepted input frames contains:

```json
{
  "boss": "04-ranch-zephyr",
  "cell": [220,220],
  "anchor": [110,206],
  "columns": 8,
  "pageFrames": 40,
  "frames": [
    {"file":"accepted-000.png","ticks":4},
    {"file":"accepted-001.png","ticks":5}
  ],
  "endpoints": [
    {"file":"accepted-phase1.png","rect":[0,0,220,220]},
    {"file":"accepted-phase2.png","rect":[0,0,220,220]}
  ],
  "sourceRecord": "Accepted master and mechanical rig provenance"
}
```

The abbreviated frame list above must be replaced with the complete ordered sequence. Positive integer durations must total **480 simulation ticks**, exactly eight seconds at 60 Hz. For 100 frames, a mix of 4- and 5-tick holds can total 480; for 160 frames, use 3 ticks per frame. Choose timing for the actual choreography. The tool does not interpolate, crop, resize, segment, or invent any art. All frames need transparent padding at the cell boundary.

```bash
python3 tools/pack-boss-transform.py /absolute/authoring/spec.json \
  public/assets/bosses/transformations \
  --registry public/js/boss-transformations.js
```

The tool validates all source frames and both exact endpoints before publishing pages. It packs at most 40 frames per page by default (8 columns, 5 rows: `1760×1100`, 7,744,000 decoded bytes). It verifies the encoded page preserves all RGBA bytes. Hashes of the final encoded page bytes in filenames prevent stale cached art when art, layout, or encoding changes. It merges only the selected boss into the registry. Provenance goes beside the input spec as `<boss>-packed.json`, or to `--provenance /absolute/path.json`; keep it outside `public/assets`. That report records source files and hashes, per-frame RGBA hashes, timings, and the resulting clip metadata. Remove obsolete page revisions only after confirming they are unreferenced.

## Snapshot playback and residency

`boss-transform-player.js` indexes `snapshot.boss.t` directly against cumulative frame durations, clamped to ticks 0–479. It does not start a local timer. A late online snapshot at tick 300 requests the page containing that frame, rather than replaying the beginning. Phase-one presentation warms the first page; transformation playback pins its current page and the next page. Earlier pages are released. Next-stage boss body prefetch pauses while a transformation page is pinned and resumes afterward. Normal stage art remains pinned.

If the current page is not decoded yet, the renderer holds the last displayed complete cel (one 220×220 canvas). If no cel has been displayed, it draws the existing phase-one standing idle cel. A recovered page resumes at the current authoritative tick. A new stage, a phase-one retry, or a clock rewind clears the held cel. Phase-two idle releases every transformation page. Decoding failures use the loader's existing three-attempt retry policy and asset error reporting.

For registered clips the presentation bypasses the old contour/optical-flow code entirely. The old code remains loaded because unregistered bosses still need it. Once all accepted clips exist, its removal can be a separate change.

## Verification

```bash
npm test
npm run build && npm run check:assets && npm run check:budgets
npm run test:browser
npm run test:e2e
```

New tests cover every tick, page boundaries, late snapshots, page cancellation, residency, both facings, registration, endpoint mismatch, clipped frames, exact packing, and the real browser render route. Browser and packing fixtures are temporary synthetic test patterns and never enter production assets. Adding real clips changes asset inventory and transfer costs; refresh the measured baseline only after reviewing those costs, without silently raising caps. The first warmed transformation page is included in first-stage transfer and request accounting.

Runtime tests cannot judge art quality. Review every accepted frame and the full sequence in both facings at native and game sizes, including the pilot's eyes and cockpit, foot support, weapon continuity, transparent edges, disconnected parts, and endpoint handoff. No production frames are included in this implementation branch.
