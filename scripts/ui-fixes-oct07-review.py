"""Native src/app.html regression checks with fixture IPC (not a Tauri runtime test).

Requires Python Playwright and Chromium. A local server is started automatically.
Usage: python3 scripts/ui-fixes-oct07-review.py a [before|after]
The before phase reads src/ from commit 27f58c1 through git, without changing checkout.
"""
import json, sys, os, shutil, subprocess, mimetypes, threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/port-spec/compare/review-15'
OUT.mkdir(parents=True,exist_ok=True)
step=sys.argv[1] if len(sys.argv)>1 else ''
phase=sys.argv[2] if len(sys.argv)>2 else 'after'
if step not in 'abcdef' or len(step)!=1 or phase not in ['before','after']:
    raise SystemExit('Usage: ui-fixes-oct07-review.py a|b|c|d|e|f [before|after]')
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
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
      for width,height in ([(1060,700),(720,520),(1400,700)] if step=='d' else [(1060,700),(720,520)]):
        context=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=2)
        page=context.new_page();errors=[]
        page.on('pageerror',lambda e: errors.append(str(e)))
        page.add_init_script(path=str(ROOT/'scripts/ui-fixes-oct07-fixture.js'))
        if phase=='before':
          def original(route):
            path=urlparse(route.request.url).path.lstrip('/')
            body=subprocess.check_output(['git','show',f'27f58c1:{path}'],cwd=ROOT)
            route.fulfill(body=body,content_type=mimetypes.guess_type(path)[0] or 'application/octet-stream')
          page.route('**/src/**',original)
        page.goto(BASE+'/src/app.html?page=materials')
        page.wait_for_selector('.materialspage .mbook')
        page.evaluate('(name)=>Shell.setShell(name)',shell)
        page.evaluate('document.fonts.ready')
        page.wait_for_timeout(800)
        record={'shell':shell,'size':[width,height],'step':step,'phase':phase}
        if step=='a':
          def state():
            return page.evaluate('''()=>{const b=document.querySelector('[data-material="holographic"]'), c=b.querySelector('.mcard'), s=getComputedStyle(c), m=new DOMMatrix(s.transform);return {button:b.getBoundingClientRect().toJSON(),angle:Math.atan2(m.b,m.a)*180/Math.PI,transform:c.style.transform,sheen:s.getPropertyValue('--sx'),transition:s.transition,background:getComputedStyle(b).backgroundColor};}''')
          page.locator('[data-material="holographic"]').scroll_into_view_if_needed();page.wait_for_timeout(300)
          record['rest']=state()
          page.locator('[data-material="holographic"]').hover(position={'x':100,'y':90})
          page.wait_for_timeout(350);record['hover']=state()
          page.screenshot(path=str(OUT/f'{shell}-{width}-a-{phase}.png'))
          page.mouse.move(1,1);page.wait_for_timeout(500);record['leave']=state()
          if phase=='after':
            assert abs(record['hover']['angle']+2)<.15,record
            assert record['rest']['button']==record['hover']['button'],record
            assert abs(record['leave']['angle']+2)<.01,record
            page.evaluate("document.documentElement.dataset.motion='reduce'")
            page.locator('[data-material="holographic"]').hover();page.wait_for_timeout(350)
            record['reduce']=state();assert abs(record['reduce']['angle']+2)<.01
        if step=='f':
          page.evaluate("async()=>{S.bookView='list';await Shell.open('book');}")
          page.wait_for_timeout(600)
          def header():
            return page.evaluate("()=>{const v=document.querySelector('.book-view'),m=Array.from(document.querySelectorAll('.ph button')).find(b=>b.textContent==='Make a Pack…');return {view:v.getBoundingClientRect().toJSON(),make:m.getBoundingClientRect().toJSON(),header:document.querySelector('.bookpage .ph').getBoundingClientRect().toJSON()};}")
          record['list']=header()
          page.screenshot(path=str(OUT/f'{shell}-{width}-f-list-{phase}.png'))
          page.get_by_role('button',name='Calendar',exact=True).click();page.wait_for_timeout(600)
          record['calendar']=header()
          page.screenshot(path=str(OUT/f'{shell}-{width}-f-calendar-{phase}.png'))
          if phase=='after':
            assert record['list']==record['calendar'],record
            for i in range(3):
              page.get_by_role('button',name='List',exact=True).click()
              assert header()==record['list']
              page.get_by_role('button',name='Calendar',exact=True).click()
              assert header()==record['calendar']
            page.evaluate("()=>{reviewMake=0;PackMaker.open=()=>reviewMake++;reviewPoster=0;Poster.save=async()=>{reviewPoster++;return null;};}")
            page.get_by_role('button',name='Make a Pack…',exact=True).click()
            page.get_by_role('button',name='Save poster…',exact=True).click()
            page.wait_for_function("()=>!Bridge.dialogOpen")
            assert page.evaluate("()=>reviewMake===1 && reviewPoster===1")
            page.evaluate("()=>{S.lib=[];Shell.refresh();}")
            assert page.get_by_role('button',name='Make a Pack…',exact=True).is_disabled()
            assert page.get_by_role('button',name='Save poster…',exact=True).is_disabled()
            record['actionsPreserved']=True
        if step=='e':
          page.evaluate("async()=>{await Shell.open('settings');}")
          if phase=='after':
            button=page.get_by_role('button',name='Redeem…',exact=True)
            button.scroll_into_view_if_needed()
            record['entry']=page.evaluate("()=>{const r=document.querySelector('.settingspage > .setcard').lastElementChild;return {label:r.querySelector('b').textContent,sub:r.querySelector('small').textContent,button:r.querySelector('button').className,count:document.querySelectorAll('.settingspage button').length};}")
            assert record['entry']['label']=='Redeem a code' and record['entry']['button']=='btn paper small'
            page.get_by_role('switch').last.focus();page.keyboard.press('Tab')
            assert button.evaluate('(e)=>e===document.activeElement')
          page.screenshot(path=str(OUT/f'{shell}-{width}-e-settings-{phase}.png'))
          if phase=='after':
            page.keyboard.press('Enter');page.wait_for_selector('dialog[open] input')
            page.locator('dialog input').fill('PETA1-REVIEW')
            page.evaluate('window.reviewRedeemError=true')
            page.get_by_role('button',name='Redeem',exact=True).click()
            page.get_by_role('status').filter(has_text='Example error').wait_for()
            assert page.locator('dialog[open]').count()==1
            page.evaluate('window.reviewRedeemError=false')
            page.get_by_role('button',name='Redeem',exact=True).click()
            page.wait_for_function("()=>!document.querySelector('dialog') && S.bonusEnvelopes===1")
            record['success']=page.evaluate("()=>({page:S.page,toast:document.querySelector('#toast').textContent,code:reviewCalls.filter(c=>c.cmd==='redeem_code').at(-1).args.code,bonus:S.bonusEnvelopes})")
            assert record['success']['page']=='settings' and record['success']['toast']=='Code received.' and record['success']['code']=='PETA1-REVIEW'
            page.evaluate("async()=>{await Shell.open('today');}");page.wait_for_timeout(500)
            assert page.locator('.today').get_attribute('data-state')=='arrived'
            assert 'An extra envelope from Peta.' in page.locator('.today').inner_text()
            record['menu']=[]
            for hidden in [False,True]:
              page.evaluate("async()=>{await Shell.open('book');window.reviewPage=Shell.current;}")
              if hidden:page.evaluate('Shell.close()')
              page.evaluate("async()=>{reviewOpened=true;await __TAURI__.event.emit('app-page','redeem');}")
              value=page.evaluate("()=>({page:S.page,same:reviewPage===Shell.current,open:S.windowOpen,dialog:!!document.querySelector('dialog[open]')})")
              assert value=={'page':'book','same':True,'open':True,'dialog':True}
              record['menu'].append(value)
              page.keyboard.press('Escape');page.wait_for_function("()=>!document.querySelector('dialog')")
            page.evaluate("async()=>{await Shell.open('packs');}")
            page.locator('[data-pack="pixel"]').click();page.wait_for_timeout(100)
            page.evaluate("async()=>{await __TAURI__.event.emit('app-page','redeem');}")
            assert page.evaluate("()=>S.page==='packs' && !PackZoom.current && !document.querySelector('#nav').inert && !!document.querySelector('dialog[open]')")
            page.keyboard.press('Escape');page.wait_for_function("()=>!document.querySelector('dialog')")
          for opened in [True,False]:
            page.evaluate("async(opened)=>{reviewBonus=0;reviewMaterialOpened=opened;await Shell.open('today');}",opened)
            page.wait_for_timeout(650)
            record['today-'+str(opened)]=page.evaluate("()=>({text:document.querySelector('.today').textContent,scroll:document.querySelector('.today').scrollHeight})")
            if phase=='after':assert 'Redeem' not in record['today-'+str(opened)]['text']
            page.screenshot(path=str(OUT/f'{shell}-{width}-e-today-{"opened" if opened else "arrived"}-{phase}.png'))
          page.evaluate("async()=>{await Shell.open('gifts');}")
          assert page.get_by_role('button',name='Open Peta file…').count()==1
          if phase=='after':assert 'Redeem' not in page.locator('.giftspage').inner_text()
          record['gifts']=page.locator('.giftspage').inner_text()
          if phase=='after':
            page.goto(BASE+'/src/app.html?page=redeem')
            page.wait_for_selector('dialog[open]')
            record['coldMenu']=page.evaluate("()=>S.page")
            assert record['coldMenu']=='today'
            page.keyboard.press('Escape')
        if step=='d':
          page.evaluate("async()=>{MK.tab='packs';await Shell.open('market');}")
          page.wait_for_timeout(800)
          record['card']=page.evaluate("()=>{const e=document.querySelector('.mk-hero-text'),s=getComputedStyle(e),m=new DOMMatrix(s.transform);return {rect:e.getBoundingClientRect().toJSON(),background:s.backgroundImage,borderSource:s.borderImageSource,slice:s.borderImageSlice,borderWidth:s.borderImageWidth,angle:Math.atan2(m.b,m.a)*180/Math.PI,clip:getComputedStyle(e,'::before').backgroundImage,shadow:s.filter,art:Array.from(document.querySelectorAll('.mk-hero-art .fan-s,.mk-hero-art .mk-pouch')).map(a=>({width:a.offsetWidth,transform:getComputedStyle(a).transform}))};}")
          if phase=='after':
            assert record['card']['background']=='none'
            assert record['card']['slice']=='175 205 110 150 fill'
            assert 'note-index-card-blank' in record['card']['borderSource']
            assert abs(record['card']['angle']-.6)<.01
          page.screenshot(path=str(OUT/f'{shell}-{width}-d-{phase}.png'))
          page.locator('.mk-hero-text').scroll_into_view_if_needed();page.wait_for_timeout(200)
          page.screenshot(path=str(OUT/f'{shell}-{width}-d-card-{phase}.png'))
        if step=='c':
          page.evaluate("async()=>{await Shell.open('packs');}")
          page.locator('[data-pack="pixel"]').click();page.wait_for_timeout(1150)
          record['scroll']=page.evaluate("()=>PackZoom.active.page.scrollTop")
          record['inert']=page.evaluate("()=>PackZoom.active.world.every(e=>e.inert) && document.querySelector('#nav').inert && !document.querySelector('.wctl').inert")
          assert record['inert']
          record['focus']=[]
          for key in ['Tab','Tab','Tab','Tab','Shift+Tab','Shift+Tab','ArrowDown','ArrowUp','ArrowLeft','ArrowRight','PageDown','PageUp','Home','End','Meta+1','Meta+7']:
            page.keyboard.press(key)
            record['focus'].append(page.evaluate("()=>({key:document.activeElement.className,inside:PackZoom.active.root.contains(document.activeElement),scroll:PackZoom.active.page.scrollTop,page:S.page})"))
            assert record['focus'][-1]['inside'] and record['focus'][-1]['scroll']==record['scroll'] and record['focus'][-1]['page']=='packs'
          page.evaluate("()=>{window.reviewClicks=0;document.querySelector('.mkz-act').focus({preventScroll:true});window.reviewClickBlock=e=>{if(e.target.closest('.mkz-act')){reviewClicks++;e.preventDefault();e.stopImmediatePropagation();}};window.addEventListener('click',reviewClickBlock,true);}")
          for key in ['Enter','Space']:page.keyboard.press(key)
          record['activation']=page.evaluate("()=>reviewClicks")
          assert record['activation']==2
          page.evaluate("window.removeEventListener('click',reviewClickBlock,true)")
          page.keyboard.press('Escape');page.wait_for_timeout(650)
          assert page.evaluate("()=>!PackZoom.active && !document.querySelector('#nav').inert && document.activeElement.dataset.pack==='pixel'")
          # A refresh and an exception during open must both release the background.
          page.locator('[data-pack="pixel"]').click();page.wait_for_timeout(100);page.evaluate('Shell.refresh()')
          assert page.evaluate("()=>!PackZoom.current && !document.querySelector('#nav').inert")
          record['exceptionCleanup']=page.evaluate("()=>{const old=PackZoom.target;PackZoom.target=()=>{throw Error('test geometry failure')};try{const tile=document.querySelector('[data-pack=pixel]');PackZoom.open(S.packs.find(p=>p.id==='pixel'),tile,p=>Pages.packs.card(p));}catch(e){}finally{PackZoom.target=old;}return !PackZoom.current && !document.querySelector('#nav').inert && !Shell.current.style.overflowY;}")
          assert record['exceptionCleanup']
        if step=='b':
          page.evaluate("async()=>{await Shell.open('packs');}")
          page.locator('[data-pack="pixel"]').click()
          page.wait_for_timeout(1150)
          record['zoom']=page.evaluate("()=>{const c=PackZoom.active.clone,r=c.getBoundingClientRect(),to=PackZoom.target(PackZoom.active.root);return {transform:getComputedStyle(c).transform,rect:r.toJSON(),target:to,label:getComputedStyle(c.querySelector('.pk-label b')).fontSize,sheen:!!c.querySelector('.sheen'),dpr:devicePixelRatio};}")
          page.screenshot(path=str(OUT/f'{shell}-{width}-b-{phase}.png'))
          if phase=='after':
            assert record['zoom']['transform']=='none',record
            assert abs(record['zoom']['rect']['width']-record['zoom']['target']['width'])<.1
            assert record['zoom']['rect']['height']*2<=1024
            assert record['zoom']['sheen']
          page.keyboard.press('Escape');page.wait_for_timeout(650)
          record['closed']=page.evaluate("()=>!PackZoom.active && document.activeElement.dataset.pack==='pixel' && !document.querySelector('[data-pack=pixel] .pk-stack').style.visibility")
          assert record['closed']
          if phase=='after':
            page.evaluate("document.documentElement.dataset.motion='reduce'")
            page.locator('[data-pack="pixel"]').click();page.wait_for_timeout(100)
            record['reduceTransform']=page.evaluate("()=>getComputedStyle(PackZoom.active.clone).transform")
            assert record['reduceTransform']=='none'
            page.keyboard.press('Escape');page.wait_for_timeout(100)
            page.evaluate("document.documentElement.dataset.motion='full'")
            page.locator('[data-pack="pixel"]').click();page.wait_for_timeout(100);page.keyboard.press('Escape');page.wait_for_timeout(750)
            assert page.evaluate("()=>!PackZoom.active && document.activeElement.dataset.pack==='pixel'")
        if step=='b' and phase=='after':
          page.evaluate("async()=>{document.documentElement.dataset.motion='full';MK.tab='packs';await Shell.open('market');}")
          page.get_by_role('button',name='Pixel Dream by Ryo, on your shelf — look closer').click();page.wait_for_timeout(1150)
          record['marketTransform']=page.evaluate("()=>getComputedStyle(PackZoom.active.clone).transform")
          assert record['marketTransform']=='none'
          page.screenshot(path=str(OUT/f'{shell}-{width}-b-market-after.png'))
          page.keyboard.press('Escape');page.wait_for_timeout(650)
          page.evaluate("async()=>{await Shell.open('packs');}")
          for kind in ['coffee','cats']:
            page.locator('[data-pack="'+kind+'"]').click();page.wait_for_timeout(1050)
            assert page.evaluate("()=>getComputedStyle(PackZoom.active.clone).transform==='none'")
            page.keyboard.press('Escape');page.wait_for_timeout(650)
        if step=='a':
          page.evaluate("async()=>{document.documentElement.dataset.motion='full';await Shell.open('market');MK.tab='materials';Shell.refresh();await document.fonts.ready;}")
          target=page.locator('.mk-mat').filter(has=page.locator('[data-m="holographic"]'))
          target.scroll_into_view_if_needed();page.wait_for_timeout(700)
          target.hover(position={'x':100,'y':90});page.wait_for_timeout(350)
          record['marketAngle']=page.evaluate("()=>{const m=new DOMMatrix(getComputedStyle(document.querySelector('.mk-mat [data-m=holographic]')).transform);return Math.atan2(m.b,m.a)*180/Math.PI;}")
          if phase=='after':assert abs(record['marketAngle']+2)<.01
          page.screenshot(path=str(OUT/f'{shell}-{width}-a-market-{phase}.png'))
        assert not errors,errors
        records.append(record);context.close()
    browser.close()
server.shutdown();server.server_close()
(OUT/f'{step}-{phase}.json').write_text(json.dumps(records,ensure_ascii=False,indent=2))
print(json.dumps({'step':step,'phase':phase,'views':len(records),'passed':True}))
