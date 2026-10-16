"""Verify real Create PNG/image/sheen ratios and uniform frame fitting after resize."""
import importlib,json,subprocess,time,os,hashlib
from pathlib import Path
from PIL import Image,ImageDraw
c=importlib.import_module('port-capture');out=c.ROOT/'docs/port-spec/compare/review-04'
assert Path(os.environ['XDG_DATA_HOME']).resolve().is_relative_to(Path('/tmp'))
def ev(s):return c.evaluate(s,timeout=90)
def wait(s):
    start=time.monotonic()
    while not ev('return Boolean('+s+');'):
        assert time.monotonic()-start<90,s;time.sleep(.2)
def shot(shell):
    ids=subprocess.check_output(['xdotool','search','--name','^Peta$'],text=True).split()
    w=next(i for i in ids if 'WIDTH=1060' in subprocess.check_output(['xdotool','getwindowgeometry','--shell',i],text=True))
    p=out/(shell+'-create-after.png');subprocess.run(['import','-window',w,str(p)],check=True)
    actual=Image.open(p).convert('RGB');golden=Image.open(c.ROOT/'docs/port-spec/golden'/(shell+'-07-create-cutting-mat.jpg')).crop((190,79,1250,779))
    pair=Image.new('RGB',(2120,732),'#f5f0e6');pair.paste(golden,(0,32));pair.paste(actual,(1060,32));d=ImageDraw.Draw(pair);d.text((12,8),'Golden (unchanged; different sample)',fill='#2b2a28');d.text((1072,8),'Actual Tauri / preserved sticker ratio',fill='#2b2a28');pair.save(out/(shell+'-create-golden.jpg'),quality=90)
wait('document.querySelectorAll(".nav-item").length===8 && document.querySelector("#viewport .page")');time.sleep(.8)
ev('S.closeOutside=false;await Bridge.invoke("print_later");await Bridge.invoke("exit_edit_mode");await Bridge.window.show();await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(1060,700));await Bridge.window.setPosition(new window.__TAURI__.dpi.LogicalPosition(190,79));return true;')
subprocess.run(['xdotool','mousemove','20','20'],check=True)
records=[]
for key in ['sBubble','sBlueFlower','sPolaroid']:
    ev('await Bridge.invoke("creator_cancel");crReset();S.chosen="holographic";Shell.setShell("studio");await Shell.open("create");await crLoadSample('+json.dumps(key)+');return true;')
    wait('CR.res && !document.querySelector(".g-go .btn:not(.paper)").disabled')
    assert ev('return CR.res.material==="holographic";'), 'Fixture must contain unlocked holographic stock'
    if key=='sBubble':
        sha=hashlib.sha256(bytes(ev('return Array.from(new Uint8Array(await (await fetch(CR.res.url)).arrayBuffer()));'))).hexdigest()
        assert sha==json.loads((out/'before.json').read_text())['renderedPngSha256'], 'Rendered PNG changed'
    for shell in ['studio','desk']:
        ev('Shell.setShell('+json.dumps(shell)+');return true;');wait('CR.res && !document.querySelector(".g-go .btn:not(.paper)").disabled')
        for width,height in [(1060,700),(720,520),(1440,900),(1060,700)]:
            ev(f'await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize({width},{height}));await sleep(500);return true;')
            value=ev('const s=document.querySelector(".stk-host .stk"),img=s.querySelector("img"),sheen=s.querySelector(".sheen"),host=s.parentElement,css=getComputedStyle(host),box=e=>e.getBoundingClientRect().toJSON();return {shell:S.shell,sample:'+json.dumps(key)+',viewport:[innerWidth,innerHeight],source:[CR.res.w,CR.res.h],natural:[img.naturalWidth,img.naturalHeight],sticker:box(s),image:box(img),sheen:box(sheen),host:box(host),padding:[parseFloat(css.paddingLeft),parseFloat(css.paddingTop)],zoom:CR.zoom.scale};')
            ratio=value['source'][0]/value['source'][1]
            assert value['natural']==value['source']
            for part in ['sticker','image','sheen']:
                r=value[part];assert abs(r['width']/r['height']-ratio)<.003,(key,shell,width,part,value)
            r=value['image'];h=value['host'];px,py=value['padding']
            assert r['left']>=h['left']+px-.5 and r['right']<=h['right']-px+.5 and r['top']>=h['top']+py-.5 and r['bottom']<=h['bottom']-py+.5,value
            records.append(value)
            if key=='sBubble' and width==1060:shot(shell)
ratios={v['sample']:v['source'][0]/v['source'][1] for v in records}
assert ratios['sBubble']>1.5 and ratios['sPolaroid']<1 and abs(ratios['sBlueFlower']-1)<.01
# Resizing the finished preview must not reset the independent cutout zoom.
ev('await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(720,520));return true;')
zoom=ev('const f=document.querySelector(".frame.checker"),r=f.getBoundingClientRect();f.dispatchEvent(new WheelEvent("wheel",{deltaY:-500,clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true,cancelable:true}));await sleep(100);const z=CR.zoom.scale;await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(1060,700));await sleep(500);return {before:z,after:CR.zoom.scale};')
assert zoom['before']>1 and zoom['before']==zoom['after']
(out/'verification.json').write_text(json.dumps(dict(renderedPngSha256=sha,cases=records,cutoutZoomRetained=zoom),indent=2))
a=Image.open(out/'studio-create-before.png').convert('RGB');b=Image.open(out/'studio-create-after.png').convert('RGB');pair=Image.new('RGB',(2120,732),'#f5f0e6');pair.paste(a,(0,32));pair.paste(b,(1060,32));d=ImageDraw.Draw(pair);d.text((12,8),'Before: actual Tauri / stretched preview',fill='#2b2a28');d.text((1072,8),'After: actual Tauri / uniform scaling',fill='#2b2a28');pair.save(out/'studio-create.jpg',quality=90)
print('Verified',len(records),'native PNG/image/sheen ratios, unchanged rendered PNG and retained cutout zoom')
