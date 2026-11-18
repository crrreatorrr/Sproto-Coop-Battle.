// Disposable atlas fixtures verify the real lazy loader and whole-frame render route.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../public');

async function checkPartialActionDependencies(browser, base) {
  for (const missing of ['sprite-timeline','sprite-clip-player','boss-action-selection']) {
    const page = await browser.newPage();
    const errors = [];
    let attempts = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route(`**/js/${missing}.js`, route => ++attempts === 1 ? route.abort() : route.continue());
    await page.goto(base);
    await page.waitForFunction(() => window.SprotoApp?.screen === 'title');
    await page.evaluate(() => {
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
      const g=canvas.getContext('2d'), raw=g.drawImage.bind(g);
      window.actionDependencyCheck={framesBeforeReady:0,fallbackDraws:0,running:true};
      g.drawImage=(image,...args)=>{
        if (image.src?.includes('01-marina-bront-p1.webp') && !window.CoopBossActionPlayer?.shared()) {
          actionDependencyCheck.fallbackDraws++;
        }
        return raw(image,...args);
      };
      const snap={camX:0,sk:0,si:0,t:0,items:[],players:[],enemies:[],fx:[],banner:null,projs:[],
        boss:{bi:0,ph:0,x:420,y:36,t:0,st:'idle',fc:-1,fl:0,mi:0,row:0,hp:1800,mh:2600}};
      function frame() {
        if (!actionDependencyCheck.running) return;
        if (!window.CoopBossActionPlayer?.shared()) actionDependencyCheck.framesBeforeReady++;
        try { Render.drawWorld(g,snap,{noBanner:true}); }
        catch(error) { CrashGuard.guard.report(error,'frame'); }
        snap.t++;snap.boss.t++;
        requestAnimationFrame(frame);
      }
      Render.enterStage(0);
      requestAnimationFrame(frame);
    });
    await page.waitForFunction(()=>window.CoopBossActionPlayer?.shared(),null,{timeout:10000});
    const result=await page.evaluate(()=>{
      actionDependencyCheck.running=false;
      return {...actionDependencyCheck,paused:CrashGuard.guard.paused,guardErrors:CrashGuard.guard.errors};
    });
    assert.ok(attempts>=2,missing+' was retried');
    assert.ok(result.framesBeforeReady>=3,missing+' exercised incomplete dependencies over multiple frames');
    assert.ok(result.fallbackDraws>0,missing+' rendered its actor fallback while dependency was unavailable');
    assert.equal(result.paused,false,missing+' did not pause gameplay');
    assert.equal(result.guardErrors,0,missing+' raised no guarded render error');
    assert.deepEqual(errors,[]);
    await page.close();
  }
}

async function checkPaddedCore(page) {
  const result=await page.evaluate(async()=>{
    const source=document.createElement('canvas');source.width=source.height=220;
    const sourceG=source.getContext('2d'),pixels=sourceG.createImageData(220,220);
    for(let y=8;y<206;y++)for(let x=12;x<208;x++) {
      const n=(y*220+x)*4;pixels.data.set([x,y,(x+y)%255,255],n);
    }
    sourceG.putImageData(pixels,0,0);
    const padded=document.createElement('canvas');padded.width=padded.height=330;
    padded.getContext('2d').drawImage(source,55,55);
    const picture=new Image();picture.src=padded.toDataURL();await picture.decode();
    const clip={cell:[330,330],anchor:[165,261],coreRect:[55,55,220,220],frameTicks:[1],
      pages:[{src:'padded-test',columns:1,frames:1}]};
    let available=true;
    const player=CoopSpriteClipPlayer.create({loaded:()=>available?picture:null},{setPages:()=>{}});
    player.sync({identity:'padded',clip,age:0});
    const checks=[];
    for(const [width,height,x,y] of [[640,360,420,260],[640,360,443,259],[256,256,128,240]]) {
      for(const facing of [-1,1])for(const opaque of [false,true]) {
        const old=document.createElement('canvas'),now=document.createElement('canvas');
        old.width=now.width=width;old.height=now.height=height;
        const a=old.getContext('2d'),b=now.getContext('2d');
        for(const g of [a,b]){g.imageSmoothingEnabled=false;if(opaque){g.fillStyle='#263141';g.fillRect(0,0,width,height);}}
        a.save();a.translate(x,y);if(facing>0)a.scale(-1,1);
        a.drawImage(source,0,0,220,220,-122,-228,243,243);a.restore();
        player.draw(b,{x,y,facing,extent:243});
        const before=a.getImageData(0,0,width,height).data,after=b.getImageData(0,0,width,height).data;
        let differences=0;for(let i=0;i<before.length;i++)if(before[i]!==after[i])differences++;
        checks.push({width,height,x,y,facing,opaque,differences});
      }
    }
    // The outer padding contains real drawable room, rather than cropping the
    // larger cell down to its nominal actor core.
    const g=padded.getContext('2d');g.fillStyle='#ff0000';g.fillRect(10,90,60,5);
    const armed=new Image();armed.src=padded.toDataURL();await armed.decode();
    const extra=CoopSpriteClipPlayer.create({loaded:()=>armed},{setPages:()=>{}});
    extra.sync({identity:'weapon',clip,age:0});
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
    extra.draw(canvas.getContext('2d'),{x:420,y:260,facing:-1,extent:243});
    const image=canvas.getContext('2d').getImageData(0,0,640,360).data;
    let outsideWeapon=0;for(let y=0;y<360;y++)for(let x=0;x<298;x++) {
      const i=(y*640+x)*4;if(image[i]===255&&image[i+1]===0&&image[i+2]===0&&image[i+3]===255)outsideWeapon++;
    }
    return {checks,outsideWeapon};
  });
  assert.ok(result.checks.every(check=>check.differences===0),'padded core must preserve exact world pixel sampling');
  assert.ok(result.outsideWeapon>100,'weapon pixels outside the actor core remain visible');
}

