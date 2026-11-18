# Interim standing-only fallback banks

Row0 column0 of each legacy body bank contains its exact accepted220pixel standing phase endpoint. Columns1–3 retain their original walking cels, with at least three distinct row0 poses. Every attack row after y220 is exact original decoded RGBA, with unchanged bank dimensions. No existing walk or attack motion was removed. New provider movement/attack streams are still required before shipping.

`original-banks/` preserves the original encoded inputs. `manifest.json` binds the original/new encodings, complete attack-region hashes, accepted endpoint atlas rectangles and exact replay semantics. The source endpoint atlases are in `source/transformations/`.

From the game root, verify without generating or writing art:

```sh
python3 source/fallback-standing-holds/replay-import.py .
```

The verifier also checks the original top16 and accepted bottom16 Zephyr projectile-bank cells. Pillow11.3.0 matches the repository tooling. Decoded RGBA is the portable visual authority; encoder versions may produce different compressed bytes.
