#!/usr/bin/env python3
"""Pack the playable Sproto Fighter roster into stage-local Shadow sprite sheets.

Usage: python3 tools/import-shadow-roster.py /path/to/Sproto-Fighter [revision]
Reads only git objects in the source repository. Requires Pillow.
"""
import argparse
import ast
import io
import json
import re
import subprocess
from collections import Counter
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[1]
CELL = 64
FOOT = (32, 56)
SCALE = 1.6
STAGES = 12
COLUMNS = 14
PALETTE = (
    (13, 9, 24), (24, 17, 41), (39, 28, 61), (57, 41, 84), (78, 57, 108),
    (103, 76, 134), (132, 102, 160), (157, 132, 183), (183, 162, 204),
)
DETAIL = ((30, 16, 32), (163, 64, 120), (102, 90, 184), (215, 168, 235))
STAGE_STARTS = ('buddhashadow', 'rivet', 'sproto2075', 'vamp', 'sproto3106', 'duo')
RANGED_ROLES = {'DOUBLE SHOT', 'LASER', 'LASER CAPTAIN', 'SHADOW POISE', 'SHOUT', 'SIEGE', 'SNIPER',
                'SPITTER', 'STAFF', 'THROWER', 'TWIN EMITTER', 'ZONING', 'ORANGE AURA'}
RASTER_SHOTS = {
    'referenceB': 'sproto3106-reference-b.png', 'miniSproto': 'sproto2531-mini.png',
    'ethereum': 'vitalik-ethereum.png', 'joint': 'highsproto-weed-leaf.png',
    'chadCoin': 'chad-retain-coin.png',
}


class Source:
    def __init__(self, repository, revision):
        self.repository = repository
        self.commit = self.git('rev-parse', revision + '^{commit}').decode().strip()
        self.batch = subprocess.Popen(
            ['git', '-C', str(repository), 'cat-file', '--batch'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        )

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repository), *args])

    def text(self, path):
        return self.git('show', self.commit + ':' + path).decode()

    def image(self, path):
        request = f"{self.commit}:public/{path.lstrip('/')}"
        self.batch.stdin.write(request.encode() + b'\n')
        self.batch.stdin.flush()
        header = self.batch.stdout.readline().split()
        if len(header) != 3 or header[1] != b'blob':
            raise ValueError(f'Missing Fighter image: {path}')
        data = self.batch.stdout.read(int(header[2]))
        if self.batch.stdout.read(1) != b'\n':
            raise ValueError(f'Incomplete git image: {path}')
        with Image.open(io.BytesIO(data)) as im:
            return im.convert('RGBA')

    def close(self):
        self.batch.stdin.close()
        if self.batch.wait() != 0:
            raise RuntimeError('git cat-file failed')


def js_json(text, name):
    declaration = next(line for line in text.splitlines()
                       if line.startswith(('const ' + name + ':', 'export const ' + name + ':')))
    return json.loads(declaration[declaration.index(' = ') + 3:].removesuffix(';'))


def roster(roster_text):
    line = next(line for line in roster_text.splitlines() if line.startswith('export const PLAYABLE_FIGHTERS = '))
    order = re.findall(r"""['"]([a-z0-9]+)['"]""", line)
    paired = js_json(roster_text, 'PAIRED_BODY_IDS')
    block = roster_text.split('export const ROSTER:', 1)[1].split('};', 1)[0]
    declarations = list(re.finditer(r'^\s*(?:"([a-z0-9]+)"|([a-z0-9]+))\s*:\s*\{', block, re.MULTILINE))
    data = {}
    for index, row in enumerate(declarations):
        end = declarations[index + 1].start() if index + 1 < len(declarations) else len(block)
        body = block[row.end():end]
        values = {}
        for field in ('name', 'role'):
            match = re.search(r"""(?:["']?\b""" + field + r"""["']?)\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')""", body)
            if not match:
                break
            literal = match.group(1)
            values[field] = json.loads(literal) if literal.startswith('"') else ast.literal_eval(literal)
        if len(values) == 2:
            data[row.group(1) or row.group(2)] = values
    if not order or len(set(order)) != len(order) or set(order) - set(data):
        raise ValueError(f'Could not read complete Fighter roster: {set(order) - set(data)}')
    return order, data, paired


