'use strict';
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(__dirname, 'artifacts/sprotel-bitcoin'));

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const server = spawn(process.execPath, ['server/server.js'], { cwd: root, env: { ...process.env, PORT: '0' } });
  let browser;
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server timeout')), 10000);
      server.stdout.on('data', chunk => {
        const match = String(chunk).match(/localhost:(\d+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      server.once('error', reject);
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [], missing = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() === 404 && r.url().includes('/assets/')) missing.push(r.url()); });
    await page.goto('http://127.0.0.1:' + port);
    await page.waitForFunction(() => window.SprotoApp?.screen === 'title');
    await page.evaluate(() => {
      SprotoApp.screen = 'stages'; SprotoApp.stageSel = 11; SprotoApp.settings.freePlay = true;
      SprotoApp.slots[0].ctrl = 'local'; SprotoApp.slots[0].dev = 'k1';
    });
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => SprotoApp.stageSel === 12);
    await page.screenshot({ path: path.join(out, 'stage-13-selection.png') });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => SprotoApp.screen === 'game' && SprotoApp.sim.stageIdx === 12 && window.RenderFx);
    const result = await page.evaluate(async () => {
      SprotoApp.frozen = true;
      const plan = AssetLoader.groups(MANIFEST);
      await AssetLoader.shared().preload(plan.boss(12).concat(plan.scenery(12), [MANIFEST.shadows.sheets[1]]));
      const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360;
      const g = cv.getContext('2d'), draw = g.drawImage.bind(g), calls = [];
      g.drawImage = (...args) => { calls.push(args); draw(...args); };
      const seenActor = new Set(), seenFx = new Set(), images = [];
      const snap = Sim.snapshot(SprotoApp.sim);
      Object.assign(snap, { camX: 0, sk: 0, banner: null, enemies: [], items: [], projs: [], fx: [], hz: [] });
      snap.players.forEach((p, i) => { p.x = 80 + i * 60; p.y = 75; p.z = 0; p.st = 'idle'; });
      for (let phase = 0; phase < 2; phase++) {
        const ph = MANIFEST.bosses[12].phases[phase];
        const actor = Render.img(ph.sheet), fx = Render.img(ph.proj), C = ph.actorCell;
        if (actor.naturalWidth !== C * 8 || actor.naturalHeight !== C * (phase ? 9 : 10) ||
            fx.naturalWidth !== 1024 || fx.naturalHeight !== 64 * (phase ? 4 : 6)) throw new Error('atlas dimensions');
        const boss = { bi: 12, ph: phase, x: 485, y: 60, fc: -1, st: 'idle', t: 0, hp: phase ? 2000 : 4000, mh: 4000, fl: 0, w: phase ? 140 : 90, ar: 0 };
        const pose = (extra, row, col) => {
          calls.length = 0;
          Render.drawWorld(g, { ...snap, boss: { ...boss, ...extra } }, { local: [0], noBanner: true });
          const hit = calls.find(a => a[0] === actor);
          if (!hit || hit[1] !== col*C || hit[2] !== row*C) throw new Error('actor playback ' + JSON.stringify({ phase, extra, row, col, got: hit?.slice(1, 5) }));
          seenActor.add(phase+':'+row+':'+col);
        };
        for (let a = 0; a < (phase ? 3 : 5); a++) {
          const ages = phase && a === 1 ? [0,8,15,23,30,35,51,62] : [0,8,15,23,30,37,44,51];
          ages.forEach((t,col) => pose({ st: 'fire', ba: a, by: 60, row: a+1, t, wl: [60] }, 1+a,col));
        }
        [0,6,12,18,24,30,40,35].forEach((t,col) => pose({ st:'charge',t,x:col>=6?75:485 },6,col));
        [0,9,18,27].forEach((t,col) => pose({ st:'sweep',t },7,col));
        [0,6,12,18].forEach((t,col) => pose({ st:'sweep',t:Sim.SWEEP_WARN+t },7,4+col));
        [0,9,18,27].forEach((t,col) => pose({t},0,col));
        [0,9,18,27].forEach((t,col) => pose({st:'enter',t},0,4+col));
        [6,4,2,1].forEach((fl,col) => pose({fl},8,col));
        [0,14,28,42].forEach((t,col) => pose({st:'dead',t},8,4+col));
        if (!phase) {
          for (let col=0;col<8;col++) pose({st:'transform',ph:1,t:col*60},9,col);
        }
        for (let a=0;a<(phase?3:5);a++) {
          for (let col=0;col<16;col++) {
            calls.length=0;
            Render.drawWorld(g,{...snap,boss:{...boss,st:'fire',ba:a,by:60,row:a+1,t:35},
              projs:[{id:1,k:'boss',bi:12,ph:phase,ba:phase?undefined:a,ma:phase?a:undefined,r:a,t:col*3,x:290,y:55,z:25,vx:-4}]},{noBanner:true});
            const hit=calls.find(args=>args[0]===fx);
            if(!hit||hit[1]!==col*64||hit[2]!==a*64)throw new Error('projectile playback '+phase+':'+a+':'+col);
            seenFx.add(phase+':'+a+':'+col);
            if(col===4)images.push({name:(phase?'phase2-':'phase1-')+a,data:cv.toDataURL('image/png')});
          }
        }
        for(let col=0;col<16;col++) {
          calls.length=0;
          Render.drawWorld(g,{...snap,boss,fx:[{id:1,k:'bossImpact',bi:12,ph:phase,x:290,y:55,z:25,t:col*1.5}]},{noBanner:true});
          const hit=calls.find(args=>args[0]===fx);
          if(!hit||hit[1]!==col*64||hit[2]!==ph.impactRow*64)throw new Error('impact playback');
          seenFx.add(phase+':impact:'+col);
        }
      }
      return {actorFrames:seenActor.size,fxFrames:seenFx.size,images};
    });
    assert.strictEqual(result.actorFrames,136);assert.strictEqual(result.fxFrames,160);
    result.images.forEach(({name,data})=>fs.writeFileSync(path.join(out,name+'-in-game.png'),Buffer.from(data.split(',')[1],'base64')));
    assert.deepStrictEqual(errors, []); assert.deepStrictEqual(missing, []);
    console.log('browser Sprotel: stage 13 start, all 136 actor / 160 projectile frames, no errors or missing assets');
  } finally { if (browser) await browser.close(); server.kill(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
