#!/usr/bin/env python3
"""Import ten complete playable bodies and authored motion from Sproto Fighter's Git objects."""
import argparse
import importlib.util
import json
import random
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SHADOW_TOOL = ROOT / 'tools/import-shadow-roster.py'
spec = importlib.util.spec_from_file_location('shadow', SHADOW_TOOL)
shadow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shadow)

ORIGINAL = ('sproto3106', 'vamp', 'guest09', 'guest10', 'rivet', 'dumpstar')
SOURCE_REVISION = '0e9af1967a9bd80c9eac5b66e415860e97d77f7a'
SEED = 20261115
CELL = 64
COLS = 8
POSE_NAMES = ('guard', 'breathe', 'walkNear', 'passNear', 'walkFar', 'passFar', 'dash', 'jumpAnticipation',
              'airRise', 'airFall', 'crouchLanding', 'punchWindup', 'punchExtended', 'punchRecover', 'upperWindup',
              'uppercut', 'kickChamber', 'kickHalf', 'kickFull', 'kickRecover', 'sweep', 'sweepRecover', 'airKickChamber',
              'airKickFull', 'hit', 'block', 'grabReach', 'grabHold', 'throwRelease', 'powerCharge', 'powerRelease', 'special')
# Sample the authored sequences at their key poses. The playback timing is set by Coop's move windows.
MOTION = {'cast': (0, 1, 2, 3), 'ranged': (0, 2, 4, 7), 'recoil': (0, 1, 3), 'special': (0, 2, 4, 6),
          'dash': (0, 2, 4), 'jump': (0, 1, 3, 5), 'heavy': (0, 2, 3, 5, 7), 'airKick': (0, 2, 4, 5)}


def alpha_box(im):
    return im.getchannel('A').point(lambda a: 255 if a >= 100 else 0).getbbox()


def register(source, config, entry, calibration, density, foot):
    raw = source.image(shadow.entry_url(entry))
    ax, ay = entry.get('anchor', config['anchor']) if isinstance(entry, dict) else config['anchor']
    face = config.get('facing', 1)
    dx, dy = calibration.get('anchorOffset', (0, 0))
    box = alpha_box(raw)
    if box is None:
        raise ValueError(f'Empty frame {shadow.entry_url(entry)}')
    body = raw.crop(box)
    left, top = box[:2]
    if face < 0:
        body = ImageOps.mirror(body)
        left = ax * 2 - box[2]
    scale = density * calibration.get('pixelScale', 1)
    body = body.resize((max(1, round(body.width * scale)), max(1, round(body.height * scale))), Image.Resampling.NEAREST)
    x = round(foot[0] / 2 + (left - ax + dx * face) * density)
    y = round(foot[1] / 2 + (top - ay + dy) * density)
    tile = Image.new('RGBA', (CELL, CELL))
    tile.alpha_composite(body, (x, y))
    if alpha_box(tile) is None:
        raise ValueError(f'Frame registered outside its cell: {shadow.entry_url(entry)}')
    return tile


