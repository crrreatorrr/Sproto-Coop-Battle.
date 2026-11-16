#!/usr/bin/env python3
"""Draw a combat sprite sheet from four-frame groups of 64 px cells.

Equipment grips are centered at (32, 32) to match the fighter atlas hand
anchors. Shots point right and hit effects are centered. The renderer layers
these cells over the existing 128 px character frames so every Sproto can
use every class without changing their size, color or foot position.
"""

from pathlib import Path
from math import cos, pi, sin

from PIL import Image, ImageDraw

CELL = 64
INK = "#19162b"
WHITE = "#fff5df"
VIOLET = ("#583780", "#b784ff", "#f8d6ff")
MINT = ("#286d65", "#65e6ad", "#e0ffe1")
SKY = ("#29496e", "#68c9eb", "#ebfaff")
AMBER = ("#713044", "#ff934d", "#fff0ad")
STEEL = ("#404c6d", "#a6bed2", "#edf8ff")


def spark(pen, x, y, r, color):
    pen.polygon([(x, y-r), (x+1, y-1), (x+r, y), (x+1, y+1),
                 (x, y+r), (x-1, y+1), (x-r, y), (x-1, y-1)], fill=color)


def staff(pen, frame, healer, style="staff"):
    dark, main, light = MINT if healer else VIOLET
    # Held horizontal in the sheet. Casting rotates around the grip.
    back = {"staff": 6, "rod": 18, "wand": 26, "scepter": 19}[style]
    pen.rectangle((back, 30, 52, 34), fill=INK)
    pen.line((back+2, 31, 50, 31), fill="#b08b79", width=2)
    pen.rectangle((27, 29, 37, 35), fill="#423658", outline=INK)
    pen.line((28, 30, 36, 30), fill="#dac499")
    pen.rectangle((back, 29, back+3, 35), fill=dark, outline=INK)
    if style == "wand":
        pen.polygon([(38, 30), (52, 29), (58, 25), (55, 33), (40, 34)],
                    fill=main, outline=INK)
        spark(pen, 55, 28, 5, light)
    elif style == "rod":
        pen.rectangle((39, 29, 49, 35), fill="#8c6372", outline=INK)
        pen.line((41, 30, 48, 30), fill=light)
        pen.polygon([(47, 31), (54, 22), (61, 31), (54, 42)], fill=main, outline=INK)
        spark(pen, 54, 31, 5, light)
    elif style == "scepter":
        pen.polygon([(42, 32), (45, 23), (50, 26), (55, 19), (61, 28),
                     (59, 39), (55, 42), (51, 36), (45, 41)], fill=dark, outline=INK)
        pen.line([(43, 29), (46, 24), (50, 27), (55, 21), (59, 27)], fill="#e8b974", width=2)
        spark(pen, 54, 31, 8, light)
    elif healer:
        shape = [(49, 20), (55, 20), (55, 26), (61, 26), (61, 38),
                 (55, 38), (55, 44), (49, 44), (49, 38), (43, 38),
                 (43, 26), (49, 26)]
        pen.polygon(shape, fill=dark, outline=INK)
        pen.rectangle((50, 22, 54, 41), fill=main)
        pen.rectangle((45, 28, 59, 35), fill=main)
        pen.rectangle((51, 27, 53, 36), fill=light)
        pen.rectangle((48, 30, 56, 32), fill=light)
    else:
        pen.polygon([(41, 32), (49, 22), (56, 23), (61, 32),
                     (56, 41), (49, 42)], fill=dark, outline=INK)
        pen.polygon([(46, 31), (52, 24), (58, 31), (53, 38)], fill=main)
        pen.polygon([(51, 27), (55, 30), (51, 34), (48, 31)], fill=light)
        pen.line((42, 31, 47, 35, 53, 40), fill="#d4a46f", width=2)
    if frame:
        spark(pen, 55 + frame, 24 - frame * 3, min(5, 2 + frame), light)
        spark(pen, 47, 42 + frame * 3, 1 + frame, main)
    if frame == 2:
        spark(pen, 53, 31, 10, light)


