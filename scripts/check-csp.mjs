/** Exercise real frontend files under the configured CSP with isolated IPC, never user data.
 * Set PETA_PLAYWRIGHT_MODULE/PETA_BROWSER when using an existing bundled browser runtime.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const config=JSON.parse(await readFile(resolve(root,'src-tauri/tauri.conf.json'),'utf8'));
const developer=JSON.parse(await readFile(resolve(root,'src-tauri/tauri.developer.conf.json'),'utf8'));
const policy=config.app.security.csp;assert.equal(developer.app.security.csp,policy);
assert.ok(policy.includes("script-src 'self';"));assert.ok(!policy.includes('unsafe-eval'));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ttf':'font/ttf','.woff2':'font/woff2','.mp4':'video/mp4'};
const server=createServer(async(req,res)=>{
  const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}
  try{const data=await readFile(path);res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Content-Security-Policy':policy}).end(data);}
  catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const {chromium}=await import(process.env.PETA_PLAYWRIGHT_MODULE||'playwright');
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.PETA_BROWSER?{executablePath:process.env.PETA_BROWSER}:{})});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript({content:await readFile(resolve(root,'scripts/ui-fixes-oct07-fixture.js'),'utf8')});
  await page.addInitScript(()=>{
    window.cspViolations=[];document.addEventListener('securitypolicyviolation',e=>window.cspViolations.push({directive:e.effectiveDirective,blocked:e.blockedURI}));
    const original=window.__TAURI__.core.invoke;
    window.__TAURI__.core.invoke=async(cmd,args)=>{
      if(cmd==='inbox_status')return {enabled:false,friends:[]};
      if(cmd==='friend_link_take'||cmd==='referee_sync')return null;
      if(cmd==='layer_info')return {displayId:'fixture',logicalWidth:1200,logicalHeight:800};
      if(cmd==='layer_placements')return [];
      if(cmd==='arrival_status')return 'material';
      if(cmd==='arrival_hover_status')return false;
      if(cmd==='sticker_back')return {kind:'original',material:{id:'matte',name:'Matte'},createdBy:'Maker',createdOn:'Oct 14, 2026',originalNumber:1,idCode:args.stickerId};
      const result=await original(cmd,args);
      if(cmd==='pack_status')result.limits={copiesPerDesign:30,packSlots:200,prizes:10};
      return result;
    };
  });
  const origin=`http://127.0.0.1:${server.address().port}`;
  await page.goto(`${origin}/src/app.html?page=settings`);await page.waitForSelector('.settingspage');
  for(const route of ['today','create','studio','book','packs','gifts','materials','market','boards','settings']){
    await page.evaluate(async p=>{await Shell.open(p);await document.fonts.ready;for(let i=0;i<3;i++)await new Promise(requestAnimationFrame);},route);
    assert.deepEqual(await page.evaluate(()=>window.cspViolations),[],route);
  }
  for(const file of ['index.html','arrival.html']){
    await page.goto(`${origin}/src/${file}`);await page.waitForLoadState('networkidle');
    assert.deepEqual(await page.evaluate(()=>window.cspViolations),[],file);
  }
  assert.deepEqual(errors,[]);
  await page.evaluate(()=>{const s=document.createElement('script');s.textContent='window.untrustedScriptRan=true';document.body.append(s);});
  await page.waitForFunction(()=>window.cspViolations.length>0);
  assert.equal(await page.evaluate(()=>window.untrustedScriptRan),undefined);
  console.log('PASS: 10 app pages, desktop layer and arrival load without CSP violations; untrusted inline script is blocked. Native WebView checks remain on the macOS checklist.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
