'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
globalThis.window = globalThis;
require('../public/js/manifest.js');
const Sim = require('../public/js/sim.js');
const select = require('../public/js/boss-fx-selection.js');
const timeline = require('../public/js/sprite-timeline.js');
const M = globalThis.MANIFEST;
const copy = value => JSON.parse(JSON.stringify(value));

// Fixtures supply an arena and inputs, then let the pinned simulation create
// projectiles, impacts, flash, death and removal ages through its real paths.
function arena(phase = 0, changes = {}) {
  const state = Sim.create(Array.from({length:4}, (_,i) => ({fid:i,weapon:0,ctrl:'local'})), 135);
  Sim.startStage(state, 0);
  state.enemies = []; state.items = [];
  state.stage.waves.forEach(w => { w.done = true; });
  state.lockX = state.camX;
  state.boss = {bi:0,phase,hp:9000,maxHp:9000,x:state.camX+420,y:60,z:0,
    face:-1,st:'fire',t:29,row:1,w:150,cycle:0,flash:0,tx:0,ty:60,
    hitCd:0,adds:0,arch:0,addT:0,warn:[60],both:true,...changes};
  for (const p of state.players) Object.assign(p,{x:state.camX+100,y:112,inv:9999,in:{}});
  return state;
}
function step(state, count = 1) {
  for (let i=0;i<count;i++) Sim.step(state);
  return Sim.snapshot(state);
}
function strike(state) {
  Object.assign(state.players[0],{x:state.boss.x-110,y:60,face:1,weapon:0,
    st:'attack',t:4,combo:1,launch:false,hitDone:new Set(),in:{}});
}
function extra(bi, mode) {
  const state = arena(1,{bi,st:mode,t:0});
  const attack = Sim.bossExtraAttack(bi,mode), b=state.boss;
  b.extraZones = attack.zones.map(([x,y,w,d,delay,rounded]) => [
    Math.round(Sim.clamp(b.x+x*b.face,state.camX+42,state.camX+Sim.W-42)),
    Math.round(Sim.clamp(b.y+y,0,Sim.DEPTH)),w,d,delay,rounded]);
  return {state,attack};
}
function choices(snapshot) {
  return {projectiles:snapshot.projs.map(select.projectile),
    effects:snapshot.fx.map(select.effect),overlays:select.overlays(snapshot.boss)};
}
function reconnect(state) {
  const restored = Sim.importState(copy(Sim.exportState(state)));
  assert.deepEqual(Sim.snapshot(restored),Sim.snapshot(state),'restart export retains authoritative ages and owners');
  assert.deepEqual(choices(Sim.snapshot(restored)),choices(Sim.snapshot(state)));
  return restored;
}

const shotSnapshots = [];
for (const phase of [0,1]) for (const [row,missile,purpose,count] of [
  [1,false,'lane',2],[2,false,'spread',2],[3,true,'homing',phase ? 4 : 2]]) {
  const state=arena(phase,{row,missile});
  const snapshot=step(state);
  assert.equal(snapshot.projs.length,count);
  assert(snapshot.projs.some(p=>p.vx<0)&&snapshot.projs.some(p=>p.vx>0),'real middle-room volley emits both ways');
  for (const p of snapshot.projs) {
    assert.equal(select.projectile(p).purpose,purpose);
    assert.equal(select.projectile(p).phase,phase);
    assert.equal(select.projectile(p).age,p.t);
    if (!missile) assert.equal(p.z,16,'visual metadata never changes low-lane elevation');
  }
  shotSnapshots.push(snapshot);
  reconnect(state);
}

// A surviving P1 shot hits on the exact tick that a player transforms its owner
// into P2. The impact must keep the projectile's P1 source, not the actor's P2.
const transition=arena();
const before=step(transition), incoming=before.projs.find(p=>p.vx<0);
transition.boss.hp=4501;
strike(transition);
Object.assign(transition.players[1],{x:incoming.x+incoming.vx,y:incoming.y,inv:0,hp:100,st:'idle'});
const transitionSnapshot=step(transition);
assert.equal(transitionSnapshot.boss.st,'transform');
assert.equal(transitionSnapshot.boss.ph,1);
const oldImpact=transitionSnapshot.fx.find(f=>f.k==='bossImpact');
assert(oldImpact,'real projectile collision produced an impact');
assert.equal(oldImpact.ph,0);
assert.equal(select.effect(oldImpact).purpose,'impact');
assert.equal(select.effect(oldImpact).phase,0);
assert.deepEqual(select.overlays(transitionSnapshot.boss),[],'phase-less flash cannot bleed into transformation');
reconnect(transition);

