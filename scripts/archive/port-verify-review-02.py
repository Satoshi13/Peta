"""Exercise thin/continuous/rapid strokes and the real minimal native tray menu."""
import importlib,json,subprocess,time,math
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
c=importlib.import_module('port-capture');out=c.ROOT/'docs/port-spec/compare/review-02'
def ev(s):return c.evaluate(s,timeout=90)
def wait(s):
 start=time.monotonic()
 while not ev('return Boolean('+s+');'):
  assert time.monotonic()-start<90,s;time.sleep(.1)
def mouse(p,*args):subprocess.run(['xdotool','mousemove',str(round(p['x'])),str(round(p['y'])),*args],check=True)
def ready():wait('CR.res && !document.querySelector(".g-go .btn:not(.paper)").disabled')
record={}
ev('Bridge.invoke=(name,args)=>window.__TAURI__.core.invoke(name,args);S.closeOutside=false;await Bridge.invoke("exit_edit_mode");await Bridge.invoke("print_later");await Bridge.window.show();Shell.setShell("studio");await Shell.open("market");return true;')
# The oval follows the actual selected tab, including the originally ambiguous Materials state.
record['tabs']=[]
for label in ['Materials','Creators','Packs']:
 ev('Array.from(document.querySelectorAll(".marketpage .seg button")).find(b=>b.textContent==='+json.dumps(label)+').click();return true;')
 item=ev('const b=document.querySelector(".marketpage .seg button[aria-pressed=true]"),s=getComputedStyle(b,"::after");return {selected:b.textContent,selectedCount:document.querySelectorAll(".marketpage .seg button[aria-pressed=true]").length,circleOpacity:s.opacity,circleWidth:s.borderWidth};')
 assert item['selected']==label and item['selectedCount']==1 and item['circleOpacity']=='1' and item['circleWidth']=='2px';record['tabs'].append(item)
 if label=='Materials':
  time.sleep(.5);subprocess.run(['import','-window','root',str(out/'materials-selected-native.png')],check=True)
# Actual native tray data, then show the very same Menu instance as a native GTK context menu.
record['tray']=ev('return await Bridge.invoke("port_capture_tray",{popup:false});')
items=[i for i in record['tray']['items'] if not i.get('separator')];assert [i['id'] for i in items]==['today','resume_print','edit','settings','quit']
assert items[1]['enabled']==ev('return Boolean(await Bridge.invoke("print_pending"));')
with ThreadPoolExecutor(max_workers=1) as pool:
 popup=pool.submit(ev,'return await Bridge.invoke("port_capture_tray",{popup:true});')
 time.sleep(.7)
 subprocess.run(['import','-window','root',str(out/'tray-native.png')],check=True)
 subprocess.run(['xdotool','key','Escape'],check=True)
 popup.result()

