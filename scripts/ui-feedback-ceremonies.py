"""Real UI/browser checks, with fixture native IPC. Usage: ... [before|after]."""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse
import json, threading, shutil, sys, subprocess, mimetypes
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/port-spec/compare/review-15'
phase=sys.argv[1] if len(sys.argv)>1 else 'after'
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
focus_cases=set(sys.argv[2:])
records=[r for r in json.loads((OUT/f'ceremonies-{phase}.json').read_text()) if r.get('case') not in focus_cases] if focus_cases else []
setup="""opts=>{
 window.batchCalls=[];window.batchPrinted=[];window.batchLater=0;
 const rarities=['common','common','rare','archive','common','uncommon','common','uncommon','common','rare'];
 if(opts.single)rarities[0]=opts.single;
 const mats=rarities.map(r=>r==='rare'?'holographic':['archive','special'].includes(r)?'gold':r==='uncommon'?'kraft':'matte');
 const keys=['sEgg','sGoodDay','sCoffee','sBlueFlower','sPolaroid','sPlant','sCamera','sCassette','sBubble','sCat'];
 const invoke=Bridge.invoke,asset=Bridge.asset,entry=Bridge.entry;
 Bridge.invoke=async(cmd,args)=>{
  if(cmd==='pack_open'){
   batchCalls.push(args.packId);await sleep(opts.delay || 0);
   if(opts.failAt===batchCalls.length)throw Error('Fixture opening failed');
   const i=batchCalls.length-1;return {stickerId:'batch-'+i,remaining:12-i-1,rarity:rarities[i],name:'Sticker '+(i+1)};
  }
  if(cmd==='print_later'){batchLater++;return;}
  return invoke(cmd,args);
 };
 Bridge.entry=async id=>id.startsWith('batch-') ? {id,material:mats[Number(id.split('-')[1])],kind:'received',title:id} : entry(id);
 Bridge.asset=async id=>{
  if(!id.startsWith('batch-'))return asset(id);
  if(opts.previewFail && id==='batch-1')throw Error('Fixture image failed');
  return A[keys[Number(id.split('-')[1])]];
 };
 Desktop.print=async entries=>batchPrinted.push([entries].flat().map(e=>e.id));
 const pack={id:'pixel',title:'Review Pack',kind:'holo',hue:0,daily:false,left:Array(12).fill(null)};
 window.batchPack=pack;if(opts.single)Cer.openPack(pack);else Cer.openPackMany(pack,10);
}"""
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox'])
 def fresh(shell='studio',width=1060,height=700):
  context=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=2)
  page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.add_init_script(path=str(ROOT/'scripts/ui-fixes-oct07-fixture.js'))
  if phase=='before':
   def original(route):
    path=urlparse(route.request.url).path.lstrip('/')
    route.fulfill(body=subprocess.check_output(['git','show',f'1ed97e5:{path}'],cwd=ROOT),content_type=mimetypes.guess_type(path)[0] or 'application/octet-stream')
   page.route('**/src/**',original)
  page.goto(f'http://127.0.0.1:{server.server_port}/src/app.html?page=materials')
  page.wait_for_selector('.mbook');page.evaluate('(s)=>Shell.setShell(s)',shell)
  page.evaluate('document.fonts.ready');page.wait_for_timeout(1000)
  return context,page,errors
 for shell in ([] if focus_cases else ['studio','desk']):
  for width,height in [(1060,700),(720,520)]:
   context,page,errors=fresh(shell,width,height)
   record={'shell':shell,'size':[width,height]}
   tile=page.locator('.mbook[data-material=kraft]');tile.scroll_into_view_if_needed();page.mouse.move(0,0);page.wait_for_timeout(350)
   record['shadowRest']=tile.evaluate('(e)=>getComputedStyle(e).boxShadow');tile.hover();page.wait_for_timeout(20)
   record['shadowFrames']=tile.evaluate("e=>{const a=e.getAnimations().find(a=>a.transitionProperty==='box-shadow');if(!a)return [];a.pause();return [0,140,280].map(t=>{a.currentTime=t;return {t,shadow:getComputedStyle(e).boxShadow};});}")
   if phase=='after':assert len({s['shadow'] for s in record['shadowFrames']})==3,record
   tile.screenshot(path=str(OUT/f'{shell}-{width}-kraft-{phase}.png'),animations='disabled')
   if phase=='after':
    page.mouse.move(0,0);page.wait_for_timeout(20)
    record['shadowExit']=tile.evaluate("e=>{const a=e.getAnimations().find(a=>a.transitionProperty==='box-shadow');if(!a)return [];a.pause();return [0,140,280].map(t=>{a.currentTime=t;return {t,shadow:getComputedStyle(e).boxShadow};});}")
    assert len({s['shadow'] for s in record['shadowExit']})==3,record
   tile.click();page.wait_for_timeout(500)
   materialClose=page.locator('.material-preview .x')
   if phase=='after':
    record['materialClose']=materialClose.evaluate("b=>{const r=b.getBoundingClientRect(),s=b.querySelector('svg').getBoundingClientRect();return {width:r.width,height:r.height,dx:s.x+s.width/2-r.x-r.width/2,dy:s.y+s.height/2-r.y-r.height/2};}")
    assert record['materialClose']=={'width':32,'height':32,'dx':0,'dy':0},record
   materialClose.screenshot(path=str(OUT/f'{shell}-{width}-material-close-{phase}.png'))
   materialClose.focus();page.keyboard.press('Enter');assert page.locator('.material-preview').count()==0
   page.evaluate("async()=>{await Shell.open('market')}");page.wait_for_timeout(650)
   page.locator('.mk-tile[aria-label^="Pixel Dream"]').click();page.wait_for_timeout(1000)
   act=page.get_by_role('button',name='Add another set — 12 Scraps',exact=True);act.hover();page.wait_for_timeout(300)
   record['exchangeHover']=act.evaluate("b=>({background:getComputedStyle(b).backgroundColor,shadow:getComputedStyle(b).boxShadow,filter:getComputedStyle(b).filter,opacity:getComputedStyle(b).opacity,display:getComputedStyle(b).display})")
   if phase=='after':assert record['exchangeHover']['shadow']!='none' and record['exchangeHover']['filter']=='none',record
   page.locator('.mkz-card').screenshot(path=str(OUT/f'{shell}-{width}-exchange-hover-{phase}.png'))
   if phase=='after':
    record['packClose']=page.locator('.mkz-x').evaluate("b=>{const r=b.getBoundingClientRect(),s=b.querySelector('svg').getBoundingClientRect();return {width:r.width,height:r.height,dx:s.x+s.width/2-r.x-r.width/2,dy:s.y+s.height/2-r.y-r.height/2};}")
    assert record['packClose']==record['materialClose'],record
   page.locator('.mkz-x').click();page.wait_for_timeout(650)
   page.evaluate("()=>{S.appearance='night';Appearance.apply();}");page.locator('#nav [data-page=book]').hover();page.wait_for_timeout(300)
   record['nightHover']=page.locator('#nav [data-page=book]').evaluate("b=>({background:getComputedStyle(b).backgroundColor,color:getComputedStyle(b).color})")
   page.locator('#nav').screenshot(path=str(OUT/f'{shell}-{width}-night-nav-{phase}.png'))
   if phase=='after':
    page.evaluate("()=>{S.appearance='day';Appearance.apply();}")
    # Daily material identity stays hidden in the envelope, then gets its palette.
    for mat in ['holographic','gold']:
     page.evaluate("m=>{MAT[m].rarity=m==='gold'?'special':'rare';window.materialResult=Cer.openMaterial(MAT[m]);}",mat)
     page.wait_for_function("document.querySelector('.material-envelope .mcard')?.tabIndex===0")
     assert page.evaluate("!document.querySelector('.cer').dataset.reveal && document.querySelector('.mcard[data-concealed]')!==null")
     page.locator('.material-envelope .mcard').press('Enter');page.wait_for_selector('.cer .keep:not([disabled])');page.wait_for_timeout(600)
     assert page.evaluate("document.querySelector('.cer').dataset.material")==mat
     assert page.locator('.cer .seal').evaluate('(e)=>getComputedStyle(e).opacity')=='1'
     assert page.locator('.cer .rv-meta .no').is_visible()
     page.screenshot(path=str(OUT/f'{shell}-{width}-{mat}-reveal.png'))
     card=page.locator('.material-card-position').bounding_box();info=page.locator('.cer .rv-info').bounding_box()
     assert card['y']+card['height']<info['y'],(card,info)
     page.locator('.cer .keep').click();page.evaluate("async()=>{const r=await materialResult;await r.close();}")
    page.evaluate(setup,{})
    assert page.evaluate('batchCalls.length')==0
    page.locator('.cer .pouch').press('Enter')
    page.wait_for_function("document.querySelector('.cer')?.dataset.phase==='sealed'",timeout=30000)
    assert page.evaluate('batchCalls.length')==10
    assert page.locator('.pm-covered').count()==10 and page.locator('.pm-slot.full').count()==0
    assert page.evaluate('batchPack.left.length')==2
    page.screenshot(path=str(OUT/f'{shell}-{width}-batch-sealed.png'))
    button=page.get_by_role('button',name='Turn them over',exact=True);button.focus();page.keyboard.press('Enter');page.keyboard.press('Enter')
    page.wait_for_function("document.querySelector('.cer')?.dataset.phase==='finished'",timeout=30000)
    assert page.locator('.pm-covered').count()==0 and page.locator('.pm-slot.full').count()==10
    assert page.evaluate('batchCalls.length')==10
    page.screenshot(path=str(OUT/f'{shell}-{width}-batch-revealed.png'))
    record['batch']=page.locator('.cer .rv-meta').inner_text()
    bounds=page.locator('.pm-grid').bounding_box();footer=page.locator('.rv-info').bounding_box()
    assert bounds['y']+bounds['height']<=footer['y'],(bounds,footer)
    assert footer['y']+footer['height']<=height,footer
    page.get_by_role('button',name='Later',exact=True).click();page.wait_for_selector('.cer',state='detached')
    assert page.evaluate('batchLater===1 && batchPrinted.length===0 && !Bridge.busy')
   assert not errors,errors
   records.append(record);context.close()
 if phase=='after':
  for case,opts in [('skip-loading',{'delay':50}),('skip-reveal',{}),('partial',{'failAt':4}),('zero',{'failAt':1}),('preview-failure',{'previewFail':True}),('app-reduce',{}),('os-reduce',{}),('resize',{}),('single-rare',{'single':'rare'}),('single-special',{'single':'special'})]:
   if focus_cases and case not in focus_cases:continue
   context,page,errors=fresh()
   if case=='app-reduce':page.evaluate("document.documentElement.dataset.motion='reduce'")
   if case=='os-reduce':page.emulate_media(reduced_motion='reduce')
   page.evaluate(setup,opts);page.locator('.cer .pouch').press('Space')
   if opts.get('single'):
    page.wait_for_selector('.cer .pk-sleeve.out');page.locator('.cer .pk-sleeve.out').press('Enter')
    page.wait_for_function("document.querySelector('.cer')?.dataset.reveal==='sticker'")
    page.locator('.cer-skip:not([hidden])').click();page.wait_for_selector('.cer .rv-info')
    page.wait_for_selector('.cer-skip',state='hidden')
    assert page.evaluate('batchCalls.length===1')
    assert page.evaluate("document.querySelector('.cer').dataset.rarity")==opts['single']
    page.screenshot(path=str(OUT/f'{case}-reveal.png'))
    page.get_by_role('button',name='Later',exact=True).click();page.wait_for_selector('.cer',state='detached')
    assert page.evaluate('batchLater===1 && batchPrinted.length===0 && !Bridge.busy')
    assert not errors,errors
    records.append({'case':case,'passed':True});context.close();continue
   if case=='skip-loading':page.locator('.cer-skip:not([hidden])').click()
   if case=='zero':
    page.wait_for_selector('.cer',state='detached');assert page.evaluate('batchCalls.length===1 && !Bridge.busy && batchPrinted.length===0')
   else:
    if case!='skip-loading':
     page.wait_for_function("document.querySelector('.cer')?.dataset.phase==='sealed'",timeout=30000)
     if case=='resize':page.set_viewport_size({'width':720,'height':520});page.wait_for_timeout(300)
     expected=3 if case=='partial' else 10
     assert page.locator('.pm-covered').count()==expected
     page.get_by_role('button',name='Turn them over',exact=True).click()
     if case=='skip-reveal':page.locator('.cer-skip:not([hidden])').click()
    page.wait_for_function("document.querySelector('.cer')?.dataset.phase==='finished'",timeout=30000)
    if case=='resize':
     for w,h in [(1060,700),(720,520)]:
      page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(300)
      sizes=page.locator('.pm-slot.full').evaluate_all("slots=>slots.map(s=>{const b=s.getBoundingClientRect(),r=s.querySelector('.stk').getBoundingClientRect();return {cell:[b.width,b.height],art:[r.width,r.height]};})")
      assert all(s['art'][0]<=s['cell'][0]*.81 and s['art'][1]<=s['cell'][1] for s in sizes),sizes
     page.screenshot(path=str(OUT/'batch-resize-finished.png'))
    if case=='preview-failure':assert page.locator('.pm-missing').count()==1
    expected=3 if case=='partial' else 10
    assert page.evaluate('batchCalls.length')==(4 if case=='partial' else 10)
    # Rapid result clicks must start one print request containing each committed ID exactly once.
    page.evaluate("()=>{document.querySelector('.cer .keep').click();document.querySelector('.cer .keep').click();}")
    page.wait_for_selector('.cer',state='detached');page.wait_for_function('batchPrinted.length===1')
    assert page.evaluate('batchPrinted[0]')==['batch-'+str(i) for i in range(expected)]
    assert page.evaluate('!Bridge.busy && batchLater===0')
   assert not errors,errors
   records.append({'case':case,'passed':True});context.close()
 browser.close()
server.shutdown();server.server_close()
(OUT/f'ceremonies-{phase}.json').write_text(json.dumps(records,indent=2))
print(json.dumps({'phase':phase,'scenarios':len(records),'passed':True}))