// Exercise each boss's actual signature and special releases, including every
// delayed zone. Lifetimes come from simulation removal, not a render clock.
const impactSnapshots={};
for (const [bi, info] of M.bosses.entries()) for (const mode of ['signature','special']) {
  if (info.attacks === 'bar') continue; // Dedicated Last Call attacks have their own simulation and browser suites.
  const {state,attack}=extra(bi,mode), emitted=new Map(), life=mode==='special'?36:24;
  const end=attack.warning+Math.max(...attack.zones.map(z=>z[4]))+life+1;
  for(let tick=1;tick<=end;tick++) {
    const snapshot=step(state);
    for (const f of snapshot.fx.filter(f=>f.k==='bossImpact'||f.k==='bossSpecialImpact')) {
      const choice=select.effect(f);
      assert.equal(choice.purpose,mode);
      assert.equal(choice.phase,1);
      assert.equal(choice.bossIndex,bi);
      assert.equal(choice.ended,false);
      assert(f.t<life);
      if (!emitted.has(f.id)) emitted.set(f.id,{first:tick,event:copy(f)});
      emitted.get(f.id).last=tick;
      if(bi===0&&f.t===7) impactSnapshots[mode]=copy(snapshot);
    }
    if(bi===0&&tick===attack.warning+8) {
      const restored=reconnect(state);
      assert.deepEqual(step(restored),step(Sim.importState(copy(Sim.exportState(state)))),
        'a restarted simulation produces the same next FX snapshot');
    }
  }
  assert.equal(emitted.size,attack.zones.length,'all real delayed attack zones emitted exactly once');
  for(const {first,last,event} of emitted.values()) {
    assert.equal(last-first+1,life-1,'spawn tick is age one; effect disappears at its finite end');
    assert.equal(select.effect({...event,t:life}).ended,true);
  }
}

const hurt=arena(1);
strike(hurt);
const hurtSnapshot=step(hurt);
assert.equal(hurtSnapshot.boss.st,'fire');
assert(hurtSnapshot.projs.length,'a hurt flash does not interrupt the real firing release');
assert.deepEqual(select.overlays(hurtSnapshot.boss).map(c=>[c.purpose,c.phase,c.age]),[['hurt',1,1]]);
assert.equal(select.effect(hurtSnapshot.fx.find(f=>f.k==='bossHit')),null,'phase-less hit chips retain their existing renderer');
step(hurt,5);
assert.deepEqual(select.overlays(Sim.snapshot(hurt).boss),[],'hurt overlay ends with the authoritative flash');

const dying=arena(1,{hp:5});
strike(dying);
let deathSnapshot=step(dying);
assert.equal(deathSnapshot.boss.st,'dead');
assert.equal(select.overlays(deathSnapshot.boss)[0].purpose,'death');
step(dying,112);
const joined=reconnect(dying);
for(let tick=114;tick<=151;tick++) {
  deathSnapshot=step(dying);
  assert.deepEqual(deathSnapshot,step(joined),'reconnect continues the exact finite death and generic boom sequence');
  if(tick<=150) assert.equal(select.overlays(deathSnapshot.boss)[0].age,tick);
  else assert.equal(deathSnapshot.boss,null,'boss overlay owner disappears at the existing simulation end');
  for(const f of deathSnapshot.fx.filter(f=>f.k==='boom')) {
    assert.equal(f.bi,undefined); assert.equal(f.ph,undefined);
    assert.equal(select.effect(f),null,'random death booms cannot be inferred to belong to the current actor');
  }
}
assert.deepEqual(select.overlays({bi:0,ph:1,st:'dead',t:151}),[]);

function clip(src,row,ticks=[2,3,4,5]) {
  return {cell:[96,96],anchor:[48,48],frameTicks:ticks,
    pages:[{src,columns:4,rows:8,frames:4,firstCell:row*4}]};
}
const animations={bosses:{}};
for(const boss of M.bosses) animations.bosses[boss.key]={phases:boss.phases.map(ph=>({fx:
  Object.fromEntries(Object.entries(select.rows).map(([purpose,row])=>[purpose,clip(ph.proj,row)]))}))};

