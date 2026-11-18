#!/usr/bin/env python3
"""Pack complete authored cels; deduplicate identical frames across state clips.

No poses are synthesized. Input cells and their integer tick durations are kept
exactly. Clips can share immutable, bounded atlas pages using explicit cell lists.
"""
from argparse import ArgumentParser
import hashlib
import json
import math
from pathlib import Path
import re
import tempfile

from PIL import Image, ImageChops


def digest(data):
    return hashlib.sha256(data).hexdigest()


def positive(value):
    return type(value) is int and value > 0


def pack(spec_path, output, provenance_path):
    spec_path, output, provenance_path = map(Path, (spec_path, output, provenance_path))
    spec = json.loads(spec_path.read_text())
    name, prefix = spec['id'], spec['assetPrefix']
    if not isinstance(name, str) or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', name):
        raise ValueError('A portable lowercase sprite-set id is required')
    if not isinstance(prefix, str) or not re.fullmatch(r'assets/[a-z0-9_-]+(?:/[a-z0-9_-]+)*', prefix):
        raise ValueError('An assets/ URL prefix without traversal is required')
    cell, anchor = spec['cell'], spec['anchor']
    if not isinstance(cell, list) or len(cell) != 2 or not all(positive(n) for n in cell):
        raise ValueError('Cell must have two positive integer dimensions')
    if not isinstance(anchor, list) or len(anchor) != 2 or any(
            type(n) is not int or not 0 <= n < cell[i] for i, n in enumerate(anchor)):
        raise ValueError('Anchor must be inside the cell')
    columns, capacity = spec.get('columns', 8), spec.get('pageFrames', 24)
    if not positive(columns) or not positive(capacity) or capacity > 256:
        raise ValueError('Invalid page layout')
    unique, frames, sources, clip_records = {}, [], [], {}
    if not isinstance(spec['clips'], dict) or not spec['clips']:
        raise ValueError('At least one authored clip is required')
    for action, raw in spec['clips'].items():
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', action) or not raw.get('frames'):
            raise ValueError('Every named clip needs complete source frames')
        if type(raw.get('loop', False)) is not bool:
            raise ValueError('Loop must be a boolean')
        sequence, ticks = [], []
        for row in raw['frames']:
            if not positive(row['ticks']):
                raise ValueError('Frame duration must be positive integer simulation ticks')
            source = (spec_path.parent / row['file']).resolve()
            with Image.open(source) as image:
                cel = image.convert('RGBA')
            if cel.size != tuple(cell):
                raise ValueError('Source cell dimensions disagree: ' + str(source))
            key = digest(cel.tobytes())
            if key not in unique:
                unique[key] = len(frames)
                frames.append(cel)
            sequence.append(unique[key])
            ticks.append(row['ticks'])
            sources.append({'action': action, 'file': row['file'], 'sha256': digest(source.read_bytes()),
                            'rgbaSha256': key, 'uniqueCel': unique[key], 'ticks': row['ticks']})
        clip_records[action] = {'sequence': sequence, 'ticks': ticks, 'loop': raw.get('loop', False)}
    if len(frames) > 10000:
        raise ValueError('Sprite set exceeds the source cel limit')
    core = spec.get('coreRect')
    if core is not None and (not isinstance(core, list) or len(core) != 4 or
            any(type(n) is not int for n in core) or core[0] < 0 or core[1] < 0 or
            core[2] <= 0 or core[3] <= 0 or core[0] + core[2] > cell[0] or core[1] + core[3] > cell[1]):
        raise ValueError('Sprite core rectangle must stay inside the cell')
    # All source/metadata validation finishes before the output directory is changed.
    output.mkdir(parents=True, exist_ok=True)
    physical_pages, locations = [], {}
    with tempfile.TemporaryDirectory(prefix='sprite-clips-', dir=output) as temporary:
        staging = Path(temporary)
        for first in range(0, len(frames), capacity):
            selected = frames[first:first + capacity]
            page_columns = min(columns, len(selected))
            rows = math.ceil(len(selected) / page_columns)
            width, height = page_columns * cell[0], rows * cell[1]
            if max(width, height) > 2048 or width * height * 4 > 8 * 1024 * 1024:
                raise ValueError('Sprite page exceeds texture/decode limits')
            sheet = Image.new('RGBA', (width, height))
            for local, cel in enumerate(selected):
                sheet.paste(cel, ((local % page_columns) * cell[0], (local // page_columns) * cell[1]))
            encoded = staging / 'pending.webp'
            sheet.save(encoded, lossless=True, exact=True, method=6)
            with Image.open(encoded) as reopened:
                if ImageChops.difference(sheet, reopened.convert('RGBA')).getbbox(alpha_only=False):
                    raise ValueError('WebP did not retain exact RGBA source samples')
            encoded_hash = digest(encoded.read_bytes())
            filename = f'{name}-{encoded_hash[:16]}.webp'
            encoded.replace(staging / filename)
            page = {'src': f'{prefix}/{filename}', 'columns': page_columns, 'rows': rows,
                    'width': width, 'height': height, 'decodedBytes': width * height * 4,
                    'encodedBytes': (staging / filename).stat().st_size, 'sha256': encoded_hash}
            index = len(physical_pages)
            physical_pages.append(page)
            for local in range(len(selected)):
                locations[first + local] = (index, local)
        clips = {}
        for action, raw in clip_records.items():
            runs = []
            for source_cel in raw['sequence']:
                page_index, local = locations[source_cel]
                page = physical_pages[page_index]
                if not runs or runs[-1]['src'] != page['src']:
                    runs.append({'src': page['src'], 'columns': page['columns'], 'rows': page['rows'],
                                 'frames': 0, 'cells': []})
                runs[-1]['frames'] += 1
                runs[-1]['cells'].append(local)
            clips[action] = {'cell': cell, 'anchor': anchor, 'loop': raw['loop'],
                             'frameTicks': raw['ticks'], 'pages': runs}
            if core is not None:
                clips[action]['coreRect'] = core.copy()
        for image_path in staging.iterdir():
            image_path.replace(output / image_path.name)
    result = {'version': 1, 'id': name, 'clips': clips, 'pages': physical_pages,
              'sourceCelCount': len(sources), 'uniqueCelCount': len(frames), 'sources': sources,
              'authoredCelsUnchanged': True, 'synthesizedFrames': 0}
    provenance_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=provenance_path.parent, delete=False) as pending:
        pending.write(json.dumps(result, indent=2) + '\n')
        temporary_path = Path(pending.name)
    temporary_path.replace(provenance_path)
    return result


def main():
    cli = ArgumentParser(description=__doc__)
    cli.add_argument('spec', type=Path)
    cli.add_argument('output', type=Path)
    cli.add_argument('provenance', type=Path)
    args = cli.parse_args()
    result = pack(args.spec, args.output, args.provenance)
    print(json.dumps({key: result[key] for key in ('id', 'sourceCelCount', 'uniqueCelCount')}))


if __name__ == '__main__':
    main()
