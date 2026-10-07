"""Verify real UI reward states and badge geometry with fixture IPC, not a native runtime."""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
import json,threading,os,shutil
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/port-spec/compare/review-15'
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
records=[]
with sync_playwright() as pw:
 options={'args':['--no-sandbox']}
 if chromium:=os.environ.get('PETA_CHROMIUM') or shutil.which('chromium'):options['executable_path']=chromium
 browser=pw.chromium.launch(**options)
 for shell in ['studio','desk']:
  for width,height in [(1060,700),(720,520)]:
   context=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=2)
   page=context.new_page();errors=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   page.add_init_script(path=str(ROOT/'scripts/ui-fixes-oct07-fixture.js'))
   page.goto(f'http://127.0.0.1:{server.server_port}/src/app.html?page=packs')
   page.wait_for_selector('[data-pack=welcome]')
   page.evaluate('(s)=>Shell.setShell(s)',shell);page.evaluate('document.fonts.ready')
   record={'shell':shell,'size':[width,height],'states':[],'badge':[]}
   for total,left,credits in [(12,9,0),(12,3,0),(12,2,1),(12,2,0),(20,0,2),(20,0,1),(20,0,0)]:
    page.evaluate("([total,left,credits])=>{PackZoom.dispose();const p=S.packs.find(p=>p.id==='welcome');p.total=total;p.left=Array(left).fill(null);p.freeOpenings=credits;Shell.refresh();}",[total,left,credits])
    page.locator('[data-pack=welcome]').click();page.wait_for_timeout(1100)
    state=page.evaluate("()=>{const c=PackZoom.active;return {stock:c.card.querySelector('.mkz-own').textContent,progress:c.card.querySelector('.mkz-reward p').textContent,filled:c.card.querySelectorAll('.mkz-pips i:not(.o)').length,empty:c.card.querySelectorAll('.mkz-pips i.o').length,free:!!Array.from(c.card.querySelectorAll('button')).find(b=>b.textContent==='Open free'),filter:getComputedStyle(c.clone.querySelector('.pk-img')).filter,sourceFilter:getComputedStyle(c.source.querySelector('.pk-img')).filter,labelOpacity:getComputedStyle(c.clone.querySelector('.pk-label')).opacity,aria:c.card.querySelector('[role=progressbar]').getAttribute('aria-valuenow')};}")
    progress=10 if credits else (total-left)%10
    assert state['stock']==f'{left} openings left'
    assert (state['filled'],state['empty'],state['aria'])==(progress,10-progress,str(progress))
    assert state['free']==bool(credits)
    assert state['filter']==state['sourceFilter'],state
    if not left:assert 'grayscale(0.8)' in state['filter'] and state['labelOpacity']=='0.5',state
    if credits:
     sizes=page.locator('.mkz-buy .btn').evaluate_all('(buttons)=>buttons.map(b=>({width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height}))')
     assert all(s==sizes[0] for s in sizes),sizes
    state.update(total=total,left=left,credits=credits);record['states'].append(state)
    if (total,left,credits) in [(12,2,1),(20,0,1)]:
     page.screenshot(path=str(OUT/f'{shell}-{width}-pack-rewards-{ "empty" if not left else "ready"}.png'))
    page.keyboard.press('Escape');page.wait_for_timeout(650)
   # Badge and pouch share one clone and one transform for the entire camera movement.
   page.evaluate("()=>{const p=S.packs.find(p=>p.id==='welcome');p.left=Array(2).fill(null);p.freeOpenings=0;Shell.refresh();}")
   page.mouse.move(0,0);page.wait_for_timeout(500)
   geometry="""(zoom)=>{const stack=zoom?PackZoom.active.clone:document.querySelector('[data-pack=welcome] .pk-stack');const badge=stack.querySelector('.pk-badge');const r=stack.getBoundingClientRect(),b=badge.getBoundingClientRect();return {center:(b.x+b.width/2-r.x)/r.width,bottom:(b.bottom-r.bottom)/r.width,width:b.width/r.width,font:parseFloat(getComputedStyle(badge).fontSize)/stack.offsetWidth,visible:getComputedStyle(badge).visibility,inside:badge.parentElement===stack};}"""
   baseline=page.evaluate(geometry,False);record['badge'].append(baseline)
   # Use synchronous open so Playwright's stability wait cannot hide the first animation frames.
   page.evaluate("document.querySelector('[data-pack=welcome]').click()")
   for wait in [0,80,160,500]:
    page.wait_for_timeout(wait);g=page.evaluate(geometry,True);record['badge'].append(g)
    assert g['inside'] and g['visible']=='visible'
    for key in ['center','bottom','width']:assert abs(g[key]-baseline[key])<0.003,(key,g,baseline)
   page.keyboard.press('Escape');page.wait_for_timeout(100)
   record['badge'].append(page.evaluate(geometry,True));page.wait_for_timeout(650)
   final=page.evaluate(geometry,False)
   for key in ['center','bottom','width']:assert abs(final[key]-baseline[key])<0.003
   # Navigation stays available, including on a gray empty pack, with reduced motion.
   page.evaluate("()=>{document.documentElement.dataset.motion='reduce';S.packs.find(p=>p.id==='welcome').left=[];Shell.refresh();document.querySelector('[data-pack=welcome]').click();}")
   page.wait_for_timeout(100);page.locator('#nav [data-page=book]').click();page.wait_for_timeout(700)
   assert page.evaluate("()=>S.page==='book' && !PackZoom.current && !document.querySelector('#nav').inert")
   assert not errors,errors
   # Non-daily packs can offer all three buttons; keep their bounds equal at minimum size.
   page.evaluate("async()=>{await Shell.open('packs');document.documentElement.dataset.motion='full';const p=S.packs.find(p=>p.id==='pixel');p.total=14;p.left=Array(4).fill(null);p.freeOpenings=1;Shell.refresh();}")
   page.locator('[data-pack=pixel]').click();page.wait_for_timeout(1100)
   buttons=page.locator('.mkz-buy .btn').evaluate_all('(bs)=>bs.map(b=>({text:b.textContent,width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height}))')
   assert [b['text'] for b in buttons]==['Open free','Open one','Open all 4']
   assert all(b['width']==buttons[0]['width'] and b['height']==40 for b in buttons)
   page.get_by_role('button',name='Open all 4',exact=True).scroll_into_view_if_needed()
   assert page.get_by_role('button',name='Open all 4',exact=True).is_visible()
   record['threeButtons']=buttons
   records.append(record);context.close()
 browser.close()
server.shutdown();server.server_close()
(OUT/'pack-rewards-after.json').write_text(json.dumps(records,indent=2))
print(json.dumps({'views':len(records),'states':sum(len(r['states']) for r in records),'passed':True}))