// Render through the public world renderer, using actual simulation snapshots.
// The mock records source rectangles and transforms, not reimplemented drawing.
function renderer(registry=animations) {
  const images=new Map(), requested=[], calls=[], copies=[], canvases=[], stack=[];
  let transform={x:0,y:0,sx:1,sy:1};
  const context=new Proxy({globalAlpha:1,
    save(){stack.push({...transform});},restore(){transform=stack.pop();},
    translate(x,y){transform.x+=x*transform.sx;transform.y+=y*transform.sy;},
    scale(x,y){transform.sx*=x;transform.sy*=y;},
    drawImage(...args){
      const worldArgs=args.slice(1), copied=args[0].fxCopy;
      if (copied) {
        assert.deepEqual(worldArgs.slice(0,4),[0,0,96,96],'world sampling uses the normalized cel origin');
        // Trace the real source-copy/world-draw chain for existing selection
        // assertions while retaining the actual world rectangle separately.
        args=[copied[0],...copied.slice(1,5),...args.slice(5)];
      }
      calls.push({args,worldArgs,copiedSource:copied?copied.slice(1,5):null,transform:{...transform}});
    },
    createLinearGradient(){return {addColorStop(){}};},
  },{get:(object,key)=>key in object?object[key]:()=>{}});
  for(const boss of M.bosses) for(const ph of boss.phases) {
    images.set(ph.sheet,{tag:'actor',naturalWidth:880,naturalHeight:1760});
    images.set(ph.proj,{tag:ph.proj,naturalWidth:384,naturalHeight:768});
  }
  const scope={Sim,MANIFEST:M,AssetLoader:{lru:()=>new Map()},
    CoopBossTransformations:{animations:registry},
    document:{createElement:()=>{
      const canvas={width:0,height:0};
      const cell={
        clearRect(...args){assert.deepEqual(args,[0,0,96,96]);canvas.fxCopy=null;},
        drawImage(...args){
          assert.equal(canvas.fxCopy,null,'transparent cel regions are cleared before every copy');
          assert.deepEqual(args.slice(3),[96,96,0,0,96,96]);
          assert.equal(cell.imageSmoothingEnabled,false,'source copy remains one-to-one');
          canvas.fxCopy=args.slice();copies.push(args.slice());
        },
      };
      canvas.getContext=()=>cell;canvases.push(canvas);return canvas;
    }},
    Render:{img:src=>{requested.push(src);return images.get(src);},ready:im=>!!im,
      text(){},frameCanvas:()=>null,canFilter:()=>false,drawFighter(){},drawBackground(){},
      weapon:()=>({c:{width:32,height:32},gx:0,gy:0})}};
  scope.window=scope;
  for(const name of ['sprite-timeline','boss-fx-selection','render-fx']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/js/'+name+'.js'),'utf8'),scope);
  }
  return {scope,images,requested,copies,canvases,draw(snapshot){
    calls.length=0;copies.length=0;
    const original=JSON.stringify(snapshot);
    scope.RenderFx.drawWorld(context,snapshot,{noBanner:true});
    assert.equal(JSON.stringify(snapshot),original,'render never mutates the authoritative snapshot');
    assert.equal(stack.length,0);
    return calls.filter(c=>c.args[0].tag!=='actor');
  }};
}
function fxDraws(r,snapshot,src) { return r.draw(snapshot).filter(c=>c.args[0].tag===src); }
const rendered=renderer();
for(const snapshot of shotSnapshots) {
  const draws=rendered.draw(snapshot);
  assert.equal(draws.length,snapshot.projs.length);
  for(const p of snapshot.projs) {
    const choice=select.projectile(p),draw=draws.find(c=>
      c.transform.x===Math.round(p.x-snapshot.camX)&&
      c.transform.y===Math.round(Sim.FLOOR_TOP+p.y-p.z));
    assert(draw,'depth-sorted draw retains the exact projectile position');
    assert.equal(draw.args[0].tag,M.bosses[p.bi].phases[p.ph].proj);
    assert.equal(draw.args[2],choice.row*96);
    assert.equal(draw.transform.x,Math.round(p.x-snapshot.camX));
    assert.equal(draw.transform.y,Math.round(Sim.FLOOR_TOP+p.y-p.z));
    assert.equal(draw.transform.sx,p.vx>0?-1:1,'existing facing is retained');
  }
}
assert.equal(rendered.canvases.length,1,'all registered FX share one reusable source-cell scratch');
assert.equal(rendered.canvases[0].width*rendered.canvases[0].height*4,36864,'scratch decoded bytes stay bounded');
rendered.canvases[0].width=1;rendered.canvases[0].height=1;
rendered.draw(shotSnapshots[0]);
assert.equal(rendered.canvases.length,1,'a resized scratch is reused');
assert.equal(rendered.canvases[0].width*rendered.canvases[0].height*4,36864,'scratch dimensions are restored before copying');
for(const mode of ['signature','special']) {
  const snapshot=impactSnapshots[mode],event=snapshot.fx.find(f=>select.effect(f)?.purpose===mode);
  const src=M.bosses[event.bi].phases[event.ph].proj;
  const draws=fxDraws(rendered,snapshot,src);
  assert(draws.some(c=>c.args[2]===select.rows[mode]*96));
  const detached=copy(snapshot); detached.boss=null;
  assert.deepEqual(fxDraws(renderer(),detached,src),draws,'event visuals survive actor removal and fresh-client join');
  const ended=copy(detached);ended.fx=ended.fx.map(f=>({...f,t:mode==='special'?36:24}));
  assert.equal(fxDraws(rendered,ended,src).length,0,'stale finite event cannot loop or leak its final cel');
}

