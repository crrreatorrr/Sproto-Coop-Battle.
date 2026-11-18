'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  const {analyzeStreamedMedia: analyze, canonicalStreamPath, MEDIA_LIMITS: limits, ACTION_NAMES, LOOPING_ACTION_NAMES} =
    await import('../scripts/streamed-media-budget.mjs');
  const key = '01-test-boss', T = 'assets/bosses/transformations/', A = 'assets/bosses/actions/';
  const copy = value => JSON.parse(JSON.stringify(value));
  const image = (src,w=220,h=220,bytes=1024) =>
    ({path:src,bytes,width:w,height:h,decodedBytes:w*h*4,sha256:'a'.repeat(64)});
  function fixture() {
    const phases=[0,1].map(n=>({sheet:`assets/bosses/test-p${n}.webp`,proj:`assets/bosses/test-p${n}-fx.png`}));
    return {manifest:{fighters:[],bosses:[{key,phases}]},registry:{version:1,clips:{},animations:{version:1,bosses:{}}},
      files:[{path:'index.html',bytes:100,sha256:'b'.repeat(64)},...phases.flatMap(p=>[image(p.sheet),image(p.proj,96,96)])]};
  }
  function transform(f,n=2,large=false) {
    const frames=large?80:n,srcs=Array.from({length:n},(_,i)=>T+'test-'+i+'.webp');
    const ticks=Array(frames).fill(Math.floor(480/frames));ticks[frames-1]+=480-ticks.reduce((a,b)=>a+b,0);
    const clip={cell:[220,220],anchor:[110,206],frameTicks:ticks,
      pages:srcs.map(src=>({src,columns:large?8:1,frames:large?40:1}))};
    f.registry.clips[key]=clip;
    f.files.push(...srcs.map(src=>image(src,large?1760:220,large?1100:220)));
    return clip;
  }
  function action(f,phase=0,padded=false) {
    const srcs=[A+'walk-0.webp',A+'walk-1.webp'],count=padded?10:1;
    const clip={cell:padded?[330,330]:[220,220],anchor:padded?[165,261]:[110,206],
      ...(padded?{coreRect:[55,55,220,220]}:{}),frameTicks:Array(count*2).fill(3),
      pages:srcs.map(src=>({src,columns:padded?5:1,frames:count}))};
    const phases=[{},{}];phases[phase]={actions:{walk:clip}};
    f.registry.animations.bosses[key]={phases};
    f.files.push(...srcs.map(src=>image(src,padded?1650:220,padded?660:220)));
    return clip;
  }
  function fx(f,purpose='hurt',phase=0) {
    const boss=f.registry.animations.bosses[key]||={phases:[{},{}]};
    const c={cell:[96,96],anchor:[48,48],frameTicks:[6],
      pages:[{src:f.manifest.bosses[0].phases[0].proj,columns:1,frames:1}]};
    boss.phases[phase].fx||={};boss.phases[phase].fx[purpose]=c;return c;
  }
  const run=f=>analyze(f.manifest,f.registry,f.files);
  const valid=r=>{assert.deepEqual(r.validationErrors,[]);assert.deepEqual(r.limitErrors,[]);};
  const invalid=f=>{const r=run(f);assert(r.validationErrors.length,'malformed source must diagnose');return r;};
  let count=0;
  function test(name,body){body();count++;console.log('stream budget:',name);}

  test('empty registration preserves every public/base byte',()=>{
    const f=fixture(),r=run(f);valid(r);assert.equal(r.optionalBytes,0);
    assert.equal(r.basePublicBytes,f.files.reduce((n,p)=>n+p.bytes,0));
  });
  test('valid complete480tick transform is optional without hiding any file',()=>{
    const f=fixture();transform(f);const r=run(f);valid(r);
    assert.equal(r.optionalCount,2);assert.equal(r.optionalBytes,2048);
    assert.equal(r.basePublicBytes+r.optionalBytes,f.files.reduce((n,p)=>n+p.bytes,0));
    assert.equal(r.registeredTransformClips,1);assert(r.scenes.some(s=>s.retainedTransformPages===2));
  });
  test('padded actions retain full atlas and held330cel dimensions',()=>{
    const f=fixture();action(f,0,true);const r=run(f);valid(r);
    const s=r.scenes.find(s=>s.retainedActionPages===2);
    assert.equal(s.actionDecodedBytes,8712000);assert.equal(s.heldCelBytes,435600);
  });
  test('unregistered namespace files stay base and fail diagnostics',()=>{
    const f=fixture();f.files.push(image(T+'orphan.webp'));const r=invalid(f);
    assert.equal(r.optionalCount,0);assert.equal(r.basePublicBytes,f.files.reduce((n,p)=>n+p.bytes,0));
  });
  test('ordinary unused files are still counted as base',()=>{
    const f=fixture();f.files.push(image('assets/ufo/unused.webp'));const r=run(f);valid(r);assert.equal(r.optionalBytes,0);
  });
  test('FX directory and pinned projectile paths never receive an exemption',()=>{
    const f=fixture();f.files.push(image('assets/bosses/fx/flare.webp',96,96));
    f.registry.animations.bosses[key]={phases:[{fx:{hurt:{pages:[{src:'assets/bosses/fx/flare.webp'}]}}},{}]};
    const r=run(f);valid(r);assert.equal(r.optionalBytes,0);
    assert(r.scenes[0].fallbackDecodedBytes>fixture().files.filter(x=>x.decodedBytes).reduce((n,x)=>n+x.decodedBytes,0));
  });
  test('aliases, URL queries, traversal, uppercase and wrong namespaces cannot classify',()=>{
    for(const alias of [T+'../test.webp',T+'./test.webp',T+'a//test.webp',T+'test.webp?v=1',T+'test.webp#x',
      '/'+T+'test.webp','https://example.com/'+T+'test.webp',T+'TEST.webp',T+'%74est.webp',A+'test.webp']) {
      const f=fixture(),c=transform(f);c.pages[0].src=alias;
      assert.equal(invalid(f).optionalCount,0,alias);
    }
    assert(canonicalStreamPath(T+'safe/nested-name.webp','transformations'));
    assert(!canonicalStreamPath(A+'safe.png','actions'));
  });
  test('unknown boss, phase and unreachable action registrations fail',()=>{
    let f=fixture();const c=transform(f);f.registry.clips.unknown=c;delete f.registry.clips[key];assert.equal(invalid(f).optionalCount,0);
    f=fixture();action(f);f.registry.animations.bosses[key].phases.push({actions:{}});assert.equal(invalid(f).optionalCount,0);
    f=fixture();action(f);const p=f.registry.animations.bosses[key].phases[0];p.actions.dance=p.actions.walk;delete p.actions.walk;
    assert.equal(invalid(f).optionalCount,0);
  });
  test('malformed registry containers diagnose without crashing',()=>{
    for(const edit of [f=>f.registry.clips=[],f=>f.registry.animations=1,
      f=>f.registry.animations.bosses=false,f=>f.registry.animations.bosses[key]={phases:{}},
      f=>f.registry.animations.bosses[key]={phases:[3]},f=>f.registry.animations.bosses[key]={phases:[{actions:[]}]}]) {
      const f=fixture();edit(f);invalid(f);
    }
  });
  test('phase shape agrees with the real loader for null, present undefined and sparse holes',()=>{
    function realGroups(f) {
      const scope={URL,performance,CoopBossTransformations:f.registry};scope.window=scope;
      vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/js/asset-loader.js'),'utf8'),scope);
      return scope.AssetLoader.groups(f.manifest);
    }
    for(const bad of [null,undefined]) {
      const f=fixture();action(f,1);f.registry.animations.bosses[key].phases[0]=bad;
      assert.throws(()=>realGroups(f),/actions/);
      const r=invalid(f);assert.equal(r.optionalCount,0,'invalid owner array cannot exempt the other phase');
      assert(r.validationErrors.some(e=>e.message==='phase must be an object'));
    }
    const f=fixture();action(f,1);delete f.registry.animations.bosses[key].phases[0];
    assert.equal(realGroups(f).actions.length,2);valid(run(f));assert.equal(run(f).optionalCount,2);
  });
  test('missing page, mismatched actual dimensions and bad frame totals are atomic',()=>{
    for(const edit of [f=>f.files.pop(),f=>f.files.at(-1).width++,f=>f.files.at(-1).decodedBytes++,
      f=>f.registry.clips[key].frameTicks.pop(),f=>f.registry.clips[key].frameTicks=[1,1],
      f=>f.registry.clips[key].anchor=[220,206]]) {
      const f=fixture();transform(f);edit(f);assert.equal(invalid(f).optionalCount,0);
    }
  });
  test('malformed action anchors, core rectangles and atlas cell bounds fail',()=>{
    for(const edit of [c=>c.anchor=[-1,206],c=>c.coreRect=[1,0,220,220],
      c=>c.pages[0].cells=[1,2],c=>{c.pages[0].rows=1;c.pages[0].firstCell=1;},
      c=>{c.pages[0].rows=1;c.pages[0].cells=[1];},c=>c.pages[0].columns=1.5]) {
      const f=fixture(),c=action(f);edit(c);assert.equal(invalid(f).optionalCount,0);
    }
  });
  test('encoded page cap allows exactly1MiB and rejects one extra byte',()=>{
    const f=fixture();transform(f);f.files.at(-1).bytes=limits.encodedPageBytes;valid(run(f));
    f.files.at(-1).bytes++;assert.equal(invalid(f).optionalCount,0);
  });
  test('texture and decoded page limits use actual complete page dimensions',()=>{
    const f=fixture(),c=transform(f);c.pages[0].columns=10;f.files.at(-2).width=2200;f.files.at(-2).decodedBytes=2200*220*4;
    assert.equal(invalid(f).optionalCount,0);
    for(const height of [1024,1025]) {
      const g=fixture(),a=action(g);a.cell=[1024,height];a.anchor=[0,0];a.pages=[{src:A+'walk-0.webp',columns:2,frames:2}];
      g.files=g.files.filter(p=>p.path!==A+'walk-1.webp');Object.assign(g.files.at(-1),image(A+'walk-0.webp',2048,height));
      const r=run(g);if(height===1024)valid(r);else assert(r.validationErrors.length);
    }
  });
  test('shared valid action pages count once globally and in residency',()=>{
    const f=fixture(),c=action(f);c.pages[1].src=c.pages[0].src;f.files.pop();
    f.registry.animations.bosses[key].phases[0].actions.lane=copy(c);
    const r=run(f);valid(r);assert.equal(r.optionalCount,1);assert.equal(r.optionalBytes,1024);
    assert(r.scenes.filter(s=>s.retainedActionPages).every(s=>s.retainedActionPages===1));
  });
  test('duplicate transform sources remain invalid under actual runtime planner',()=>{
    const f=fixture(),c=transform(f);c.pages[1].src=c.pages[0].src;assert.equal(invalid(f).optionalCount,0);
  });
  test('a source retained by a base consumer cannot be exempted by registration',()=>{
    const f=fixture(),c=action(f);f.manifest.bosses[0].phases[0].proj=c.pages[0].src;assert.equal(invalid(f).optionalCount,0);
  });
  test('64MiB total is distinct from per-page encoded checks',()=>{
    for(const n of [64,65]) {
      const f=fixture();transform(f,n);for(const file of f.files.filter(p=>p.path.startsWith(T)))file.bytes=limits.encodedPageBytes;
      const r=run(f);assert.deepEqual(r.validationErrors,[]);assert.equal(r.optionalBytes,n*limits.encodedPageBytes);
      if(n===64)assert.deepEqual(r.limitErrors,[]);else assert(r.limitErrors.some(e=>e.includes('64 MiB')));
    }
  });
  test('fallback/FX banks are included during transform overlap',()=>{
    const f=fixture();transform(f,2,true);
    for(const file of f.files.filter(p=>p.path.includes('test-p')))Object.assign(file,image(file.path,1024,1024));
    valid(run(f));const src='assets/bosses/fx/additional.png';f.files.push(image(src,768,768));
    f.registry.animations.bosses[key]={phases:[{fx:{hurt:{pages:[{src}]}}},{}]};
    const r=run(f);assert.deepEqual(r.validationErrors,[]);assert(r.limitErrors.some(e=>e.includes('32 MiB')));
    assert(r.scenes.find(s=>s.state==='transform-page-0').fallbackDecodedBytes>16*1024*1024);
  });
  test('P1 action overlap includes T standby and held cel, P2 excludes standby',()=>{
    for(const phase of [0,1]) {
      const f=fixture();transform(f,2,true);action(f,phase,true);
      for(const file of f.files.filter(p=>p.path.includes('test-p')))Object.assign(file,image(file.path,1250,850));
      const r=run(f),row=r.scenes.find(s=>s.retainedActionPages===2);assert.deepEqual(r.validationErrors,[]);
      assert.equal(row.heldCelBytes,435600);assert.equal(row.fallbackDecodedBytes,17000000);
      assert.equal(row.transformDecodedBytes,phase===0?7744000:0);
      if(phase===0)assert(r.limitErrors.some(e=>e.includes('32 MiB')));else assert.deepEqual(r.limitErrors,[]);
    }
  });
  test('more than two total pages is valid but only current/next are retained',()=>{
    const f=fixture();transform(f,4);const r=run(f);valid(r);assert.equal(r.optionalCount,4);
    assert(r.scenes.every(s=>s.retainedTransformPages<=2));
  });
  test('looping action residency includes the last-to-first page pair',()=>{
    for(const looping of [true,false]) {
      const f=fixture(),c=action(f,0,true);f.files=f.files.filter(p=>!p.path.startsWith(A));
      c.pages=[10,1,10].map((frames,i)=>({src:A+'loop-'+i+'.webp',columns:frames===1?1:5,frames}));
      c.frameTicks=Array(21).fill(3);
      f.files.push(...c.pages.map(p=>image(p.src,p.columns*330,p.frames===1?330:660)));
      if(!looping){const actions=f.registry.animations.bosses[key].phases[0].actions;actions.sweep=c;delete actions.walk;}
      const r=run(f);valid(r);const last=r.scenes.find(s=>s.state.endsWith('/page-2'));
      assert.equal(last.actionDecodedBytes,looping?8712000:4356000);
    }
  });
  test('normal next-boss prefetch also respects presentation envelope',()=>{
    const f=fixture();const other=copy(f.manifest.bosses[0]);other.key='02-other';
    other.phases=other.phases.map(p=>({sheet:p.sheet.replace('test-','other-'),proj:p.proj.replace('test-','other-')}));
    f.manifest.bosses.push(other);f.files.push(...other.phases.flatMap(p=>[image(p.sheet,1250,850),image(p.proj,1250,850)]));
    for(const file of f.files.filter(p=>p.path.includes('test-p')))Object.assign(file,image(file.path,1250,850));
    const r=run(f);assert(r.limitErrors.some(e=>e.includes('fallback-and-next-prefetch')));assert.equal(r.optionalBytes,0);
  });
  test('32MiB exact boundary passes and four extra decoded bytes fail',()=>{
    const f=fixture();for(const file of f.files.filter(p=>p.decodedBytes))Object.assign(file,image(file.path,1,limits.presentationBytes/16));
    assert.equal(run(f).maxPresentationDecodedBytes,limits.presentationBytes);valid(run(f));
    f.files[1].height++;f.files[1].decodedBytes+=4;assert(run(f).limitErrors.some(e=>e.includes('32 MiB')));
  });
  test('valid registered FX reserves one global native scratch in every scene',()=>{
    const f=fixture();transform(f);const before=run(f);fx(f);const after=run(f);valid(after);
    assert.equal(after.fxScratchDecodedBytes,96*96*4);assert.equal(after.optionalBytes,before.optionalBytes);
    assert.equal(after.basePublicBytes,before.basePublicBytes,'FX never gains an optional-media exemption');
    for(let i=0;i<after.scenes.length;i++){
      assert.equal(after.scenes[i].fxScratchDecodedBytes,36864);
      assert.equal(after.scenes[i].decodedBytes-before.scenes[i].decodedBytes,36864);
    }
  });
  test('invalid or unreachable FX metadata does not allocate a reserve',()=>{
    for(const edit of [c=>c.cell=[128,96],c=>c.anchor=[96,48],c=>c.coreRect=[0,0,95,96],
      c=>c.pages[0].src=A+'bad.webp',c=>c.pages[0].src='assets/bosses/./bad.png',
      c=>c.pages[0].src='assets/bosses/bad.png?query=1',c=>c.pages[0].columns=1000,
      c=>{c.frameTicks=Array(65).fill(1);c.pages[0].columns=8;c.pages[0].frames=65;}]){
      const f=fixture(),c=fx(f);edit(c);assert.equal(run(f).fxScratchDecodedBytes,0);
    }
    for(const purpose of ['unreachable','toString']){const f=fixture();fx(f,purpose);assert.equal(run(f).fxScratchDecodedBytes,0);}
  });
  test('many valid FX purposes/phases share one scratch rather than a cache',()=>{
    const f=fixture();for(const phase of [0,1])for(const purpose of ['signature','special','hurt','death'])fx(f,purpose,phase);
    const r=run(f);valid(r);assert.equal(r.fxScratchPlans.length,8);assert.equal(r.fxScratchDecodedBytes,36864);
    assert(r.scenes.every(s=>s.fxScratchDecodedBytes===36864));assert.equal(r.optionalBytes,0);
  });
  test('FX64frame and complete native-core limits mirror the runtime',()=>{
    for(const frames of [64,65]){
      const f=fixture(),c=fx(f);c.frameTicks=Array(frames).fill(1);c.pages[0].columns=8;c.pages[0].frames=frames;
      Object.assign(f.files.find(p=>p.path===c.pages[0].src),image(c.pages[0].src,768,Math.ceil(frames/8)*96));
      const r=run(f);valid(r);assert.equal(r.fxScratchDecodedBytes,frames===64?36864:0);
    }
  });
  test('32MiB boundary includes the scratch, with no cap increase',()=>{
    const f=fixture();fx(f);
    const baseWithoutFirst=f.files.filter(p=>p.decodedBytes&&p!==f.files[1]).reduce((n,p)=>n+p.decodedBytes,0);
    const firstHeight=(limits.presentationBytes-36864-baseWithoutFirst)/4;
    Object.assign(f.files[1],image(f.files[1].path,1,firstHeight));
    const r=run(f);valid(r);assert.equal(r.maxPresentationDecodedBytes,limits.presentationBytes);
    assert.equal(r.fxScratchDecodedBytes,36864);f.files[1].height++;f.files[1].decodedBytes+=4;
    assert(run(f).limitErrors.some(e=>e.includes('32 MiB')));
  });
  test('policy action names agree with actual reachable selector outputs',()=>{
    const scope={};scope.window=scope;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/js/boss-action-selection.js'),'utf8'),scope);
    const select=scope.CoopBossActionSelection.select;
    const samples=[{st:'idle'},{st:'fire',row:1},{st:'fire',row:2},{st:'fire',mi:1},
      {st:'charge',t:0},{st:'charge',t:40,fc:-1,x:400},{st:'charge',t:40,fc:-1,x:70},
      ...['sweep','signature','special','dead'].map(st=>({st})),{st:'idle',ar:2,su:1}];
    assert.deepEqual([...new Set(samples.map(s=>select(s).action))].sort(),[...ACTION_NAMES].sort());
    assert.deepEqual([...new Set(samples.map(s=>select(s)).filter(s=>s.loop).map(s=>s.action))].sort(),[...LOOPING_ACTION_NAMES].sort());
  });
  console.log(`streamed media budget adversarial checks ok (${count} groups)`);
}
main().catch(error=>{console.error(error);process.exit(1);});
