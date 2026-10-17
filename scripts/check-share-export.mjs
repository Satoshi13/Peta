/** Reproducible share-card rendering and all three export controls against isolated IPC. */
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PETA_PLAYWRIGHT_MODULE||'playwright');
const root=process.cwd(),out=resolve('docs/official-packs-v2/share');await mkdir(out,{recursive:true});
const material=process.env.PETA_SHARE_MATERIAL||'matte';
const source=process.env.PETA_SHARE_PNG||resolve('src/art/samples/cat-skateboard.png');
const phase=process.argv.includes('--before')?'before':'after';
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');let file=url.pathname==='/fixture.png'?source:resolve(root,'.'+url.pathname);const data=url.pathname==='/share.js'&&phase==='before'?execFileSync('git',['show','9ffe138:src/app/js/share-card.js']):await readFile(url.pathname==='/share.js'?resolve('src/app/js/share-card.js'):file);res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.png':'image/png','.svg':'image/svg+xml','.jpg':'image/jpeg'})[extname(file)]||'text/plain'}).end(data);}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.PETA_BROWSER?{executablePath:process.env.PETA_BROWSER}:{})});const page=await browser.newPage({viewport:{width:900,height:900}});
 await page.goto(`http://127.0.0.1:${server.address().port}/src/app.html`); // scripts are replaced below; no native library is opened
 await page.setContent('<html><head><base href="'+`http://127.0.0.1:${server.address().port}/src/`+'"></head><body></body></html>');
 await page.addScriptTag({content:`const A={pagePaper:'art/book/page-paper.jpg',logo:'art/brand/logo-wordmark-ink.svg'};const PetaMath={fitInside:(w,h,mw,mh)=>{const k=Math.min(mw/w,mh/h);return{w:w*k,h:h*k}}};const resOf=async()=>({url:'/fixture.png'});const titleOf=()=> 'Cat';const Snd={tap(){}};const userError=String;const Dialogs={open:d=>d.showModal()};const CloseButton=()=>document.createElement('button');const calls=[];const Bridge={invoke:async(cmd,args)=>{calls.push({cmd,args});if(cmd==='sticker_export_options')return true;if(cmd==='sticker_export')return Array.from(new Uint8Array(await(await fetch('/fixture.png')).arrayBuffer()));return null;}};const h=(tag,...args)=>{let props=args[0]&&typeof args[0]==='object'&&!Array.isArray(args[0])&&!(args[0] instanceof Node)?args.shift():{};let bits=tag.split('.'),e=document.createElement(bits.shift());e.className=bits.join(' ');for(const[k,v]of Object.entries(props)){if(k==='on'){for(const[n,f]of Object.entries(v))e.addEventListener(n,f);}else if(k==='data'){Object.assign(e.dataset,v);}else if(k==='style'){Object.assign(e.style,v);}else if(k in e)e[k]=v;else e.setAttribute(k,v);}for(const c of args.flat(Infinity))if(c!=null)e.append(c);return e;};`});
 await page.addScriptTag({url:`http://127.0.0.1:${server.address().port}/src/app/js/sticker.js`});await page.addScriptTag({url:`http://127.0.0.1:${server.address().port}/share.js`});
 const png=await page.evaluate(async(material)=>Array.from(new Uint8Array(await(await ShareCard.render({id:'PETA-6R1N-3SBY',material})).arrayBuffer())),material);await writeFile(resolve(out,`${phase}.png`),Buffer.from(png));
 if(phase==='after'){
  await page.evaluate(()=>ShareCard.open({id:'PETA-6R1N-3SBY',material:'holographic'}));await page.locator('.share-copy:enabled').waitFor();
  assert.equal(await page.locator('.share-kind option').count(),3);
  for(const kind of ['card','sticker','cutout']){await page.selectOption('.share-kind',kind);await page.locator('.share-copy:enabled').waitFor();await page.click('.share-copy');await page.click('.share-save');await page.waitForFunction(n=>window.eval('calls').filter(c=>c.cmd==='poster_save').length>=n,['card','sticker','cutout'].indexOf(kind)+1);}
  const calls=await page.evaluate(()=>window.eval('calls'));const save=calls.filter(c=>c.cmd==='poster_save');assert.deepEqual(save.map(c=>c.args.name),['Peta Cat','Peta Cat','Peta Cat cut-out']);assert.equal(calls.filter(c=>c.cmd==='share_copy').length,3);await writeFile(resolve(out,'controls.json'),JSON.stringify({choices:3,copy:3,saveNames:save.map(c=>c.args.name)},null,2)+'\n');
 }
 console.log(`Saved ${phase} share card and checked export controls.`);
}finally{await browser?.close();server.close();}
