/** Market hanging geometry and screenshots against isolated IPC. Run --before before applying the glassine fix. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PETA_PLAYWRIGHT_MODULE || 'playwright');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const before=process.argv.includes('--before'), phase=before?'before':'after';
const out=resolve(root,'docs/official-packs-finish/step1');await mkdir(out,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!path.startsWith(root+'/'))return res.writeHead(403).end();try{const data=await readFile(path);res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.PETA_BROWSER?{executablePath:process.env.PETA_BROWSER}:{})});
 const page=await browser.newPage({viewport:{width:1060,height:800}}),errors=[],metrics=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript({content:await readFile(resolve(root,'scripts/ui-fixes-oct07-fixture.js'),'utf8')});
 await page.goto(`http://127.0.0.1:${server.address().port}/src/app.html?page=market`);await page.waitForSelector('.mk-rail');
 await page.evaluate(async()=>{
  S.motion='reduce';Bridge.savePreferences();
  const items=[{key:'cat',name:'Cat',rarity:'common'}];
  S.scraps.shopPacks=[{id:'shop:hang-glassine',title:'Glassine',by:'Peta',pouch:'glassine',price:12,items},{id:'shop:hang-rose',title:'Rose',by:'Peta',pouch:'matte',color:'rose',price:12,items}];
  S.scraps.shop={...S.scraps.shop,order:['shop:hang-glassine','coffee','shop:hang-rose'],featured:['tokyo']};
 });
 for(const width of [1060,720])for(const appearance of ['day','night']){
  await page.setViewportSize({width,height:800});await page.evaluate(async appearance=>{S.appearance=appearance;Appearance.apply();Featured.reset();await Shell.go('market',{force:true,instant:true});},appearance);
  await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const row=page.locator('.mk-rail-row').first();await row.scrollIntoViewIfNeeded();
  await row.screenshot({path:resolve(out,`${phase}-${width}-${appearance}.png`)});
  const geometry=await row.evaluate(async el=>{
   const result={};for(const id of ['shop:hang-glassine','coffee','shop:hang-rose']){
    const tile=el.querySelector(`[data-pack="${id}"]`);if(!tile)continue;
    const stack=tile.querySelector('.pk-stack').getBoundingClientRect(),clip=tile.parentElement.querySelector('.mk-clip').getBoundingClientRect(),pic=tile.querySelector('.bagpic')?.getBoundingClientRect();
    result[id]={stackTop:stack.top,clipBottom:clip.bottom,picTop:pic?.top,picWidth:pic?.width,picHeight:pic?.height};
   }return result;
  });metrics.push({width,appearance,geometry});
  if(!before){const g=geometry['shop:hang-glassine'];assert.ok(g.picTop+g.picHeight*(147/1254)<=g.clipBottom-2,'clip must overlap the glassine painted top');}
 }
 if(!before){const baseline=JSON.parse(await readFile(resolve(out,'before-geometry.json'),'utf8'));for(let i=0;i<metrics.length;i++)for(const id of ['coffee','shop:hang-rose'])assert.deepEqual(JSON.parse(JSON.stringify(metrics[i].geometry[id])),baseline[i].geometry[id],'other bags must stay in place');}
 await writeFile(resolve(out,`${phase}-geometry.json`),JSON.stringify(metrics,null,2)+'\n');assert.deepEqual(errors,[]);console.log(JSON.stringify(metrics));
}finally{await browser?.close();server.close();}
