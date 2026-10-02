#!/usr/bin/env python3
"""Browser checks against the existing UI using a mocked Tauri bridge."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]; SHOTS=ROOT/'docs/art-stage1'; SHOTS.mkdir(parents=True,exist_ok=True)
BRIDGE=r"""
(() => {
 const materials = [
  {id:"matte",name:"Matte",rarity:"common",recipe:{substrate:"paper"}},
  {id:"kraft",name:"Kraft",rarity:"uncommon",recipe:{substrate:"kraft"}},
  {id:"holographic",name:"Holographic",rarity:"rare",recipe:{substrate:"film",reflection:{enabled:true,type:"holographic"}}},
 ];
 const f=window.artFixture={materials,handlers:{},failOpen:false,phase:"ready",calls:[],status:{date:"2026-10-02",materialOpened:false,slot:"available",canCreate:true,stickerId:null,material:null,unlocked:materials}};
 const bytes=async()=>new Uint8Array(await (await fetch("art/samples/cat-skateboard.png")).arrayBuffer());
 window.__TAURI__={
  event:{listen:async(name,cb)=>{f.handlers[name]=cb;return()=>{};}},
  core:{invoke:async(name,args)=>{
   f.calls.push({name,args});
   if(name==="daily_status")return structuredClone(f.status);
   if(name==="daily_open_material"){
    await new Promise(r=>setTimeout(r,120));
    if(f.failOpen)throw "test_open_failed";
    f.status.materialOpened=true;f.status.material=materials[2];return structuredClone(f.status);
   }
   if(name==="collection_unused")return [];
   if(name==="daily_create")return structuredClone(f.status);
   if(name==="sticker_asset"||name==="creator_original")return await bytes();
   if(name==="creator_info")return {phase:f.phase,width:993,height:1024,hadAlpha:true,countsForToday:true,materials,defaultMaterial:"holographic",defaultStrength:.5};
   if(name==="creator_render"){
    const data=await bytes();const header=new TextEncoder().encode(JSON.stringify({stickerLen:data.length,cutoutLen:data.length,width:993,height:1024,coverage:.7}));
    const buffer=new ArrayBuffer(4+header.length+data.length*2);new DataView(buffer).setUint32(0,header.length);
    const out=new Uint8Array(buffer);out.set(header,4);out.set(data,4+header.length);out.set(data,4+header.length+data.length);return buffer;
   }
   if(["creator_cancel","creator_finish","creator_stroke","creator_clear_edits"].includes(name))return null;
   throw new Error("Unmocked command "+name);
  }},
 };
})();
"""
def assert_images(page):
 missing=page.evaluate("Array.from(document.images).filter(i=>i.getAttribute('src') && (!i.complete||i.naturalWidth===0)).map(i=>i.src)")
 assert not missing,missing
def snapshot(page,name):
 page.screenshot(path=str(SHOTS/name),type='jpeg',quality=88,full_page=True)
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 errors=[]
 for scheme in ('light','dark'):
  context=browser.new_context(viewport={'width':560,'height':1120},color_scheme=scheme)
  context.add_init_script(BRIDGE);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('http://127.0.0.1:8765/src/today.html');page.wait_for_selector('#stage-envelope:not([hidden])')
  assert_images(page)
  assert page.locator('[data-art="envelope"]').evaluate("e=>getComputedStyle(e,'::before').content")=='none'
  snapshot(page,f'today-envelope-{scheme}.jpg')
  page.locator('#open-material').click()
  page.wait_for_function("document.body.classList.contains('art-opening')")
  page.wait_for_function("!document.body.classList.contains('art-opening') && !document.getElementById('stage-choose').hidden")
  page.wait_for_timeout(700)
  assert page.locator('[data-art="material-reveal"]').get_attribute('data-art-material')=='holographic'
  assert page.locator('[data-art="material-reveal"]').get_attribute('data-art-rarity')=='rare'
  assert page.evaluate("document.getAnimations().filter(a=>a.playState==='running').length")==0
  assert page.locator('#material-picker .chip').count()==3
  snapshot(page,f'today-material-{scheme}.jpg')
  for index,kind in [(0,'matte'),(1,'kraft'),(2,'holographic')]:
   page.evaluate(f"artFixture.status.material=artFixture.materials[{index}];artFixture.handlers['daily-changed']()")
   page.wait_for_function(f"document.querySelector('[data-art=\"material-reveal\"]').dataset.artMaterial==='{kind}'")
  page.locator('#choose-collection').click();page.wait_for_selector('#stage-collection:not([hidden])')
  page.locator('#collection-back').click();page.wait_for_selector('#stage-choose:not([hidden])')
  page.evaluate("artFixture.status.slot='confirmed';artFixture.status.stickerId='sample';artFixture.handlers['daily-changed']()")
  page.wait_for_selector('#stage-done:not([hidden])');page.wait_for_timeout(750);assert_images(page)
  # Failure must restore closed art without mutating any app state.
  page.goto('http://127.0.0.1:8765/src/today.html?pack=box');page.wait_for_selector('#stage-envelope:not([hidden])')
  assert page.locator('[data-art="icon-pack"]').evaluate("e=>getComputedStyle(e).backgroundImage").endswith('choice-pack-box.png")')
  page.evaluate('artFixture.failOpen=true');page.locator('#open-material').click()
  page.wait_for_function("document.getElementById('error').textContent.includes('test_open_failed')")
  assert not page.evaluate("document.body.classList.contains('art-opening')")
  assert page.locator('#stage-envelope').is_visible()
  assert page.locator('#error').is_visible()
  page.set_viewport_size({'width':1140,'height':720})
  page.goto('http://127.0.0.1:8765/src/creator.html');page.wait_for_function("document.getElementById('img-sticker').naturalWidth>0")
  assert_images(page);snapshot(page,f'creator-{scheme}.jpg')
  assert page.locator('#mat').evaluate("e=>getComputedStyle(e).borderTopStyle")=='none'
  assert page.locator('[data-art="cutting-progress"]').evaluate("e=>getComputedStyle(e,'::before').content")=='none'
  page.evaluate("artFixture.phase='loading';artFixture.handlers['creator-changed']()");page.wait_for_selector('#loading:not([hidden])')
  assert page.evaluate("document.getAnimations().some(a=>a.playState==='running')")  # only during loading
  page.evaluate("artFixture.phase='ready';artFixture.handlers['creator-changed']()");page.wait_for_selector('#loading[hidden]',state='attached')
  page.wait_for_timeout(350)  # Allow the existing sheen opacity transition to finish.
  assert page.evaluate("document.getAnimations().filter(a=>a.playState==='running').length")==0
  page.locator('#materials .chip').first.click();page.wait_for_function("document.getElementById('sticker-wrap').dataset.material==='matte'")
  context.close()
 # Reduced motion must use the final static frame and avoid envelope animation.
 context=browser.new_context(viewport={'width':1140,'height':720},reduced_motion='reduce')
 context.add_init_script(BRIDGE);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8765/src/creator.html');page.wait_for_function("document.getElementById('img-sticker').naturalWidth>0")
 page.evaluate("artFixture.phase='loading';artFixture.handlers['creator-changed']()");page.wait_for_selector('#loading:not([hidden])')
 assert page.locator('[data-art="cutting-progress"]').evaluate("e=>getComputedStyle(e).animationName")=='none'
 assert 'cut-line-11.png' in page.locator('[data-art="cutting-progress"]').evaluate("e=>getComputedStyle(e).backgroundImage")
 snapshot(page,'creator-reduced-motion.jpg')
 page.goto('http://127.0.0.1:8765/src/today.html');page.wait_for_selector('#stage-envelope:not([hidden])');page.locator('#open-material').click()
 page.wait_for_selector('#stage-choose:not([hidden])');assert not page.evaluate("document.body.classList.contains('art-opening')")
 # Preview images and background controls all work.
 page.goto('http://127.0.0.1:8765/src/art/preview.html');page.locator('img').evaluate_all("images=>images.forEach(i=>i.loading='eager')")
 page.wait_for_function('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)')
 assert page.locator('figure').count()==51
 page.get_by_label('ダーク',exact=True).check();assert page.locator('.canvas').first.evaluate("e=>getComputedStyle(e).backgroundColor")=='rgb(35, 39, 45)'
 page.get_by_label('壁紙風',exact=True).check();assert 'linear-gradient' in page.locator('.canvas').first.evaluate("e=>getComputedStyle(e).backgroundImage")
 context.close();browser.close()
 assert not errors,errors
print('PASS: light/dark UI, decoded images, successful/failed open, material variants, no idle animations, Pack query switch, creator loading, reduced motion, preview backgrounds.')
