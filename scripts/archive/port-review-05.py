"""Capture the real Book detail before/after direct flipping and consistent actions."""
import importlib,json,subprocess,time,sys,os
from pathlib import Path
from PIL import Image,ImageDraw
c=importlib.import_module('port-capture');out=c.ROOT/'docs/port-spec/compare/review-05';phase=sys.argv[1];assert phase in ['before','after']
assert Path(os.environ['XDG_DATA_HOME']).resolve().is_relative_to(Path('/tmp'))
def ev(s):return c.evaluate(s,timeout=90)
start=time.monotonic()
while not ev('return document.querySelectorAll(".nav-item").length===8 && !!document.querySelector("#viewport .page");'):
    assert time.monotonic()-start<60;time.sleep(.2)
time.sleep(.8)
ev('S.closeOutside=false;await Bridge.invoke("print_later");await Bridge.invoke("exit_edit_mode");await Bridge.window.show();await Bridge.invoke("creator_cancel");crReset();await Bridge.window.setPosition(new window.__TAURI__.dpi.LogicalPosition(190,79));return true;')
records=[]
for shell in ['studio','desk']:
    for width,height in [(1060,700),(720,520)]:
        ev('await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize('+str(width)+','+str(height)+'));Shell.setShell('+json.dumps(shell)+');S.bookMonth=monthKey(new Date("2026-09-01T12:00:00Z"));BK.sel="PETA-PORT-0010";BK.gift=false;BK.deleteId=null;await Shell.open("book");await sleep(900);await document.fonts.ready;return true;')
        start=time.monotonic()
        while not ev('return !!document.querySelector(".f-front .stk img")?.naturalWidth && document.querySelectorAll(".tile-stk .stk").length===document.querySelectorAll(".tile-stk").length;'):
            assert time.monotonic()-start<60;time.sleep(.2)
        if width==720:ev('document.querySelector(".detail").scrollIntoView({block:"start"});await sleep(300);return true;')
        ids=subprocess.check_output(['xdotool','search','--name','^Peta$'],text=True).split();win=next(i for i in ids if 'WIDTH='+str(width) in subprocess.check_output(['xdotool','getwindowgeometry','--shell',i],text=True));name=f'{shell}-book-{width}'
        subprocess.run(['xdotool','windowactivate','--sync',win],check=True);time.sleep(2)
        subprocess.run(['import','-window','root','/tmp/peta-review05-root-shot.png'],check=True)
        pos=ev('const p=await Bridge.window.outerPosition();return {x:p.x,y:p.y};')
        Image.open('/tmp/peta-review05-root-shot.png').crop((pos['x'],pos['y'],pos['x']+width,pos['y']+height)).save(out/f'{name}-{phase}.png')
        records.append(ev('return {shell:S.shell,size:[innerWidth,innerHeight],buttons:Array.from(document.querySelectorAll(".detail .btn")).map(e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON(),radius:getComputedStyle(e).borderRadius,font:getComputedStyle(e).font})),turnRow:!!document.querySelector(".turn-row"),clickableSticker:!!document.querySelector(".book-flip"),detail:document.querySelector(".detail").getBoundingClientRect().toJSON()};'))
        if phase=='after':
            a=Image.open(out/f'{name}-before.png').convert('RGB');b=Image.open(out/f'{name}-after.png').convert('RGB');w,h=b.size
            pair=Image.new('RGB',(w*2,h+32),'#f5f0e6');pair.paste(a,(0,32));pair.paste(b,(w,32));d=ImageDraw.Draw(pair);d.text((12,8),'Before: actual Tauri',fill='#2b2a28');d.text((w+12,8),'After: actual Tauri / click to flip and consistent actions',fill='#2b2a28');pair.save(out/f'{name}.jpg',quality=90)
            if width==1060:
                gold=Image.open(c.ROOT/'docs/port-spec/golden'/f'{shell}-10-book-detail.jpg').crop((190,79,1250,779));pair.paste(gold,(0,32));d.rectangle((0,0,w,32),fill='#f5f0e6');d.text((12,8),'Golden (unchanged; different sticker)',fill='#2b2a28');pair.save(out/f'{name}-golden.jpg',quality=90)
(out/f'layout-{phase}.json').write_text(json.dumps(records,indent=2));print('Captured four real Book details:',phase)