// Grounding is an optional visual origin for event-owned signature/special
// clips. It never edits the snapshot z, damage zone or finite event timeline.
for(const mode of ['signature','special']) {
  const snapshot=impactSnapshots[mode],registry=copy(animations);
  const event=snapshot.fx.find(f=>select.effect(f)?.purpose===mode);
  const src=M.bosses[event.bi].phases[event.ph].proj;
  const authored=registry.bosses[M.bosses[event.bi].key].phases[event.ph].fx[mode];
  authored.grounded=true;authored.anchor=[48,95];
  const r=renderer(registry),original=copy(snapshot),draws=fxDraws(r,snapshot,src);
  const shakeY=snapshot.sk?Math.round(Math.cos(snapshot.t*2.3)*snapshot.sk*.6):0;
  for(const f of snapshot.fx.filter(f=>select.effect(f)?.purpose===mode)) {
    const shakeX=snapshot.sk?Math.round(Math.sin(snapshot.t*1.7)*snapshot.sk):0;
    const draw=draws.find(c=>c.args[2]===select.rows[mode]*96&&
      c.transform.x===shakeX+Math.round(f.x-snapshot.camX));
    assert(draw,'actual zone event drew its grounded source cel');
    assert.equal(draw.transform.y,shakeY+Math.round(Sim.FLOOR_TOP+f.y));
    const size=mode==='special'?f.sm+25:f.sm||82;
    assert.equal(draw.args[6],-95*size/96);
    assert(Math.abs(draw.args[6]+95*draw.args[8]/96)<1e-9,
      'opaque contact edge95 lands on the exact floor at every effect size');
  }
  assert.deepEqual(snapshot,original,'grounding preserves snapshot collision position and elevation');
  const detached=copy(snapshot);detached.boss=null;
  assert.deepEqual(fxDraws(renderer(registry),detached,src),draws,'ground origin does not depend on current actor state');
  for(const flag of [false,undefined,'true',1]) {
    const ungrounded=copy(animations);
    ungrounded.bosses[M.bosses[event.bi].key].phases[event.ph].fx[mode].grounded=flag;
    assert.deepEqual(fxDraws(renderer(ungrounded),snapshot,src),fxDraws(renderer(),snapshot,src),
      'only explicit boolean true changes the visual origin');
  }
  const unavailable=copy(registry);
  unavailable.bosses[M.bosses[event.bi].key].phases[event.ph].fx[mode].pages[0].src='assets/bosses/fx/pending.webp';
  const pending=fxDraws(renderer(unavailable),snapshot,src),legacy=fxDraws(renderer({}),snapshot,src);
  assert.deepEqual(pending,legacy,'undecoded grounded art retains legacy elevated placement');
}
const activeExtra=extra(0,'special');step(activeExtra.state,activeExtra.attack.warning+2);
const stateBeforeDraw=Sim.exportState(activeExtra.state),allGroundFlags=copy(animations);
for(const boss of Object.values(allGroundFlags.bosses))for(const phase of boss.phases)
  for(const fx of Object.values(phase.fx))fx.grounded=true;
