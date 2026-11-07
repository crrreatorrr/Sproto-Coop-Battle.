#!/usr/bin/env python3
"""Pack the 40 existing fighter poses into one lossless PNG atlas per character.

The pose PNGs stay on disk. Nothing here draws new pixels, deletes a source,
or edits feet, hands, or hit boxes. The grid is 8 by 5 cells of 128, row-major,
poses 00-31 then w00-w07, with no padding. Cells are copied on integer
coordinates, so a crop is the original bitmap.

PNG bytes come from a stdlib encoder (fixed filters, zlib level 9) so the file
does not depend on Pillow. Lossless WebP is measured when Pillow is importable
and recorded in the provenance file; it is not the shipped format because the
bitstream moves with libwebp and CI does not have Pillow.

Usage:
  python3 tools/pack-fighter-atlases.py          # write atlases + provenance
  python3 tools/pack-fighter-atlases.py --check  # pixel-compare committed atlases
"""
from __future__ import annotations

import hashlib
import io
import json
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POSE_DIR = ROOT / 'public' / 'assets' / 'fighters'
PROVENANCE = ROOT / 'tests' / 'fixtures' / 'atlas-provenance.json'
FIGHTERS = ('sproto3106', 'vamp', 'guest09', 'guest10', 'rivet', 'dumpstar')
CELL = 128
COLS = 8
ROWS = 5
ORDER = [f'{i:02d}' for i in range(32)] + [f'w0{i}' for i in range(8)]
assert len(ORDER) == COLS * ROWS


def paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def decode_png(data):
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('not a png')
    pos = 8
    width = height = color = depth = interlace = None
    idat = bytearray()
    while pos + 8 <= len(data):
        length, kind = struct.unpack('>I4s', data[pos:pos + 8])
        pos += 8
        chunk = data[pos:pos + length]
        pos += length + 4
        if kind == b'IHDR':
            width, height, depth, color, comp, filt, interlace = struct.unpack('>IIBBBBB', chunk)
        elif kind == b'IDAT':
            idat += chunk
        elif kind == b'IEND':
            break
    if depth != 8 or color != 6 or interlace != 0:
        raise ValueError(f'expected 8-bit non-interlaced RGBA, got depth={depth} color={color} interlace={interlace}')
    raw = zlib.decompress(bytes(idat))
    stride = width * 4
    rows = []
    prev = bytearray(stride)
    i = 0
    for _y in range(height):
        filt = raw[i]
        i += 1
        row = bytearray(raw[i:i + stride])
        i += stride
        if filt == 1:
            for x in range(stride):
                left = row[x - 4] if x >= 4 else 0
                row[x] = (row[x] + left) & 255
        elif filt == 2:
            for x in range(stride):
                row[x] = (row[x] + prev[x]) & 255
        elif filt == 3:
            for x in range(stride):
                left = row[x - 4] if x >= 4 else 0
                row[x] = (row[x] + ((left + prev[x]) // 2)) & 255
        elif filt == 4:
            for x in range(stride):
                left = row[x - 4] if x >= 4 else 0
                up = prev[x]
                ul = prev[x - 4] if x >= 4 else 0
                row[x] = (row[x] + paeth(left, up, ul)) & 255
        elif filt != 0:
            raise ValueError('bad png filter ' + str(filt))
        rows.append(row)
        prev = row
    if i != len(raw):
        raise ValueError('png raw length mismatch')
    return width, height, rows


def _filter(kind, row, prev):
    stride = len(row)
    out = bytearray(stride)
    if kind == 0:
        out[:] = row
    elif kind == 1:
        for x in range(stride):
            left = row[x - 4] if x >= 4 else 0
            out[x] = (row[x] - left) & 255
    elif kind == 2:
        for x in range(stride):
            out[x] = (row[x] - prev[x]) & 255
    elif kind == 3:
        for x in range(stride):
            left = row[x - 4] if x >= 4 else 0
            out[x] = (row[x] - ((left + prev[x]) // 2)) & 255
    else:
        for x in range(stride):
            left = row[x - 4] if x >= 4 else 0
            up = prev[x]
            ul = prev[x - 4] if x >= 4 else 0
            out[x] = (row[x] - paeth(left, up, ul)) & 255
    return out


def _magnitude(buf):
    total = 0
    for b in buf:
        total += b if b < 128 else 256 - b
    return total


def encode_png(width, height, rows):
    stride = width * 4
    raw = bytearray()
    prev = bytearray(stride)
    for row in rows:
        best_kind = 0
        best_score = None
        best = None
        for kind in range(5):
            cand = _filter(kind, row, prev)
            score = _magnitude(cand)
            if best_score is None or score < best_score:
                best_kind = kind
                best_score = score
                best = cand
        raw.append(best_kind)
        raw += best
        prev = row
    comp = zlib.compress(bytes(raw), 9)

    def chunk(kind, payload):
        body = kind + payload
        return struct.pack('>I', len(payload)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', comp) + chunk(b'IEND', b'')


def load_pose(fid, name):
    path = POSE_DIR / fid / f'{name}.png'
    width, height, rows = decode_png(path.read_bytes())
    if (width, height) != (CELL, CELL):
        raise ValueError(f'{path} is {width}x{height}, expected {CELL}x{CELL}')
    return rows


def pack_rows(fid):
    atlas = [bytearray(COLS * CELL * 4) for _ in range(ROWS * CELL)]
    sources = []
    for index, name in enumerate(ORDER):
        rows = load_pose(fid, name)
        col, row = index % COLS, index // COLS
        ox = col * CELL * 4
        oy = row * CELL
        for y in range(CELL):
            atlas[oy + y][ox:ox + CELL * 4] = rows[y]
        sources.append(rows)
    return atlas, sources


def cells_match(atlas_rows, sources):
    bad = []
    for index, rows in enumerate(sources):
        col, row = index % COLS, index // COLS
        ox = col * CELL * 4
        oy = row * CELL
        for y in range(CELL):
            if atlas_rows[oy + y][ox:ox + CELL * 4] != rows[y]:
                bad.append(ORDER[index])
                break
    return bad


def sha256(buf):
    return hashlib.sha256(buf).hexdigest()


def measure_webp(width, height, rows):
    try:
        from PIL import Image
        import PIL
    except Exception as err:
        return {'measured': False, 'reason': str(err)}
    raw = b''.join(rows)
    image = Image.frombytes('RGBA', (width, height), raw)
    buf = io.BytesIO()
    image.save(buf, format='WEBP', lossless=True, quality=100, method=6, exact=True)
    data = buf.getvalue()
    back = Image.open(io.BytesIO(data)).convert('RGBA')
    return {
        'measured': True,
        'exact': back.tobytes() == raw,
        'bytes': len(data),
        'pillow': getattr(PIL, '__version__', 'unknown'),
        'shipped': False,
    }


def blank_rows():
    return [bytearray(COLS * CELL * 4) for _ in range(ROWS * CELL)]


def build_one(fid, measure):
    rows, sources = pack_rows(fid)
    blob = encode_png(COLS * CELL, ROWS * CELL, rows)
    back_w, back_h, back_rows = decode_png(blob)
    if (back_w, back_h) != (COLS * CELL, ROWS * CELL):
        raise ValueError(fid + ' atlas dimensions drifted')
    bad = cells_match(back_rows, sources)
    if bad:
        raise ValueError(fid + ' packed cells do not match sources: ' + ','.join(bad))
    info = {
        'file': f'assets/fighters/{fid}/atlas.png',
        'sha256': sha256(blob),
        'bytes': len(blob),
        'width': COLS * CELL,
        'height': ROWS * CELL,
        'decodedBytes': COLS * CELL * ROWS * CELL * 4,
        'sources': {name: sha256((POSE_DIR / fid / f'{name}.png').read_bytes()) for name in ORDER},
    }
    if measure:
        info['webp'] = measure_webp(COLS * CELL, ROWS * CELL, rows)
    return blob, info


def provenance_shell(fighters):
    png_total = sum(item['bytes'] for item in fighters.values())
    webp_total = None
    webp_exact = None
    pillow = None
    if all(item.get('webp', {}).get('measured') for item in fighters.values()):
        webp_total = sum(item['webp']['bytes'] for item in fighters.values())
        webp_exact = all(item['webp']['exact'] for item in fighters.values())
        pillow = next(iter(fighters.values()))['webp']['pillow']
    return {
        'packer': 'tools/pack-fighter-atlases.py',
        'format': 'png',
        'shipped': 'png',
        'reason': 'Stdlib PNG is byte-stable and pixel-checked without Pillow. Lossless WebP was measured and is smaller when exact, but its bitstream follows libwebp, which CI does not pin.',
        'cell': CELL,
        'cols': COLS,
        'rows': ROWS,
        'padding': 0,
        'order': ORDER,
        'fighters': list(FIGHTERS),
        'zlib': zlib.ZLIB_VERSION,
        'pngBytes': png_total,
        'sourcePoseBytes': sum((POSE_DIR / fid / f'{name}.png').stat().st_size for fid in FIGHTERS for name in ORDER),
        'webp': {
            'shipped': False,
            'exact': webp_exact,
            'bytes': webp_total,
            'pillow': pillow,
            'flags': 'lossless=True quality=100 method=6 exact=True',
        },
        'atlases': fighters,
    }


def write_all():
    atlases = {}
    blobs = {}
    for fid in FIGHTERS:
        blob, info = build_one(fid, True)
        blobs[fid] = blob
        atlases[fid] = info
        print(f'{fid} png {info["bytes"]} webp {info["webp"].get("bytes")} exact {info["webp"].get("exact")}')
    doc = provenance_shell(atlases)
    PROVENANCE.parent.mkdir(parents=True, exist_ok=True)
    for fid, blob in blobs.items():
        target = POSE_DIR / fid / 'atlas.png'
        target.write_bytes(blob)
    PROVENANCE.write_text(json.dumps(doc, indent=2) + '\n', encoding='utf-8')
    print(f'wrote {len(blobs)} atlases, png {doc["pngBytes"]} bytes, webp {doc["webp"]["bytes"]} bytes')
    print(f'provenance {PROVENANCE.relative_to(ROOT)}')


def check_all():
    if not PROVENANCE.exists():
        raise SystemExit('missing ' + str(PROVENANCE))
    doc = json.loads(PROVENANCE.read_text(encoding='utf-8'))
    problems = []
    if doc.get('cell') != CELL or doc.get('cols') != COLS or doc.get('rows') != ROWS or doc.get('padding') != 0:
        problems.append('grid metadata changed')
    if doc.get('order') != ORDER:
        problems.append('pose order changed')
    if doc.get('shipped') != 'png':
        problems.append('shipped format is not png')
    webp = doc.get('webp') or {}
    if webp.get('shipped') or not webp.get('exact') or not webp.get('bytes'):
        problems.append('lossless webp measurement missing or inexact')
    if webp.get('bytes') and doc.get('pngBytes') and webp['bytes'] >= doc['pngBytes']:
        problems.append('recorded webp is not smaller than png')
    for fid in FIGHTERS:
        info = (doc.get('atlases') or {}).get(fid)
        path = POSE_DIR / fid / 'atlas.png'
        if not info or not path.exists():
            problems.append('missing atlas for ' + fid)
            continue
        blob = path.read_bytes()
        if sha256(blob) != info['sha256'] or len(blob) != info['bytes']:
            problems.append(fid + ' atlas bytes do not match provenance')
        width, height, rows = decode_png(blob)
        if (width, height) != (info['width'], info['height']) or width > 1024 or height > 1024:
            problems.append(fid + ' atlas is outside the 1024 square')
        sources = []
        for name in ORDER:
            pose = POSE_DIR / fid / f'{name}.png'
            if not pose.exists():
                problems.append('deleted source ' + str(pose.relative_to(ROOT)))
                continue
            raw = pose.read_bytes()
            if info['sources'].get(name) != sha256(raw):
                problems.append(fid + ' source ' + name + ' hash changed')
            pw, ph, prows = decode_png(raw)
            if (pw, ph) != (CELL, CELL):
                problems.append(fid + ' ' + name + ' is not 128')
            sources.append(prows)
        if len(sources) == len(ORDER):
            bad = cells_match(rows, sources)
            if bad:
                problems.append(fid + ' pixels differ: ' + ','.join(bad))
    if problems:
        raise SystemExit('atlas check failed:\n' + '\n'.join(problems))
    print(f'atlas pixels match {len(FIGHTERS) * len(ORDER)} poses; png {doc["pngBytes"]} webp {webp["bytes"]} (not shipped)')


def main():
    if '--check' in sys.argv:
        check_all()
    else:
        write_all()
        check_all()


if __name__ == '__main__':
    main()
