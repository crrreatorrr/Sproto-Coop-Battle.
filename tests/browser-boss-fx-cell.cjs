// Coordinate-coded NOT-ART images exercise real Canvas sampling. No game art is used.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname,'../public');

async function main() {
  const scripts=['manifest','combat','sim','sprite-timeline','boss-fx-selection'];
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://fixture.invalid').pathname;
    if(pathname==='/') {
      res.writeHead(200,{'Content-Type':'text/html'});
      res.end('<!doctype html>'+scripts.map(name=>`<script src="js/${name}.js"></script>`).join(''));
    } else if(/^\/js\/[a-z-]+\.js$/.test(pathname)) {
      fs.readFile(path.join(root,pathname.slice(1)),(error,data)=>{
        if(error){res.writeHead(404).end();return;}
        res.writeHead(200,{'Content-Type':'text/javascript'}).end(data);
      });
    } else res.writeHead(204).end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:640,height:360},deviceScaleFactor:1});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    let resolveHeld;const held=new Promise(resolve=>{resolveHeld=resolve;});
    await page.route('**/assets/bosses/fx/browser-late-fx.png',route=>resolveHeld(route));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const setup=await page.evaluate(async()=>{
      const create=document.createElement.bind(document),images=new Map(),cells=[];
      function canvas(w=640,h=360){const c=create('canvas');c.width=w;c.height=h;return c;}
      for(let cell=0;cell<16;cell++) {
        const c=canvas(96,96),g=c.getContext('2d'),data=g.createImageData(96,96);
        for(let y=0;y<96;y++)for(let x=0;x<96;x++) {
          const n=(y*96+x)*4;
          // Distinct cels and transparent holes reveal stale scratch pixels.
          const hole=cell%4!==0&&x>=18+cell%3&&x<48&&y>=26&&y<53;
          data.data.set([y,x,(cell*13+100)%255,hole?0:255],n);
        }
        g.putImageData(data,0,0);cells.push(c);
      }
      const source=canvas(384,384),bank=canvas(384,768),sg=source.getContext('2d'),bg=bank.getContext('2d');
      for(let i=0;i<16;i++)sg.drawImage(cells[i],i%4*96,Math.floor(i/4)*96);
      bg.fillStyle='#182c50';bg.fillRect(0,0,384,384);bg.drawImage(source,0,384);
      async function picture(c){const image=new Image();image.src=c.toDataURL();await image.decode();return image;}
      const sourceImage=await picture(source),bankImage=await picture(bank);
      const bi=5,key=MANIFEST.bosses[bi].key,bankPath=MANIFEST.bosses[bi].phases[1].proj;
      const oraclePath='assets/bosses/fx/browser-oracle-fx.png',latePath='assets/bosses/fx/browser-late-fx.png';
      images.set(oraclePath,sourceImage);images.set(bankPath,bankImage);
      window.AssetLoader={lru:()=>new Map()};
      window.Render={img:src=>images.get(src),ready:image=>!!image?.complete&&image.naturalWidth>0,
        text(){},frameCanvas:()=>null,canFilter:()=>false,drawFighter(){},drawBackground(){},weapon:()=>null};
      window.CoopBossTransformations={animations:{bosses:{}}};
      function install(mode) {
        const fx=mode==='legacy'?{}:{special:{cell:[96,96],anchor:[48,95],frameTicks:[9,9,9,9],grounded:true,
          pages:[{src:mode==='oracle'?oraclePath:mode==='late'?latePath:bankPath,
            columns:4,rows:mode==='oracle'?4:8,frames:4,firstCell:mode==='oracle'?4:20}]}};
        CoopBossTransformations.animations.bosses[key]={phases:[{}, {fx}]};
      }
      function state() {
        const s=Sim.create(Array.from({length:4},(_,i)=>({fid:i,weapon:0,ctrl:'local'})),782);Sim.startStage(s,bi);
        s.enemies=[];s.items=[];s.stage.waves.forEach(w=>{w.done=true;});s.lockX=s.camX;
        s.boss={bi,phase:1,hp:9000,maxHp:9000,x:s.camX+420,y:60,z:0,face:-1,st:'special',t:0,row:0,w:150,
          cycle:0,flash:0,tx:0,ty:60,hitCd:0,adds:0,arch:bi%Sim.BOSS_ARCHETYPES.length,addT:0};
        for(const p of s.players)Object.assign(p,{x:s.camX+170,y:100,inv:9999,in:{}});
        const attack=Sim.bossExtraAttack(bi,'special'),origin=attack.aim?{x:s.camX+240,y:60}:s.boss;
        s.boss.extraZones=attack.zones.map(([x,y,w,d,delay,round])=>[
          Math.round(Sim.clamp(origin.x-x,s.camX+42,s.camX+Sim.W-42)),Math.round(Sim.clamp(origin.y+y,0,Sim.DEPTH)),w,d,delay,round]);
        return {s,attack};
      }
      const {s,attack}=state(),snapshots=[];let restarted;
      const total=attack.warning+Math.max(...attack.zones.map(z=>z[4]))+36;
      for(let tick=1;tick<=total;tick++) {
        Sim.step(s);if(tick===attack.warning+21)restarted=Sim.importState(JSON.parse(JSON.stringify(Sim.exportState(s))));
        if(tick>=attack.warning)snapshots.push(JSON.parse(JSON.stringify(Sim.snapshot(s))));
      }
      function scene(snapshot){return {...snapshot,boss:null,players:[],enemies:[],items:[],projs:[],hz:[],
        fx:snapshot.fx.filter(f=>f.k==='bossSpecialImpact')};}
      const failed=scene(snapshots[21]),event=failed.fx.find(f=>f.sm+25===149.60000000000002);
      if(!event)throw Error('Pinned simulation no longer produces the regression geometry');
      const extent=event.sm+25,dx=-48*extent/96,dy=-95*extent/96,x=Math.round(event.x-failed.camX)+Math.round(Math.sin(failed.t*1.7)*(failed.sk||0)),y=Math.round(Sim.FLOOR_TOP+event.y)+Math.round(Math.cos(failed.t*2.3)*(failed.sk||0)*.6);
      if(x!==188||y!==278)throw Error('Actual Sim impact placement changed: '+JSON.stringify({x,y,event,camX:failed.camX,attack}));
      function bytes(c){return c.getContext('2d').getImageData(0,0,c.width,c.height).data;}
      function differences(a,b){const x=bytes(a),y=bytes(b);let n=0;for(let i=0;i<x.length;i+=4)if(x[i]!==y[i]||x[i+1]!==y[i+1]||x[i+2]!==y[i+2]||x[i+3]!==y[i+3])n++;return n;}
      function direct(image,sy){const c=canvas(),g=c.getContext('2d');g.imageSmoothingEnabled=false;g.translate(x,y);g.drawImage(image,96,sy,96,96,dx,dy,extent,extent);return c;}
      const oldMismatch=differences(direct(sourceImage,96),direct(bankImage,480));
      window.fxCellTest={canvas,bytes,differences,images,cells,bankPath,oraclePath,latePath,bankPNG:bank.toDataURL().split(',')[1],
        install,scene,snapshots,failed,event,created:[],restarted,regressionGeometry:[dx,dy,extent,extent,x,y]};
      // Only renderer-owned canvases are counted after fixture construction.
      document.createElement=(name,...args)=>{const c=create(name,...args);if(name==='canvas')fxCellTest.created.push(c);return c;};
      return {oldMismatch,geometry:fxCellTest.regressionGeometry,actualSimSnapshots:snapshots.length};
    });
    assert.deepEqual(setup.geometry,[-74.80000000000001,-148.04166666666669,149.60000000000002,149.60000000000002,188,278]);
    // Keep the raw control in evidence; the registered-output contract also
    // applies if a future browser fixes its full-atlas boundary rounding.
    await page.addScriptTag({url:`http://127.0.0.1:${server.address().port}/js/render-fx.js`});
    const result=await page.evaluate(()=>{
      const t=fxCellTest;
      t.render=(snapshot,mode)=>{
        t.install(mode);const c=t.canvas(),g=c.getContext('2d'),before=JSON.stringify(snapshot);
        RenderFx.drawWorld(g,snapshot,{noBanner:true});
        if(JSON.stringify(snapshot)!==before)throw Error('Renderer mutated actual Sim snapshot');return c;
      };
      t.reference=snapshot=>{
        const c=t.canvas(),g=c.getContext('2d');g.imageSmoothingEnabled=false;
        if(snapshot.sk)g.translate(Math.round(Math.sin(snapshot.t*1.7)*snapshot.sk),Math.round(Math.cos(snapshot.t*2.3)*snapshot.sk*.6));
        for(const f of snapshot.fx) {
          const col=Math.min(3,Math.floor(f.t/9)),size=f.sm+25;g.save();g.translate(Math.round(f.x-snapshot.camX),Math.round(Sim.FLOOR_TOP+f.y));
          g.drawImage(t.cells[4+col],0,0,96,96,-48*size/96,-95*size/96,size,size);g.restore();
        }
        return c;
      };
      const seen=new Set();let comparisons=0;
      // Real overlapping zones exercise several different cells in one world
      // draw. Replaying in reverse also catches retained-cell/rewind mistakes.
      for(const snapshot of t.snapshots.concat(t.snapshots.slice().reverse())) {
        const s=t.scene(snapshot),before=JSON.stringify(snapshot),ref=t.reference(s),oracle=t.render(s,'oracle'),bank=t.render(s,'bank');
        if(t.differences(ref,oracle)||t.differences(ref,bank))throw Error('Normalized FX differ from cell-local reference');
        if(JSON.stringify(snapshot)!==before)throw Error('Source snapshot mutated');
        for(const f of s.fx)seen.add(Math.min(3,Math.floor(f.t/9)));comparisons+=2;
      }
      if(t.created.length!==1)throw Error('Expected one reusable scratch canvas');
      t.created[0].width=t.created[0].height=1;
      if(t.differences(t.render(t.failed,'bank'),t.reference(t.failed)))throw Error('Resized scratch did not restore the cell');
      const late=new Image();t.images.set(t.latePath,late);late.src=t.latePath;t.late=late;
      const pending=t.render(t.failed,'late'),legacy=t.render(t.failed,'legacy');
      if(t.differences(pending,legacy))throw Error('Pending optional page did not preserve exact legacy fallback');
      t.lateSnapshot=t.scene(t.snapshots[30]);
      if(!t.lateSnapshot.fx.some(f=>Math.min(3,Math.floor(f.t/9))===2))throw Error('Late test must advance the authoritative source cell');
      if(t.differences(t.render(t.lateSnapshot,'late'),t.render(t.lateSnapshot,'legacy')))throw Error('Later pending age differs from legacy');
      const before=JSON.stringify(Sim.exportState(t.restarted)),joined=t.scene(Sim.snapshot(t.restarted));
      const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
      if(canonical(joined)!==canonical(t.failed))throw Error('Reconnect snapshot changed');
      if(t.differences(t.render(joined,'bank'),t.reference(joined)))throw Error('Reconnect cel sampling changed');
      if(JSON.stringify(Sim.exportState(t.restarted))!==before)throw Error('Rendering changed restart state');
      return {comparisons,seen:[...seen].sort(),scratchCount:t.created.length,scratchDimensions:[t.created[0].width,t.created[0].height],
        maximumScratchBytes:t.created[0].width*t.created[0].height*4,pendingFallback:true,bankPNG:t.bankPNG};
    });
    let timeout;
    const route=await Promise.race([held,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Late fixture not requested')),5000);})]).finally(()=>clearTimeout(timeout));
    await route.fulfill({body:Buffer.from(result.bankPNG,'base64'),contentType:'image/png'});
    const late=await page.evaluate(async()=>{
      const t=fxCellTest;await t.late.decode();
      const before=JSON.stringify(t.lateSnapshot),actual=t.render(t.lateSnapshot,'late'),expected=t.reference(t.lateSnapshot);
      if(t.differences(actual,expected))throw Error('Late decode did not select the current authoritative cel');
      if(JSON.stringify(t.lateSnapshot)!==before)throw Error('Late render mutated snapshot');
      if(t.created.length!==1||t.created[0].width!==96||t.created[0].height!==96)throw Error('Scratch grew or leaked');
      return {currentAgeExact:true,scratchCount:1,maximumScratchBytes:36864};
    });
    assert.deepEqual(result.seen,[0,1,2,3]);assert.equal(result.scratchCount,1);assert.deepEqual(result.scratchDimensions,[96,96]);
    assert.equal(result.maximumScratchBytes,36864);assert.equal(late.currentAgeExact,true);assert.deepEqual(errors,[]);
    const out=path.join(__dirname,'artifacts');fs.mkdirSync(out,{recursive:true});delete result.bankPNG;
    fs.writeFileSync(path.join(out,'boss-fx-cell-browser.json'),JSON.stringify({status:'PASS',fixture:'Coordinate-coded NOT-ART',runtime:'registered FX only',setup,result,late,pageErrors:errors},null,2)+'\n');
    console.log('real Chromium boss FX: fractional149.6 atlas row96/480, repeated transparent cels, one36,864byte scratch and late fallback ok');
  } finally {
    if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
