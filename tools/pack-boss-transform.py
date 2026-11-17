#!/usr/bin/env python3
"""Pack accepted complete RGBA transformation frames into lossless atlas pages.

Usage: python3 tools/pack-boss-transform.py spec.json output_directory [--registry public/js/boss-transformations.js] [--provenance path.json]

The JSON spec names a boss key, ordered frames (file and ticks), a cell [220,220],
anchor [110,206], and two endpoints (file and optional [x,y,width,height] rect).
The frame durations must total 480 simulation ticks. Each input is one complete
authored frame. This tool never invents in-between frames, crops, or rescales art.
"""
from argparse import ArgumentParser
import hashlib
import json
import math
from pathlib import Path
import re
import tempfile

from PIL import Image, ImageChops


DURATION = 480


def rgba(path, cell, rect=None):
    with Image.open(path) as original:
        frame = original.convert('RGBA')
    if rect is not None:
        if len(rect) != 4 or any(not isinstance(v, int) for v in rect):
            raise ValueError('Endpoint rect must contain four integers')
        x, y, width, height = rect
        if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > frame.width or y + height > frame.height:
            raise ValueError('Endpoint rect falls outside its source image')
        frame = frame.crop((x, y, x + width, y + height))
    if frame.size != tuple(cell):
        raise ValueError(f'{path}: expected complete {cell[0]}x{cell[1]} frame')
    return frame


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def install(spec_path, output, registry=None, provenance_path=None):
    spec = json.loads(spec_path.read_text())
    source_root = spec_path.parent
    provenance_path = provenance_path or source_root / (spec['boss'] + '-packed.json')
    key = spec['boss']
    if not re.fullmatch(r'[0-9]{2}-[a-z0-9]+(?:-[a-z0-9]+)*', key):
        raise ValueError('Expected the existing numbered boss key')
    cell = spec.get('cell', [220, 220])
    anchor = spec.get('anchor', [110, 206])
    if len(cell) != 2 or any(type(n) is not int or n <= 0 for n in cell):
        raise ValueError('Cell must contain two positive integer dimensions')
    if len(anchor) != 2 or any(type(n) is not int or not 0 <= n < cell[i] for i, n in enumerate(anchor)):
        raise ValueError('Anchor must be inside the cell')
    columns, page_frames = spec.get('columns', 8), spec.get('pageFrames', 40)
    if any(type(n) is not int or n <= 0 for n in (columns, page_frames)):
        raise ValueError('Page layout must use positive integer dimensions')
    entries = spec['frames']
    if len(entries) < 2 or any(type(frame.get('ticks')) is not int or frame['ticks'] <= 0 for frame in entries):
        raise ValueError('Every source frame needs a positive integer duration')
    if sum(frame['ticks'] for frame in entries) != DURATION:
        raise ValueError('Transformation durations must total exactly 480 ticks')
    frames = []
    sources = []
    for entry in entries:
        path = (source_root / entry['file']).resolve()
        image = rgba(path, cell)
        bounds = image.getchannel('A').getbbox()
        if bounds is None or bounds == (0, 0, *cell):
            raise ValueError(f'{path}: empty or edge-to-edge frame')
        if bounds[0] <= 0 or bounds[1] <= 0 or bounds[2] >= cell[0] or bounds[3] >= cell[1]:
            raise ValueError(f'{path}: frame touches the cell boundary')
        frames.append(image)
        sources.append({'file': str(path), 'sha256': digest(path), 'ticks': entry['ticks']})
    endpoints = spec['endpoints']
    if len(endpoints) != 2:
        raise ValueError('Both accepted standing endpoint sources are required')
    for entry, frame in zip(endpoints, (frames[0], frames[-1])):
        expected = rgba(source_root / entry['file'], cell, entry.get('rect'))
        if ImageChops.difference(frame, expected).getbbox(alpha_only=False) is not None:
            raise ValueError('Transformation endpoint differs from its accepted standing sprite')

    prefix = spec.get('assetPrefix', 'assets/bosses/transformations')
    if prefix != 'assets/bosses/transformations' and not re.fullmatch(r'assets/bosses/transformations/[a-z0-9_-]+(?:/[a-z0-9_-]+)*', prefix):
        raise ValueError('Asset prefix must stay inside assets/bosses/transformations')
    registration = None
    if registry is not None:
        match = re.search(r'globalThis\.CoopBossTransformations = (\{.*\});', registry.read_text(), re.S)
        if not match:
            raise ValueError('Registry must use the canonical generated JSON assignment')
        registration = json.loads(match[1])
        if registration.get('version') != 1 or not isinstance(registration.get('clips'), dict):
            raise ValueError('Unsupported transformation registry')

    # Validate all source files before making any atlas visible to the game.
    output.mkdir(parents=True, exist_ok=True)
    pages = []
    with tempfile.TemporaryDirectory(prefix='boss-transform-', dir=output) as temporary:
        pending = Path(temporary)
        for first in range(0, len(frames), page_frames):
            selected = frames[first:first + page_frames]
            sheet = Image.new('RGBA', (columns * cell[0], math.ceil(len(selected) / columns) * cell[1]))
            for index, image in enumerate(selected):
                sheet.paste(image, ((index % columns) * cell[0], (index // columns) * cell[1]))
            encoded_page = pending / f'page-{first // page_frames:02}.webp'
            sheet.save(encoded_page, lossless=True, exact=True, method=6)
            with Image.open(encoded_page) as encoded:
                decoded = encoded.convert('RGBA')
            if ImageChops.difference(sheet, decoded).getbbox(alpha_only=False) is not None:
                raise ValueError('Encoded page did not preserve every source RGBA pixel')
            # Include layout and encoder output in immutable page URLs, not just input art.
            name = f'{key}-{digest(encoded_page)[:12]}-{first // page_frames:02}.webp'
            encoded_page.rename(pending / name)
            pages.append({'src': f'{prefix}/{name}', 'columns': columns, 'frames': len(selected)})
        clip = {'cell': cell, 'anchor': anchor, 'frameTicks': [frame['ticks'] for frame in entries], 'pages': pages}
        provenance = {'boss': key, 'durationTicks': DURATION, 'clip': clip, 'sources': sources,
                      'sourceRecord': spec.get('sourceRecord'), 'frameHashes': [
                          hashlib.sha256(frame.tobytes()).hexdigest() for frame in frames]}
        for path in pending.iterdir():
            path.replace(output / path.name)
    # Provenance belongs beside the authoring spec, never among public image assets.
    provenance_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=provenance_path.parent, delete=False) as temporary:
        temporary.write(json.dumps(provenance, indent=2) + '\n')
        next_provenance = Path(temporary.name)
    next_provenance.replace(provenance_path)
    if registration is not None:
        registration['clips'][key] = clip
        text = '// Accepted authored transformation clips are installed here by tools/pack-boss-transform.py.\n'
        text += 'globalThis.CoopBossTransformations = ' + json.dumps(registration, separators=(',', ':')) + ';\n'
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=registry.parent, delete=False) as temporary:
            temporary.write(text)
            next_registry = Path(temporary.name)
        next_registry.replace(registry)
    print(f'{key}: packed {len(frames)} source frames in {len(pages)} pages, 480 ticks')
    return clip


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('spec', type=Path)
    parser.add_argument('output_directory', type=Path)
    parser.add_argument('--registry', type=Path)
    parser.add_argument('--provenance', type=Path)
    args = parser.parse_args()
    try:
        install(args.spec.resolve(), args.output_directory.resolve(), args.registry.resolve() if args.registry else None,
                args.provenance.resolve() if args.provenance else None)
    except (ValueError, KeyError, OSError, TypeError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
