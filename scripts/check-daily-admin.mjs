/** October 15 UI regressions, using isolated IPC rather than the user's library.
 * Set PETA_PLAYWRIGHT_MODULE and optionally PETA_BROWSER for a local browser.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PETA_PLAYWRIGHT_MODULE || 'playwright');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.mp4':'video/mp4'};
const server=createServer(async(req,res)=>{
  const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!path.startsWith(root+'/')) return res.writeHead(403).end();
  try {const data=await readFile(path);res.writeHead(200,{'Content-Type':mime[extname(path)] || 'application/octet-stream'}).end(data);}
  catch {res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
  browser=await chromium.launch({headless:true,...(process.env.PETA_BROWSER ? {executablePath:process.env.PETA_BROWSER} : {})});
  const page=await browser.newPage({viewport:{width:1060,height:800}}), errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  const contract=JSON.parse(await readFile(resolve(root,'cloudflare/peta-admin/test/materials-vector.json'),'utf8'));
  let saved;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const data=path==='/api/me'?{email:'owner@example.test'}:path==='/api/friends'?{friends:[],revision:'1',downloadPage:''}:path==='/api/daily' && route.request().method()==='POST'?(saved=route.request().postDataJSON(),{id:'test'}):{contract,tables:[{id:'current',kind:'default',title:'Daily supply',state:'active',items:contract.fixed,startsAt:1,endsAt:2000000000,stoppedAt:null}]};
    await route.fulfill({json:data});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/cloudflare/peta-admin/public/index.html`);
  await page.getByRole('tab',{name:'Daily',exact:true}).click();await page.getByRole('button',{name:'Save normal table'}).waitFor();
  const normal=page.locator('#daily-content form').first(),save=normal.getByRole('button',{name:'Save normal table'});
  await normal.getByRole('spinbutton',{name:'Matte weight',exact:true}).fill('1');await save.isDisabled().then(v=>assert.equal(v,true));
  await normal.getByRole('spinbutton',{name:'Matte weight',exact:true}).fill('60');assert.equal(await save.isDisabled(),false);
  await normal.getByRole('checkbox',{name:'Include Gold Foil',exact:true}).check();await normal.getByRole('spinbutton',{name:'Gold Foil weight',exact:true}).fill('10');assert.equal(await save.isDisabled(),true);
  await normal.getByRole('spinbutton',{name:'Gold Foil weight',exact:true}).fill('5');assert.equal(await save.isDisabled(),false);
  assert.match(await normal.locator('.daily-forecast').textContent(),/Scraps/);
  await save.click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('saved'));assert.equal(saved.kind,'default');assert.equal(saved.items.find(i=>i.id==='gold').weight,5);
  await mkdir('/tmp/peta-daily-admin',{recursive:true});await page.screenshot({path:'/tmp/peta-daily-admin/desktop.png',fullPage:true});
  await page.setViewportSize({width:375,height:812});await page.screenshot({path:'/tmp/peta-daily-admin/mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);console.log('Daily admin: live limits, expected Scraps, save, and 375px layout passed.');
} finally {await browser?.close();server.close();}
