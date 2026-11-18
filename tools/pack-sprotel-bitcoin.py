#!/usr/bin/env python3
"""Pack original 2x2 mech / 4x4 projectile sheets; never redraw the source art.

176px actor cells keep both added phases within the existing 10 MiB client budget.
Actors face left at runtime; source sheets face right. The pilot's red cockpit
anchors the poses independently of an extended arm, bill, or tail.
"""
from pathlib import Path
from PIL import Image, ImageOps
from statistics import median
import json

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'art/sprotel-bitcoin'
OUT = ROOT / 'public/assets/bosses'
CELL, FOOT = 176, 165
ACTORS = {
    'p1': [('idle', 'walk')] + [(a+'-a', a+'-b') for a in
        ['snacks', 'beer', 'cocktails', 'drinks', 'marlin', 'charge', 'sweep']]
        + [('hit', 'death'), ('transform-a', 'transform-b')],
    'p2': [('idle', 'swim'), ('laser-a', 'laser-b'), ('missile-a', 'missile-b'),
        ('bubbles-a', 'bubbles-b'), None, None, ('charge-a', 'charge-b'),
        ('sweep-a', 'sweep-b'), ('hit', 'death')],
}
EFFECTS = {'p1': ['snack-fx', 'beer-fx', 'cocktail-fx', 'drinks-fx', 'marlin-fx', 'impact-fx'],
           'p2': ['laser-fx', 'missile-fx', 'bubble-fx', 'impact-fx']}


def frames(phase, name, grid):
    sheet = Image.open(RAW / phase / (name+'.png')).convert('RGBA')
    return [sheet.crop((round(c*sheet.width/grid), round(r*sheet.height/grid),
                        round((c+1)*sheet.width/grid), round((r+1)*sheet.height/grid)))
            for r in range(grid) for c in range(grid)]


def actor_frame(im):
    box = im.getchannel('A').point(lambda a: 255 if a > 100 else 0).getbbox()
    if not box:
        raise ValueError('empty actor')
    # The red seat, hat and nose remain at the same mechanical center in both forms.
    red = [(x, y) for y in range(int(im.height*.10), int(im.height*.57))
           for x in range(int(im.width*.20), int(im.width*.76))
           if (lambda p: p[3] > 180 and p[0] > 135 and p[0] > p[1]*1.8 and p[0] > p[2]*1.5)(im.getpixel((x,y)))]
    if not red:
        raise ValueError('missing visible pilot/cockpit')
    px, py = median(x for x,y in red), median(y for x,y in red)
    scale = 152/(im.height*.94)
    # Fit whole actor without squashing its proportions or cutting off a bill/hand.
    scale = min(scale, 82/max(px-box[0], box[2]-px), 157/max(1, box[3]-py))
    tile = im.resize((round(im.width*scale), round(im.height*scale)), Image.Resampling.LANCZOS)
    cell = Image.new('RGBA', (CELL,CELL))
    cell.alpha_composite(tile, (round(CELL/2-px*scale), round(62-py*scale)))
    return ImageOps.mirror(cell)


layouts = {}
for phase, rows in ACTORS.items():
    actor = Image.new('RGBA', (CELL*8,CELL*len(rows)))
    count = 0
    for row,names in enumerate(rows):
        if names is None:
            continue
        cells = sum([frames(phase,name,2) for name in names],[])
        if phase == 'p1' and row == 9:
            cells = [cells[i] for i in [0,1,4,2,5,6,3,7]]
        for col,im in enumerate(cells):
            actor.alpha_composite(actor_frame(im),(col*CELL,row*CELL)); count += 1
    # Preserve generated alpha while sharing a palette across all frames.
    actor = actor.quantize(colors=128,method=Image.Quantize.FASTOCTREE,
                           dither=Image.Dither.NONE).convert('RGBA')
    key = '13-last-call-sprotelbitcoin-'+phase
    actor.save(OUT/(key+'.webp'),lossless=True,exact=True,method=6)
    effects = EFFECTS[phase]
    fx = Image.new('RGBA',(64*16,64*len(effects)))
    for row,name in enumerate(effects):
        cells = frames(phase,name,4)
        boxes = [im.getchannel('A').point(lambda a:255 if a>80 else 0).getbbox() for im in cells]
        max_edge = max(max(b[2]-b[0],b[3]-b[1]) for b in boxes if b)
        scale = 58/max_edge
        for col,im in enumerate(cells):
            tile = im.resize((max(1,round(im.width*scale)),max(1,round(im.height*scale))),Image.Resampling.LANCZOS)
            cell = Image.new('RGBA',(64,64))
            cell.alpha_composite(tile,(round(32-im.width*scale/2),round(32-im.height*scale/2)))
            fx.alpha_composite(cell,(col*64,row*64))
    fx.quantize(colors=128,method=Image.Quantize.FASTOCTREE,dither=Image.Dither.NONE).save(
        OUT/(key+'-projectiles.png'),optimize=True)
    layouts[phase] = {'actor':{'cell':CELL,'columns':8,'rows':rows,'frames':count,'foot':[CELL//2,FOOT]},
                      'projectiles':{'cell':64,'columns':16,'rows':effects,'frames':16*len(effects)}}
    for path in [OUT/(key+'.webp'),OUT/(key+'-projectiles.png')]:
        print(path.name,path.stat().st_size,'bytes')
meta={'phases':layouts,'generation':{'actors':'2x2','projectiles':'4x4','tool':'image_gen','phaseCount':2}}
(RAW/'layout.json').write_text(json.dumps(meta,indent=2)+'\n')