# Real renderer equality for undo/redo; two rapid strokes must remain independent undo steps.
ev('await Bridge.invoke("creator_cancel");crReset();S.chosen="matte";await Shell.open("create");await crLoadSample("sCat");return true;');ready()
ev('window.__review2Render=async()=>Array.from(new Uint8Array(await Bridge.invoke("creator_render",{materialId:S.chosen,strength:.5,smooth:CR.smooth/12,outline:CR.border,preview:false}))).join(",");window.__review2Base=await __review2Render();return true;')
p=ev('const r=document.querySelector(".frame.checker").getBoundingClientRect(),w=await Bridge.window.outerPosition();return {x:r.left+r.width/2+w.x,y:r.top+r.height/2+w.y};')
mouse(p,'click','--repeat','8','--delay','40','4');time.sleep(.2)
ev('const b=document.querySelector(".g-tools input[type=range]");b.value="1";b.dispatchEvent(new Event("input",{bubbles:true}));return true;')
# Measure at native pointerdown, before any Rust command runs: only the local cutout changes.
ev('const originalInvoke=Bridge.invoke;window.__r2Invoke=originalInvoke;window.__r2Calls=[];document.querySelector(".frame.checker").addEventListener("pointerdown",e=>{window.__r2Down=canvasPoint(document.querySelector("canvas.cut"),e);},{once:true});Bridge.invoke=(name,args)=>{if(name==="creator_stroke")__r2Calls.push(args);return originalInvoke(name,args);};return true;')
mouse(p,'mousedown','1');time.sleep(.08)
record['thinWhileDown']=ev('const cv=document.querySelector("canvas.cut"),x=Math.floor(__r2Down.x),y=Math.floor(__r2Down.y);return {radius:CR.brush,point:{x:__r2Down.x,y:__r2Down.y},alpha:cv.getContext("2d").getImageData(x,y,1,1).data[3],nativeStrokeCalls:__r2Calls.length};')
assert record['thinWhileDown']['radius']==1 and record['thinWhileDown']['alpha']<255 and record['thinWhileDown']['nativeStrokeCalls']==0
mouse(p,'mouseup','1');ready()
record['thinStroke']=ev('window.__r2Thin=await __review2Render();return {changed:__r2Thin!==__review2Base,radius:__r2Calls[0].radius,canUndo:CR.history.canUndo};');assert record['thinStroke']['changed'] and record['thinStroke']['canUndo']
# Reset and draw a curved line with multiple actual X11 pointer moves. Every coordinate is retained.
ev('await Bridge.invoke("creator_clear_edits");await Shell.open("settings");await Shell.open("create");return true;');ready()
ev('__r2Calls=[];const b=document.querySelector(".g-tools input[type=range]");b.value="3";b.dispatchEvent(new Event("input",{bubbles:true}));return true;')
mouse(p,'mousedown','1')
for i in range(16):mouse(dict(x=p['x']+i*2,y=p['y']+15*math.sin(i/3)));time.sleep(.015)
mouse(dict(x=p['x']+30,y=p['y']+15*math.sin(5)),'mouseup','1')
# A second stroke begins before the first completed preview, to exercise render invalidation.
p2=dict(x=p['x']-25,y=p['y']-15);mouse(p2,'mousedown','1','mouseup','1');ready()
record['rapidStrokes']=ev('await CR.queue;window.__r2Both=await __review2Render();return {calls:__r2Calls.length,firstPoints:__r2Calls[0].points.length,newSteps:__r2Calls.every(c=>c.newStroke),changed:__r2Both!==__review2Base};')
assert record['rapidStrokes']['calls']==2 and record['rapidStrokes']['firstPoints']>10 and record['rapidStrokes']['newSteps'] and record['rapidStrokes']['changed']
def history(redo=False):
 ev('document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"z",metaKey:true,shiftKey:'+str(redo).lower()+',bubbles:true}));return true;');time.sleep(.15);ready()
history();assert ev('return (await __review2Render())!==__review2Base && (await __review2Render())!==__r2Both;')
history();assert ev('return (await __review2Render())===__review2Base;')
history(True);history(True);assert ev('return (await __review2Render())===__r2Both;');record['independentUndoRedo']=True
# Restore then undo restore must also be exactly reproducible at the same zoomed coordinates.
ev('document.querySelectorAll(".g-tools .seg button")[1].click();return true;');mouse(p2,'mousedown','1','mouseup','1');ready()
assert ev('return (await __review2Render())!==__r2Both;');history();assert ev('return (await __review2Render())===__r2Both;');record['restoreUndo']=True
# Leaving the page during a captured stroke commits it; pending work cannot overwrite a new page.
mouse(p,'mousedown','1');ev('await Shell.open("settings");await CR.queue;return true;');subprocess.run(['xdotool','mouseup','1'],check=True)
ev('await Shell.open("create");return true;');ready();record['leavingCommitsStroke']=ev('return __r2Calls.length===4 && CR.history.canUndo;');assert record['leavingCommitsStroke']
# Hiding the actual native window during a stroke must finish that stroke as well.
mouse(p,'mousedown','1');ev('await Shell.close();await CR.queue;return true;');subprocess.run(['xdotool','mouseup','1'],check=True)
ev('await Bridge.window.show();await Shell.open("create");return true;');ready()
record['hidingCommitsStroke']=ev('return __r2Calls.length===5 && CR.history.canUndo;');assert record['hidingCommitsStroke']
ev('Bridge.invoke=__r2Invoke;return true;')
(out/'controls.json').write_text(json.dumps(record,indent=2));print(json.dumps(record),flush=True)