async function main() {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      const mime = { '.js': 'application/javascript', '.html': 'text/html', '.png': 'image/png', '.webp': 'image/webp' };
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }).end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    await checkPartialActionDependencies(browser,`http://127.0.0.1:${server.address().port}/`);
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.SprotoApp?.screen === 'title');
    const fixtures = await page.evaluate(() => [0, 1].map(index => {
      const atlas = document.createElement('canvas');
      atlas.width = 1760; atlas.height = 1100;
      const g = atlas.getContext('2d');
      for (let frame = 0; frame < 40; frame++) {
        g.fillStyle = `rgb(${index ? 160 : 32},${50 + frame},24)`;
        g.fillRect((frame % 8) * 220 + 24, Math.floor(frame / 8) * 220 + 20, 150, 185);
      }
      return atlas.toDataURL('image/png').split(',')[1];
    }));
    await page.route('**/assets/bosses/transformations/browser-*.png', route => {
      const index = Number(route.request().url().match(/browser-(\d)/)[1]);
      return route.fulfill({ body: Buffer.from(fixtures[index], 'base64'), contentType: 'image/png' });
    });
    await page.evaluate(() => {
      CoopBossTransformations.clips[MANIFEST.bosses[0].key] = {
        cell: [220, 220], anchor: [110, 206], frameTicks: Array(80).fill(6),
        pages: [0, 1].map(index => ({ src: `assets/bosses/transformations/browser-${index}.png`, columns: 8, frames: 40 })),
      };
      Render.enterStage(0);
    });
    await page.waitForFunction(() => window.RenderFx && window.CoopBossTransformPlayer);
    await checkPaddedCore(page);
    await page.evaluate(() => {
      window.testBossSnapshot = {
        camX: 0, sk: 0, si: 0, t: 300, items: [], players: [], enemies: [], fx: [], banner: null, projs: [],
        boss: { bi: 0, ph: 1, x: 420, y: 36, z: 0, t: 300, st: 'transform', fc: -1, fl: 0, mi: 0, row: 0, hp: 1800, mh: 2600 },
      };
      CoopBossTransformPlayer.shared().sync(testBossSnapshot);
    });
    await page.waitForFunction(() => AssetLoader.shared().loaded('assets/bosses/transformations/browser-1.png'));
    await page.waitForFunction(() => AssetLoader.shared().loaded(MANIFEST.bosses[0].phases[0].sheet));
    const missingPlayer = await page.evaluate(() => {
      const player=window.CoopBossTransformPlayer;
      const oldPose=CoopBossMorph.pose, oldGenerate=CoopBossMorph.generate;
      delete window.CoopBossTransformPlayer;
      CoopBossMorph.pose=CoopBossMorph.generate=()=>{throw Error('registered transformation used legacy motion while its module was unavailable');};
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
      const g=canvas.getContext('2d'),raw=g.drawImage.bind(g),draws=[];
      g.drawImage=(image,...args)=>{if(image.src?.includes('/bosses/'))draws.push(image.src);return raw(image,...args);};
      try {
        for(const tick of [0,300,479]) {
          Render.drawWorld(g,{...testBossSnapshot,boss:{...testBossSnapshot.boss,t:tick}},{noBanner:true});
        }
      } finally {
        window.CoopBossTransformPlayer=player;
        CoopBossMorph.pose=oldPose;CoopBossMorph.generate=oldGenerate;
      }
      return draws;
    });
    assert.equal(missingPlayer.length,3);
    assert.ok(missingPlayer.every(src=>src.includes('01-marina-bront-p1.webp')),
      'registered clips retain P1 standing art until their player module is available');
    const result = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const g = canvas.getContext('2d'), raw = g.drawImage.bind(g), draws = [];
      g.drawImage = (image, ...args) => {
        if (image.src?.includes('/transformations/')) draws.push({ src: image.src, args, facing: Math.sign(g.getTransform().a) });
        return raw(image, ...args);
      };
      // A registered clip must never call the optical-flow presentation.
      for (const key of Object.keys(CoopBossMorph)) if (typeof CoopBossMorph[key] === 'function') {
        CoopBossMorph[key] = () => { throw new Error('authored clip used contour fallback'); };
      }
      const frames = [];
      for (const [tick, facing] of [[300, -1], [479, 1]]) {
        draws.length = 0;
        const snap = { ...testBossSnapshot, boss: { ...testBossSnapshot.boss, t: tick, fc: facing } };
        Render.drawWorld(g, snap, { noBanner: true });
        frames.push(draws.slice());
      }
      Render.drawWorld(g, { ...testBossSnapshot, boss: { ...testBossSnapshot.boss, st: 'idle', t: 0 } }, { noBanner: true });
      return { frames, transformsAfter: AssetLoader.shared().status().resident.transform };
    });
    assert.equal(result.frames[0].length, 1);
    assert.deepEqual(result.frames[0][0].args, [440, 220, 220, 220, -122, -228, 243, 243]);
    assert.equal(result.frames[0][0].facing, 1);
    assert.equal(result.frames[1].length, 1);
    assert.deepEqual(result.frames[1][0].args.slice(0, 4), [1540, 880, 220, 220]);
    assert.equal(result.frames[1][0].facing, -1);
    assert.equal(result.transformsAfter, 0);
    assert.deepEqual(errors, []);
    console.log('browser authored whole-frame route, late join, endpoint, facing, and release ok');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
