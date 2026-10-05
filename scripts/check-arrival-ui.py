"""Browser regression check; requires Python Playwright and Chromium."""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
import threading
import argparse
import os
import shutil
from playwright.sync_api import sync_playwright
parser=argparse.ArgumentParser(description="Check actual desktop/Today envelope UI with mocked Tauri IPC")
parser.add_argument('--screenshot', type=Path)
args=parser.parse_args()
ROOT=Path(__file__).resolve().parents[1]/'src' 
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}'
with sync_playwright() as p:
    options={'args':['--no-sandbox']}
    chromium=os.environ.get('PETA_CHROMIUM') or shutil.which('chromium')
    if chromium: options['executable_path']=chromium
    browser=p.chromium.launch(**options)
    page=browser.new_page(viewport={'width':250,'height':220},device_scale_factor=2)
    errors=[]
    page.on('pageerror',lambda error: errors.append(str(error)))
    page.add_init_script('''
      localStorage.setItem('peta.preferences',JSON.stringify({sound:false}));
      window.calls=[]; window.listeners={};
      window.__TAURI__={core:{invoke:async name=>{calls.push(name);return name==='arrival_status'?'material':null;}},
       event:{listen:async(name,fn)=>{listeners[name]=fn;return ()=>{};}}};
    ''')
    page.goto(base+'/arrival.html')
    page.wait_for_function("document.querySelector('#arrival').dataset.kind==='material'")
    page.evaluate('document.fonts.ready')
    page.wait_for_timeout(800)
    assert page.locator('.arr-note').count()==0
    assert page.locator('.arrival-label').inner_text()=="Today's\nMaterial"
    assert page.locator('#arrival img').count()==0
    assert page.evaluate("getComputedStyle(document.body).backgroundColor")=='rgba(0, 0, 0, 0)'
    box=page.locator('#arrival').bounding_box()
    page.evaluate("window.floatAnimation=document.querySelector('.arrival-float').getAnimations()[0];window.floatStart=floatAnimation.startTime")
    for i in range(30):
        page.mouse.move(150,130) if i%2 else page.mouse.move(260,230)
        page.wait_for_timeout(35)
        assert page.evaluate("document.querySelector('.arrival-float').getAnimations()[0]===floatAnimation && floatAnimation.startTime===floatStart && floatAnimation.effect.getTiming().duration===4600")
    assert box==page.locator('#arrival').bounding_box(), 'hover target moved'
    page.mouse.move(150,130)
    page.wait_for_timeout(300)
    assert page.evaluate("getComputedStyle(document.querySelector('.arrival-lift')).transform")=='matrix(1, 0, 0, 1, -7, -2)'
    page.click('#arrival',position={'x':150,'y':130})
    page.locator('#arrival').focus()
    page.keyboard.press('Enter');page.keyboard.press('Space')
    assert page.evaluate("calls.filter(x=>x==='arrival_open').length")==3
    for kind in ['gift','extra','material']:
        page.evaluate('(kind)=>listeners["arrival-changed"]({payload:kind})',kind)
        assert page.locator('#arrival').get_attribute('data-kind')==kind
        assert page.evaluate("document.querySelector('.arrival-float').getAnimations()[0]===floatAnimation")
    page.locator('#arrival').evaluate('(node)=>node.blur()');page.mouse.move(260,230);page.wait_for_timeout(300)
    page.evaluate("document.getAnimations().forEach(a=>a.pause());document.body.style.background='#eb3d4c'")
    if args.screenshot: page.screenshot(path=str(args.screenshot))
    page.evaluate("listeners['preferences-changed']({payload:{motion:'reduce',sound:false}})")
    assert page.evaluate("getComputedStyle(document.querySelector('.arrival-float')).animationName")=='none'
    page.evaluate("listeners['arrival-changed']({payload:null})")
    assert page.locator('#arrival').is_hidden()
    page.evaluate("listeners['preferences-changed']({payload:{motion:'full',sound:false}});listeners['arrival-changed']({payload:'material'})")
    page.emulate_media(reduced_motion='reduce')
    assert page.evaluate("getComputedStyle(document.querySelector('.arrival-float')).animationName")=='none'
    assert not errors,errors
    print('Desktop: stable float clock across 30 hover transitions, fixed hit target, paper label, 3 click/keyboard opens, material/gift/extra, reduced motion: PASS')

    # Build the actual shared Today envelope with the real native CSS, without unrelated app APIs.
    today=browser.new_page(viewport={'width':850,'height':650})
    today.add_init_script("window.__TAURI__={core:{invoke:async name=>name==='arrival_status'?'material':null},event:{listen:async()=>()=>{}}}")
    today.goto(base+'/arrival.html')
    today.wait_for_function("document.querySelector('#arrival').dataset.kind==='material'")
    today.evaluate("document.body.replaceChildren();document.documentElement.dataset.motion='full';document.body.dataset.shell='studio'")
    # Remove desktop CSS, then load the app styles in their actual order.
    today.locator('link[href="arrival.css"]').evaluate('(node)=>node.remove()')
    for css in ['base.css','pages.css','pack.css','polish.css','native.css']:
        today.add_style_tag(url=base+'/app/css/'+css)
    today.add_script_tag(url=base+'/app/js/shared.js')
    today.evaluate('''
      document.body.style.cssText='padding:100px;box-sizing:border-box;background:#faf6ec';
      document.body.append(EnvelopeScene());
      window.todayAnimation=document.querySelector('.env-float').getAnimations()[0];
      window.todayStart=todayAnimation.startTime;
    ''')
    today.evaluate('document.fonts.ready')
    today.wait_for_function("todayAnimation.startTime !== null")
    today.evaluate("window.todayStart=todayAnimation.startTime")
    assert today.evaluate("todayAnimation.effect.getTiming().duration")==4600
    target=today.locator('.env-scene').bounding_box()
    for i in range(20):
        today.mouse.move(target['x']+target['width']/2,target['y']+target['height']/2) if i%2 else today.mouse.move(5,5)
        today.wait_for_timeout(35)
        state=today.evaluate("({same:document.querySelector('.env-float').getAnimations()[0]===todayAnimation,start:todayAnimation.startTime,original:todayStart,duration:todayAnimation.effect.getTiming().duration,css:getComputedStyle(document.querySelector('.env-float')).animation,animations:document.querySelector('.env-float').getAnimations().map(a=>({name:a.animationName,current:a.currentTime,start:a.startTime}))})")
        assert state['same'] and state['start']==state['original'] and state['duration']==4600,state
    today.evaluate("document.querySelector('.env-scene').classList.add('material-envelope')")
    assert today.evaluate("getComputedStyle(document.querySelector('.env-float')).animationName")=='none', 'extraction must be still'
    today.evaluate("document.querySelector('.env-scene').classList.remove('material-envelope');document.documentElement.dataset.motion='reduce'")
    assert today.evaluate("getComputedStyle(document.querySelector('.env-float')).animationName")=='none'
    print('Today: float restored, 20 hover transitions preserve phase, extraction remains still, reduced motion: PASS')
    browser.close()
server.shutdown()
