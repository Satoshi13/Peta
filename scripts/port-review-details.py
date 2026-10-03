"""Native close-ups of wheel zoom and an actual Pack reveal following owner review 01."""
import importlib,json,time,subprocess,shutil
from PIL import Image,ImageDraw
c=importlib.import_module('port-capture');out=c.ROOT/'docs/port-spec/compare/review-01'
def ev(s):return c.evaluate(s,timeout=60)
def wait(s):
 start=time.monotonic()
 while not ev('return Boolean('+s+');'):
  assert time.monotonic()-start<60,s;time.sleep(.2)
def capture(name):
 ids=subprocess.check_output(['xdotool','search','--onlyvisible','--name','^Peta$'],text=True).split()
 window=next(i for i in ids if any('WIDTH='+str(w) in subprocess.check_output(['xdotool','getwindowgeometry','--shell',i],text=True) for w in [1060,1440]))
 subprocess.run(['import','-window',window,str(out/name)],check=True)
def gesture(sel,tear=False):
 r=ev('const r=document.querySelector('+json.dumps(sel)+').getBoundingClientRect(),w=await Bridge.window.outerPosition();return {x:w.x+r.x+r.width*'+('.14' if tear else '.5')+',y:w.y+r.y+'+('r.height*.2' if tear else '30')+',w:r.width};')
 x=r['x'];y=r['y'];subprocess.run(['xdotool','mousemove',str(round(x)),str(round(y)),'mousedown','1']);time.sleep(.2)
 for i in range(1,21):
  subprocess.run(['xdotool','mousemove',str(round(x+r['w']*.9*i/20 if tear else x)),str(round(y if tear else y-240*i/20))]);time.sleep(.03)
 subprocess.run(['xdotool','mouseup','1']);time.sleep(.3)
ev('S.closeOutside=false;await Bridge.window.show();Shell.setShell("desk");await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(1060,700));CR.tool="erase";CR.border=20;await Shell.open("create");await crLoadSample("sCat");return true;');wait('CR.stage==="ready" && CR.res');time.sleep(.8)
capture('zoom-before.png')
r=ev('const r=document.querySelector(".frame.checker").getBoundingClientRect(),w=await Bridge.window.outerPosition();return {x:r.x+r.width/2+w.x,y:r.y+r.height/2+w.y};')
subprocess.run(['xdotool','mousemove',str(round(r['x'])),str(round(r['y'])),'click','--repeat','4','--delay','60','4']);time.sleep(.4);capture('zoom-after.png')
a=Image.open(out/'zoom-before.png').convert('RGB');b=Image.open(out/'zoom-after.png').convert('RGB');pair=Image.new('RGB',(2120,732),'#f5f0e6');pair.paste(a,(0,32));pair.paste(b,(1060,32));d=ImageDraw.Draw(pair);d.text((12,8),'Native cutout: 100%',fill='#2b2a28');scale=ev('return CR.zoom.scale;');d.text((1072,8),'Native cutout after mouse wheel: '+str(round(scale*100))+'% (checker stays fixed)',fill='#2b2a28');pair.save(out/'zoom.jpg',quality=90)
ev('await Bridge.invoke("creator_cancel");crReset();await Shell.open("packs");const p=S.packs.find(p=>!p.daily&&packOpenable(p));if(!p)throw Error("Disposable fixture needs a Market Pack");Cer.openPack(p);return true;');wait('document.querySelector(".pouch")');time.sleep(1.2);gesture('.pouch',True);wait('document.querySelector(".pk-sleeve.out")');time.sleep(.8);gesture('.pk-sleeve');wait('document.querySelector(".rv-info .seal")');time.sleep(1.2)
seal=ev('const e=document.querySelector(".rv-info .seal"),s=getComputedStyle(e);return {text:e.textContent,boxShadow:s.boxShadow,border:s.borderWidth,minWidth:s.minWidth};');assert seal['boxShadow']=='none' and seal['minWidth']=='0px';capture('reveal-after.png')
(out/'details.json').write_text(json.dumps(dict(nativeWheelScale=scale,ceremonySeal=seal),indent=2));print(seal)
ev('document.querySelector(".rv-btns .btn.paper").click();await sleep(800);await Bridge.window.show();await Shell.open("settings");return true;')