def bow(pen, frame, hostile):
    _, main, light = AMBER if hostile else SKY
    string = (10, 32) if frame == 1 else (15, 32)
    pen.line([(18, 11), string, (18, 53)], fill="#39283a", width=2)
    pen.line([(18, 11), string, (18, 53)], fill="#ffdead")
    limbs = [(17, 10), (25, 15), (31, 24), (32, 32),
             (31, 40), (25, 49), (17, 54)]
    pen.line(limbs, fill=INK, width=5)
    pen.line(limbs, fill="#a45436" if hostile else "#824d40", width=3)
    pen.line([(19, 11), (26, 16), (31, 25)], fill="#f2b970")
    pen.rectangle((28, 28, 35, 35), fill=INK)
    pen.rectangle((29, 29, 34, 34), fill=main)
    pen.line((29, 29, 33, 29), fill=light)
    if frame in (1, 2):
        start = string[0] if frame == 1 else 33
        end = start + 23
        pen.line((start, 31, end, 31), fill=INK, width=3)
        pen.line((start, 31, end, 31), fill=main)
        pen.polygon([(end, 28), (end+4, 31), (end, 34)], fill=light)
        if frame == 2:
            spark(pen, end-3, 31, 5, light)


def crossbow(pen, frame):
    dark, main, light = SKY
    pen.polygon([(15, 32), (19, 27), (43, 27), (49, 31), (46, 37),
                 (36, 37), (34, 41), (28, 41), (25, 36), (18, 37)], fill="#824d40", outline=INK)
    pen.line([(18, 30), (43, 29), (47, 31)], fill="#deaa78", width=2)
    pen.line([(36, 19), (45, 22), (51, 31), (45, 40), (36, 44)], fill=INK, width=4)
    pen.line([(36, 19), (45, 22), (51, 31), (45, 40), (36, 44)], fill=dark, width=2)
    back = 26 if frame == 1 else 34
    pen.line([(36, 19), (back, 32), (36, 44)], fill=light)
    if frame in (1, 2):
        pen.line((back, 31, 54, 31), fill=main, width=2)
        pen.polygon([(54, 28), (59, 31), (54, 34)], fill=light)
    if frame == 2:
        spark(pen, 54, 31, 7, light)


def scimitar(pen, frame):
    pen.rectangle((24, 30, 36, 34), fill=INK)
    pen.rectangle((26, 31, 35, 33), fill="#71394b")
    pen.rectangle((35, 27, 39, 36), fill="#d5a456", outline=INK)
    blade = [(39, 29), (49, 29), (55, 27), (61, 23), (59, 29),
             (54, 34), (47, 36), (39, 34)]
    pen.polygon(blade, fill="#8db5d8", outline=INK)
    pen.line([(39, 33), (47, 35), (54, 33), (59, 28)], fill=WHITE)
    if frame == 2:
        spark(pen, 57, 26, 4, WHITE)


def mace(pen, frame):
    pen.rectangle((25, 29, 54, 35), fill=INK)
    pen.rectangle((26, 30, 52, 34), fill="#9b6550")
    pen.rectangle((27, 29, 35, 35), fill="#433451")
    head = [(50, 22), (54, 22), (57, 18), (60, 24), (62, 29), (60, 35),
            (60, 39), (55, 43), (53, 39), (48, 39), (47, 34), (45, 30)]
    pen.polygon(head, fill="#736682", outline=INK)
    pen.polygon([(51, 24), (55, 24), (57, 21), (58, 27), (55, 31), (49, 30)],
                fill="#d0b2aa")
    pen.line([(48, 34), (55, 35), (60, 31)], fill="#4c3d60", width=2)
    if frame == 2:
        spark(pen, 60, 22, 3, AMBER[2])


def melee(pen, frame, style):
    if style == "twin-blades":
        scimitar(pen, frame)
        pen.polygon([(30, 34), (23, 43), (12, 47), (17, 42), (20, 34), (29, 30)],
                    fill="#8db5d8", outline=INK)
        pen.line((16, 44, 27, 34), fill=WHITE)
        return
    grip = (14, 30, 44, 34) if style == "halberd" else (23, 30, 41, 34)
    pen.rectangle(grip, fill="#975d49", outline=INK)
    pen.line((28, 32, 35, 32), fill="#df9d67")
    if style == "cudgel":
        blade = [(40, 28), (55, 22), (60, 24), (61, 34), (58, 39), (42, 36)]
        pen.polygon(blade, fill="#906657", outline=INK)
        pen.line([(43, 29), (55, 24), (59, 26)], fill="#df9d67", width=2)
        pen.line((54, 24, 56, 37), fill="#695267", width=3)
    else:
        blade = {
            "rapier": [(40, 30), (62, 31), (40, 33)],
            "greatsword": [(40, 25), (54, 25), (62, 31), (54, 38), (40, 38)],
            "halberd": [(43, 28), (54, 22), (59, 14), (60, 22), (56, 31),
                        (59, 40), (56, 47), (48, 37), (43, 36)],
        }[style]
        pen.polygon(blade, fill="#9eb0c6", outline=INK)
        pen.line((40, 31, 59, 31), fill=WHITE)
        pen.rectangle((37, 26, 40, 37), fill="#d5a456", outline=INK)
    if frame == 2:
        spark(pen, 56, 27, 5, WHITE)


