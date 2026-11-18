#!/usr/bin/env python3
"""Pack generated 2x2 actors and 4x4 projectiles without redrawing the art.

Actor rows (220px, 8 columns): idle/walk, five throws, charge, sweep, hit/defeat.
Projectile rows (64px, 16 columns): snack, beer, cocktail, soda, marlin, impact.
The raw sheets are the reproducible source of truth; preserve their alpha.
"""
from pathlib import Path
from PIL import Image, ImageOps
import json

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'art/sprotel-bitcoin/raw'
OUT = ROOT / 'public/assets/bosses'
KEY = '13-last-call-sprotelbitcoin-p1'
ACTORS = [('idle', 'walk')] + [(a + '-a', a + '-b') for a in
    ['snacks', 'beer', 'cocktails', 'drinks', 'marlin', 'charge', 'sweep']] + [('hit', 'death')]
EFFECTS = ['snack-fx', 'beer-fx', 'cocktail-fx', 'drinks-fx', 'marlin-fx', 'impact-fx']


def frames(name, grid):
    sheet = Image.open(RAW / (name + '.png')).convert('RGBA')
    return [sheet.crop((round(c * sheet.width / grid), round(r * sheet.height / grid),
                        round((c + 1) * sheet.width / grid), round((r + 1) * sheet.height / grid)))
            for r in range(grid) for c in range(grid)]


def actor_frame(im):
    mask = im.getchannel('A').point(lambda a: 255 if a > 100 else 0)
    box = mask.getbbox()
    if not box:
        raise ValueError('empty actor')
    # Anchor under the legs, so a thrown object or extended arm never moves the torso.
    feet = mask.crop((0, box[3] - 75, im.width, box[3])).getbbox()
    pivot = (feet[0] + feet[2]) / 2
    scale = min(190 / (im.height * .94), 104 / max(pivot - box[0], box[2] - pivot))
    resized = im.resize((round(im.width * scale), round(im.height * scale)), Image.Resampling.LANCZOS)
    cell = Image.new('RGBA', (220, 220))
    cell.alpha_composite(resized, (round(110 - pivot * scale), round(206 - box[3] * scale)))
    return ImageOps.mirror(cell)  # Runtime boss art faces left.


actor = Image.new('RGBA', (220 * 8, 220 * len(ACTORS)))
for row, names in enumerate(ACTORS):
    cells = sum([frames(name, 2) for name in names], [])
    for col, frame in enumerate(cells):
        actor.alpha_composite(actor_frame(frame), (col * 220, row * 220))
# One shared palette keeps the new actor inside the existing 10 MiB static cap.
actor = actor.quantize(colors=256, method=Image.Quantize.FASTOCTREE,
                       dither=Image.Dither.NONE).convert('RGBA')
actor.save(OUT / (KEY + '.webp'), lossless=True, exact=True, method=6)

fx = Image.new('RGBA', (64 * 16, 64 * len(EFFECTS)))
for row, name in enumerate(EFFECTS):
    cells = frames(name, 4)
    # Keep the generated animation's size changes (especially the impact burst).
    boxes = [im.getchannel('A').point(lambda a: 255 if a > 80 else 0).getbbox() for im in cells]
    max_edge = max(max(b[2] - b[0], b[3] - b[1]) for b in boxes if b)
    scale = 58 / max_edge
    for col, (im, box) in enumerate(zip(cells, boxes)):
        if not box:
            continue
        tile = im.resize((round(im.width * scale), round(im.height * scale)), Image.Resampling.LANCZOS)
        cell = Image.new('RGBA', (64, 64))
        cell.alpha_composite(tile, (round(32 - im.width * scale / 2), round(32 - im.height * scale / 2)))
        fx.alpha_composite(cell, (col * 64, row * 64))
fx.quantize(colors=256, method=Image.Quantize.FASTOCTREE,
            dither=Image.Dither.NONE).save(OUT / (KEY + '-projectiles.png'), optimize=True)

meta = {'actor': {'cell': 220, 'columns': 8, 'rows': ACTORS, 'frames': 72, 'foot': [110, 206]},
        'projectiles': {'cell': 64, 'columns': 16, 'rows': EFFECTS, 'frames': 96},
        'generation': {'actors': '2x2', 'projectiles': '4x4', 'tool': 'image_gen',
                       'identity': 'reference.png', 'phaseCount': 1}}
(ROOT / 'art/sprotel-bitcoin/layout.json').write_text(json.dumps(meta, indent=2) + '\n')
for path in [OUT / (KEY + '.webp'), OUT / (KEY + '-projectiles.png')]:
    print(path.name, path.stat().st_size, 'bytes')
