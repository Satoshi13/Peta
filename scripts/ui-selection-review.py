"""Measure real segmented controls and pen-stroke animation using fixture IPC.

Usage: python3 scripts/ui-selection-review.py [before|after]
The before phase serves src/ from 18707ba without changing the checkout.
"""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from urllib.parse import urlparse
import json,threading,os,shutil,sys,subprocess,mimetypes
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/port-spec/compare/review-15'
phase=sys.argv[1] if len(sys.argv)>1 else 'after'
if phase not in ['before','after']:raise SystemExit('Expected before or after')
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
measurement="""g=>{const gr=g.getBoundingClientRect();return {width:gr.width,height:gr.height,buttons:Array.from(g.querySelectorAll('button')).map(b=>{const br=b.getBoundingClientRect();const range=document.createRange();range.selectNodeContents(b.querySelector('.seg-label') || b);const r=range.getBoundingClientRect();return {name:b.textContent,weight:getComputedStyle(b).fontWeight,button:[br.x-gr.x,br.y-gr.y,br.width,br.height],text:[r.x-gr.x,r.y-gr.y,r.width,r.height]};})};}"""
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
   if phase=='before':
    def original(route):
     path=urlparse(route.request.url).path.lstrip('/')
     route.fulfill(body=subprocess.check_output(['git','show',f'18707ba:{path}'],cwd=ROOT),content_type=mimetypes.guess_type(path)[0] or 'application/octet-stream')
    page.route('**/src/**',original)
   page.goto(f'http://127.0.0.1:{server.server_port}/src/app.html?page=market')
   page.wait_for_selector('.mk-seg');page.evaluate('(s)=>Shell.setShell(s)',shell);page.evaluate('document.fonts.ready');page.wait_for_timeout(700)
   record={'shell':shell,'size':[width,height],'phase':phase,'groups':[]}
   def check(group,names,tag):
    states=[]
    for name in names+names[:1]:
     group.get_by_role('button',name=name,exact=True).click();page.wait_for_timeout(700)
     states.append(group.evaluate(measurement))
    delta=max(abs(a-b) for state in states[1:] for first,current in zip(states[0]['buttons'],state['buttons']) for key in ['button','text'] for a,b in zip(first[key],current[key]))
    width_delta=max(abs(state['width']-states[0]['width']) for state in states)
    if phase=='after':assert delta<.02 and width_delta<.02,(tag,delta,width_delta,states)
    record['groups'].append({'name':tag,'maxDelta':delta,'widthDelta':width_delta,'states':states})
    group.screenshot(path=str(OUT/f'{shell}-{width}-selection-{tag}-{phase}.png'))
   check(page.locator('.mk-seg'),['Packs','Materials','Creators'],'market')
   if phase=='after':
    # Pause real CSS animations at known times to verify a continuous path reveal.
    group=page.locator('.mk-seg');page.evaluate("document.querySelector('.mk-seg button:nth-child(2)').click()")
    animation=page.evaluate("()=>{const b=document.querySelector('.mk-seg [aria-pressed=true]');const paths=Array.from(b.querySelectorAll('.seg-ring path'));paths.forEach(p=>p.getAnimations().forEach(a=>a.pause()));return [0,160,360,640].map(time=>{paths.forEach(p=>p.getAnimations().forEach(a=>a.currentTime=time));return {time,offsets:paths.map(p=>parseFloat(getComputedStyle(p).strokeDashoffset)),clip:paths.map(p=>getComputedStyle(p).clipPath)};});}")
    assert animation[0]['offsets']==[1,1] and animation[-1]['offsets']==[0,0],animation
    assert 1>animation[1]['offsets'][0]>animation[2]['offsets'][0]>0
    assert animation[1]['offsets'][1]==1
    assert all(s['clip']==['none','none'] for s in animation)
    record['animation']=animation
    for time in [0,160,360,640]:
     page.evaluate("t=>document.querySelector('.mk-seg [aria-pressed=true]').querySelectorAll('.seg-ring path').forEach(p=>p.getAnimations().forEach(a=>a.currentTime=t))",time)
     group.screenshot(path=str(OUT/f'{shell}-{width}-selection-stroke-{time}.png'),animations='allow')
    # Rapid changes and keyboard activation retain one selected control and stable names.
    page.evaluate("()=>{for(const i of [0,1,2,0,2])document.querySelectorAll('.mk-seg button')[i].click();}")
    group.get_by_role('button',name='Packs',exact=True).focus();page.keyboard.press('Enter')
    assert group.locator('[aria-pressed=true]').inner_text()=='Packs'
    group.get_by_role('button',name='Creators',exact=True).focus();page.keyboard.press('Space')
    assert group.locator('[aria-pressed=true]').inner_text()=='Creators'
   page.evaluate("async()=>{S.bookView='list';await Shell.open('book');}");page.wait_for_timeout(700)
   check(page.locator('.book-view'),['List','Calendar'],'book')
   page.evaluate("async()=>{await Shell.open('settings')}");page.wait_for_timeout(700)
   appearance=page.locator('.setrow').filter(has_text='Appearance').locator('.seg')
   check(appearance,['Day','Night','Auto'],'appearance')
   window=page.locator('.setrow').filter(has_text='Window style').locator('.seg')
   check(window,['Desk','Studio'],'window')
   page.evaluate('(s)=>Shell.setShell(s)',shell)
   if phase=='after':
    for reduce in ['app','system']:
     page.evaluate("S.motion='reduce';document.documentElement.dataset.motion='reduce'" if reduce=='app' else "S.motion='full';document.documentElement.dataset.motion='full'")
     if reduce=='system':page.emulate_media(reduced_motion='reduce')
     appearance.get_by_role('button',name='Day',exact=True).click()
     state=appearance.locator('[aria-pressed=true] path').evaluate_all('(ps)=>ps.map(p=>({animations:p.getAnimations().length,offset:parseFloat(getComputedStyle(p).strokeDashoffset)}))')
     assert all(p['animations']==0 and p['offset']==0 for p in state),state
     assert appearance.locator('svg').evaluate_all('(ss)=>ss.every(s=>s.getAttribute("aria-hidden")==="true" && s.getAttribute("focusable")==="false")')
     appearance.get_by_role('button',name='Night',exact=True).click()
     record[reduce+'ReducedMotion']=True
    page.emulate_media(reduced_motion='no-preference');page.evaluate("S.motion='full';document.documentElement.dataset.motion='full'")
   # Build the real Cutting Mat with fixture render bytes, and switch the actual tools.
   page.evaluate("""async()=>{
    const photo=Stk.cv(24,20);photo.getContext('2d').fillRect(4,4,16,12);
    const png=new Uint8Array(await (await new Promise(r=>photo.toBlob(r,'image/png'))).arrayBuffer());
    const head=new TextEncoder().encode(JSON.stringify({stickerLen:png.length,width:24,height:20}));
    const frame=new Uint8Array(4+head.length+png.length*2);new DataView(frame.buffer).setUint32(0,head.length);frame.set(head,4);frame.set(png,4+head.length);frame.set(png,4+head.length+png.length);
    const invoke=Bridge.invoke;Bridge.invoke=async(cmd,args)=>cmd==='creator_render'?Array.from(frame):cmd==='creator_info'?{phase:'idle'}:invoke(cmd,args);
    CR.stage='ready';CR.photo=photo;CR.original=photo;CR.reveal=false;
    await Shell.open('create');
   }""");page.wait_for_timeout(700)
   page.get_by_role('button',name='Fix the cutout',exact=True).click()
   check(page.locator('.seg.only-edit'),['Erase','Restore'],'tools')
   assert page.evaluate('CR.tool')=='erase'
   assert not errors,errors
   records.append(record);context.close()
 browser.close()
server.shutdown();server.server_close()
(OUT/f'selection-{phase}.json').write_text(json.dumps(records,indent=2))
print(json.dumps({'phase':phase,'views':len(records),'groups':sum(len(r['groups']) for r in records),'passed':True}))