def grip(cell):
    mask = cell.getchannel('A')
    left, top, right, bottom = alpha_box(cell)
    height = bottom - top
    points = []
    for y in range(top + int(height * .30), top + max(1, int(height * .62))):
        for x in range(right - 1, left - 1, -1):
            if mask.getpixel((x, y)) >= 100:
                points.append((x, y))
                break
    x, y = max(points, default=((left + right) // 2 + 4, top + int(height * .45)))
    return [x * 2, y * 2]


def save(sheet, filename):
    filename.parent.mkdir(parents=True, exist_ok=True)
    # Preserve transparency and cap per-sheet colors for compact pixel-art transfers.
    sheet.quantize(colors=240, method=Image.Quantize.FASTOCTREE,
                   dither=Image.Dither.NONE).save(filename, optimize=True)


def pack(cells, filename):
    atlas = Image.new('RGBA', (COLS * CELL, ((len(cells) + COLS - 1) // COLS) * CELL))
    for i, tile in enumerate(cells):
        atlas.alpha_composite(tile, (i % COLS * CELL, i // COLS * CELL))
    save(atlas, filename)


def portrait(sheet, index, tile):
    left, top, right, bottom = alpha_box(tile)
    # Portraits use the head and shoulders, with position derived from the guard pose.
    fragment = tile.crop((left, top, right, top + max(1, (bottom - top) * 3 // 5)))
    fragment.thumbnail((26, 26), Image.Resampling.NEAREST)
    x = index % 8 * 28 + (28 - fragment.width) // 2
    y = index // 8 * 28 + (28 - fragment.height) // 2
    sheet.alpha_composite(fragment, (x, y))


def make_fighter(source, config, meta, fid, original):
    base = source.image(shadow.entry_url(config['frames'][0]))
    base_box = alpha_box(base)
    if original:
        original_guard = Image.open(ROOT / 'art/fighter-poses' / fid / '00.png').convert('RGBA')
        x0, y0, x1, y1 = original_guard.getchannel('A').getbbox()
        foot = [(x0 + x1) // 2, y1]
        height = (y1 - y0) / 2
    else:
        foot, height = [64, 108], 34
    density = min(height / (base_box[3] - base_box[1]), 39 / (base_box[2] - base_box[0]))
    cells = []
    if not original:
        registration = config.get('poseRegistration', {})
        for name, entry in zip(POSE_NAMES, config['frames']):
            cells.append(register(source, config, entry, registration.get(name, {}), density, foot))
        for entry in config['walkFrames'][:8]:
            cells.append(register(source, config, entry, config.get('walkRegistration', {}), density, foot))
    clips = {}
    available = config.get('clips', {})
    for name, indexes in MOTION.items():
        if name not in available:
            continue
        if original and name in ('dash', 'jump', 'heavy', 'airKick'):
            continue
        clips[name] = [len(cells) + (40 if original else 0), len(indexes)]
        for i in indexes:
            calibration = config.get('clipRegistration', {}).get(name, {})
            cells.append(register(source, config, available[name][i], calibration, density, foot))
    guard = register(source, config, config['frames'][0], {}, density, foot)
    folder = ROOT / 'public/assets/fighters' / fid
    if cells:
        pack(cells, folder / ('motion.png' if original else 'atlas.png'))
    hands = [grip(tile) for tile in cells]
    if original:
        return {'clips': clips, 'motionHands': hands} if cells else {}, guard
    return {'id': fid, 'name': meta['name'], 'foot': foot, 'box': [2 * a for a in alpha_box(guard)],
            'cell': CELL, 'hands': hands[:40], 'motionHands': hands[40:], 'clips': clips}, guard


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repository', type=Path)
    parser.add_argument('revision', nargs='?', default=SOURCE_REVISION)
    args = parser.parse_args()
    source = shadow.Source(args.repository, args.revision)
    try:
        order, metadata, paired = shadow.roster(source.text('src/sim/roster.ts'))
        configs = json.loads(source.text('public/fighters/pose-atlas.json'))['fighters']
        candidates = [fid for fid in order if fid not in ORIGINAL and fid not in paired
                      and len(configs[fid].get('walkFrames', [])) >= 8
                      and sum(len(configs[fid].get('clips', {}).get(name, [])) for name in MOTION if name != 'special') >= 18]
        chosen = random.Random(SEED).sample(sorted(candidates), 10)
        originals = {}
        additions = []
        portraits = Image.new('RGBA', (8 * 28, 2 * 28))
        for index, fid in enumerate((*ORIGINAL, *chosen)):
            row, guard = make_fighter(source, configs[fid], metadata[fid], fid, index < len(ORIGINAL))
            portrait(portraits, index, guard)
            if index < len(ORIGINAL):
                if row:
                    originals[fid] = row
            else:
                additions.append(row)
        save(portraits, ROOT / 'public/assets/fighters/portraits.png')
        output = {'commit': source.commit, 'seed': SEED, 'additions': additions, 'originals': originals}
        (ROOT / 'tools/playable-roster.json').write_text(json.dumps(output, separators=(',', ':')) + '\n', encoding='utf-8')
        print(f'{source.commit}: {", ".join(chosen)}')
    finally:
        source.close()


if __name__ == '__main__':
    main()
