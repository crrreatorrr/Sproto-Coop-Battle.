"""Consolidate projectile and impact sprite colors from the approved boss sheets.

Run from the repository root. The source directory may contain the original
approved sheets or the first runtime exports. Each cel is polished separately
so its four-frame timing, anchor, and orientation are kept.
"""

from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
from subprocess import check_output

import numpy as np
from PIL import Image


CELL = 96
GRID = 4
SIZE = CELL * GRID
NEIGHBORS = ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1))
FULL_NAMES = '*-projectiles.png'
RUNTIME_REFERENCE = '7b99968dcdcf56fb4c720f3f1409e38451fdcdca'

# Cool glints belong on silver faces. Bright effect cores keep the shot's own
# palette. Stage 12's gold shell still reads as metal around its blue exhaust.
GLINTS = (
    ((196, 220, 178), (193, 211, 154)),  # Marina alloy / chartreuse rounds
    ((159, 221, 216), (157, 221, 201)),  # Last Light prism / sea-glass blades
    ((223, 173, 217), (222, 159, 218)),  # Mudline magenta machinery
    ((255, 198, 119), (243, 215, 129)),  # Ranch amber cannon / reactor
    ((255, 187, 120), (255, 179, 121)),  # Neon molten-orange rounds
    ((155, 220, 252), (166, 224, 252)),  # Circuit mirrored ice / electrical blue
    ((200, 183, 247), (208, 187, 250)),  # Moonkeep lavender cannon
    ((202, 220, 168), (220, 231, 154)),  # Crown ivory armor / lime discharge
    ((147, 225, 213), (160, 227, 216)),  # Hatchery aqua hull / orange exhaust
    ((246, 171, 116), (246, 166, 148)),  # Verse copper crescent
    ((221, 170, 229), (227, 168, 237)),  # Rooftop violet turbines
    ((164, 228, 251), (175, 227, 251)),  # Codebreak blue reactor and gold shell
)


def around(values):
    shape = ((1, 1), (1, 1)) + ((0, 0),) * (values.ndim - 2)
    padded = np.pad(values, shape)
    h, w = values.shape[:2]
    return np.stack([padded[1+y:1+y+h, 1+x:1+x+w] for y, x in NEIGHBORS])


def drop_specks(alpha):
    """Keep intentional exhaust streaks and impact chunks; remove pixel debris."""
    remaining = set(zip(*np.where(alpha > 0)))
    h, w = alpha.shape
    while remaining:
        seed = remaining.pop()
        pending = [seed]
        points = [seed]
        while pending:
            y, x = pending.pop()
            for dy, dx in NEIGHBORS:
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and (ny, nx) in remaining:
                    remaining.remove((ny, nx))
                    pending.append((ny, nx))
                    points.append((ny, nx))
        if len(points) < 3 or (len(points) < 5 and all(alpha[y, x] < 255 for y, x in points)):
            for y, x in points:
                alpha[y, x] = 0