def throw_knife(pen, frame):
    pen.rectangle((23, 29, 36, 34), fill=INK)
    pen.line((24, 31, 35, 31), fill="#a26d5c", width=2)
    pen.rectangle((35, 26, 38, 37), fill=INK)
    pen.polygon([(38, 27), (50, 29), (57, 31), (49, 36), (38, 36)],
                fill=STEEL[1], outline=INK)
    pen.line((38, 34, 50, 34, 54, 31), fill=STEEL[2])
    if frame == 1:
        spark(pen, 53, 28, 5, AMBER[2])


def bolt(pen, frame, palette, big=False):
    dark, main, light = palette
    r = (8 if big else 4) + (frame % 2)
    start = 9 if big else 16
    tail = [(start, 32), (27, 28), (32, 32-r-2), (42+r, 32),
            (32, 34+r), (25, 36), (start+3, 36)]
    pen.polygon(tail, fill=dark)
    pen.polygon([(start+5, 32), (33, 32-r), (41+r, 32), (33, 32+r)],
                fill=main)
    pen.polygon([(29, 32), (34, 28), (38+r, 32), (34, 36)], fill=light)
    spark(pen, start+frame*3, 24+(frame % 2)*14, 1+frame % 3, main)
    if big:
        pen.line((23, 26, 12, 28), fill=light)
        pen.line((29, 40, 17, 39), fill=main)


def arrow(pen, frame, palette, big=False, knife=False):
    dark, main, light = palette
    if knife:
        pen.rectangle((22, 30, 29, 34), fill=INK)
        pen.rectangle((23, 31, 28, 33), fill="#b07a59")
        pen.polygon([(29, 29), (39, 29), (44, 31), (39, 35), (29, 35)],
                    fill=light, outline=INK)
        pen.line((31, 33, 39, 33), fill=main)
        spark(pen, 42, 27-frame, 2+frame % 2, AMBER[1])
        return
    start = 9 if big else 17
    pen.polygon([(start, 27), (start+9, 30), (38, 30), (38, 27),
                 (47, 32), (38, 37), (38, 34), (start+9, 34),
                 (start, 37), (start+3, 32)], fill=dark, outline=INK)
    pen.line((start+3, 32, 42, 32), fill=main, width=2)
    pen.polygon([(39, 29), (45, 32), (39, 34)], fill=light)
    pen.line((start+1, 27-frame, start+12, 27-frame), fill=main)
    if big:
        pen.line((12, 38+frame, 33, 38+frame), fill=light, width=2)


