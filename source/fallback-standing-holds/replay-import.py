"""Read-only portable replay of interim standing banks and accepted FX packing.

Pass the game root; no author workspace, generator or new poses are required.
"""
from pathlib import Path
import argparse,hashlib,json
from PIL import Image

sha=lambda path:hashlib.sha256(Path(path).read_bytes()).hexdigest()
rgba_sha=lambda im:hashlib.sha256(im.convert('RGBA').tobytes()).hexdigest()
def need(value,message):
    if not value:raise AssertionError(message)
def verify(root):
    root=Path(root).resolve();folder=root/'source/fallback-standing-holds'
    manifest=json.loads((folder/'manifest.json').read_text());rows=[]
    for bank in manifest['banks']:
        original=Image.open(folder/bank['originalFile']).convert('RGBA')
        need(sha(folder/bank['originalFile'])==bank['originalEncodedSha256'],'Original bank changed')
        ep=bank['sourceEndpoint'];atlas=Image.open(root/ep['file']).convert('RGBA');x,y,w,h=ep['rect']
        endpoint=atlas.crop((x,y,x+w,y+h));need(rgba_sha(endpoint)==ep['decodedRgbaSha256'],'Endpoint changed')
        expected=original.copy()
        expected.paste(endpoint,(0,0))
        current=Image.open(root/'public'/bank['public']).convert('RGBA')
        need(current.size==original.size==tuple(bank['size']),'Bank grid changed')
        need(current.tobytes()==expected.tobytes(),'Bank differs from exact source replay')
        need(sha(root/'public'/bank['public'])==bank['newEncodedSha256'],'Installed encoding changed')
        attack=current.crop((0,220,current.width,current.height))
        need(rgba_sha(attack)==bank['attackDecodedRgbaSha256'],'Attack rows changed')
        need(rgba_sha(current)==bank['wholeBankDecodedRgbaSha256'],'Whole decoded bank changed')
        walking=current.crop((220,0,880,220))
        need(walking.tobytes()==original.crop((220,0,880,220)).tobytes(),'Original walk cels changed')
        need(rgba_sha(walking)==bank['walkDecodedRgbaSha256'],'Walk-region hash changed')
        need(len({current.crop((c*220,0,(c+1)*220,220)).tobytes() for c in range(4)})>=3,'Walk distinctness lost')
        rows.append({'public':bank['public'],'sourceReplayRGBAMismatches':0,'attackRGBAMismatches':0,
            'walkRGBAMismatches':0,'standingCopiesExact':1,'originalWalkCelsPreserved':3})
    fx=root/'source/effects/04-ranch-zephyr/phase-2';proof=json.loads((fx/'provenance.json').read_text())
    old=Image.open(fx/'original-projectile-bank.png').convert('RGBA');accepted=Image.open(fx/'accepted-effects-atlas96.png').convert('RGBA')
    actual=Image.open(root/'public'/proof['public']).convert('RGBA')
    need(actual.size==(384,768),'FX bank dimensions')
    need(actual.crop((0,0,384,384)).tobytes()==old.tobytes(),'Legacy top four FX rows changed')
    need(actual.crop((0,384,384,768)).tobytes()==accepted.tobytes(),'Accepted bottom four FX rows changed')
    need(sha(root/'public'/proof['public'])==proof['publicEncodedSha256'],'FX encoded source changed')
    return {'status':'PASS','bodyBanks':len(rows),'standingCopiesExact':len(rows),
        'originalWalkCelsPreserved':len(rows)*3,
        'attackCelsPreserved':manifest['attackCelsPreserved'],'newWalkingOrMotionPoses':0,
        'oldProjectileCelsPreserved':16,'acceptedEffectCelsExact':16,'fxTopAndBottomRGBAMismatches':0,'banks':rows}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('game_root',type=Path);args=parser.parse_args()
    print(json.dumps(verify(args.game_root),indent=2))
