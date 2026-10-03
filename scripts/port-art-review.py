"""Capture delivered paper parts in actual Tauri; preserve the original golden and artwork."""
import importlib,json,subprocess,time
from PIL import Image,ImageDraw
c=importlib.import_module('port-capture');out=c.ROOT/'docs/port-spec/compare/art-03';out.mkdir(exist_ok=True)
def ev(s):return c.evaluate(s,timeout=60)
def ready():
    ev('await document.fonts.ready;await Promise.all(["pageDots","pageGutter","pageEdgeRight","pageEdgeBottom","pageCorner","spiralBinding","spiralCapTop","spiralCapBottom","noteStickyYellow","indexCard","paperClip"].map(k=>Stk.load(A[k])));return true;')
    start=time.monotonic()
    while not ev('return Array.from(document.querySelectorAll("#viewport img")).every(i=>i.complete && i.naturalWidth>0) && document.querySelectorAll(".tile-stk .stk").length===document.querySelectorAll(".tile-stk").length && (!document.querySelector(".f-front") || Boolean(document.querySelector(".f-front .stk"))) && document.querySelectorAll(".fan-s .stk").length===document.querySelectorAll(".fan-s").length;'):
        assert time.monotonic()-start<60;time.sleep(.2)
    time.sleep(.6)
def shot(name,width=1060):
    ready()
    ids=subprocess.check_output(['xdotool','search','--name','^Peta$'],text=True).split()
    window=next(i for i in ids if f'WIDTH={width}' in subprocess.check_output(['xdotool','getwindowgeometry','--shell',i],text=True))
    subprocess.run(['import','-window',window,str(out/(name+'-actual.png'))],check=True)
    if width==1060:
        ref=Image.open(c.ROOT/'docs/port-spec/golden'/f'{name}.jpg').crop((190,79,1250,779))
        actual=Image.open(out/(name+'-actual.png')).convert('RGB')
        pair=Image.new('RGB',(2120,732),'#f5f0e6');pair.paste(ref,(0,32));pair.paste(actual,(1060,32))
        d=ImageDraw.Draw(pair);d.text((12,8),'Golden (original window crop)',fill='#2b2a28');d.text((1072,8),'Actual Tauri / delivered paper parts',fill='#2b2a28');pair.save(out/(name+'.jpg'),quality=90)
    print(name,flush=True)
def geometry():
    return ev('const band=document.querySelector(".binding-band"),detail=document.querySelector(".detail");return {shell:S.shell,page:S.page,width:innerWidth,height:innerHeight,bindingHeight:band?.getBoundingClientRect().height,bindingWidth:band?.getBoundingClientRect().width,bindingBackground:band?getComputedStyle(band.querySelector(".binding-middle")).backgroundImage:null,oldCoilCount:document.querySelectorAll(".coil").length,detailBackground:detail?getComputedStyle(detail).backgroundImage:null,paperArt:Array.from(document.querySelectorAll(".book-paper-parts [data-art]")).map(e=>e.dataset.art)};')
ev('S.closeOutside=false; await Bridge.invoke("print_later");await Bridge.invoke("exit_edit_mode");await Bridge.window.show();await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(1060,700));await Bridge.window.setPosition(new window.__TAURI__.dpi.LogicalPosition(190,79));return true;')
records=[]
for width,height in [(1060,700),(720,520)]:
    ev(f'await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize({width},{height}));return true;')
    for shell in ['studio','desk']:
        ev('Shell.setShell('+json.dumps(shell)+');return true;')
        for page,name in [('book','09-book'),('book-detail','10-book-detail'),('market','16-market-packs')]:
            if width==720 and page=='book':continue
            ev('BK.sel=null;S.bookMonth=null;MK.tab="packs";MK.sel=null;await Shell.open('+json.dumps('book' if page=='book-detail' else page)+');return true;')
            if page=='book-detail':ev('document.querySelector(".tile").click();return true;')
            shot(shell+'-'+name+('-720x520' if width==720 else ''),width)
            record=geometry();records.append(record)
            if shell=='desk' and page.startswith('book'):
                pitch=record['bindingWidth']/128*50
                assert record['bindingHeight']>0 and abs(record['bindingHeight']/pitch-round(record['bindingHeight']/pitch))<1e-6
                assert record['oldCoilCount']==0 and len(record['paperArt'])==4
            if page=='book-detail':
                assert 'note-sticky-yellow.png' in record['detailBackground']
                bottom=ev('const p=document.querySelector(".page-in");p.scrollTop=p.scrollHeight;await new Promise(requestAnimationFrame);return {scrollTop:p.scrollTop,maximum:p.scrollHeight-p.clientHeight};')
                assert abs(bottom['scrollTop']-bottom['maximum'])<=1
                record['detailScrollBottomReached']=bottom
                ev('document.querySelector(".page-in").scrollTop=0;return true;')
ev('await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(1060,700));await Shell.open("book");return true;')
(out/'verification.json').write_text(json.dumps(records,indent=2))
