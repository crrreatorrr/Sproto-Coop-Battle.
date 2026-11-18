# Reviewed transformation staging bundle

All 12 reviewed transformations passed input, palette, packet and endpoint checks. This directory is staging only; no game registry or game files were installed. Combat animation completion and final production integration remain separate.

`public/` contains only the exact reviewed WebP page bytes. `registry-fragment.json` preserves the reviewed clip metadata for the integrator to merge. `source/` and `provenance/` stay outside the public game directory.

Each offline source atlas combines the same 160 complete 220px cels in a 10×16 grid (2200×3520 PNG). The portable pack spec retains the original 8-column, 40-frame page layout and three-tick durations. Use a pack-boss-transform.py version that reads each frame entry rect. Decoded RGBA hashes are authoritative when a different encoder version changes WebP bytes. Each boss has one verified portable ZIP containing both source endpoints. The optional portable_rig.py helper reads these packets with Pillow and the standard library. native cels, large QA boards and game GIFs are retained only in frozen workspace evidence.
