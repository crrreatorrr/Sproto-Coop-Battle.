#!/usr/bin/env python3
"""Build the 12 stage backgrounds from Sproto Arcade's stage art.

Each Arcade panorama is split at its floor line into
  NN-back.jpg  the scenery above the floor (drawn with parallax), 226 px tall
  NN-floor.jpg the floor itself, stretched to the 150 px deep fighting belt
Usage: python3 tools/build-backgrounds.py /path/to/Sproto-Arcade
"""
import sys, os
from PIL import Image
A = sys.argv[1] if len(sys.argv) > 1 else '../Sproto-Arcade'
O = 'public/assets/stages/'
os.makedirs(O, exist_ok=True)
BACK_H, FLOOR_H = 226, 150
# (source, floor line as a fraction of image height) — floor lines follow Arcade's levels.js 'foot' values.
# (source, floor line, floor end) as fractions of image height. The floor end skips the dark
# borders some Arcade panoramas have below their walkable floor.
SOURCES = [
    ('art/level-01.jpg', .885, .95), ('art/level-02.jpg', .74, .87), ('art/level-03.jpg', .80, 1), ('art/level-04.jpg', .70, 1),
    ('art/level-05.jpg', .72, 1), ('art/level-06.jpg', .82, .95), ('art/level-07.jpg', .80, .95), ('art/level-08.jpg', .80, 1),
    ('art/level-09.jpg', .80, .95), ('art/level-10.jpg', .82, .93),
    ('art/rooftop-chase/01.webp', .99, 1),  # sky chase with no floor: its floor comes from Neon Tomorrow's street
    ('art/codebreak/shaft.webp', .55, 1),   # vertical shaft: its circuit waterfalls are the scenery
]
FLOOR_FROM = {11: 5}
# Floors whose source band is too thin to stretch: the band is scaled evenly and stacked into a deck.
TILE_FLOOR = {1: (.888, .952), 9: (.806, .862)}
def load(i):
    src, fl, fe = SOURCES[i - 1]
    im = Image.open(os.path.join(A, src)).convert('RGB')
    if 'shaft' in src: im = im.crop((0, im.height - 1100, im.width, im.height))
    return im, fl, fe
def marina_deck(full):
    """Tidebreak Marina: a crisp pixel-art pier deck in the Arcade planks' own colours.
    The Arcade pier is only a thin strip, so instead of stretching it, boards are drawn running
    across the screen, narrower toward the back for depth, with gaps, lit edges, nails and knots."""
    import random
    from PIL import ImageDraw
    W0, H0 = full.size
    # Palette sampled from the clean middle of the Arcade pier.
    src = full.crop((1120, int(H0 * .897), 1760, int(H0 * .946))).convert('RGB')
    raw = src.tobytes(); cols = sorted((tuple(raw[k:k + 3]) for k in range(0, len(raw), 3)), key=sum)
    n = len(cols)
    dark, mid, light, hi = cols[n // 10], cols[n // 2], cols[int(n * .8)], cols[int(n * .97)]
    gap = tuple(int(v * .45) for v in dark)
    tw = 512
    deck = Image.new('RGB', (tw, FLOOR_H), gap)
    d = ImageDraw.Draw(deck)
    rnd = random.Random(11)
    shade = lambda c, k: tuple(max(0, min(255, int(v * k))) for v in c)
    y, row = 0, 0
    while y < FLOOR_H:
        bh = 7 + int(7 * (y / FLOOR_H))           # boards grow taller toward the front
        k = 0.70 + 0.32 * (y / FLOOR_H)          # and lighter
        x = -rnd.randint(0, 60)
        while x < tw:
            L = rnd.randint(70, 170)
            tone = rnd.choice([mid, mid, mid, light, light, dark])
            body = shade(tone, k * rnd.uniform(.94, 1.06))
            x0, x1, y0, y1 = max(0, x), min(tw, x + L - 2), y, y + bh - 2
            if x1 > x0:
                d.rectangle([x0, y0, x1, y1], fill=body)
                d.line([x0, y0, x1, y0], fill=shade(hi, k))                 # lit top edge
                d.line([x0, y1, x1, y1], fill=shade(dark, k * .8))          # shaded bottom edge
                for gx in range(x0 + 3, x1 - 3, 9):                          # grain flecks
                    if rnd.random() < .5:
                        gy = rnd.randint(y0 + 2, max(y0 + 2, y1 - 2))
                        d.line([gx, gy, gx + rnd.randint(3, 7), gy], fill=shade(tone, k * .82))
                if rnd.random() < .35:                                       # a knot
                    kx, ky = rnd.randint(x0 + 6, max(x0 + 6, x1 - 6)), (y0 + y1) // 2
                    d.ellipse([kx - 2, ky - 1, kx + 2, ky + 1], fill=shade(dark, k * .7))
                for nx in (x0 + 3, x1 - 3):                                   # nails at board ends
                    if x0 < nx < x1 and bh > 8:
                        d.point([(nx, y0 + 2), (nx, y1 - 2)], fill=shade(dark, k * .55))
            x += L
        y += bh
        row += 1
    d.line([(0, FLOOR_H - 3), (tw, FLOOR_H - 3)], fill=hi)
    d.rectangle([(0, FLOOR_H - 2), (tw, FLOOR_H)], fill=gap)
    return deck

for i in range(1, 13):
    im, fl, fe = load(i)
    w, h = im.size
    cut = int(h * fl)
    s = BACK_H / cut
    back = im.crop((0, 0, w, cut)).resize((round(w * s), BACK_H), Image.LANCZOS)
    fim, ffl, ffe = load(FLOOR_FROM.get(i, i))
    fw, fh = fim.size
    fs = BACK_H / int(fh * ffl)
    if i == 1:
        floor = marina_deck(fim)
    elif i == 12:
        # The shaft has no walkable floor: lay its gold circuit traces flat as a circuit-board deck.
        full = Image.open(os.path.join(A, SOURCES[11][0])).convert('RGB')
        strip = full.crop((200, full.height - 1100, 440, full.height - 600)).rotate(90, expand=True)
        strip = strip.resize((round(strip.width * FLOOR_H / strip.height), FLOOR_H), Image.LANCZOS)
        floor = Image.eval(strip, lambda v: int(v * 0.8))
    elif i in TILE_FLOOR:
        a, b = TILE_FLOOR[i]
        band = fim.crop((0, int(fh * a), fw, int(fh * b)))
        bw = round(fw * fs * 1.6); band = band.resize((bw, round(band.height * bw / fw)), Image.LANCZOS)
        floor = Image.new('RGB', (bw, FLOOR_H))
        for k, y in enumerate(range(0, FLOOR_H, band.height)):
            row = band if k % 2 == 0 else band.transpose(Image.FLIP_LEFT_RIGHT)  # vary the seams
            floor.paste(row, (0, y))
    else:
        floor = fim.crop((0, int(fh * ffl), fw, int(fh * ffe))).resize((round(fw * fs), FLOOR_H), Image.LANCZOS)
    back.save(f'{O}{i:02d}-back.jpg', quality=84)
    floor.save(f'{O}{i:02d}-floor.jpg', quality=84)
    print(i, back.size, floor.size)