renderer(allGroundFlags).draw(Sim.snapshot(activeExtra.state));
assert.deepEqual(Sim.exportState(activeExtra.state),stateBeforeDraw,'live collision/event restart state is unchanged by grounded rendering');
for(const snapshot of shotSnapshots.concat([hurtSnapshot])) {
  assert.deepEqual(renderer(allGroundFlags).draw(snapshot),renderer().draw(snapshot),
    'projectile elevation and hurt overlays ignore grounded flags');
}
const transitionDraws=fxDraws(rendered,transitionSnapshot,M.bosses[0].phases[0].proj);
assert(transitionDraws.some(c=>c.args[2]===3*96),'P1 impact keeps its original atlas during P2 transform');
assert(fxDraws(rendered,hurtSnapshot,M.bosses[0].phases[1].proj).some(c=>c.args[2]===6*96));
const afterRemoval=Sim.snapshot(Sim.importState(copy(Sim.exportState(joined))));
// Use the still-live death owner captured from a real run before removal.
const deathRun=arena(1,{hp:5}); strike(deathRun);step(deathRun,113);
const liveDeath=Sim.snapshot(deathRun);
assert(fxDraws(rendered,liveDeath,M.bosses[0].phases[1].proj).some(c=>c.args[2]===7*96));
assert.equal(rendered.draw(afterRemoval).length,0,'untagged booms after owner removal stay generic');
assert.deepEqual(renderer(allGroundFlags).draw(liveDeath),renderer().draw(liveDeath),
  'death overlay and untagged booms ignore grounded flags');

// Finite clips clamp after their own last cel; projectile clips loop from the
// serialized age, including a fresh renderer joining after several cycles.
const sequence=timeline.plan(clip(M.bosses[0].phases[0].proj,0));
assert.equal(sequence.at(14,true).frame,0);
assert.equal(sequence.at(1000,false).frame,3);
const travelling=arena(); step(travelling,20);
const travelSnapshot=Sim.snapshot(travelling),travelJoin=reconnect(travelling);
assert.deepEqual(renderer().draw(Sim.snapshot(travelJoin)),renderer().draw(travelSnapshot));
assert.deepEqual(rendered.draw(travelSnapshot),renderer().draw(travelSnapshot),'old and new clients select the same loop cel');
for(const p of travelSnapshot.projs.filter(p=>p.t===20)) {
  const draw=rendered.draw(travelSnapshot).find(c=>c.transform.x===Math.round(p.x-travelSnapshot.camX));
  assert.equal(draw.args[1],192,'age20 loops a fourteen-tick clip into its third cel');
}

const ordinary=copy(transitionSnapshot); ordinary.boss=null;
ordinary.fx=[oldImpact]; ordinary.projs=[];ordinary.items=[];
const src=M.bosses[0].phases[0].proj;
assert.deepEqual(fxDraws(renderer(allGroundFlags),ordinary,src),fxDraws(renderer(),ordinary,src),
  'ordinary projectile impacts ignore grounded flags');
