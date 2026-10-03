"""Native UI captures and actual pointer/IPC measurements for review 02. No mocked IPC."""
import importlib,json,subprocess,time,sys
from PIL import Image,ImageDraw
c=importlib.import_module('port-capture');phase=sys.argv[1];assert phase in ['before','after']
out=c.ROOT/'docs/port-spec/compare/review-02';out.mkdir(exist_ok=True)
def ev(s):return c.evaluate(s,timeout=90)
def wait(s):
 start=time.monotonic()
 while not ev('return Boolean('+s+');'):
  assert time.monotonic()-start<90,s;time.sleep(.15)
def shot(name):
 wait('Array.from(document.querySelectorAll("#viewport img")).every(i=>i.complete&&i.naturalWidth>0)')
 time.sleep(.5)
 ids=subprocess.check_output(['xdotool','search','--onlyvisible','--name','^Peta$'],text=True).split()
 w=next(i for i in ids if 'WIDTH=1060' in subprocess.check_output(['xdotool','getwindowgeometry','--shell',i],text=True))
 target=out/f'{name}-{phase}.png';subprocess.run(['import','-window',w,str(target)],check=True)
 before=out/f'{name}-before.png'
 if phase=='after' and before.exists():
  a=Image.open(before).convert('RGB');b=Image.open(target).convert('RGB');pair=Image.new('RGB',(2120,732),'#f5f0e6');pair.paste(a,(0,32));pair.paste(b,(1060,32));d=ImageDraw.Draw(pair);d.text((12,8),'Before: native Tauri',fill='#2b2a28');d.text((1072,8),'After: native Tauri / review 02',fill='#2b2a28');pair.save(out/f'{name}.jpg',quality=90)
 print(target.name,flush=True)
ev('CR.brush={"before":26,"after":12}['+json.dumps(phase)+'];CR.tool="erase";S.closeOutside=false;await Bridge.invoke("print_later");await Bridge.invoke("exit_edit_mode");await Bridge.window.show();await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(1060,700));await Bridge.window.setPosition(new window.__TAURI__.dpi.LogicalPosition(190,79));return true;')
for shell in ['studio','desk']:
 ev('Shell.setShell('+json.dumps(shell)+');return true;')
 for page in ['market','settings','create']:
  ev('MK.tab="packs";MK.sel=null;await Shell.open('+json.dumps(page)+');return true;')
  if page=='market':wait('document.querySelectorAll(".fan-s .stk").length===document.querySelectorAll(".fan-s").length')
  if page=='create':
   ev('await Bridge.invoke("creator_cancel");crReset();S.chosen="matte";await crLoadSample("sCat");return true;');wait('CR.stage==="ready"&&CR.res')
  shot(shell+'-'+page)
# Raise/focus the real app before pointer measurements; layers/tooltips can otherwise intercept X11 input.
ids=subprocess.check_output(['xdotool','search','--name','^Peta$'],text=True).split()
w=next(i for i in ids if 'WIDTH=1060' in subprocess.check_output(['xdotool','getwindowgeometry','--shell',i],text=True))
subprocess.run(['xdotool','windowactivate','--sync',w],check=True);time.sleep(.3)
# Forward every invocation to the genuine Rust command and count completions.
ev('window.__perf={counts:{},pending:0,maxPending:0,lastEnd:0,gaps:[],paintStart:0,firstFeedback:null};const originalInvoke=Bridge.invoke;window.__perfInvoke=originalInvoke;Bridge.invoke=(command,args)=>{const m=__perf;if(command!=="creator_stroke"&&command!=="creator_render")return originalInvoke(command,args);m.counts[command]=(m.counts[command]||0)+1;m.pending++;m.maxPending=Math.max(m.maxPending,m.pending);return originalInvoke(command,args).finally(()=>{m.pending--;m.lastEnd=performance.now();});};let last=performance.now();window.__perfTick=()=>{const now=performance.now();__perf.gaps.push(now-last);last=now;window.__perfFrame=requestAnimationFrame(__perfTick);};__perfFrame=requestAnimationFrame(__perfTick);return true;')
p=ev('const cv=document.querySelector("canvas.cut"),r=cv.getBoundingClientRect(),w=await Bridge.window.outerPosition();document.querySelector(".frame.checker").addEventListener("pointerdown",e=>{const p=canvasPoint(cv,e),x=Math.floor(p.x),y=Math.floor(p.y),alpha=cv.getContext("2d").getImageData(x,y,1,1).data[3];window.__perfPixel={x,y,alpha};__perf.paintStart=performance.now();const metrics=__perf;const observe=()=>{if(cv.getContext("2d").getImageData(x,y,1,1).data[3]<alpha){metrics.firstFeedback=performance.now()-metrics.paintStart;}else if(!metrics.finished && metrics.firstFeedback===null)requestAnimationFrame(observe);};requestAnimationFrame(observe);},{once:true,capture:true});return {x:r.left+r.width/2+w.x,y:r.top+r.height/2+w.y};')
subprocess.run(['xdotool','mousemove',str(round(p['x'])),str(round(p['y'])),'mousedown','1'],check=True)
for i in range(24):
 subprocess.run(['xdotool','mousemove',str(round(p['x']+i*2)),str(round(p['y']+12*((i%8)-4)/4))],check=True);time.sleep(.012)
subprocess.run(['xdotool','mouseup','1'],check=True);up=time.monotonic()
wait('__perf.pending===0');time.sleep(.5);wait('__perf.pending===0')
result=ev('await CR.queue;__perf.finished=true;cancelAnimationFrame(__perfFrame);Bridge.invoke=__perfInvoke;return {counts:__perf.counts,pointerPixel:window.__perfPixel,maxPending:__perf.maxPending,firstFeedbackMs:__perf.firstFeedback,maxFrameGapMs:Math.max(...__perf.gaps),frameCount:__perf.gaps.length,brushMin:document.querySelector(".g-tools input[type=range]").min,brushValue:CR.brush,history:CR.history};');result['settledAfterPointerUpMs']=round((time.monotonic()-up)*1000)
(out/f'performance-{phase}.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
if phase=='after':assert result['counts'].get('creator_stroke')==1 and result['counts'].get('creator_render',0)<=2 and result['brushMin']=='1' and result['firstFeedbackMs']<100