def entry_url(entry):
    return entry if isinstance(entry, str) else entry['url']


def cast_frames(cfg):
    clips = cfg.get('clips', {})
    if clips.get('ranged'):
        return [clips['ranged'][1], clips['ranged'][3], clips['ranged'][7]], 'ranged'
    if clips.get('cast'):
        return [clips['cast'][1], clips['cast'][2], clips['cast'][3]], 'cast'
    return [cfg['frames'][29], cfg['frames'][30], cfg['frames'][13]], None


def body_frames(cfg):
    poses = cfg['frames']
    walk = cfg.get('walkFrames') or poses[2:6]
    walk = [walk[i * len(walk) // 4] for i in range(4)]
    cast, clip = cast_frames(cfg)
    clip_registration = cfg.get('clipRegistration', {}).get(clip, {})
    pose_registration = cfg.get('poseRegistration', {})
    if clip is None:
        cast_registration = [pose_registration.get(slot, {}) for slot in ('powerCharge', 'powerRelease', 'punchRecover')]
    else:
        cast_registration = [clip_registration] * 3
    return [(poses[0], pose_registration.get('guard', {}))] + [(f, cfg.get('walkRegistration', {})) for f in walk] + [
        (poses[i], pose_registration.get(slot, {})) for i, slot in
        [(11, 'punchWindup'), (12, 'punchExtended'), (13, 'punchRecover')]
    ] + list(zip(cast, cast_registration)) + [
        (poses[24], pose_registration.get('hit', {})), (poses[24], pose_registration.get('hit', {})),
    ]


def grade(im):
    out = Image.new('RGBA', im.size)
    colors = []
    for red, green, blue, alpha in im.getdata():
        if alpha < 80:
            colors.append((0, 0, 0, 0))
            continue
        light = (red * 54 + green * 183 + blue * 19) // 256
        band = min(len(PALETTE) - 1, light * len(PALETTE) // 256)
        r, g, b = PALETTE[band]
        if band >= 3:
            # Carry a little relative warmth through the same Shadow palette.
            delta = 7 if red - blue > 35 else -6 if blue - red > 35 else 0
            r += delta
            b -= delta // 2
        colors.append((r, g, b, 255))
    out.putdata(colors)
    return out


def body(source, cfg, entry, registration, density, offset):
    frame = source.image(entry_url(entry))
    ax, ay = entry.get('anchor', cfg['anchor']) if isinstance(entry, dict) else cfg['anchor']
    face = cfg.get('facing', 1)
    dx, dy = registration.get('anchorOffset', (0, 0))
    k = density * registration.get('pixelScale', 1)
    box = frame.getchannel('A').getbbox()
    if not box:
        raise ValueError(f'Empty Fighter frame: {entry_url(entry)}')
    frame = frame.crop(box)
    left, top = box[:2]
    if face < 0:
        frame = ImageOps.mirror(frame)
        left = ax * 2 - box[2]
    frame = frame.resize((max(1, round(frame.width * k)), max(1, round(frame.height * k))), Image.Resampling.NEAREST)
    x = round(FOOT[0] + offset + (left - ax + dx * face) * density)
    y = round(FOOT[1] + (top - ay + dy) * density)
    return grade(frame), (x, y)


def falling(im):
    box = im.getchannel('A').getbbox()
    turn = im.crop(box).transpose(Image.Transpose.ROTATE_270)
    out = Image.new('RGBA', im.size)
    out.alpha_composite(turn, (FOOT[0] - turn.width // 2, FOOT[1] - turn.height))
    return out


def projectile(source, ident, shape, signatures, icons):
    out = Image.new('RGBA', (CELL, CELL))
    draw = ImageDraw.Draw(out)
    if shape.startswith('signature:'):
        item = signatures[shape.split(':')[1]]
        tint = ImageColor.getrgb(item['color'])
        base = tuple((c + s * 2) // 3 for c, s in zip(tint, DETAIL[2]))
        for name, ox, oy, step in [(item['icon'], 29, 33, 2), (item['detail'], 39, 27, 1)]:
            rows = icons[name]
            width = max(map(len, rows))
            colors = {'a': DETAIL[0], 'b': base, 'c': DETAIL[3]}
            for y, row in enumerate(rows):
                for x, mark in enumerate(row):
                    if mark in colors:
                        x0 = ox + (x - width // 2) * step
                        y0 = oy + (y - len(rows) // 2) * step
                        draw.rectangle((x0, y0, x0 + step - 1, y0 + step - 1), fill=colors[mark])
    elif shape in RASTER_SHOTS:
        raster = source.image('fighters/powers/' + RASTER_SHOTS[shape])
        raster = raster.crop(raster.getchannel('A').getbbox())
        raster.thumbnail((24, 24), Image.Resampling.NEAREST)
        out.alpha_composite(grade(raster), ((CELL - raster.width) // 2, (CELL - raster.height) // 2))
    elif shape in ('darkRing', 'ring', 'orb') or ident == 'buddhashadow':
        draw.ellipse((21, 22, 42, 41), outline=DETAIL[2], width=3)
        draw.arc((21, 22, 42, 41), 175, 300, fill=DETAIL[3], width=2)
        draw.arc((24, 25, 39, 38), 0, 195, fill=DETAIL[0], width=2)
    elif shape == 'twin':
        draw.rectangle((18, 25, 31, 29), fill=DETAIL[1])
        draw.rectangle((18, 33, 31, 37), fill=DETAIL[2])
        draw.polygon([(29, 24), (39, 26), (45, 31), (39, 36), (29, 39)], fill=DETAIL[0])
        draw.rectangle((35, 29, 42, 33), fill=DETAIL[3])
    elif shape in ('eyeLaser', 'pelvicStream', 'needle', 'prism', 'arrow'):
        draw.polygon([(16, 27), (36, 27), (46, 32), (36, 36), (16, 36), (22, 32)], fill=DETAIL[2])
        draw.rectangle((27, 30, 41, 32), fill=DETAIL[3])
    else:
        draw.polygon([(16, 34), (22, 27), (32, 24), (41, 29), (46, 32), (37, 39), (26, 40)],
                     fill=DETAIL[2], outline=DETAIL[0], width=2)
        draw.polygon([(25, 33), (32, 27), (42, 31), (32, 35)], fill=DETAIL[3])
    return out


def target_density(source, cfg, paired):
    base = cfg['frames'][0]
    idle = source.image(entry_url(base))
    box = idle.getchannel('A').getbbox()
    if not box:
        raise ValueError(f'Empty Fighter guard frame: {entry_url(base)}')
    height = box[3] - box[1]
    width = box[2] - box[0]
    return min((34 if paired else 39) / height, (30 if paired else 54) / width)


def place_row(sheet, row, source, atlases, meta, pair, shape, signatures, icons):
    row_y = row * CELL
    configs = [atlases[body_id] for body_id in pair]
    layouts = list(map(body_frames, configs))
    density = target_density(source, configs[0], len(pair) > 1)
    # Both twins use the lead actor's density, keeping their relative sizes.
    offsets = [0] if len(pair) == 1 else [-9, 9]
    for col in range(COLUMNS - 1):
        frame = Image.new('RGBA', (CELL, CELL))
        for i, cfg in enumerate(configs):
            entry, registration = layouts[i][col]
            sprite, where = body(source, cfg, entry, registration, density, offsets[i])
            # Draw both actors in authored scale around the shared foot.
            frame.alpha_composite(sprite, where)
        if col == 12:
            frame = falling(frame)
        if not frame.getbbox():
            raise ValueError(f'No visible pixels in {meta["id"]} pose {col}')
        sheet.alpha_composite(frame, (col * CELL, row_y))
    sheet.alpha_composite(projectile(source, meta['id'], shape, signatures, icons), ((COLUMNS - 1) * CELL, row_y))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('revision', default='origin/main', nargs='?')
    args = parser.parse_args()
    source = Source(args.source, args.revision)
    try:
        roster_text = source.text('src/sim/roster.ts')
        ids, data, paired = roster(roster_text)
        atlases = json.loads(source.text('public/fighters/pose-atlas.json'))['fighters']
        actions = json.loads(source.text('src/sim/data/character-actions.json'))
        signature_shapes = json.loads(source.text('src/sim/data/signature-projectiles.json'))
        power = source.text('src/powerArt.ts')
        signatures, icons = js_json(power, 'SIGNATURE_OBJECTS'), js_json(power, 'SIGNATURE_ICONS')
        shapes = {ident: signature_shapes.get(ident, actions.get(ident, {}).get('originalProjectile', 'spark')) for ident in ids}
        shapes['buddhashadow'] = 'darkRing'
        shapes['d86'] = shapes['lowernipple'] = 'twin'

        roles = {}
        for ident in ids:
            authored = data[ident]['role']
            roles[ident] = 'twin' if ident in paired else 'ranged' if (
                authored in RANGED_ROLES or ident in signature_shapes or shapes[ident] in RASTER_SHOTS
            ) else 'melee'
        stages = [[] for _ in range(STAGES)]
        reserved = set(STAGE_STARTS)
        for stage, ident in enumerate(STAGE_STARTS):
            stages[stage].append(ident)
        # Spread roles and source roster order throughout the campaign.
        for role in ('melee', 'ranged', 'twin'):
            for ident in (ident for ident in ids if roles[ident] == role and ident not in reserved):
                stage = min(range(STAGES), key=lambda n: (sum(roles[i] == role for i in stages[n]), len(stages[n]), n))
                stages[stage].append(ident)
        for i, stage in enumerate(stages):
            first = stage[:1]
            rest = stage[1:]
            melee = [ident for ident in rest if roles[ident] == 'melee']
            ranged = [ident for ident in rest if roles[ident] == 'ranged']
            twins = [ident for ident in rest if roles[ident] == 'twin']
            for ident in twins:
                ranged.insert(len(ranged) // 2, ident)
            lineup = first
            while melee or ranged:
                lineup.extend(melee[:2])
                del melee[:2]
                if ranged:
                    lineup.append(ranged.pop(0))
            stages[i] = lineup
        assert sorted(ident for stage in stages for ident in stage) == sorted(ids)

        dest = ROOT / 'public/assets/shadows'
        dest.mkdir(parents=True, exist_ok=True)
        sheets = []
        rows = []
        for i, stage in enumerate(stages):
            # manifest.js names the sheet .png (it is pinned); the file is lossless WebP and
            # AssetLoader.shadowSheet maps the name. Rename both when manifest.js is next re-pinned.
            name = f'{i + 1:02}.png'
            sheet = Image.new('RGBA', (COLUMNS * CELL, len(stage) * CELL))
            entries = [{'id': ident, 'name': data[ident]['name'], 'role': roles[ident]} for ident in stage]
            for row, meta in enumerate(entries):
                ident = meta['id']
                place_row(sheet, row, source, atlases, meta, paired.get(ident, [ident]), shapes[ident], signatures, icons)
            quantized = sheet.quantize(colors=128, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
            quantized.convert('RGBA').save(dest / name.replace('.png', '.webp'), format='WEBP',
                                           lossless=True, quality=100, method=6, exact=True)
            sheets.append('assets/shadows/' + name)
            rows.append(entries)
        info = {'source': source.commit, 'cell': CELL, 'foot': FOOT, 'scale': SCALE, 'sheets': sheets, 'stages': rows}
        (ROOT / 'tools/shadow-roster.json').write_text(json.dumps(info, ensure_ascii=True, indent=2) + '\n')
        print(f'{len(ids)} Fighter identities, {dict(Counter(roles.values()))}, {sum((ROOT / "public" / name.replace(".png", ".webp")).stat().st_size for name in sheets)} bytes')
    finally:
        source.close()


if __name__ == '__main__':
    main()
