"""Capture review corrections in the real Tauri window. Usage: python3 scripts/port-review.py before|after"""
import importlib,json,subprocess,time,sys
from pathlib import Path
from PIL import Image,ImageDraw
c=importlib.import_module('port-capture');phase=sys.argv[1]
assert phase in ['before','after']
out=c.ROOT/'docs/port-spec/compare/review-01';out.mkdir(exist_ok=True)
def ev(s):return c.evaluate(s,timeout=60)
def shot(shell,page):
    ev('await document.fonts.ready;await Promise.all(["spiralCoil","flagCream","flagPink","flagSky","coverBoard","pagePaper"].map(k=>Stk.load(A[k])));return true;')
    start=time.monotonic()
    while not ev('return Array.from(document.querySelectorAll("#viewport img")).every(i=>i.complete && i.naturalWidth>0) && document.querySelectorAll(".tile-stk .stk").length===document.querySelectorAll(".tile-stk").length && (!document.querySelector(".f-front") || Boolean(document.querySelector(".f-front .stk")));'):
        assert time.monotonic()-start<60;time.sleep(.2)
    time.sleep(.8)
    ids=subprocess.check_output(['xdotool','search','--name','^Peta$'],text=True).split()
    window=next(i for i in ids if 'WIDTH=1060' in subprocess.check_output(['xdotool','getwindowgeometry','--shell',i],text=True))
    target=out/f'{shell}-{page}-{phase}.png'
    subprocess.run(['import','-window',window,str(target)],check=True)
    before=out/f'{shell}-{page}-before.png'
    if phase=='after' and before.exists():
        a=Image.open(before).convert('RGB');b=Image.open(target).convert('RGB');pair=Image.new('RGB',(2120,732),'#f5f0e6');pair.paste(a,(0,32));pair.paste(b,(1060,32));d=ImageDraw.Draw(pair);d.text((12,8),'Before: native Tauri',fill='#2b2a28');d.text((1072,8),'After: native Tauri / requested corrections',fill='#2b2a28');pair.save(out/f'{shell}-{page}.jpg',quality=90)
    print(target.name,flush=True)
ev('S.closeOutside=false; await Bridge.invoke("print_later"); await Bridge.invoke("exit_edit_mode"); await Bridge.window.show(); await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(1060,700)); await Bridge.window.setPosition(new window.__TAURI__.dpi.LogicalPosition(190,79)); return true;')
for shell in ['studio','desk']:
    ev('Shell.setShell('+json.dumps(shell)+');return true;')
    for page in ['settings','market','materials','book','book-detail','gifts','create']:
        actual='book' if page=='book-detail' else page
        ev('MK.tab="packs";MK.sel=null;BK.sel=null; await Shell.open('+json.dumps(actual)+');return true;')
        if page=='book-detail':ev('document.querySelector(".tile")?.click();return true;')
        if page=='create':
            ev('await Bridge.invoke("creator_cancel");crReset();S.chosen="matte";await crLoadSample("sCat");return true;')
            start=time.monotonic()
            while not ev('return CR.stage==="ready" && Boolean(CR.res);'):
                assert time.monotonic()-start<60;time.sleep(.2)
        if page=='market':
            start=time.monotonic()
            while ev('return document.querySelectorAll(".fan-s .stk").length;')!=4:
                assert time.monotonic()-start<60;time.sleep(.2)
        shot(shell,page)
