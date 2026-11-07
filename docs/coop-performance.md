# Sproto Coop Battle performance (C2)

Measured on top of `0b2e8df` (C3). Gameplay hashes, feet, hands, hit boxes, and boss sheet paths are unchanged. No new art. The 240 pose PNGs stay in the repo and are not requested.

## What loads

`public/js/asset-loader.js` replaces the old `Promise.all` of 274 images. A missing file used to count as success. A critical file now tries three times (150 ms, then 400 ms) and the title stays on the loading screen until Attack, Enter, or Space retries. Four loads and two decodes run at once. Paths stay relative to `document.baseURI`, so a `/play/sproto-coop-battle/` host does not jump back to the site root.

Blocking startup, before the title:

| Piece | Requests |
|---|---:|
| `index.html` | 1 |
| Classic scripts, including `asset-loader.js` | 9 |
| Six fighter atlases | 6 |
| Stage 01 scenery (title background and the first fight) | 2 |
| Stage 05 scenery (lobby background) | 2 |
| **Title total** | **20** |

The first fight then asks for the current boss sheet, phase-2 sheet, and both projectile sheets (4). That is the critical set: **24 requests**. Eight UFO images used by the saucer, laser, beach ball, and shields prefetch when the stage starts. They are inside the first-stage byte total and are not part of the title waterfall. `idle.png` and `muzzle.png` were on the old preload list and are not drawn; they stay on disk with `red-laser.png` and `thrust.png`.

Boss sheets stay lazy. Entering a stage pins that stage and the next one (scenery plus both phases). Unpinned boss images are dropped, so a 12-stage walk keeps at most 8 boss images (2 stages × 2 phases × sheet and projectile). Stage images keep those pins, the two startup stages, and up to 8 extra thumbs. Tint and pose-cell canvases are capped at 96 each.

## Atlases

`tools/pack-fighter-atlases.py` copies the existing 128×128 poses. Grid is 8×5, row-major, poses `00`–`31` then `w00`–`w07`, no padding. Each atlas is 1024×640. Cells are integer copies; `--check` decodes the atlas and compares all 240 poses to the sources. Feet, hands, and boxes in `manifest.js` are untouched (`abf8ee18e934ecf5921aa92043d7fd45015f0db56592ad0a47c07282115d9748`).

Shipped format is PNG from the stdlib encoder (zlib 1.3 on the machine that wrote the files). Lossless WebP was measured with Pillow 13.0.0 (`lossless`, `exact=True`, `method=6`) and matched the pixels, but the bitstream follows libwebp and CI does not have Pillow, so WebP is not shipped.

| | Bytes |
|---|---:|
| 240 source poses | 1,163,757 |
| 6 PNGs shipped | 988,221 |
| 6 lossless WebP, not shipped | 665,604 |

Per character PNG / exact WebP: Sheriff 210,203 / 157,410; VAMP 155,436 / 102,776; Red Kev 168,206 / 105,410; Sprotel Bitcoin 156,111 / 106,876; Golden Sproto 153,547 / 95,490; Dumpstar 144,718 / 97,642.

The renderer copies each cell with `getImageData` into a 128 canvas, then draws that canvas the way the old code drew the pose PNG. Weapon anchors stay on the manifest hand points.

## Budgets

Caps are 1.5 MiB title, 3 MiB first stage, 30 critical requests, 10 MiB static (`10,485,760`). All four hold.

| Gate | Measured | Cap |
|---|---:|---:|
| Title file bytes (HTML + 9 scripts + 10 startup images) | 1,382,836 | 1,572,864 |
| Title transfer, cache disabled, 3-run median | 1,388,836 | 1,572,864 |
| Title requests | 20 | 30 |
| First stage bytes (title + stage-1 boss/projectiles + 8 UFO images) | 2,005,074 | 3,145,728 |
| Critical requests (title + 4 boss images) | 24 | 30 |
| `public/` static bytes | 10,180,239 | 10,485,760 |

Static margin is about 305 KB. The pose sources are in that total. On-disk fighter decoded RGBA is 31,457,280 because it still counts the unused poses. Runtime fighter images are the six atlases: 15,728,640 bytes, plus one 1024×640 staging canvas per character after the first draw (another 15,728,640, constant). Cell and tint caps add at most 6,291,456 each. Boss decoded memory stays at or under 8 × 1024 × 1024 × 4 = 33,554,432 instead of all 48 sheets (201,326,592).

## Timing

Headless Playwright Chromium 158.0.8127.18 (Chrome for Testing build 1254), Node v22.23.4, cache disabled. Three cold title loads:

| Condition | Median |
|---|---:|
| Localhost, no throttle | 83.4 ms, 1,388,836 bytes, 20 requests |
| Emulated 10 Mbps and 100 ms RTT | 1,534.2 ms, same bytes and requests |

There is no CPU 4× throttle and no named GPU in this run. The 2 s title figure is this emulated network, not a CI time gate. CI enforces the byte and request caps, the atlas pixel check, and the same browser cell comparison (240/240 poses, zero pose-PNG requests).

## Hashes that did not move

| Run | sha256 |
|---|---|
| 6 CPU, seed 42 | `c6ae6107e5bcbd4889664a9ce77c9426e154f35075b8065c2f813424347635d9` |
| 2 local + 4 CPU, seed 7, 1800 ticks | `89ecbf4b26032462e367e666f5ebec9ca2853ca392d97461ec937a284818841b` |
| 6 local devices, seed 99, 1800 ticks | `d753a4cd1c37252f9f6c1a1cf7e104095183191de865df54b78762f3990b36c2` |

Asset tree `be0dc513d5355393f6ccef53f896175834dd2a5f94025988adc258d4715b9b68`. Public tree `f8c5d41f0327a4da860d6a9c84905d05f530038333f96fc5c25b0d225855bbbf`. 330 asset files, 10,015,678 bytes. Dynamic refs 86. Unused and kept: 240 poses plus four UFO files.