const legacyColumn=Math.min(3,Math.floor(oldImpact.t/6))*96;
function fallback(registry,adjust=()=>{}) {
  const r=renderer(registry);adjust(r);
  const draws=fxDraws(r,ordinary,src);
  assert.equal(draws.length,1);
  assert.equal(draws[0].args[1],legacyColumn);
  assert.equal(draws[0].args[2],3*96,'fallback retains the existing four-row impact');
  return r;
}
fallback({});
fallback(animations,r=>{delete r.scope.CoopBossFxSelection;});
fallback(animations,r=>{delete r.scope.CoopSpriteTimeline;});
fallback(animations,r=>{r.images.get(src).naturalHeight=384;});
for(const bad of [
  {...clip(src,3),frameTicks:[0,3,4,5]},
  {...clip(src,3),anchor:[-1,48]},
  {...clip(src,3),cell:[48,96]},
  {...clip(src,3),coreRect:[1,0,95,96]},
  {...clip(src,3),pages:[{src,columns:4,rows:8,frames:4,firstCell:32}]},
  {...clip(src,3),frameTicks:Array(65).fill(1),pages:[{src,columns:8,rows:9,frames:65}]},
  {...clip(src,3),pages:[{src,columns:32,rows:8,frames:4}]},
  ...['https://example.com/fx.webp','assets/bosses/../fx.webp',
    'assets/bosses/actions/fx.webp','assets/bosses/transformations/fx.webp',
    'assets/bosses/./actions/fx.webp','assets/bosses//transformations/fx.webp'].map(url=>clip(url,3)),
]) {
  const registry=copy(animations);registry.bosses[M.bosses[0].key].phases[0].fx.impact=bad;
  const r=fallback(registry);
  if(bad.pages[0].src!==src) assert(!r.requested.includes(bad.pages[0].src),'invalid or stream-owned paths are never requested');
}
const delayed=renderer(),additional='assets/bosses/fx/test.webp',reg=copy(animations);
reg.bosses[M.bosses[0].key].phases[0].fx.impact=clip(additional,3);
delayed.scope.CoopBossTransformations.animations=reg;
assert.equal(fxDraws(delayed,ordinary,src).length,1,'undecoded optional page uses legacy atlas');
assert.equal(delayed.canvases.length,0,'fallback does not allocate or expose stale normalized art');
assert.equal(delayed.copies.length,0);
delayed.images.set(additional,{tag:additional,naturalWidth:384,naturalHeight:768});
const later=copy(ordinary);later.fx[0].t=8;
const decoded=fxDraws(delayed,later,additional);
assert.equal(decoded.length,1);
assert.equal(decoded[0].args[1],2*96,'a late page resumes at authoritative age, without replaying its start');
assert.equal(delayed.canvases.length,1);
assert.deepEqual(decoded[0].worldArgs.slice(0,4),[0,0,96,96]);

// Eight-by-eight provider sheets can supply eight cels per purpose. Explicit
// cells and repeated page sources reuse the generic timeline's atlas mapping.
const eight=copy(animations),eightSrc='assets/bosses/fx/eight-row.webp';
eight.bosses[M.bosses[0].key].phases[0].fx.impact={cell:[96,96],anchor:[48,48],
  frameTicks:Array(8).fill(2),pages:[{src:eightSrc,columns:8,rows:8,frames:8,firstCell:24}]};
const eightRenderer=renderer(eight);
eightRenderer.images.set(eightSrc,{tag:eightSrc,naturalWidth:768,naturalHeight:768});
const lateImpact=copy(ordinary);lateImpact.fx[0].t=23;
const clamped=fxDraws(eightRenderer,lateImpact,eightSrc);
assert.equal(clamped[0].args[1],7*96,'a finite impact holds its last cel until the simulation removes it');
assert.equal(clamped[0].args[2],3*96);
const remapped=copy(eight);
remapped.bosses[M.bosses[0].key].phases[0].fx.impact={cell:[96,96],anchor:[48,48],
  frameTicks:[2,3,4,5],pages:[
    {src:eightSrc,columns:8,rows:8,frames:2,cells:[31,29]},
    {src:eightSrc,columns:8,rows:8,frames:2,cells:[25,24]}]};
const remapRenderer=renderer(remapped);
remapRenderer.images.set(eightSrc,{tag:eightSrc,naturalWidth:768,naturalHeight:768});
assert.equal(fxDraws(remapRenderer,later,eightSrc)[0].args[1],96,'explicit atlas cells preserve the provider ordering');

assert.equal(select.projectile({k:'boss',bi:0,ph:9,t:1}),null);
assert.equal(select.effect({k:'boom',bi:0,ph:1,t:0}),null);
assert.equal(select.effect({...oldImpact,sm:70}).purpose,'signature');
assert.equal(select.effect({...oldImpact,sm:69}).purpose,'impact');
console.log('boss FX: actual Sim emissions, phase ownership, reconnect, finite ends, optional ground contacts, eight-row playback and legacy fallback ok');
