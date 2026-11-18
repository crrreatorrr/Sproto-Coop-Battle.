"""Apply only the two independently inspected, source-bound matte proposals.

No pixel is painted, moved or interpolated. Original packets stay immutable.
Only explicitly reviewed background samples become canonical transparent RGBA;
all other strict/material samples and the existing fixed palettes stay exact.
"""
from pathlib import Path
import hashlib
import json
from collections import deque

import numpy as np
from PIL import Image, ImageOps, ImageDraw

BASE = Path(__file__).resolve().parent


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def read(p):
    return np.asarray(Image.open(p).convert('RGBA')).copy()


def save(a, p):
    p.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(a, 'RGBA').save(p)


def verify_packet(p, expected):
    manifests = [p / name for name in ['freeze-manifest.json', 'delivery-manifest.json']
                 if (p / name).exists() and sha(p / name) == expected]
    assert len(manifests) == 1, (p, expected)
    m = manifests[0]
    rows = json.loads(m.read_text())['files']
    entries = rows.items() if isinstance(rows, dict) else [
        (row.get('file', row.get('path')), row) for row in rows]
    for name, row in entries:
        assert sha(p / name) == row['sha256'], name
    return len(rows)


def count_components(mask):
    pending = set(map(tuple, np.argwhere(mask)))
    count = 0
    while pending:
        count += 1
        todo = deque([pending.pop()])
        while todo:
            y, x = todo.popleft()
            for pos in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
                if pos in pending:
                    pending.remove(pos)
                    todo.append(pos)
    return count


def board(cels, out, label):
    for name, color in [('dark', (16,21,30)), ('pale', (201,212,220))]:
        im = Image.new('RGB', (1568, 850), color)
        text = ImageDraw.Draw(im)
        for i, cel in enumerate(cels):
            for row in range(2):
                image = Image.fromarray(cel, 'RGBA')
                if row:
                    image = ImageOps.mirror(image)
                image = image.resize((384,384), Image.Resampling.NEAREST)
                im.paste(image, (i*392,row*425), image)
                text.text((i*392+5,row*425+390), f'{label} {i}: actual96 NNx4', fill=(130,140,150))
        im.save(out / f'delivery96-NNx4-{name}-both-facings.png')


def finish(out, report, cells):
    page = np.concatenate(cells, axis=1)
    save(page, out / 'reviewed-four-cel-atlas96.png')
    board(cells, out, report['family'])
    report['atlasSha256'] = sha(out / 'reviewed-four-cel-atlas96.png')
    report['status'] = 'REVIEWED_EXACT_BACKGROUND_MASK_APPLIED_FINAL_VISUAL_REVIEW_PENDING'
    report['localNewArtworkOrMotion'] = False
    report['globalToleranceIncrease'] = False
    report['paletteRelearningOrRecolor'] = False
    report['gameEdits'] = False
    (out / 'checks.json').write_text(json.dumps(report, indent=2) + '\n')


def spread():
    p = BASE / 'zephyr-p2-spread-03-background-proposal-v1'
    before = verify_packet(p, 'f8d944e1cb81f323ee83971af7961defc6eb2775b61d87b8279987ad326d54c4')
    proposal = json.loads((p/'proposal.json').read_text())
    assert sha(Path(proposal['source'])) == proposal['sourceSHA256']
    original = BASE / 'zephyr-p2-spread-03-independent-v1'
    original_count = verify_packet(original, proposal['originalRejectedPacketManifestSHA256'])
    out = BASE / 'zephyr-p2-spread-03-reviewed-matte-v1'
    out.mkdir(exist_ok=True)
    records, cells = [], []
    for i in range(4):
        strict = read(original/f'strict-extraction/frames/frame-{i:03}.png')
        material = read(original/f'material-finish-128/native/frame-{i:03}.png')
        mask = np.zeros((512,512), dtype=bool)
        entry = next((r for r in proposal['components'] if r['tile']==i), None)
        if entry:
            assert sha(p/entry['mask512']) == entry['mask512SHA256']
            mask = np.asarray(Image.open(p/entry['mask512']).convert('L')) > 0
            assert int(mask.sum()) == entry['samples']
            assert not np.any(mask & (np.asarray(Image.open(p/entry['protectedRimMask'])) > 0))
            for value in entry['nativeCoordinateAndRawRGBAList']:
                x,y = value['native512']
                assert mask[y,x] and strict[y,x].tolist() == value['rawRGBA']
                assert max(strict[y-1,x,:3]) < 180, 'actual dark rim must remain above background run'
        changed_strict, changed_material = strict.copy(), material.copy()
        changed_strict[mask] = 0
        changed_material[mask] = 0
        assert np.array_equal(changed_strict[~mask], strict[~mask])
        assert np.array_equal(changed_material[~mask], material[~mask])
        save(changed_strict, out/f'strict-reviewed512/frame-{i:03}.png')
        save(changed_material, out/f'material-reviewed512/frame-{i:03}.png')
        cell = np.asarray(Image.fromarray(changed_material).resize((96,96),Image.Resampling.NEAREST))
        old = read(original/f'material-finish-128/game96/frame-{i:03}.png')
        projected = np.asarray(Image.fromarray(mask.astype('uint8')*255).resize((96,96),Image.Resampling.NEAREST)) > 0
        difference = np.any(cell != old, axis=2)
        assert np.array_equal(difference, projected)
        save(cell, out/f'game96/frame-{i:03}.png')
        cells.append(cell)
        records.append({'cel':i,'nativeBackgroundSamplesRemoved':int(mask.sum()),'gameSamplesRemoved':int(projected.sum()),'retainedStrictAndMaterialRGBAExact':True})
    assert sum(r['nativeBackgroundSamplesRemoved'] for r in records) == 27
    assert sum(r['gameSamplesRemoved'] for r in records) == 6
    finish(out, {'family':'Zephyr spread','proposalManifestSha256':'f8d944e1cb81f323ee83971af7961defc6eb2775b61d87b8279987ad326d54c4','proposalFilesVerified':before,'originalFilesVerified':original_count,'classification':'All27 are exterior pale-magenta background runs one pixel below an intact dark rim and separate from real amber exhaust. Exact complete components approved; no true paint removal.','anchor':[43,48],'frameTicks':[4]*4,'loop':True,'records':records}, cells)
    verify_packet(p, 'f8d944e1cb81f323ee83971af7961defc6eb2775b61d87b8279987ad326d54c4')
    print('Spread: 27 known background samples removed; six96samples only; all other pixels exact.')


