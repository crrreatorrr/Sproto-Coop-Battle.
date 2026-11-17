"""Exact authoring-to-playback checks using tiny synthetic test cells."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('sprite_packer', ROOT.parent/'tools/pack-sprite-clips.py')
packer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packer)

with tempfile.TemporaryDirectory(prefix='sprite-packer-check-') as temporary:
    root = Path(temporary)
    cells = []
    for n in range(5):
        cel = Image.new('RGBA',(8,8))
        cel.putpixel((2,3),(n*30,93,171,255))
        cel.putpixel((4,5),(32,45,n*40,0))  # Preserve RGB under transparent pixels too.
        cel.save(root/f'cel-{n}.png')
        cells.append(cel)
    sequences = {'lane':[0,1,2,0,4,3,0], 'walk':[0,1,0]}
    raw = {'id':'test-sprite-set','assetPrefix':'assets/test/clips','cell':[8,8],'anchor':[4,7],
           'columns':2,'pageFrames':2,'clips':{name:{'loop':name=='walk','frames':[
               {'file':f'cel-{index}.png','ticks':3 if i!=2 else 2}
               for i,index in enumerate(sequence)]} for name,sequence in sequences.items()}}
    input_file = root/'input.json'
    input_file.write_text(json.dumps(raw))
    result = packer.pack(input_file,root/'packed',root/'proof.json')
    assert result['sourceCelCount']==10 and result['uniqueCelCount']==5
    for name,sequence in sequences.items():
        replay = []
        for page in result['clips'][name]['pages']:
            with Image.open(root/'packed'/Path(page['src']).name) as atlas:
                for index in page['cells']:
                    x,y=(index%page['columns'])*8,(index//page['columns'])*8
                    replay.append(atlas.convert('RGBA').crop((x,y,x+8,y+8)))
        assert len(replay)==len(sequence)
        for actual,index in zip(replay,sequence):
            assert ImageChops.difference(actual,cells[index]).getbbox(alpha_only=False) is None
    timeline_code = """
const fs=require('node:fs');
const timeline=require(process.argv[1]);
const proof=JSON.parse(fs.readFileSync(process.argv[2]));
for(const clip of Object.values(proof.clips)) {
  const plan=timeline.plan(clip,{allowRepeatedSources:true});
  let tick=0,frame=0;
  for(const duration of clip.frameTicks) {
    if(plan.at(tick).frame!==frame || plan.at(tick+duration-.001).frame!==frame) throw Error('Timing');
    tick+=duration;frame++;
  }
}
"""
    subprocess.run(['node','-e',timeline_code,str(ROOT.parent/'public/js/sprite-timeline.js'),str(root/'proof.json')],check=True)
    # Repacking a different atlas layout must never reuse the old content URL.
    original_urls={p['src'] for p in result['pages']}
    raw['columns']=1
    input_file.write_text(json.dumps(raw))
    changed=packer.pack(input_file,root/'packed-column',root/'proof-column.json')
    assert all(a['src']!=b['src'] for a,b in zip(result['pages'][:2],changed['pages'][:2]))
    # Validation happens before installing any page or provenance file.
    raw['clips']['walk']['frames'][0]['ticks']=0
    input_file.write_text(json.dumps(raw))
    try:
        packer.pack(input_file,root/'invalid',root/'invalid-proof.json')
    except ValueError:
        pass
    else:
        raise AssertionError('Accepted a zero-duration frame')
    assert not (root/'invalid').exists() and not (root/'invalid-proof.json').exists()
report={'status':'PASS','authoredCelsReplayed':10,'uniqueCels':5,
        'checks':['exact RGBA including transparent RGB','shared/revisited atlas pages',
                  'irregular duration boundaries','content URLs include layout','reject before install'],
        'gameFilesChanged':False,'newAnimationArt':False}
(ROOT/'artifacts').mkdir(exist_ok=True)
(ROOT/'artifacts/sprite-packer.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
