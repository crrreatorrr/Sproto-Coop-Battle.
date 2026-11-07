#!/usr/bin/env python3
"""Build the 12 stage backgrounds from Sproto Arcade's stage art.

For each stage:
  NN-back.jpg   the Arcade panorama above its floor line (scenery, drawn with parallax), 226 px tall
  NN-floor.jpg  the fighting floor, 150 px deep

The Arcade floors are thin strips meant for a side-on view; stretched to a deep beat-'em-up belt
they smear. So each floor is drawn as crisp pixel art in a style that fits the stage, using colours
sampled from that stage's own Arcade floor. Codebreak's floor is its shaft's circuit traces laid flat.
Usage: python3 tools/build-backgrounds.py /path/to/Sproto-Arcade
"""
import os, random, sys
from PIL import Image, ImageDraw

A = sys.argv[1] if len(sys.argv) > 1 else '../Sproto-Arcade'
O = 'public/assets/stages/'
os.makedirs(O, exist_ok=True)
BACK_H, FLOOR_H, TW = 226, 150, 512

# (source, floor line, palette band start, palette band end, floor style), fractions of image height.
SOURCES = [
    ('art/level-01.jpg', .885, .897, .946, 'planks'),        # Tidebreak Marina: pier deck
    ('art/level-02.jpg', .74, .76, .86, 'dance'),            # Last Light Bar: glossy wood floor
    ('art/level-03.jpg', .80, .82, .97, 'slabs'),            # Mudline Trenches: mossy slabs + grates
    ('art/level-04.jpg', .70, .75, .97, 'dirt'),             # Sproto Ranch: packed dirt
    ('art/level-05.jpg', .72, .74, .90, 'tar'),              # Neon Tomorrow: rooftop tar + neon seams
    ('art/level-06.jpg', .82, .84, .93, 'metal'),            # Circuit Gate: steel plates
    ('art/level-07.jpg', .80, .82, .94, 'flagstones'),       # Moonkeep Castle: courtyard flagstones
    ('art/level-08.jpg', .80, .82, .97, 'tiles'),            # Crown Relay Chamber: big stone tiles
    ('art/level-09.jpg', .80, .806, .862, 'organic'),        # The Hatchery: purple stone + spores
    ('art/level-10.jpg', .82, .84, .92, 'rock'),             # Verse Gate: asteroid rock + crystals
    ('art/rooftop-chase/01.webp', .99, .55, .95, 'gravel'),  # Rooftop Breakaway: roof gravel
    ('art/codebreak/shaft.webp', .55, 0, 1, 'circuit'),      # Codebreak Ascent: circuit board
]
ACCENTS = {2: (255, 80, 200), 5: (60, 230, 255), 6: (255, 196, 40), 9: (90, 255, 220), 10: (150, 120, 255), 11: (170, 90, 255)}


def load(i):
    src = SOURCES[i - 1][0]
    im = Image.open(os.path.join(A, src)).convert('RGB')
    if 'shaft' in src:
        im = im.crop((0, im.height - 1100, im.width, im.height))
    return im


