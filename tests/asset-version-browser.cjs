// Real browser cache remains enabled: an old immutable atlas URL stays old,
// while the next release requests its new bytes through the same canonical key.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');

async function main() {
  const {runtimeIndex} = await import('../scripts/build.mjs');
  let release = 'before-art-replacement';
  const requests = [];
  const source = fs.readFileSync(path.join(__dirname,'../public/js/asset-loader.js'));
  const server = http.createServer((req,res)=>{
    const url = new URL(req.url,'http://fixture.invalid');
    if (url.pathname==='/') {
      const {version} = runtimeIndex({publicTreeSha256:release});
      res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});
      res.end(`<canvas id="proof" width="2" height="2"></canvas><script>globalThis.CoopAssetVersion="${version}";</script><script src="js/asset-loader.js?v=${version}"></script>`);
    } else if (url.pathname==='/js/asset-loader.js') {
      res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'public,max-age=31536000,immutable'});
      res.end(source);
    } else if (url.pathname==='/assets/bosses/version-fixture.svg') {
      requests.push(req.url);
      res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'public,max-age=31536000,immutable'});
      res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><path fill="${release==='before-art-replacement'?'#e02010':'#1060e0'}" d="M0 0h2v2H0z"/></svg>`);
    } else { res.writeHead(204);res.end(); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext();
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const base=`http://127.0.0.1:${server.address().port}/`;
    await page.goto(base);
    async function sample(explicitURL) {
      return page.evaluate(async url=>{
        const key='assets/bosses/version-fixture.svg';
        let image;
        if (url) { image=new Image();image.src=url;await image.decode(); }
        else {
          const loader=AssetLoader.create({base:document.baseURI});
          await loader.request(key).promise;
          image=loader.loaded(key);
        }
        const g=document.getElementById('proof').getContext('2d');
        g.clearRect(0,0,2,2);g.drawImage(image,0,0);
        return {pixel:Array.from(g.getImageData(0,0,1,1).data),url:image.src,version:CoopAssetVersion};
      },explicitURL);
    }
    const old=await sample();
    assert.deepEqual(old.pixel,[224,32,16,255]);
    release='after-art-replacement';
    await page.reload();
    const cached=await sample(old.url);
    assert.deepEqual(cached.pixel,old.pixel,'control proves the old immutable image remains warm in the browser cache');
    assert.equal(requests.length,1,'control reused cache with no network fetch');
    const current=await sample();
    assert.deepEqual(current.pixel,[16,96,224,255]);
    assert.notEqual(current.url,old.url);
    assert.notEqual(current.version,old.version);
    assert.equal(requests.length,2,'new release fetched exactly one replacement image');
    assert.deepEqual(errors,[]);
    const out=path.join(__dirname,'artifacts');
    fs.mkdirSync(out,{recursive:true});
    fs.writeFileSync(path.join(out,'asset-version-browser.json'),JSON.stringify({status:'PASS',old,current,
      warmCacheControlPixel:cached.pixel,networkRequests:requests,browserErrors:errors},null,2)+'\n');
    console.log('real Chromium warm cache: old URL remains cached; new release loads replacement art ok');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
