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
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
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
const dailyContract=JSON.parse(await readFile(resolve(root,'cloudflare/peta-admin/test/materials-vector.json'),'utf8'));
const packContract=JSON.parse(await readFile(resolve(root,'cloudflare/shared/shop-pack-contract.json'),'utf8'));

const {shopCatalog}=JSON.parse(await readFile(resolve(root,'cloudflare/peta-admin/test/config-vector.json'),'utf8'));
shopCatalog.packs=shopCatalog.packs.map(p=>({...p,id:`shop:${p.id}-test`,shop:true}));
let browser;
try {
  browser=await chromium.launch({headless:true,...(process.env.PETA_BROWSER ? {executablePath:process.env.PETA_BROWSER} : {})});
  const page=await browser.newPage({viewport:{width:1060,height:800}}), errors=[];
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname, method=route.request().method();
    if(method==='POST'){posts.push([path,route.request().postDataJSON()]);return route.fulfill({json:path==='/api/reports/block'?{blocked:true,resolved:2}:{ok:true}});}
    const data={'/api/me':{email:'owner@example.test'},'/api/friends':{friends:[],revision:'1',downloadPage:''},
      '/api/daily':{contract:dailyContract,tables:[]},
      '/api/coupons':{catalog:[{kind:'scraps',id:'',cap:1000}],coupons:[{name:'THANKYOU',title:'From Peta',items:[{kind:'scraps',count:20}],readable:true,startsAt:1760000000,endsAt:2000000000,claims:1,maxClaims:10,state:'open'}]},
      '/api/packs':{contract:packContract,drafts:[],packs:[],storage:{objects:0,bytes:0,truncated:false}},
      '/api/release':{latest:{version:'0.0.1',size:10485760,publishedAt:'2026-10-17T00:00:00Z',minimumSystemVersion:'14.0',architectures:['arm64','x86_64']},downloads:[{version:'0.0.1',people:2,downloads:3,lastAt:1760000000}],updates:[]},
      '/api/reports':{open:1,reports:[report,{...report,id:'e'.repeat(64),resolvedAt:1760000500,reason:'<img src=x onerror=alert(1)>'}],blocked:[{key:'bbbbbbbb',reason:'Spam',at:1760000000,reports:1}]},
      '/api/shop':{catalog:shopCatalog,configs:[{id:'shop-1',kind:'default',featured:['shop:night-test'],officialFirst:false,order:['shop:night-test'],packs:[{id:'shop:night-test',onSale:true,price:14,blurb:'Fog.'}],startsAt:1760000000,endsAt:2000000000,stoppedAt:null,state:'active'}]},
      '/api/market':{openListings:7,sellers:3,allTime:{pulls:40,scraps:240,sellerMilli:168000},daily:Array.from({length:30},(_,i)=>({day:1760000000-1760000000%86400+i*86400,pulls:i%7,scraps:(i%7)*6,sellerMilli:(i%7)*4200}))},
      '/api/news':{news:[{id:'news-1',text:'<b>Autumn</b> week',kind:'event',link:'download',startsAt:1760000000,endsAt:2000000000,stoppedAt:null,state:'live'}]},
      [`/api/reports/${report.id}`]:{...report,available:true,contents:{readable:true,lines:[{label:"メモ",value:'<b>not bold</b>'}],pictures:[{label:"ステッカー",png:PNG}]}},
    }[path];
    await route.fulfill(data?{json:data}:{status:404,json:{error:'not_found'}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/cloudflare/peta-admin/public/index.html`);
  await mkdir(shots,{recursive:true});

  // Reports: the open count on the tab, plain-text reasons, blob: pictures, resolve and block with confirmation.
  await page.waitForFunction(()=>document.querySelector('#reports-count').textContent==='1');
  await page.getByRole('tab',{name:/報告/}).click();await page.getByRole('button',{name:"内容を見る"}).first().waitFor();
  assert.equal(await page.locator('#report-list img').count(),0);
  assert.match(await page.locator('#report-list').textContent(),/<img src=x onerror=alert\(1\)>/);
  await page.getByRole('button',{name:"内容を見る"}).first().click();await page.locator('#report-list img').waitFor();
  assert.match(await page.locator('#report-list img').getAttribute('src'),/^blob:/);
  assert.equal(await page.locator('#report-list dd b').count(),0);assert.match(await page.locator('#report-list dd').first().textContent(),/<b>not bold<\/b>/);
  assert.equal(await page.locator('#report-list a[download]').count(),0);
  await page.getByRole('button',{name:"解決済みにする"}).first().click();await page.locator('#accept-confirm').click();
  await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('解決済み'));
  await page.getByRole('button',{name:"送信者をブロック"}).first().click();await page.locator('#block-reason').fill('Confirmed abuse');
  assert.equal(await page.locator('#block-resolve').isChecked(),true);await page.locator('#accept-block').click();
  await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('ブロック'));
  assert.deepEqual(posts.filter(p=>p[0].startsWith('/api/reports')).map(p=>p[0]),['/api/reports/resolve','/api/reports/block']);
  assert.deepEqual(posts.at(-1)[1],{id:report.id,reason:'Confirmed abuse',resolveOpen:true,confirm:true});
  await page.screenshot({path:join(shots,'reports-desktop.png'),fullPage:true});
  await page.setViewportSize({width:375,height:812});await page.screenshot({path:join(shots,'reports-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:1060,height:800});

  // News: a plain-text preview, the two fixed links and publish.
  await page.getByRole('tab',{name:"お知らせ",exact:true}).click();await page.getByRole('button',{name:"停止"}).waitFor();
  assert.match(await page.locator('#news-list').textContent(),/<b>Autumn<\/b> week/);
  await page.locator('#news-text').fill('<i>Hello</i> friends');await page.locator('#news-link').selectOption('discord');
  assert.match(await page.locator('#news-preview').textContent(),/情報 · <i>Hello<\/i> friends  Discord招待 →/);
  assert.equal(await page.locator('#news-link option').count(),3);
  await page.getByRole('button',{name:"公開"}).click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('公開しました'));
  const published=posts.find(p=>p[0]==='/api/news')[1];
  assert.equal(published.text,'<i>Hello</i> friends');assert.equal(published.link,'discord');assert.ok(published.endsAt-published.startsAt>=6*86400);
  await page.setViewportSize({width:375,height:812});await page.screenshot({path:join(shots,'news-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:1060,height:800});

  // Shop: starts from the setting in effect, refuses a price out of range, saves only what differs from the built-in shop.
  await page.getByRole('tab',{name:"ショップ",exact:true}).click();await page.locator('.shop-price[data-pack="shop:pixel-test"]').waitFor();
  assert.equal(await page.locator('#shop-featured input[value="shop:night-test"]').isChecked(),true);
  assert.equal(await page.locator('.shop-price[data-pack="shop:night-test"]').inputValue(),'14');
  assert.equal(await page.locator('.shop-price[data-pack="shop:tokyo-test"]').isDisabled(),true,'free packs have no price');
  await page.locator('.shop-price[data-pack="shop:pixel-test"]').fill('30');await page.getByRole('button',{name:"ショップ設定を保存"}).click();
  assert.equal(await page.locator('.shop-price[data-pack="shop:pixel-test"]').evaluate(e=>e.validity.valid),false);assert.equal(posts.some(p=>p[0]==='/api/shop'),false);
  await page.locator('.shop-price[data-pack="shop:pixel-test"]').fill('20');await page.locator('.shop-sale[data-pack="shop:cats-test"]').uncheck();
  await page.locator('#shop-featured input[value="shop:pixel-test"]').check();await page.locator('#shop-official-first').check();
  await page.getByRole('button',{name:'Pixel Dreamを上へ'}).click();
  await page.getByRole('button',{name:"ショップ設定を保存"}).click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('ショップ設定を保存しました'));
  const saved=posts.find(p=>p[0]==='/api/shop')[1];
  assert.deepEqual(saved.featured,['shop:pixel-test','shop:night-test']);assert.equal(saved.officialFirst,true);assert.equal(saved.kind,'default');
  assert.deepEqual(saved.packs,[{id:'shop:pixel-test',onSale:true,price:20,blurb:null},{id:'shop:cats-test',onSale:false,price:null,blurb:null},{id:'shop:night-test',onSale:true,price:14,blurb:'Fog.'}]);
  assert.equal(saved.order.length,6);
  await page.setViewportSize({width:375,height:812});await page.screenshot({path:join(shots,'shop-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:1060,height:800});

  // Market: totals, two single-measure SVG charts with per-day tooltips, a table, nothing personal.
  await page.getByRole('tab',{name:'Market',exact:true}).click();await page.locator('#market-content svg').first().waitFor();
  assert.equal(await page.locator('#market-content svg').count(),2);
  assert.equal(await page.locator('#market-content svg .col').first().locator('title').textContent().then(t=>/· 0 回/.test(t)),true);
  assert.equal(await page.locator('#market-content table tr').count(),31);
  assert.match(await page.locator('#market-content').textContent(),/合計 168 Scraps/);
  await page.screenshot({path:join(shots,'market-desktop.png'),fullPage:true});
  await page.setViewportSize({width:375,height:812});await page.screenshot({path:join(shots,'market-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:1060,height:800});

  // Every owner tab stays usable at 375px and its interface text is Japanese.
  await page.setViewportSize({width:375,height:812});
  for(const id of ['friends','coupons','daily','shop','packs','news','reports','market','release']){
    const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/'+id);
    await page.locator('#tab-'+id).click();await response;
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,id+' must fit 375px');
    const text=await page.locator('#'+id).innerText();assert.ok(!/Refresh|New pack ID|Signed in as|No downloads|1 stickers/.test(text),id+' uses Japanese controls');
    await page.screenshot({path:join(shots,id+'-375.png'),fullPage:true});
  }
  assert.deepEqual(errors,[]);console.log(`Owner desk round two: checks passed. Screenshots in ${shots}.`);
} finally {await browser?.close();server.close();}
