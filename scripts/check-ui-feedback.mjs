/** October 13 UI regressions, using isolated IPC rather than the user's library.
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
    const invoke=window.__TAURI__.core.invoke;
    window.__TAURI__.core.invoke=async(cmd,args)=>{
      if(cmd==='friend_link_take') return null;
      if(cmd==='creator_info') return {phase:window.reviewEditing ? 'ready':'idle',width:512,height:512,editingStickerId:window.reviewEditing,editAsNew:true,defaultMaterial:'matte',defaultOutline:20,defaultSmooth:.3,defaultStrength:.5};
      if(cmd==='creator_cancel'){window.reviewEditing=null;return;}
      if(cmd==='creator_edit_original'){window.reviewEditing=args.stickerId;return;}
      if(cmd==='creator_save_original'){
        window.reviewSaved=args;window.reviewEditing=null;return {stickerId:'review-new',newImage:false};
      }
      if(cmd==='sticker_back') return {kind:'original',material:{id:'matte',name:'Matte'},createdBy:'Review',createdOn:'2026-10-13',originalNumber:1,idCode:args.stickerId};
      if(cmd==='creator_original') return [...new Uint8Array(await(await fetch('/src/art/samples/good-day.png')).arrayBuffer())];
      if(cmd==='creator_render') {
        const png=new Uint8Array(await(await fetch('/src/art/samples/good-day.png')).arrayBuffer());
        const header=new TextEncoder().encode(JSON.stringify({stickerLen:png.length,cutoutLen:png.length,width:512,height:512}));
        const result=new Uint8Array(4+header.length+png.length*2);new DataView(result.buffer).setUint32(0,header.length);
        result.set(header,4);result.set(png,4+header.length);result.set(png,4+header.length+png.length);return [...result];
      }
      let result=await invoke(cmd,args);
      if(cmd==='book_page' && window.reviewSaved) result=[...result,{...result[0],stickerId:'review-new',title:window.reviewSaved.name}];
      if(cmd==='book_page') for(const e of result){e.checked='checked';e.lineage='real';e.title='Named Peta';}
      if(cmd==='pack_status') result.limits={copiesPerDesign:30,packSlots:200,prizes:10};
      return result;
    };
  };
  await page.addInitScript({content:await readFile(resolve(root,'scripts/ui-fixes-oct07-fixture.js'),'utf8')+'\n('+fixture.toString()+')();'});
  await page.goto(`http://127.0.0.1:${server.address().port}/src/app.html?page=book`);
  await page.waitForSelector('.bookpage');
  await page.evaluate(()=>{const go=Shell.go;Shell.go=(id,o={})=>go(id,{...o,instant:true});});
  for(const width of [1060,720]) {
    await page.setViewportSize({width,height:800});
    for(const theme of ['day','night']) {
      await page.evaluate(async theme=>{S.appearance=theme;S.motion='reduce';Bridge.savePreferences();BK.sel=S.lib[0].id;await Shell.open('book');},theme);
      await page.waitForSelector('[data-action="edit"]');
      assert.equal(await page.locator('.ph h1').evaluate(el=>getComputedStyle(el).color),theme==='night'?'rgb(241, 234, 217)':'rgb(43, 42, 40)');
      const date=await page.locator('.tile-date').first().evaluate(el=>getComputedStyle(el).color);
      assert.equal(date,theme==='night'?'rgb(217, 207, 186)':'rgb(74, 70, 63)');
      await page.evaluate(async()=>{StudioOpen('gift',S.lib[0].id);await Shell.open('studio');});
      await page.waitForSelector('.st-panel');
      await page.evaluate(()=>{ST.gift.step=2;Shell.refresh();});
      const colors=await page.locator('.st-panel').evaluate(el=>({text:getComputedStyle(el).color,heading:getComputedStyle(el.querySelector('h2')).color,input:getComputedStyle(el.querySelector('input')).backgroundColor}));
      assert.equal(colors.text,theme==='night'?'rgb(241, 234, 217)':'rgb(43, 42, 40)',JSON.stringify({width,theme,colors}));assert.equal(colors.heading,colors.text);assert.equal(colors.input,theme==='night'?'rgb(38, 34, 25)':'rgb(248, 243, 231)');
      await page.evaluate(()=>Shell.open('packs'));
      assert.equal(await page.locator('.pk-count').first().evaluate(el=>getComputedStyle(el).mixBlendMode),theme==='night'?'normal':'multiply');
      await page.evaluate(async()=>{await Shell.open('market');Scraps.button('material','matte','Exchange').click();});
      const count=page.locator('.scrap-trade input[type="number"]');
      assert.equal(await count.evaluate(el=>document.activeElement===el),false);
      await count.focus();
      assert.equal(await count.evaluate(el=>getComputedStyle(el).outlineStyle),'none');
    }
  }
  await page.setViewportSize({width:1060,height:800});
  const chrome=await page.evaluate(()=>({logo:getComputedStyle(document.querySelector('.nav'),'::before').width,dot:getComputedStyle(document.querySelector('.wc')).backgroundSize}));
  assert.equal(chrome.logo,'88px');assert.equal(chrome.dot,'18px 18px');
  await page.evaluate(async()=>{BK.sel=S.lib[0].id;await Shell.open('book');});
  await page.locator('[data-action="edit"]').click();await page.waitForFunction(()=>window.reviewEditing);await page.evaluate(()=>crSync());
  await page.waitForSelector('.cs-sticker .stk');
  assert.equal(await page.locator('.g-go .go-btns > .btn').last().textContent(),'Save as new Peta');
  const name=page.locator('#cr-name'),save=page.locator('.g-go .go-btns > .btn').last();
  await name.fill('   ');assert.equal(await save.isDisabled(),true);
  await name.fill('New name');assert.equal(await save.isEnabled(),true);
  await page.evaluate(()=>{S.stock.matte=0;MAT.matte.unlimited=false;Shell.refresh();});
  assert.equal(await save.isDisabled(),true);
  await page.evaluate(()=>{S.stock.matte=5;Shell.refresh();});
  await page.waitForFunction(()=>!document.querySelector('.g-go .go-btns > .btn:last-child').disabled);
  await save.click();await page.waitForSelector('.detail');
  const saved=await page.evaluate(()=>({args:window.reviewSaved,selected:BK.sel,originalPresent:S.lib.some(e=>e.id==='review-0')}));
  assert.equal(saved.args.saveAsNew,true);assert.equal(saved.args.name,'New name');
  assert.equal(saved.selected,'review-new');assert.equal(saved.originalPresent,true);
  // Probe lifecycle: isolate metadata delivery to observe Loading, success, and failure.
  const video=await page.evaluate(()=>{
    const create=document.createElement.bind(document),probes=[];
    document.createElement=(tag,...args)=>{const el=create(tag,...args);if(tag==='video')probes.push(el);return el;};
    try {
      const first=AboutPeta.card(),button=first.querySelector('.about-watch');
      const loading=button.textContent;probes[0].dispatchEvent(new Event('loadedmetadata'));
      const ready={text:button.textContent,disabled:button.disabled};
      const second=AboutPeta.card();probes[1].dispatchEvent(new Event('error'));
      return {loading,ready,error:second.querySelector('.about-watch').textContent};
    } finally {document.createElement=create;}
  });
  assert.equal(video.loading,'Loading…');assert.deepEqual(video.ready,{text:'Watch the tour',disabled:false});assert.equal(video.error,'Tour unavailable');
  if(process.env.PETA_UI_OUT){
    await mkdir(process.env.PETA_UI_OUT,{recursive:true});
    await page.evaluate(async()=>{await Pages.book.edit(S.lib[0]);await crSync();document.querySelector('#toast').classList.remove('on');});
    await page.waitForSelector('.cs-sticker .stk');await page.screenshot({path:resolve(process.env.PETA_UI_OUT,'create-night.png')});
    await page.evaluate(async()=>{ST.mode='gift';ST.gift.step=2;await Shell.open('studio');});
    await page.screenshot({path:resolve(process.env.PETA_UI_OUT,'gift-night.png')});
    await page.evaluate(async()=>{BK.sel=S.lib[0].id;await Shell.open('book');});
    await page.screenshot({path:resolve(process.env.PETA_UI_OUT,'collection-night.png')});
  }
  assert.deepEqual(errors,[]);console.log('UI feedback checks passed at 1060px and 720px, in Day and Night.');
} finally {await browser?.close();await new Promise(r=>server.close(r));}