def impact(pen, frame, palette):
    dark, main, light = palette
    r = 6 + frame*5
    for i in range(7):
        a = i*2*pi/7 + 0.1
        reach = r + (i % 3)*3
        x, y = 32+round(cos(a)*reach), 32+round(sin(a)*reach)
        if frame < 2:
            pen.line((32, 32, x, y), fill=dark, width=4)
            pen.line((32, 32, x, y), fill=main, width=2)
        spark(pen, x, y, 3-frame//2, light if i % 2 == 0 else main)
    if frame < 2:
        spark(pen, 32, 32, 8-frame*2, light)


def mend(pen, frame):
    dark, main, light = MINT
    r = 10 + frame*6
    y = 45-frame*2
    pen.ellipse((32-r, y-5, 32+r, y+5), outline=dark, width=4)
    pen.ellipse((32-r, y-5, 32+r, y+5), outline=main)
    for i, dx in enumerate((-14, 0, 14)):
        x, y = 32+dx+frame*(i-1), 30-frame*4-7*(i % 2)
        size = 3+(i % 2)
        pen.rectangle((x-1, y-size, x+1, y+size), fill=light)
        pen.rectangle((x-size, y-1, x+size, y+1), fill=light)
        spark(pen, x-3, y+10, 2, main)


def cut(pen, frame, palette, shape):
    dark, main, light = palette
    if shape == "thrust":
        w = 18 + frame*3
        pen.polygon([(32-w, 32), (50, 28), (60, 32), (50, 36)], fill=dark)
        pen.polygon([(31-w, 32), (50, 30), (60, 32), (50, 34)], fill=main)
        pen.line((46-frame*6, 32, 56, 32), fill=light)
        return
    if shape == "heavy":
        r = 8+frame*6
        pen.arc((32-r, 28, 32+r, 42+frame), 12, 338, fill=dark, width=5)
        pen.arc((32-r, 28, 32+r, 42+frame), 12, 338, fill=main, width=2)
        for i, dx in enumerate((-12, 0, 12)):
            spark(pen, 32+dx+frame*(i-1), 28-frame*4-(i % 2)*4, 4-frame//2, light)
        return
    # A tapered crescent. The leading edge sweeps toward the angle of impact.
    radius = 22 + frame*2
    start = -1.2 + frame*.39
    end = start + (1.85 if shape == "arc" else 1.4)
    angles = [start+(end-start)*i/10 for i in range(11)]
    outer = [(31+round(cos(a)*radius), 32+round(sin(a)*radius)) for a in angles]
    inner = [(31+round(cos(a)*(radius-min(i, 10-i))),
              32+round(sin(a)*(radius-min(i, 10-i)))) for i, a in enumerate(angles)]
    pen.polygon(outer + inner[::-1], fill=dark)
    pen.line(outer[1:-1], fill=main, width=2)
    pen.line(outer[3:8], fill=light)
    if frame >= 1:
        spark(pen, *outer[-2], 3, light)


ROWS = [
    lambda p, t: staff(p, t, False),  # mage, healer, bow, shadow bow
    lambda p, t: staff(p, t, True),
    lambda p, t: bow(p, t, False),
    lambda p, t: bow(p, t, True),
    scimitar, mace,
    lambda p, t: bolt(p, t, VIOLET),  # mage bolt, healer bolt, arrow
    lambda p, t: bolt(p, t, MINT),
    lambda p, t: arrow(p, t, SKY),
    lambda p, t: bolt(p, t, VIOLET, big=True),
    lambda p, t: arrow(p, t, SKY, big=True),
    lambda p, t: arrow(p, t, AMBER),
    lambda p, t: arrow(p, t, STEEL, knife=True),
    mend,                           # heal, mage impact, healer impact, arrow impact, enemy impact
    lambda p, t: impact(p, t, VIOLET),
    lambda p, t: impact(p, t, MINT),
    lambda p, t: impact(p, t, SKY),
    lambda p, t: impact(p, t, AMBER),
    lambda p, t: impact(p, t, STEEL), # melee impact
    lambda p, t: cut(p, t, SKY, "arc"),
    lambda p, t: cut(p, t, AMBER, "heavy"),
    lambda p, t: cut(p, t, STEEL, "thrust"),
    lambda p, t: cut(p, t, ("#694a45", "#efa769", WHITE), "chop"),
    lambda p, t: cut(p, t, VIOLET, "arc"),
    lambda p, t: staff(p, t, False, "wand"),
    lambda p, t: staff(p, t, False, "rod"),
    lambda p, t: staff(p, t, False, "scepter"),
    lambda p, t: staff(p, t, True, "rod"),
    lambda p, t: staff(p, t, True, "scepter"),
    crossbow,
    lambda p, t: melee(p, t, "rapier"),
    lambda p, t: melee(p, t, "greatsword"),
    lambda p, t: melee(p, t, "cudgel"),
    lambda p, t: melee(p, t, "halberd"),
    lambda p, t: melee(p, t, "twin-blades"),
    throw_knife,
]

if __name__ == "__main__":
    atlas = Image.new("RGBA", (CELL*8, CELL*((len(ROWS)+1)//2)))
    for row, draw in enumerate(ROWS):
        for frame in range(4):
            cell = Image.new("RGBA", (CELL, CELL))
            draw(ImageDraw.Draw(cell), frame)
            atlas.paste(cell, ((frame+(row % 2)*4)*CELL, (row//2)*CELL))
    # Index the small hand-drawn palette without altering any pixels.
    colors = sorted({color for _, color in atlas.getcolors(256)})
    indices = {color: i for i, color in enumerate(colors)}
    indexed = Image.frombytes("P", atlas.size, bytes(indices[color] for color in atlas.getdata()))
    indexed.putpalette([channel for color in colors for channel in color[:3]])
    out = Path(__file__).resolve().parents[1] / "public/assets/fx/combat.png"
    indexed.save(out, optimize=True, transparency=bytes(color[3] for color in colors))
