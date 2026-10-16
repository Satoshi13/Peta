"""Real Tauri before/after captures for shelf alignment and notebook binding."""
import importlib,json,subprocess,time,sys,os
from PIL import Image,ImageDraw
c=importlib.import_module('port-capture');phase=sys.argv[1];assert phase in ['before','after']
assert Path(os.environ['XDG_DATA_HOME']).resolve().is_relative_to(Path('/tmp')), 'Disposable fixture required'
out=c.ROOT/'docs/port-spec/compare/review-03';out.mkdir(exist_ok=True)
def ev(s):return c.evaluate(s,timeout=60)
def shot(shell,page,width):
    ev('await document.fonts.ready;await Promise.all(["pagePaper","coverBoard","spiralBinding","spiralCapTop","spiralCapBottom","pageGutter","packHolo"].map(k=>Stk.load(A[k])));return true;')
    start=time.monotonic()
    while not ev('return Boolean(document.querySelector("#viewport .page[data-page="+S.page+"]")) && (S.page!=="packs" || document.querySelectorAll(".pack").length>0) && Array.from(document.querySelectorAll("#viewport img")).every(i=>i.complete && i.naturalWidth>0) && document.querySelectorAll(".tile-stk .stk").length===document.querySelectorAll(".tile-stk").length;'):
        assert time.monotonic()-start<60;time.sleep(.2)
    time.sleep(.6)
    ids=subprocess.check_output(['xdotool','search','--name','^Peta$'],text=True).split()
    window=next(i for i in ids if f'WIDTH={width}' in subprocess.check_output(['xdotool','getwindowgeometry','--shell',i],text=True))
    name=f'{shell}-{page}-{width}';actual=out/f'{name}-{phase}.png'
    subprocess.run(['import','-window',window,str(actual)],check=True)
    if phase=='after':
        a=Image.open(out/f'{name}-before.png').convert('RGB');b=Image.open(actual).convert('RGB');w,h=b.size
        pair=Image.new('RGB',(w*2,h+32),'#f5f0e6');pair.paste(a,(0,32));pair.paste(b,(w,32));d=ImageDraw.Draw(pair);d.text((12,8),'Before: actual Tauri',fill='#2b2a28');d.text((w+12,8),'After: actual Tauri / requested corrections',fill='#2b2a28');pair.save(out/f'{name}.jpg',quality=90)
        if width==1060:
            ref=Image.open(c.ROOT/'docs/port-spec/golden'/f'{shell}-{PathName[page]}.jpg').crop((190,79,1250,779))
            pair.paste(ref,(0,32));d.rectangle((0,0,w,32),fill='#f5f0e6');d.text((12,8),'Golden (unchanged)',fill='#2b2a28');pair.save(out/f'{name}-golden.jpg',quality=90)
    print(name+'-'+phase,flush=True)
PathName={'packs':'11-packs-shelf','book':'09-book'}
start=time.monotonic()
while not ev('return document.querySelectorAll(".nav-item").length===8 && Boolean(document.querySelector("#viewport .page"));'):
    assert time.monotonic()-start<60;time.sleep(.2)
time.sleep(.8) # Let initial boot finish before issuing another Shell.open.
assert ev('return Bridge.enterCeremony.toString().includes("setSize");') == (phase=='before'), 'Wrong native binary for this capture phase'
ev('S.closeOutside=false;await Bridge.invoke("print_later");await Bridge.invoke("exit_edit_mode");await Bridge.window.show();await Bridge.window.setPosition(new window.__TAURI__.dpi.LogicalPosition(190,79));return true;')
if phase=='before':
    ev('await Bridge.reload();if(S.packAvailable)await Bridge.invoke("pack_open",{packId:"welcome"});await Bridge.invoke("print_later");return true;')
records=[]
for width,height in [(1060,700),(720,520)]:
    ev(f'await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize({width},{height}));return true;')
    for shell in ['studio','desk']:
        ev('Shell.setShell('+json.dumps(shell)+');return true;')
        for page in ['packs','book']:
            ev('BK.sel=null;S.bookMonth=null;await Shell.open('+json.dumps(page)+');return true;')
            shot(shell,page,width)
            records.append(ev('return {shell:S.shell,page:S.page,width:innerWidth,height:innerHeight,packs:Array.from(document.querySelectorAll(".pack")).map(e=>({disabled:e.disabled,rect:e.getBoundingClientRect().toJSON(),bag:e.querySelector(".pk-stack").getBoundingClientRect().toJSON(),label:e.querySelector(".pack-tag").getBoundingClientRect().toJSON(),action:e.querySelector(".open-cta")?.getBoundingClientRect().toJSON()})),binding:document.querySelector(".binding-band")?.getBoundingClientRect().toJSON()};'))
ev('await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(1060,700));return true;')
(out/f'layout-{phase}.json').write_text(json.dumps(records,indent=2))
