"""Read reviewed endpoint parts without author modules or machine-specific paths.

This reader generates no poses. It proves native/finished endpoint equality,
retains declared source joints and exposes exact layers for future animation.
Only Pillow and the Python standard library are required.
"""
from dataclasses import dataclass
import hashlib
from io import BytesIO
import json
from pathlib import Path
import zipfile

from PIL import Image, ImageChops


def digest(data):
    return hashlib.sha256(data).hexdigest()


class MaterialFinish:
    def __init__(self, record):
        colors, palette = record['bodyColors'], record['palette']
        if record['protectedRGBChanges'] or record['alphaChanges'] or type(colors) is not int or \
                not 16 <= colors <= 256 or len(palette) != colors * 3 or any(
                    type(n) is not int or not 0 <= n <= 255 for n in palette):
            raise ValueError('A source-preserving reviewed palette is required')
        self.palette = Image.new('P', (1, 1))
        # Do not pad to 256: that would add unwanted black palette candidates.
        self.palette.putpalette(palette)

    def apply_game_cel(self, cel, pilot_mask):
        cel = cel.convert('RGBA')
        if cel.size != (220, 220) or pilot_mask.size != cel.size:
            raise ValueError('Expected matching 220px actor and visible-pilot mask')
        mask = pilot_mask.convert('L').point(lambda n: 255 if n else 0)
        if ImageChops.multiply(mask, cel.getchannel('A')).getbbox() is None:
            raise ValueError('The original pilot must remain visible')
        finished = cel.convert('RGB').quantize(palette=self.palette, dither=Image.Dither.NONE).convert('RGBA')
        finished.putalpha(cel.getchannel('A'))
        finished = Image.composite(cel, finished, mask)
        transparent = cel.getchannel('A').point(lambda n: 255 if n == 0 else 0)
        finished.paste((0, 0, 0, 0), mask=transparent)
        return finished

    def from_source(self, cel, pilot_mask):
        if cel.size != (640, 640) or pilot_mask.size != cel.size:
            raise ValueError('Expected 640px source art and visible-pilot mask')
        mask = pilot_mask.getchannel('A') if 'A' in pilot_mask.getbands() else pilot_mask.convert('L')
        mask = mask.point(lambda n: 255 if n else 0)
        return self.apply_game_cel(cel.resize((220, 220), Image.Resampling.NEAREST),
                                   mask.resize((220, 220), Image.Resampling.NEAREST))


@dataclass
class RigLayer:
    id: str
    order: int
    image: Image.Image
    metadata: dict


@dataclass
class SourceRig:
    boss: str
    phase: int
    layers: list
    native: Image.Image
    pilot_mask: Image.Image
    finished: Image.Image
    material: MaterialFinish
    omission_mask: Image.Image
    metadata: dict
    proof: dict


def load_rig(packet_path, phase):
    if phase not in (1, 2):
        raise ValueError('Source phases are one-based 1 or 2')
    packet_path = Path(packet_path)
    with zipfile.ZipFile(packet_path) as archive:
        manifest = json.loads(archive.read('rig.json'))
        if manifest['version'] != 1 or manifest['cell'] != [640, 640] or manifest['anchor'] != [320, 600]:
            raise ValueError('Unsupported source-rig geometry')
        verified = {}
        for name, expected in manifest['files'].items():
            data = archive.read(name)
            if digest(data) != expected:
                raise ValueError('Source member hash changed: ' + name)
            verified[name] = data

        def read_image(name, mode):
            return Image.open(BytesIO(verified[name])).convert(mode)

        record = next(p for p in manifest['phases'] if p['phase'] == phase)
        native = Image.new('RGBA', (640, 640))
        layers = []
        for row in record['layers']:
            image = Image.new('RGBA', (640, 640))
            if row['texture']:
                texture = read_image(row['texture'], 'RGBA')
                box = row['bounds']
                if not isinstance(box, list) or len(box) != 4 or any(type(n) is not int for n in box) or \
                        not (0 <= box[0] < box[2] <= 640 and 0 <= box[1] < box[3] <= 640) or \
                        texture.size != (box[2] - box[0], box[3] - box[1]):
                    raise ValueError('Source texture bounds disagree')
                image.paste(texture, (box[0], box[1]))
            layers.append(RigLayer(row['id'], row['order'], image, row['kinematics']))
            native.alpha_composite(image)
        mask = Image.new('L', native.size)
        if record['omissionMask']:
            mask = read_image(record['omissionMask'], 'L')
            if mask.size != native.size:
                raise ValueError('Omission mask geometry disagrees')
            native.paste((0, 0, 0, 0), mask=mask.point(lambda n: 255 if n else 0))
        if digest(native.tobytes()) != record['nativeRgbaSha256']:
            raise ValueError('Ordered source layers do not reproduce the reviewed endpoint')
        protected = read_image(record['protectedMask'], 'L')
        material = MaterialFinish(manifest['materialFinish'])
        finished = material.from_source(native, protected)
        if digest(finished.tobytes()) != record['finished220RgbaSha256']:
            raise ValueError('Portable finish changed the reviewed game handoff')
    proof = {'boss': manifest['boss'], 'phase': phase, 'packetSha256': digest(packet_path.read_bytes()),
             'verifiedMembers': len(verified), 'nativeAndFinishedReplaysExact': True}
    return SourceRig(manifest['boss'], phase, layers, native, protected, finished, material, mask, record, proof)


if __name__ == '__main__':
    from argparse import ArgumentParser
    cli = ArgumentParser(description=__doc__)
    cli.add_argument('packet', type=Path)
    cli.add_argument('--phase', type=int, choices=(1, 2))
    args = cli.parse_args()
    for phase in (args.phase,) if args.phase else (1, 2):
        print(json.dumps(load_rig(args.packet, phase).proof))