def bront():
    p = BASE / 'bront-p2-hurt-04-fringe-mask-proposal-v1'
    before = verify_packet(p, '94c490e1d79614d2872d6d03d4e754a369f5abbbda2a4731eea1d6b321b8348d')
    proposal = json.loads((p/'proposal.json').read_text())
    assert sha(Path(proposal['sourceFile'])) == proposal['expectedSourceSha256']
    original = BASE / 'bront-p2-four-effects-candidate-v2'
    original_count = verify_packet(original, proposal['strictPacketFreezeSha256'])
    out = BASE / 'bront-p2-hurt-04-reviewed-matte-v1'
    out.mkdir(exist_ok=True)
    records, cells = [], []
    for entry in proposal['records']:
        i, tile = entry['cel'], entry['combinedV2Tile']
        strict_path = original/f'source-matte-frames/frame-{tile:03}.png'
        assert sha(strict_path) == entry['strictInputSha256']
        strict = read(strict_path)
        material = read(original/f'material-finish-128/native/frame-{tile:03}.png')
        mask_path = p/entry['proposalMask']
        assert sha(mask_path) == entry['proposalMaskSha256']
        mask = np.asarray(Image.open(mask_path).convert('L')) > 0
        assert int(mask.sum()) == entry['proposalPixels']
        assert count_components(mask) == entry['components4']
        assert np.all(strict[mask,3] == 255)
        colors = strict[mask,:3]
        assert np.all((colors[:,0]>180)&(colors[:,2]>180)&(colors[:,1]<90))
        for folder in ['protected-dark-case','protected-copper','protected-cyan-lime','ambiguous-KEEP-masks']:
            protected = np.asarray(Image.open(p/folder/f'cel-{i:03}.png').convert('L')) > 0
            assert not np.any(mask & protected), folder
        changed_strict, changed_material = strict.copy(), material.copy()
        changed_strict[mask] = 0
        changed_material[mask] = 0
        assert np.array_equal(changed_strict[~mask], strict[~mask])
        assert np.array_equal(changed_material[~mask], material[~mask])
        save(changed_strict,out/f'strict-reviewed1024/frame-{i:03}.png')
        save(changed_material,out/f'material-reviewed1024/frame-{i:03}.png')
        cell = np.asarray(Image.fromarray(changed_material).resize((96,96),Image.Resampling.NEAREST))
        save(cell,out/f'game96/frame-{i:03}.png')
        cells.append(cell)
        old = read(original/f'material-finish-128/game96/frame-{tile:03}.png')
        projected = np.asarray(Image.fromarray(mask.astype('uint8')*255).resize((96,96),Image.Resampling.NEAREST)) > 0
        assert np.array_equal(np.any(cell != old,axis=2),projected)
        records.append({'cel':i,'nativeBackgroundSamplesRemoved':int(mask.sum()),'completeComponents4':entry['components4'],'gameSamplesRemoved':int(projected.sum()),'ambiguousSamplesKept':entry['ambiguousPixelsExplicitlyKept'],'retainedStrictAndMaterialRGBAExact':True})
    assert sum(r['nativeBackgroundSamplesRemoved'] for r in records) == 13806
    assert sum(r['ambiguousSamplesKept'] for r in records) == 14175
    finish(out, {'family':'Bront hurt','proposalManifestSha256':sha(p/'freeze-manifest.json'),'proposalFilesVerified':before,'originalFilesVerified':original_count,'classification':'Exact reviewed high-magenta peripheral background mixing outside intact graphite/copper/cyan-lime paint. Native full/detail/pale/dark contexts inspected. Only named masks approved; all14175 ambiguous neighbors remain unchanged.','anchor':[48,48],'frameTicks':[2,1,1,2],'loop':False,'records':records},cells)
    verify_packet(p, '94c490e1d79614d2872d6d03d4e754a369f5abbbda2a4731eea1d6b321b8348d')
    print('Bront: exact13806 peripheral matte samples removed; all protected/ambiguous paint retained.')


if __name__ == '__main__':
    spread()
    bront()
