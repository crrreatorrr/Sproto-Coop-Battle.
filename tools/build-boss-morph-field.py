#!/usr/bin/env python3
"""Build the Co-op boss transformation mesh from the shipped 220px actor cels.

Run with Pillow, NumPy, and opencv-python-headless installed. The renderer
uses these compact meshes to align adjacent sprite contours at runtime.
"""
from base64 import b64encode
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
BOSSES = ROOT / 'public/assets/bosses'
OUTPUT = ROOT / 'public/js/boss-morph-field.js'
ANCHORS = ROOT / 'tools/boss-morph-anchors.json'
CELL = 220
GRID = 12
MAX_SHIFT = 45
PADDING = 28
GRID_AXIS = np.linspace(0, CELL - 1, GRID, dtype=np.float32)
GRID_X, GRID_Y = np.meshgrid(GRID_AXIS, GRID_AXIS)


def load_cels(path):
    """Keep all the poses in the same 220px coordinate system."""
    following = path.with_name(path.name.replace('-p1.webp', '-p2.webp'))
    with Image.open(path) as first, Image.open(following) as last:
        if first.width != 4 * CELL or first.height < 7 * CELL or last.width != 4 * CELL or last.height < CELL:
            raise ValueError(f'{path.name}: unexpected actor atlas dimensions')
        first, last = first.convert('RGBA'), last.convert('RGBA')
        cels = [first.crop((0, 0, CELL, CELL))] + [
            first.crop((x, CELL * 6, x + CELL, CELL * 7))
            for x in range(0, 4 * CELL, CELL)
        ] + [last.crop((0, 0, CELL, CELL))]
        if any(cel.getchannel('A').getbbox() is None for cel in cels):
            raise ValueError(f'{path.name}: an actor keyframe is empty')
        return cels


def to_features(cel):
    """Let the silhouette and the pilot/chassis detail both guide correspondence."""
    rgba = np.asarray(cel)
    alpha = rgba[..., 3] / 255
    tone = cv2.cvtColor(rgba, cv2.COLOR_RGBA2GRAY)
    feature = np.rint(alpha * (49 + 0.80 * tone)).astype(np.uint8)
    feature = cv2.GaussianBlur(feature, (3, 3), 0.65)
    return np.pad(feature, PADDING), (alpha > 0).astype(np.uint8)


def dense_flow(source, target):
    model = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    model.setFinestScale(0)
    model.setPatchSize(16)
    model.setPatchStride(4)
    model.setGradientDescentIterations(36)
    return model.calc(source, target, None)


def mesh(flow, inverse, alpha, controls, foot=206, foot_taper=28):
    x, y = cv2.remap(flow, GRID_X + PADDING, GRID_Y + PADDING,
                     cv2.INTER_LINEAR).transpose(2, 0, 1)
    reverse = cv2.remap(inverse, GRID_X + PADDING + x, GRID_Y + PADDING + y,
                        cv2.INTER_LINEAR)
    vectors = np.stack((x, y), axis=-1)
    cycle_error = np.linalg.norm(vectors + reverse, axis=-1)
    agreement = 0.38 + 0.62 * np.exp(-cycle_error / 30)
    distance = cv2.distanceTransform(1 - alpha, cv2.DIST_L2, 3)
    distance = cv2.remap(distance, GRID_X, GRID_Y, cv2.INTER_LINEAR)
    support = np.clip(1 - distance / 44, 0, 1)
    speed = np.linalg.norm(vectors, axis=-1)
    capped = np.minimum(1, MAX_SHIFT / np.maximum(1, speed))
    vectors *= (agreement * support * capped)[..., None]
    # Hold the pilot and primary hinge on their authored trajectories even
    # when two consecutive frames show different armor around those points.
    for start, end, radius in controls:
        axis = np.asarray(end, dtype=np.float32) - start
        axis *= min(1, 56 / max(1, np.linalg.norm(axis)))
        distance = (GRID_X - start[0]) ** 2 + (GRID_Y - start[1]) ** 2
        influence = (0.84 * np.exp(-distance / (2 * radius ** 2)) * support)[..., None]
        vectors += (axis - vectors) * influence
    # Don't raise a planted foot by dragging its texture toward the cockpit.
    vectors[..., 1] *= np.clip((foot - GRID_Y) / foot_taper, 0, 1)
    vectors[[0, -1], :] = 0
    vectors[:, [0, -1]] = 0

    # Bound adjacent displacement differences in both axes. With this limit,
    # interpolating toward any frame cannot flip a triangle.
    max_step = (CELL - 1) / (GRID - 1) * 0.65
    for _ in range(24):
        spread = max(np.linalg.norm(np.diff(vectors, axis=axis), axis=-1).max() for axis in (0, 1))
        if spread <= max_step:
            break
        vectors = cv2.GaussianBlur(vectors, (3, 3), 0.62, borderType=cv2.BORDER_CONSTANT)
        vectors[[0, -1], :] = 0
        vectors[:, [0, -1]] = 0
    rounded = np.rint(vectors).astype(np.int8)
    if max(np.linalg.norm(np.diff(rounded.astype(np.int16), axis=axis), axis=-1).max()
           for axis in (0, 1)) >= (CELL - 1) / (GRID - 1) / np.sqrt(2):
        raise ValueError('Mesh distortion can fold a triangle')
    return rounded


def main():
    bosses = sorted(BOSSES.glob('*-p1.webp'))
    if len(bosses) != 12 or [path.name[:2] for path in bosses] != [f'{i:02}' for i in range(1, 13)]:
        raise ValueError('The mesh needs one actor sheet pair for each of the twelve stages')
    cv2.setNumThreads(1)
    anchors = json.loads(ANCHORS.read_text())
    fields, timing = [], []
    for path in bosses:
        pilot = path.stem.removesuffix('-p1').split('-')[-1]
        profile = anchors[pilot]
        poses = [to_features(cel) for cel in load_cels(path)]
        for part in ('pilot', 'hinge'):
            points = profile[part]
            if len(points) != len(poses) or any(len(xy) != 2 or any(not 0 <= v < CELL for v in xy) for xy in points):
                raise ValueError(f'{path.name}: expected six in-cell {part} anchors')
        timing.append([[p, h] for p, h in zip(profile['pilot'], profile['hinge'])])
        for gap, ((source, source_alpha), (target, target_alpha)) in enumerate(zip(poses, poses[1:])):
            controls = [(profile['pilot'][gap], profile['pilot'][gap + 1], 21),
                        (profile['hinge'][gap], profile['hinge'][gap + 1], 16)]
            outgoing = dense_flow(source, target)
            incoming = dense_flow(target, source)
            fields.extend((mesh(outgoing, incoming, source_alpha, controls),
                           mesh(incoming, outgoing, target_alpha, [(b, a, r) for a, b, r in controls])))
    content = b64encode(np.asarray(fields, dtype=np.int8).tobytes()).decode('ascii')
    OUTPUT.write_text(
        '// Generated by tools/build-boss-morph-field.py.\n'
        '// Signed XY pixel offsets: stage, keyframe gap, direction, row, column, axis.\n'
        f"globalThis.CoopBossMorphField = '{content}';\n"
        f"globalThis.CoopBossMorphGuides = {json.dumps(timing, separators=(',', ':'))};\n",
        encoding='ascii',
    )
    print(f'{len(bosses)} boss morph fields, {len(fields)} directional meshes, {len(content)} base64 bytes')


if __name__ == '__main__':
    main()