def palette(im, a, b):
    """Dark / mid / light / highlight sampled from the middle of the Arcade floor band."""
    w, h = im.size
    band = im.crop((int(w * .2), int(h * a), int(w * .8), int(h * b))).resize((200, 40))
    raw = band.tobytes()
    cols = sorted((tuple(raw[k:k + 3]) for k in range(0, len(raw), 3)), key=sum)
    n = len(cols)
    return cols[n // 10], cols[n // 2], cols[int(n * .8)], cols[int(n * .97)]


def sh(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


def depth(y):
    """Rows nearer the camera are taller and brighter."""
    return 0.70 + 0.32 * (y / FLOOR_H)


def rows(min_h, max_h):
    y = 0
    while y < FLOOR_H:
        h = min_h + int((max_h - min_h) * (y / FLOOR_H))
        yield y, h
        y += h


def planks(d, pal, rnd, gloss=False):
    dark, mid, light, hi = pal
    for y, bh in rows(7, 14):
        k = depth(y)
        x = -rnd.randint(0, 60)
        while x < TW:
            L = rnd.randint(70, 170)
            tone = rnd.choice([mid, mid, mid, light, light, dark])
            body = sh(tone, k * rnd.uniform(.94, 1.06))
            x0, x1, y1 = max(0, x), min(TW, x + L - 2), y + bh - 2
            if x1 > x0:
                d.rectangle([x0, y, x1, y1], fill=body)
                d.line([x0, y, x1, y], fill=sh(hi, k))
                d.line([x0, y1, x1, y1], fill=sh(dark, k * .8))
                for gx in range(x0 + 3, x1 - 3, 9):
                    if rnd.random() < .5:
                        gy = rnd.randint(y + 2, max(y + 2, y1 - 2))
                        d.line([gx, gy, gx + rnd.randint(3, 7), gy], fill=sh(tone, k * .82))
                if gloss and rnd.random() < .5:  # a soft reflection of the bar's lights
                    gx = rnd.randint(x0, max(x0, x1 - 20))
                    d.line([gx, y + 2, gx + 14, y + 2], fill=sh(hi, 1.1))
                elif rnd.random() < .3:
                    kx = rnd.randint(x0 + 6, max(x0 + 6, x1 - 6))
                    d.ellipse([kx - 2, (y + y1) // 2 - 1, kx + 2, (y + y1) // 2 + 1], fill=sh(dark, k * .7))
                for nx in (x0 + 3, x1 - 3):
                    if x0 < nx < x1 and bh > 8:
                        d.point([(nx, y + 2), (nx, y1 - 2)], fill=sh(dark, k * .55))
            x += L


def stones(d, pal, rnd, min_h, max_h, wmin, wmax, moss=None, mortar=.45, round_=False):
    dark, mid, light, hi = pal
    for y, bh in rows(min_h, max_h):
        k = depth(y)
        x = -rnd.randint(0, wmax)
        while x < TW:
            L = rnd.randint(wmin, wmax)
            body = sh(rnd.choice([mid, mid, light, dark]), k * rnd.uniform(.9, 1.08))
            box = [x + 1, y + 1, x + L - 2, y + bh - 2]
            if round_:
                d.rounded_rectangle(box, radius=3, fill=body)
            else:
                d.rectangle(box, fill=body)
            d.line([x + 2, y + 1, x + L - 3, y + 1], fill=sh(hi, k))
            d.line([x + L - 2, y + 2, x + L - 2, y + bh - 2], fill=sh(dark, k * .75))
            for _ in range(rnd.randint(0, 2)):  # cracks and pits
                cx, cy = rnd.randint(x + 3, x + L - 4), rnd.randint(y + 3, y + bh - 3)
                d.line([cx, cy, cx + rnd.randint(-4, 4), cy + rnd.randint(1, 3)], fill=sh(dark, k * .65))
            if moss and rnd.random() < .3:
                mx = rnd.randint(x + 2, x + L - 6)
                d.rectangle([mx, y + bh - 4, mx + rnd.randint(3, 9), y + bh - 2], fill=sh(moss, k))
            x += L


def speckle(d, pal, rnd, n, colors):
    for _ in range(n):
        x, y = rnd.randint(0, TW - 1), rnd.randint(0, FLOOR_H - 1)
        d.point((x, y), fill=sh(rnd.choice(colors), depth(y)))


def gen_floor(i, style, pal):
    rnd = random.Random(100 + i)
    dark, mid, light, hi = pal
    gap = sh(dark, .45)
    img = Image.new('RGB', (TW, FLOOR_H), gap)
    d = ImageDraw.Draw(img)
    acc = ACCENTS.get(i)
    if style == 'planks':
        planks(d, pal, rnd)
    elif style == 'dance':
        planks(d, pal, rnd, gloss=True)
        for y in (FLOOR_H // 3, 2 * FLOOR_H // 3):  # faint neon glow pools from the signs
            for x in range(0, TW, 128):
                d.ellipse([x + 20, y - 4, x + 90, y + 4], outline=sh(acc, .55))
    elif style == 'slabs':
        stones(d, pal, rnd, 12, 22, 40, 90, moss=(70, 110, 50))
        for gx in range(60, TW, 170):  # drain grates
            gy = rnd.randint(30, FLOOR_H - 40)
            d.rectangle([gx, gy, gx + 34, gy + 18], fill=sh(dark, .4))
            for bx in range(gx + 3, gx + 33, 5):
                d.line([bx, gy + 2, bx, gy + 16], fill=sh(mid, .7))
    elif style == 'dirt':
        img.paste(sh(mid, .95), [0, 0, TW, FLOOR_H])
        for y in range(FLOOR_H):  # depth shading
            d.line([0, y, TW, y], fill=sh(mid, depth(y)))
        speckle(d, pal, rnd, 2600, [dark, light, hi, sh(mid, .85)])
        for ry in (52, 104):  # wagon ruts
            for x in range(0, TW, 2):
                d.point((x, ry + int(2 * rnd.random())), fill=sh(dark, depth(ry) * .8))
        for _ in range(40):  # tufts of grass
            x, y = rnd.randint(0, TW - 6), rnd.randint(6, FLOOR_H - 4)
            g = sh((110, 140, 60), depth(y))
            d.line([x, y, x - 2, y - 4], fill=g); d.line([x + 2, y, x + 2, y - 5], fill=g); d.line([x + 4, y, x + 6, y - 4], fill=g)
        for _ in range(60):  # pebbles
            x, y = rnd.randint(0, TW - 4), rnd.randint(0, FLOOR_H - 3)
            d.rectangle([x, y, x + 2, y + 1], fill=sh(light, depth(y)))
    elif style == 'tar':  # wet neon street
        for y in range(FLOOR_H):
            d.line([0, y, TW, y], fill=sh(mid, depth(y) * .95))
        speckle(d, pal, rnd, 1600, [dark, light, hi])
        for x in range(10, TW, 64):  # lane markings
            d.rectangle([x, 74, x + 30, 77], fill=sh((235, 220, 120), .85))
        for _ in range(9):  # puddles reflecting the neon signs
            x, y = rnd.randint(0, TW - 60), rnd.randint(8, FLOOR_H - 14)
            w2 = rnd.randint(30, 60)
            d.ellipse([x, y, x + w2, y + 8], fill=sh(dark, .7))
            c = rnd.choice([acc, (255, 80, 200), (255, 200, 80)])
            d.line([x + 6, y + 3, x + w2 - 8, y + 3], fill=sh(c, .9))
            d.line([x + 10, y + 5, x + w2 // 2, y + 5], fill=sh(c, .6))
        for mx in (120, 380):  # manholes
            d.ellipse([mx, 104, mx + 34, 116], fill=sh(dark, .6), outline=sh(light, .9))
            d.line([mx + 6, 110, mx + 28, 110], fill=sh(light, .8))
    elif style == 'gravel':  # rooftop: concrete roof slabs, vents, AC units, neon glow
        for y, bh in rows(20, 32):
            k = depth(y)
            off = (y // 4) % 2 * 32
            for x in range(-off, TW, 64):
                d.rectangle([x + 1, y + 1, x + 62, y + bh - 2], fill=sh(rnd.choice([mid, light, mid]), k * 1.15))
                d.line([x + 1, y + 1, x + 62, y + 1], fill=sh(hi, k * 1.1))
        speckle(d, pal, rnd, 1400, [dark, hi])
        for vx in range(30, TW, 170):  # AC units and vents
            vy = rnd.randint(16, FLOOR_H - 40)
            d.rectangle([vx, vy, vx + 40, vy + 22], fill=sh(light, 1.2), outline=sh(dark, .5))
            d.ellipse([vx + 6, vy + 4, vx + 22, vy + 18], outline=sh(dark, .6))
            d.line([vx + 14, vy + 4, vx + 14, vy + 18], fill=sh(dark, .6))
            for k2 in range(vy + 4, vy + 19, 3):
                d.line([vx + 26, k2, vx + 37, k2], fill=sh(dark, .6))
        for _ in range(6):  # neon puddles
            x, y = rnd.randint(0, TW - 50), rnd.randint(10, FLOOR_H - 12)
            d.ellipse([x, y, x + 44, y + 7], fill=sh(dark, .6))
            d.line([x + 6, y + 3, x + 36, y + 3], fill=sh(acc, .9))
    elif style == 'metal':
        for y, bh in rows(18, 30):
            k = depth(y)
            for x in range(0, TW, 64):
                d.rectangle([x + 1, y + 1, x + 62, y + bh - 2], fill=sh(rnd.choice([mid, mid, light]), k))
                d.line([x + 1, y + 1, x + 62, y + 1], fill=sh(hi, k))
                for rx, ry in ((x + 4, y + 4), (x + 59, y + 4), (x + 4, y + bh - 5), (x + 59, y + bh - 5)):
                    d.point((rx, ry), fill=sh(dark, k * .5))
                if rnd.random() < .25:  # floor vent
                    for vx in range(x + 14, x + 50, 4):
                        d.line([vx, y + 6, vx, y + bh - 7], fill=sh(dark, k * .55))
        for x in range(0, TW, 16):  # hazard stripe across the middle
            d.polygon([(x, 72), (x + 8, 72), (x + 16, 80), (x + 8, 80)], fill=sh(acc, .9))
            d.polygon([(x + 8, 72), (x + 16, 72), (x + 24, 80), (x + 16, 80)], fill=(30, 30, 30))
    elif style == 'flagstones':
        stones(d, pal, rnd, 12, 22, 30, 70, round_=True)
    elif style == 'tiles':
        for y, bh in rows(22, 34):
            k = depth(y)
            off = (y // 3) % 2 * 24
            for x in range(-off, TW, 48):
                tone = rnd.choice([mid, mid, light])
                d.rectangle([x + 1, y + 1, x + 46, y + bh - 2], fill=sh(tone, k))
                d.line([x + 2, y + 2, x + 45, y + 2], fill=sh(hi, k))
                d.rectangle([x + 18, y + bh // 2 - 2, x + 28, y + bh // 2 + 2], outline=sh(dark, k * .7))
    elif style == 'organic':
        stones(d, pal, rnd, 12, 20, 34, 80, round_=True)
        for _ in range(90):  # glowing spores
            x, y = rnd.randint(0, TW - 3), rnd.randint(0, FLOOR_H - 3)
            d.rectangle([x, y, x + 1, y + 1], fill=sh(acc, .6 + .5 * rnd.random()))
        for _ in range(26):
            x, y = rnd.randint(0, TW - 8), rnd.randint(0, FLOOR_H - 6)
            d.ellipse([x, y, x + 6, y + 4], fill=sh((255, 170, 70), depth(y)))
    elif style == 'rock':
        stones(d, pal, rnd, 14, 26, 30, 80, round_=True)
        for _ in range(16):  # crystal clusters
            x, y = rnd.randint(4, TW - 10), rnd.randint(10, FLOOR_H - 2)
            for dx, hgt in ((0, 8), (4, 12), (8, 7)):
                d.polygon([(x + dx, y), (x + dx + 2, y - hgt), (x + dx + 4, y)], fill=sh(acc, .8 + .2 * rnd.random()))
    # Front lip and a soft shadow under the back edge of the floor.
    d.line([(0, FLOOR_H - 3), (TW, FLOOR_H - 3)], fill=hi)
    d.rectangle([(0, FLOOR_H - 2), (TW, FLOOR_H)], fill=gap)
    return img


def circuit_floor():
    full = Image.open(os.path.join(A, SOURCES[11][0])).convert('RGB')
    strip = full.crop((200, full.height - 1100, 440, full.height - 600)).rotate(90, expand=True)
    strip = strip.resize((round(strip.width * FLOOR_H / strip.height), FLOOR_H), Image.LANCZOS)
    return Image.eval(strip, lambda v: int(v * 0.8))


for i in range(1, 13):
    src, cut_f, pa, pb, style = SOURCES[i - 1]
    im = load(i)
    w, h = im.size
    cut = int(h * cut_f)
    s = BACK_H / cut
    back = im.crop((0, 0, w, cut)).resize((round(w * s), BACK_H), Image.LANCZOS)
    if style == 'circuit':
        floor = circuit_floor()
    else:
        pal_src = load(5) if i == 11 else im  # the rooftop chase has no floor of its own
        pal = palette(pal_src, *((.74, .90) if i == 11 else (pa, pb)))
        if i == 11:  # rooftop concrete: the neon street's colours pulled toward a cool grey
            pal = tuple(tuple(int(v * .45 + g * .55) for v, g in zip(c, (96, 92, 118))) for c in pal)
        floor = gen_floor(i, style, pal)
    back.save(f'{O}{i:02d}-back.jpg', quality=86)
    floor.save(f'{O}{i:02d}-floor.png', optimize=True)
    print(i, style, back.size, floor.size)