def median_neighbor(rgb, eligible):
    """Return an actual nearby color nearest the channel-wise neighborhood median."""
    values = around(rgb)
    count = eligible.sum(axis=0)
    sorted_channels = np.sort(np.where(eligible[:, :, :, None], values, 256), axis=0)
    rows, cols = np.indices(count.shape)
    med = sorted_channels[np.maximum(0, count - 1) // 2, rows, cols]
    distance = (abs(values - med[None]).sum(axis=-1) + (~eligible) * 4096).argmin(axis=0)
    return values[distance, rows, cols]


def polish_cel(source, tint):
    out = np.asarray(source).copy()
    alpha = out[..., 3]
    drop_specks(alpha)
    rgb = out[..., :3].astype(np.int16)
    opacity = alpha > 0
    valid = around(opacity)
    similar = (abs(around(rgb) - rgb[None]).sum(axis=-1) <= 46) & valid
    light, dark = rgb.max(axis=-1), rgb.min(axis=-1)
    silver = (dark >= 191) & (light - dark < 47)
    # A foil highlight that traces an edge has support. A single light fleck
    # inside a plate does not, and takes the color of its surrounding material.
    silver_neighbors = around(silver & opacity).sum(axis=0)
    small_glints = opacity & silver & (silver_neighbors <= 1) & (valid.sum(axis=0) >= 3)
    isolated_color = opacity & (similar.sum(axis=0) <= 1) & (valid.sum(axis=0) >= 5)
    neighbors = valid & ~around(silver & opacity)
    muted = small_glints & (neighbors.sum(axis=0) >= 2)
    fill = median_neighbor(rgb, neighbors)
    rgb[muted] = fill[muted]
    moderate = isolated_color & ~silver
    local = median_neighbor(rgb, valid)
    rgb[moderate] = (2 * rgb[moderate] + 3 * local[moderate]) // 5

    # Reflect the projectile's palette in bright metal and broad energy cores.
    # Keep a sizable edge highlight where it actually describes the weapon.
    light, dark = rgb.max(axis=-1), rgb.min(axis=-1)
    near_white = opacity & (dark >= 165) & (light - dark < 53)
    bright = rgb[near_white]
    rgb[near_white] = (bright * 39 + np.asarray(tint) * 61) // 100
    out[..., :3] = rgb
    out[~opacity] = 0
    return Image.fromarray(out)


def save_indexed(image, target):
    rgba = np.asarray(image)
    mask = rgba[..., 3] > 0
    if not np.any(mask):
        raise ValueError(f'{target.name}: empty sprite sheet')
    palette = [0, 0, 0]
    opacity = [0]
    indices = np.zeros((SIZE, SIZE), dtype=np.uint8)
    for alpha in sorted(np.unique(rgba[..., 3][mask])):
        layer = rgba[..., 3] == alpha
        strip = Image.fromarray(rgba[layer][:, :3][None])
        colors = 104 if alpha == 255 else 16
        quantized = strip.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, kmeans=1, dither=Image.Dither.NONE)
        pixels = np.array(quantized).flatten()
        count = int(pixels.max()) + 1
        indices[layer] = pixels + len(opacity)
        palette.extend(quantized.getpalette()[:count * 3])
        opacity.extend([int(alpha)] * count)
    result = Image.frombytes('P', (SIZE, SIZE), indices.tobytes())
    result.putpalette(palette)
    result.save(target, optimize=True, transparency=bytes(opacity).rstrip(b'\xff'))


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='approved or original 384 x 384 projectile PNGs')
    parser.add_argument('--target', type=Path, default=Path('public/assets/bosses'))
    args = parser.parse_args()
    assets = sorted(Path('public/assets/bosses').glob(FULL_NAMES))
    if len(assets) != 24:
        parser.error('Run from the game root with the 24 gameplay paths present')
    args.target.mkdir(parents=True, exist_ok=True)
    for path in assets:
        stage, *rest = path.stem.split('-')
        pilot, phase, _ = rest[-3:]
        original = args.source / path.name
        from_approved = not original.exists()
        if from_approved:
            original = args.source / f'{stage}-{pilot}-{phase}.png'
        with Image.open(original) as source:
            if source.size != (SIZE, SIZE):
                raise ValueError(f'{original}: expected four 96-pixel cels per side')
            source = source.convert('RGBA')
        if from_approved and stage == '03' and phase == 'p1':
            # The runtime already split the approved fan into one sprite per
            # lane. Keep that authored correction before polishing the cel.
            runtime = check_output(['git', 'show', f'{RUNTIME_REFERENCE}:{path.as_posix()}'])
            with Image.open(BytesIO(runtime)) as image:
                source.paste(image.convert('RGBA').crop((0, CELL, SIZE, 2 * CELL)), (0, CELL))
        result = Image.new('RGBA', (SIZE, SIZE))
        tint = GLINTS[int(stage) - 1][int(phase[-1]) - 1]
        for row in range(GRID):
            for column in range(GRID):
                left, top = column * CELL, row * CELL
                cel = source.crop((left, top, left + CELL, top + CELL))
                result.paste(polish_cel(cel, tint), (left, top))
        save_indexed(result, args.target / path.name)


if __name__ == '__main__':
    main()
