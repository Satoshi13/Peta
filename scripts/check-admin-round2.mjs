/** Owner desk, round two: Reports, News, Shop and Market against stubbed APIs (no Worker, no real data).
 * Set PETA_PLAYWRIGHT_MODULE and optionally PETA_BROWSER for a local browser; PETA_SHOTS for the screenshot folder.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PETA_PLAYWRIGHT_MODULE || 'playwright');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'), shots=process.env.PETA_SHOTS || '/tmp/peta-admin-round2';
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const server=createServer(async(req,res)=>{
  const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!path.startsWith(root+'/')) return res.writeHead(403).end();
  try {const data=await readFile(path);res.writeHead(200,{'Content-Type':mime[extname(path)] || 'application/octet-stream'}).end(data);}
  catch {res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
// A 1×1 transparent PNG.
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const report={id:'f'.repeat(64),reason:'Not kind',kind:'gift',createdAt:1760000000,resolvedAt:null,stored:true,sender:'aaaaaaaa',reporter:'cccccccc',senderReports:2,senderOpen:2,senderBlocked:false};
const posts=[];
let browser;
try {
  browser=await chromium.launch({headless:true,...(process.env.PETA_BROWSER ? {executablePath:process.env.PETA_BROWSER} : {})});
  const page=await browser.newPage({viewport:{width:1060,height:800}}), errors=[];
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname, method=route.request().method();
    if(method==='POST'){posts.push([path,route.request().postDataJSON()]);return route.fulfill({json:path==='/api/reports/block'?{blocked:true,resolved:2}:{ok:true}});}
    const data={'/api/me':{email:'owner@example.test'},'/api/friends':{friends:[],revision:'1',downloadPage:''},
      '/api/reports':{open:1,reports:[report,{...report,id:'e'.repeat(64),resolvedAt:1760000500,reason:'<img src=x onerror=alert(1)>'}],blocked:[{key:'bbbbbbbb',reason:'Spam',at:1760000000,reports:1}]},
      '/api/news':{news:[{id:'news-1',text:'<b>Autumn</b> week',kind:'event',link:'download',startsAt:1760000000,endsAt:2000000000,stoppedAt:null,state:'live'}]},
      [`/api/reports/${report.id}`]:{...report,available:true,contents:{readable:true,lines:[{label:'Note',value:'<b>not bold</b>'}],pictures:[{label:'Sticker',png:PNG}]}},
    }[path];
    await route.fulfill(data?{json:data}:{status:404,json:{error:'not_found'}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/cloudflare/peta-admin/public/index.html`);
  await mkdir(shots,{recursive:true});

  // Reports: the open count on the tab, plain-text reasons, blob: pictures, resolve and block with confirmation.
  await page.waitForFunction(()=>document.querySelector('#reports-count').textContent==='1');
  await page.getByRole('tab',{name:/Reports/}).click();await page.getByRole('button',{name:'View contents'}).first().waitFor();
  assert.equal(await page.locator('#report-list img').count(),0);
  assert.match(await page.locator('#report-list').textContent(),/<img src=x onerror=alert\(1\)>/);
  await page.getByRole('button',{name:'View contents'}).first().click();await page.locator('#report-list img').waitFor();
  assert.match(await page.locator('#report-list img').getAttribute('src'),/^blob:/);
  assert.equal(await page.locator('#report-list dd b').count(),0);assert.match(await page.locator('#report-list dd').first().textContent(),/<b>not bold<\/b>/);
  assert.equal(await page.locator('#report-list a[download]').count(),0);
  await page.getByRole('button',{name:'Resolve'}).first().click();await page.locator('#accept-confirm').click();
  await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('resolved'));
  await page.getByRole('button',{name:'Block sender'}).first().click();await page.locator('#block-reason').fill('Confirmed abuse');
  assert.equal(await page.locator('#block-resolve').isChecked(),true);await page.locator('#accept-block').click();
  await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('blocked'));
  assert.deepEqual(posts.filter(p=>p[0].startsWith('/api/reports')).map(p=>p[0]),['/api/reports/resolve','/api/reports/block']);
  assert.deepEqual(posts.at(-1)[1],{id:report.id,reason:'Confirmed abuse',resolveOpen:true,confirm:true});
  await page.screenshot({path:join(shots,'reports-desktop.png'),fullPage:true});
  await page.setViewportSize({width:375,height:812});await page.screenshot({path:join(shots,'reports-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:1060,height:800});

  // News: a plain-text preview, the two fixed links and publish.
  await page.getByRole('tab',{name:'News',exact:true}).click();await page.getByRole('button',{name:'Stop'}).waitFor();
  assert.match(await page.locator('#news-list').textContent(),/<b>Autumn<\/b> week/);
  await page.locator('#news-text').fill('<i>Hello</i> friends');await page.locator('#news-link').selectOption('discord');
  assert.match(await page.locator('#news-preview').textContent(),/Info · <i>Hello<\/i> friends  The Discord invite →/);
  assert.equal(await page.locator('#news-link option').count(),3);
  await page.getByRole('button',{name:'Publish'}).click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('published'));
  const published=posts.find(p=>p[0]==='/api/news')[1];
  assert.equal(published.text,'<i>Hello</i> friends');assert.equal(published.link,'discord');assert.ok(published.endsAt-published.startsAt>=6*86400);
  await page.setViewportSize({width:375,height:812});await page.screenshot({path:join(shots,'news-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:1060,height:800});

  assert.deepEqual(errors,[]);console.log(`Owner desk round two: checks passed. Screenshots in ${shots}.`);
} finally {await browser?.close();server.close();}
