#!/usr/bin/env python3
"""Packs the boss attack effect sheets in public/assets/fx/.

The frames are reused from the sibling games, read in place and never changed there:
  Sproto Arcade  art/attacks/boss/higgsfield/ground-eruption.png    floor spike column
                 art/attacks/hazards/84px/warning/01-03.png        floor-crack warning
                 art/attacks/hazards/84px/retract/01-04.png        spike collapse wisp
                 art/attacks/boss/higgsfield/barn-fire/01-04.png   flame loop
                 art/backdrop-motion/bunker-lights/amber/01-04.png warning light bar
  Sproto Fighter public/fighters/powers/team-special-effects.png   impact rows (orange, violet)
Arcade draws at 1280x720 and Coop Battle at 640x360, so every frame is halved (the burst cells
128 -> 48). Sheets are palettized PNGs to stay inside the 10 MiB static budget.

  python3 tools/build-boss-fx.py [path/to/games]   (default: the folder above this repo)

Layout (read by FX in public/js/render.js; keep both in step):
  spikes.png  168x87  row 0 (y 0, h 63): spike column, 1 frame, 42 wide
                      row 1 (y 63, h 8): crack warning, 3 frames of 42
                      row 2 (y 71, h 16): retract, 4 frames of 42
  flame.png   104x46  4 frames of 26x46
  lights.png  76x56   4 frames of 19x56
  burst.png   192x96  row 0 orange, row 1 violet; 4 frames of 48x48 each
"""
import os
import sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
GAMES = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(REPO)
ARCADE = os.path.join(GAMES, 'Sproto-Arcade', 'art')
FIGHTER = os.path.join(GAMES, 'Sproto-Fighter', 'public', 'fighters', 'powers')
OUT = os.path.join(REPO, 'public', 'assets', 'fx')  # not under bosses/: the loader evicts loose boss images


def load(*parts):
    return Image.open(os.path.join(*parts)).convert('RGBA')


def half(im, size=None):
    return im.resize(size or (max(1, im.width // 2), max(1, im.height // 2)), Image.LANCZOS)


def fit(im, w, h):
    """Scale to height h, then centre horizontally in a w x h cell."""
    k = h / im.height
    scaled = im.resize((max(1, round(im.width * k)), h), Image.LANCZOS)
    cell = Image.new('RGBA', (w, h))
    cell.alpha_composite(scaled.crop((max(0, (scaled.width - w) // 2), 0, max(0, (scaled.width - w) // 2) + min(w, scaled.width), h)),
                         (max(0, (w - scaled.width) // 2), 0))
    return cell


def save(im, name, colors=96):
    # Hard alpha edges suit pixel art and keep the palette small.
    a = im.getchannel('A').point(lambda v: 0 if v < 40 else 255)
    im.putalpha(a)
    q = im.quantize(colors=colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    q.save(path, optimize=True)
    print(name, im.size, os.path.getsize(path), 'bytes')


def spikes():
    sheet = Image.new('RGBA', (168, 87))
    sheet.alpha_composite(half(load(ARCADE, 'attacks/boss/higgsfield/ground-eruption.png')), (0, 0))
    for i in range(3):
        sheet.alpha_composite(half(load(ARCADE, 'attacks/hazards/84px/warning', '%02d.png' % (i + 1))), (i * 42, 63))
    for i in range(4):
        sheet.alpha_composite(half(load(ARCADE, 'attacks/hazards/84px/retract', '%02d.png' % (i + 1))), (i * 42, 71))
    save(sheet, 'spikes.png')


def flame():
    sheet = Image.new('RGBA', (104, 46))
    for i in range(4):
        sheet.alpha_composite(half(load(ARCADE, 'attacks/boss/higgsfield/barn-fire', '%02d.png' % (i + 1))), (i * 26, 0))
    save(sheet, 'flame.png')


def lights():
    sheet = Image.new('RGBA', (76, 56))
    for i in range(4):
        sheet.alpha_composite(fit(load(ARCADE, 'backdrop-motion/bunker-lights/amber', '%02d.png' % (i + 1)), 19, 56), (i * 19, 0))
    save(sheet, 'lights.png', colors=64)


def burst():
    src = load(FIGHTER, 'team-special-effects.png')
    sheet = Image.new('RGBA', (192, 96))
    for row, src_row in enumerate((5, 6)):  # impact rows: 5 orange, 6 violet
        for i in range(4):
            cell = src.crop((i * 128, src_row * 128, i * 128 + 128, src_row * 128 + 128))
            sheet.alpha_composite(half(cell, (48, 48)), (i * 48, row * 48))
    save(sheet, 'burst.png')


if __name__ == '__main__':
    spikes()
    flame()
    lights()
    burst()
