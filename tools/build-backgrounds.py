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
    ('art/level-01.jpg', .80, .95), ('art/level-02.jpg', .74, .87), ('art/level-03.jpg', .80, 1), ('art/level-04.jpg', .70, 1),
    ('art/level-05.jpg', .72, 1), ('art/level-06.jpg', .82, .95), ('art/level-07.jpg', .80, .95), ('art/level-08.jpg', .80, 1),
    ('art/level-09.jpg', .78, .95), ('art/level-10.jpg', .82, .93),
    ('art/rooftop-chase/01.webp', .99, 1),  # sky chase with no floor: its floor comes from Neon Tomorrow's street
    ('art/codebreak/shaft.webp', .80, 1),   # vertical shaft: its lowest screen is used
]
FLOOR_FROM = {11: 5}
def load(i):
    src, fl, fe = SOURCES[i - 1]
    im = Image.open(os.path.join(A, src)).convert('RGB')
    if 'shaft' in src: im = im.crop((0, im.height - 1100, im.width, im.height))
    return im, fl, fe
for i in range(1, 13):
    im, fl, fe = load(i)
    w, h = im.size
    cut = int(h * fl)
    s = BACK_H / cut
    back = im.crop((0, 0, w, cut)).resize((round(w * s), BACK_H), Image.LANCZOS)
    fim, ffl, ffe = load(FLOOR_FROM.get(i, i))
    fw, fh = fim.size
    fs = BACK_H / int(fh * ffl)
    floor = fim.crop((0, int(fh * ffl), fw, int(fh * ffe))).resize((round(fw * fs), FLOOR_H), Image.LANCZOS)
    back.save(f'{O}{i:02d}-back.jpg', quality=84)
    floor.save(f'{O}{i:02d}-floor.jpg', quality=84)
    print(i, back.size, floor.size)
