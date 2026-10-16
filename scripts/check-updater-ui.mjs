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
  const fixture=()=>{
    const invoke=window.__TAURI__.core.invoke;window.updateReady=null;window.updateFail=false;window.updateCalls=0;
    window.__TAURI__.core.invoke=async(cmd,args)=>{
      if(cmd==='friend_link_take')return null;
      if(cmd==='update_status')return {enabled:true,version:'0.1.0',ready:window.updateReady};
      if(cmd==='update_check'){window.updateCalls++;if(window.updateFail)throw Error('offline');return {enabled:true,version:'0.1.0',ready:window.updateReady};}
      return invoke(cmd,args);
    };
  };
  await page.addInitScript({content:await readFile(resolve(root,'scripts/ui-fixes-oct07-fixture.js'),'utf8')+'\n('+fixture.toString()+')();'});
  await page.goto(`http://127.0.0.1:${server.address().port}/src/app.html?page=settings`);await page.waitForSelector('.settingspage');
  await page.getByRole('button',{name:'Check for updates',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>!UpdateUI.checking);
  await page.evaluate(async()=>{S.pending={stickerId:'printing'};window.updateReady='0.2.0';await UpdateUI.check(false);});
  assert.equal(await page.locator('.update-notice').count(),0);
  await page.evaluate(()=>{S.pending=null;const cer=document.createElement('div');cer.className='cer';document.body.append(cer);UpdateUI.offer();});
  assert.equal(await page.locator('.update-notice').count(),0);
  await page.evaluate(()=>document.querySelector('.cer').remove());await page.locator('.update-notice').waitFor();
  await page.getByRole('button',{name:'Later',exact:true}).click();await page.evaluate(()=>UpdateUI.offer());assert.equal(await page.locator('.update-notice').count(),0);
  await page.getByRole('button',{name:'Check for updates',exact:true}).click();await page.locator('.update-notice').waitFor();
  await mkdir('/tmp/peta-updater-ui',{recursive:true});await page.screenshot({path:'/tmp/peta-updater-ui/ready.png'});
  await page.getByRole('button',{name:'Later',exact:true}).click();
  await page.evaluate(async()=>{window.updateReady=null;window.updateFail=true;await UpdateUI.check(false);});assert.equal(await page.locator('.update-notice').count(),0);
  assert.deepEqual(errors,[]);console.log('Updater UI: quiet background failure, deferred notice, Later and manual check passed.');
} finally {await browser?.close();server.close();}
