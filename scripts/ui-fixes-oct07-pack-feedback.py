"""Check native pack detail sizes and navigation with fixture IPC (not a Tauri runtime).

Requires Python Playwright and Chromium. Starts its own local server.
Usage: python3 scripts/ui-fixes-oct07-pack-feedback.py [before|after]
Before reads src/ from df2b302 without changing the working tree.
"""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import threading,json,sys,subprocess,mimetypes,os,shutil
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/port-spec/compare/review-15'
phase=sys.argv[1] if len(sys.argv)>1 else 'after'
if phase not in ['before','after']:raise SystemExit('Usage: ui-fixes-oct07-pack-feedback.py [before|after]')
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
BASE=f'http://127.0.0.1:{server.server_port}'
records=[]
with sync_playwright() as pw:
 options={'args':['--no-sandbox']}
 chromium=os.environ.get('PETA_CHROMIUM') or shutil.which('chromium')
 if chromium:options['executable_path']=chromium
 browser=pw.chromium.launch(**options)
 for shell in ['studio','desk']:
  for width,height in [(1060,700),(720,520)]:
   context=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=2)
   page=context.new_page();errors=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   page.add_init_script(path=str(ROOT/'scripts/ui-fixes-oct07-fixture.js'))
   if phase=='before':
    def original(route):
     path=urlparse(route.request.url).path.lstrip('/')
     body=subprocess.check_output(['git','show',f'df2b302:{path}'],cwd=ROOT)
     route.fulfill(body=body,content_type=mimetypes.guess_type(path)[0] or 'application/octet-stream')
    page.route('**/src/**',original)
   page.goto(BASE+'/src/app.html?page=packs');page.wait_for_selector('[data-pack=pixel]')
   page.evaluate('(s)=>Shell.setShell(s)',shell);page.evaluate('document.fonts.ready')
   page.evaluate("()=>{const p=S.packs.find(p=>p.id==='pixel');p.left=Array(4).fill(null);Shell.refresh();}")
   page.locator('[data-pack=pixel]').click();page.wait_for_timeout(1100)
   record={'shell':shell,'size':[width,height],'phase':phase}
   record['buttons']=page.evaluate("()=>Array.from(document.querySelectorAll('.mkz-buy .btn')).map(b=>{const s=getComputedStyle(b);return {text:b.textContent,rect:b.getBoundingClientRect().toJSON(),radius:s.borderRadius,background:s.backgroundColor,paperArt:getComputedStyle(b,'::before').display};})")
   page.screenshot(path=str(OUT/f'{shell}-{width}-pack-feedback-{phase}.png'))
   if phase=='after':
    a,b=record['buttons']
    for key in ['x','width','height']:assert a['rect'][key]==b['rect'][key],record
    assert a['radius']==b['radius'] and b['paperArt']=='none'
    assert b['background']!='rgba(0, 0, 0, 0)'
    assert page.evaluate("()=>PackZoom.active.world.every(e=>e.inert) && !document.querySelector('#nav').inert && !PackZoom.active.root.hasAttribute('aria-modal')")
    record['keyboardNavigation']=[]
    for key in ['Tab']*14+['Shift+Tab']*14:
     page.keyboard.press(key)
     state=page.evaluate("()=>({nav:!!document.activeElement.closest('#nav'),allowed:PackZoom.active.root.contains(document.activeElement) || !!document.activeElement.closest('#nav'),scroll:PackZoom.active.page.scrollTop})")
     assert state['allowed']
     record['keyboardNavigation'].append(state)
    assert any(v['nav'] for v in record['keyboardNavigation'])
    page.evaluate("document.querySelector('.mkz-act').focus({preventScroll:true})")
    before=page.evaluate('PackZoom.active.page.scrollTop')
    for key in ['ArrowDown','ArrowUp','PageDown','PageUp','Home','End','Meta+1','Meta+7']:page.keyboard.press(key)
    assert page.evaluate('PackZoom.active.page.scrollTop')==before
    assert page.evaluate('S.page')=='packs'
    page.keyboard.press('Escape');page.wait_for_timeout(650)
    assert page.evaluate("()=>!PackZoom.current && document.activeElement.dataset.pack==='pixel'")
    page.evaluate("document.documentElement.dataset.theme='night'")
    page.locator('[data-pack=pixel]').click();page.wait_for_timeout(1100)
    record['nightButtons']=page.evaluate("()=>Array.from(document.querySelectorAll('.mkz-buy .btn')).map(b=>({rect:b.getBoundingClientRect().toJSON(),background:getComputedStyle(b).backgroundColor}))")
    a,b=record['nightButtons']
    for key in ['x','width','height']:assert a['rect'][key]==b['rect'][key]
    assert a['background']!=b['background']
    page.keyboard.press('Escape');page.wait_for_timeout(650)
    page.evaluate("document.documentElement.dataset.theme='day'")
    record['navigation']=[]
    for wait,target in [(100,'book'),(1100,'settings'),(100,'packs')]:
     page.evaluate("async()=>{await Shell.open('packs')}")
     page.locator('[data-pack=pixel]').click();page.wait_for_timeout(wait)
     page.locator('#nav [data-page='+target+']').click()
     page.wait_for_timeout(800)
     state=page.evaluate("()=>({page:S.page,zoom:!!PackZoom.current,navInert:document.querySelector('#nav').inert,shelfInert:!!document.querySelector('.packspage[inert]')})")
     assert state=={'page':target,'zoom':False,'navInert':False,'shelfInert':False},state
     record['navigation'].append(state)
    # Keyboard activation of navigation, not only pointer clicks.
    page.locator('[data-pack=pixel]').click();page.wait_for_timeout(100)
    page.locator('#nav [data-page=materials]').focus();page.keyboard.press('Enter');page.wait_for_timeout(800)
    assert page.evaluate("()=>S.page==='materials' && !PackZoom.current")
    # Navigating in Market, both with motion and Reduce motion.
    for motion in ['full','reduce']:
     page.evaluate("async(motion)=>{document.documentElement.dataset.motion=motion;MK.tab='packs';await Shell.open('market');}",motion)
     page.get_by_role('button',name='Pixel Dream by Ryo, on your shelf — look closer').click();page.wait_for_timeout(150)
     page.locator('#nav [data-page=book]').click();page.wait_for_timeout(800)
     assert page.evaluate("()=>S.page==='book' && !PackZoom.current && !document.querySelector('#nav').inert")
    # Pips are slot counts, not identity/rarity indicators.
    record['dots']=page.evaluate("()=>{const p={...S.packs.find(p=>p.id==='welcome'),left:Array(3).fill(null)};const card=Pages.packs.card(p);return {text:card.querySelector('.mkz-own').textContent,sealed:card.querySelectorAll('.mkz-pips i:not(.o)').length,opened:card.querySelectorAll('.mkz-pips i.o').length};}")
    assert record['dots']=={'text':'3 sealed · 9 opened of 12','sealed':3,'opened':9}
   assert not errors,errors
   records.append(record);context.close()
 browser.close()
server.shutdown();server.server_close()
(OUT/f'pack-feedback-{phase}.json').write_text(json.dumps(records,indent=2))
print(json.dumps({'phase':phase,'views':len(records),'passed':True}))
