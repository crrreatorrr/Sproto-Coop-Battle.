"""Exercise packing only with disposable synthetic test fixtures, never production art."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image, ImageDraw

MODULE = importlib.util.spec_from_file_location('boss_pack', Path(__file__).parents[1] / 'tools/pack-boss-transform.py')
pack = importlib.util.module_from_spec(MODULE)
MODULE.loader.exec_module(pack)


class Packing(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        for name, color in [('first', '#a04010'), ('last', '#1040a0')]:
            frame = Image.new('RGBA', (220, 220))
            ImageDraw.Draw(frame).rectangle((30, 20, 190, 205), fill=color)
            frame.save(self.root / (name + '.png'))
        self.spec = {'boss': '01-marina-bront', 'cell': [220, 220], 'anchor': [110, 206],
                     'frames': [{'file': 'first.png', 'ticks': 3}] * 159 + [{'file': 'last.png', 'ticks': 3}],
                     'endpoints': [{'file': 'first.png'}, {'file': 'last.png'}],
                     'sourceRecord': 'Disposable fixture; no production authoring.'}
        self.spec_path = self.root / 'accepted.json'
        self.output = self.root / 'public/assets/bosses/transformations'
        self.registry = self.root / 'boss-transformations.js'
        self.registry.write_text('globalThis.CoopBossTransformations = {"version":1,"clips":{}};\n')

    def tearDown(self):
        self.temporary.cleanup()

    def run_pack(self):
        self.spec_path.write_text(json.dumps(self.spec))
        return pack.install(self.spec_path, self.output, self.registry)

    def test_paging_provenance_endpoints_and_registry(self):
        clip = self.run_pack()
        self.assertEqual([page['frames'] for page in clip['pages']], [40] * 4)
        self.assertEqual(sum(clip['frameTicks']), 480)
        files = [self.output / Path(page['src']).name for page in clip['pages']]
        self.assertEqual(len(files), 4)
        self.assertTrue(all(path.suffix == '.webp' for path in files), 'only image pages enter public assets')
        with Image.open(files[0]) as page:
            self.assertEqual(page.size, (1760, 1100))
            self.assertEqual(page.convert('RGBA').crop((0, 0, 220, 220)).tobytes(),
                             Image.open(self.root / 'first.png').convert('RGBA').tobytes())
        with Image.open(files[-1]) as page:
            self.assertEqual(page.convert('RGBA').crop((1540, 880, 1760, 1100)).tobytes(),
                             Image.open(self.root / 'last.png').convert('RGBA').tobytes())
        provenance = json.loads((self.root / '01-marina-bront-packed.json').read_text())
        self.assertEqual(len(provenance['sources']), 160)
        self.assertEqual(len(provenance['frameHashes']), 160)
        self.assertNotEqual(provenance['frameHashes'][0], provenance['frameHashes'][-1])
        self.assertIn('"01-marina-bront"', self.registry.read_text())

    def test_layout_change_gets_new_immutable_page_urls(self):
        first = self.run_pack()
        old_page = self.output / Path(first['pages'][0]['src']).name
        original = old_page.read_bytes()
        self.spec['columns'] = 4
        second = self.run_pack()
        self.assertNotEqual(first['pages'][0]['src'], second['pages'][0]['src'])
        self.assertEqual(old_page.read_bytes(), original, 'previously registered page URLs stay immutable')
        new_page = self.output / Path(second['pages'][0]['src']).name
        with Image.open(new_page) as image:
            self.assertEqual(image.size, (880, 2200))

    def test_portable_source_atlas_rects_preserve_pages_and_combat_registry(self):
        first = self.run_pack()
        atlas = Image.new('RGBA', (440, 220))
        for column, name in enumerate(('first', 'last')):
            with Image.open(self.root / (name + '.png')) as image:
                atlas.paste(image.convert('RGBA'), (column * 220, 0))
        atlas.save(self.root / 'source.webp', lossless=True, exact=True)
        a = {'file': 'source.webp', 'rect': [0, 0, 220, 220], 'ticks': 3}
        b = {'file': 'source.webp', 'rect': [220, 0, 220, 220], 'ticks': 3}
        self.spec['frames'] = [a] * 159 + [b]
        self.spec['endpoints'] = [a, b]
        animations = {'version': 1, 'bosses': {'other': {'unchanged': True}}}
        self.registry.write_text('globalThis.CoopBossTransformations = ' + json.dumps(
            {'version': 1, 'clips': {}, 'animations': animations}) + ';\n')
        second = self.run_pack()
        self.assertEqual(first['pages'], second['pages'], 'identical RGBA yields identical public pages')
        self.assertIn('"animations":', self.registry.read_text())
        stored = json.loads(self.registry.read_text().split(' = ', 1)[1].strip().removesuffix(';'))
        self.assertEqual(stored['animations'], animations)
        proof = json.loads((self.root / '01-marina-bront-packed.json').read_text())
        self.assertEqual(proof['sources'][-1]['rect'], b['rect'])
        self.spec['frames'][3] = {'file': 'source.webp', 'rect': [430, 0, 220, 220], 'ticks': 3}
        with self.assertRaisesRegex(ValueError, 'outside'):
            self.run_pack()

    def test_rejection_has_no_output_or_registration(self):
        original = self.registry.read_bytes()
        cases = [('duration', lambda: self.spec.update(frames=[{'file': 'first.png', 'ticks': 479}])),
                 ('endpoint', lambda: self.spec['endpoints'].__setitem__(1, {'file': 'first.png'})),
                 ('missing', lambda: self.spec['frames'].__setitem__(3, {'file': 'missing.png', 'ticks': 3}))]
        baseline = json.dumps(self.spec)
        for name, mutate in cases:
            with self.subTest(name=name):
                self.spec = json.loads(baseline)
                mutate()
                with self.assertRaises((ValueError, OSError)):
                    self.run_pack()
                self.assertFalse(self.output.exists())
                self.assertEqual(self.registry.read_bytes(), original)

    def test_clipped_complete_frame_rejected(self):
        frame = Image.new('RGBA', (220, 220))
        ImageDraw.Draw(frame).rectangle((0, 20, 180, 205), fill='#a04010')
        frame.save(self.root / 'first.png')
        with self.assertRaisesRegex(ValueError, 'boundary'):
            self.run_pack()
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
