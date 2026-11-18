'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const calls = [], pages = [], decoded = new Map();
const context = {globalAlpha:1,save(){},restore(){},clearRect(){},translate(){},scale(){},
  drawImage(...args){calls.push(args);}};
const scope = {window:{document:{createElement:()=>({width:0,height:0,getContext:()=>context})}}};
for (const name of ['sprite-timeline','sprite-clip-player','boss-action-selection','boss-action-player']) {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/'+name+'.js'),'utf8'),scope);
}
const clip = {cell:[20,20],anchor:[10,18],frameTicks:[30,8,1,24],pages:[
  {src:'assets/bosses/actions/test/a.webp',columns:2,rows:1,frames:2,cells:[1,0]},
  {src:'assets/bosses/actions/test/b.webp',columns:2,rows:1,frames:2,cells:[0,1]},
]};
const manifest = {bosses:[{key:'01-test'}]};
const registry = {bosses:{'01-test':{phases:[{actions:{lane:clip}},{actions:{lane:clip}}]}}};
const player = scope.window.CoopBossActionPlayer.create({loaded:src=>decoded.get(src),
  setActionPages:paths=>pages.push(Array.from(paths))},manifest,registry);
const snapshot = {si:0,camX:0,boss:{bi:0,ph:0,st:'fire',row:1,mi:0,t:38,x:420,fc:-1,ar:0}};
const placement={x:420,y:260,facing:-1,extent:20};
player.sync(snapshot);
assert.deepEqual(pages.at(-1),['assets/bosses/actions/test/b.webp']);
assert.equal(player.draw(context,'01-test',0,placement),false,'late join waits for correct page or owner fallback');
decoded.set(clip.pages[1].src,{naturalWidth:40,naturalHeight:20});
assert.equal(player.draw(context,'01-test',0,placement),true);
assert.equal(calls.at(-1)[1],0,'shot at tick38 selects its exact source cell');
snapshot.boss.t=39;
player.sync(snapshot);
assert.equal(player.draw(context,'01-test',0,placement),true);
assert.equal(calls.at(-1)[1],20);
decoded.clear();
snapshot.boss.t=40;
player.sync(snapshot);
assert.equal(player.draw(context,'01-test',0,placement),true,'decode gaps retain same-state complete cel');
snapshot.boss.ph=1;
player.sync(snapshot);
assert.equal(player.draw(context,'01-test',1,placement),false,'phase transition discards previous cel');
assert.equal(player.draw(context,'01-test',0,placement),false);
snapshot.boss.t=2;
player.sync(snapshot);
assert.equal(player.draw(context,'01-test',1,placement),false,'rewind cannot display future shot');
snapshot.boss.st='transform';
player.sync(snapshot);
assert.deepEqual(pages.at(-1),[]);
assert.equal(player.draw(context,'01-test',1,placement),false);
const select=scope.window.CoopBossActionSelection.select;
const base={st:'fire',row:1,mi:0,t:38,ar:0,x:420,fc:-1};
assert.equal(select({...base,mi:1}).action,'homing');
assert.equal(select({...base,row:2}).action,'spread');
assert.equal(select({...base,st:'charge',ar:1,t:35}).action,'charge-windup');
assert.equal(select({...base,st:'charge',ar:1,t:36}).age,0);
assert.equal(select({...base,st:'charge',t:80,x:420}).action,'charge-rush');
assert.equal(select({...base,st:'charge',t:80,x:85.5}).action,'charge-brake');
assert.equal(select({...base,st:'charge',t:80,x:85.5}).age,1);
assert.equal(select({...base,st:'charge',t:80,x:60}).age,4);
assert.equal(select({...base,st:'charge',t:80,x:554.5,fc:1}).age,1);
assert.equal(select({...base,st:'idle',ar:2,su:12}).age,12);
assert.equal(select({...base,st:'idle',t:0}),null,'the transform hands off to the approved standing endpoint');
assert.equal(select({...base,st:'idle',t:1}).action,'walk');
assert.equal(select({...base,st:'dead',t:150}).age,150);
const plan=scope.window.CoopSpriteTimeline.plan(clip,{anchorInside:true});
for (const [tick,frame] of [[-1,0],[29.99,0],[30,1],[37.99,1],[38,2],[39,3],[62,3],[63,3]]) {
  assert.equal(plan.at(tick).frame,frame);
}
assert.throws(()=>scope.window.CoopSpriteTimeline.plan({...clip,frameTicks:[0]}),/metadata/);
assert.throws(()=>scope.window.CoopSpriteTimeline.plan(clip,{maxPageBytes:1}),/budget/);
assert.throws(()=>scope.window.CoopSpriteTimeline.plan({...clip,pages:[{...clip.pages[0],cells:[99,0]}]}),/grid/);
for(const coreRect of [[-1,0,20,20],[0,0,0,20],[1,0,20,20],[0,0,20],[0,0,NaN,20]]) {
  assert.throws(()=>scope.window.CoopSpriteTimeline.plan({...clip,coreRect}),/core rectangle/);
}
assert.deepEqual(Array.from(scope.window.CoopSpriteTimeline.plan(clip).coreRect),[0,0,20,20]);
for (const dependency of ['CoopSpriteTimeline','CoopSpriteClipPlayer','CoopBossActionSelection']) {
  const present=scope.window[dependency];
  delete scope.window[dependency];
  assert.equal(scope.window.CoopBossActionPlayer.shared(),null,'partial lazy loading retains owner fallback');
  scope.window[dependency]=present;
}
console.log('snapshot-aged boss actions: exact releases, late join, phase/rewind reset, page gaps and validation ok');
