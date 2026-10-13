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
  // Exercise the Gift destination controls with isolated friend state, without sealing or HTTP.
  await page.evaluate(async()=>{await Shell.open('studio');S.name='Maker';S.inbox.enabled=true;S.inbox.friends=[{publicKey:'fixture-friend',name:'Nao',status:'friend',fingerprint:'00112233'}];ST.mode='gift';Object.assign(ST.gift,{step:2,sticker:S.lib[0].id,dest:'file',friend:null,to:'',sealed:false});Shell.refresh();});
  await page.locator('.fr-pill').filter({hasText:'Nao'}).click();
  assert.equal(await page.getByRole('textbox',{name:'Name on the envelope',exact:true}).count(),0);
  await page.getByRole('button',{name:'Next →',exact:true}).click();
  assert.equal(await page.locator('.fr-pill').count(),0);
  assert.ok(await page.getByText('For Nao · to their Peta',{exact:true}).isVisible());
  await page.evaluate(()=>{ST.gift.step=2;Shell.refresh();});
  await page.getByRole('button',{name:'Someone else — save a file',exact:true}).click();
  await page.getByRole('textbox',{name:'Name on the envelope',exact:true}).fill('Aki');
  await page.getByRole('button',{name:'Next →',exact:true}).click();
  assert.ok(await page.getByText('For Aki · saved as a file',{exact:true}).isVisible());
  await page.evaluate(()=>{ST.gift.step=2;S.inbox.friends=[];Shell.refresh();});
  assert.ok(await page.getByText('No friends yet.',{exact:false}).isVisible());
  await page.evaluate(()=>{S.inbox.enabled=false;Shell.refresh();});
  assert.equal(await page.locator('.fr-pill').count(),0);
  assert.ok(await page.getByRole('textbox',{name:'Name on the envelope',exact:true}).isVisible());
  assert.deepEqual(await page.evaluate(()=>window.cspViolations),[],'Gift destinations');
  for(const file of ['index.html','arrival.html']){
    await page.goto(`${origin}/src/${file}`);await page.waitForLoadState('networkidle');
    assert.deepEqual(await page.evaluate(()=>window.cspViolations),[],file);
  }
  assert.deepEqual(errors,[]);
  await page.evaluate(()=>{const s=document.createElement('script');s.textContent='window.untrustedScriptRan=true';document.body.append(s);});
  await page.waitForFunction(()=>window.cspViolations.length>0);
  assert.equal(await page.evaluate(()=>window.untrustedScriptRan),undefined);
  console.log('PASS: 10 app pages, Gift friend/file/offline destinations, desktop layer and arrival load without CSP violations; untrusted inline script is blocked. Native WebView checks remain on the macOS checklist.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
