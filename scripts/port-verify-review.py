"""Exercise review corrections and wheel-zoomed Rust brush coordinates in the actual native webview."""
import importlib,json,time,subprocess
from pathlib import Path
c=importlib.import_module('port-capture');out=c.ROOT/'docs/port-spec/compare/review-01'
def ev(s):return c.evaluate(s,timeout=60)
def mouse(x,y,*commands):subprocess.run(['xdotool','mousemove',str(round(x)),str(round(y)),*commands],check=True)
def wait(s):
 start=time.monotonic()
 while not ev('return Boolean('+s+');'):
  assert time.monotonic()-start<30,s;time.sleep(.15)
record={}
ev('S.closeOutside=false;await Bridge.window.show();Shell.setShell("desk");await Shell.open("book");return true;')
record['deskNavCentres']=ev('return Array.from(document.querySelectorAll(".nav-item .ni-icon")).map(e=>{const r=e.getBoundingClientRect();return r.x+r.width/2;});')
assert max(record['deskNavCentres'])-min(record['deskNavCentres'])<1
record['book']=ev('const p=document.querySelector(".bookpage"),b=document.querySelector(".book-binding"),r=b.getBoundingClientRect();p.scrollTop=100;await sleep(200);const q=b.getBoundingClientRect(),h=document.querySelector(".ph").getBoundingClientRect();return {bindingFixed:r.x===q.x&&r.y===q.y,contentClearsBinding:h.left>=q.right+10,oldDoubleHolesRemoved:getComputedStyle(document.querySelector(".page[data-page=book]"),"::after").display==="none"};')
assert all(record['book'].values())
ev('await Shell.open("gifts");return true;');assert ev('return !document.querySelector(".giftspage .quota");');record['giftQuotaRemoved']=True
record['cornerAndPill']=ev('return {cornerBackground:getComputedStyle(document.querySelector(".resize-h")).backgroundImage,pillWidth:document.querySelector(".wctl").clientWidth};')
assert record['cornerAndPill']==dict(cornerBackground='none',pillWidth=96)
ev('await Shell.open("materials");return true;')
record['seal']=ev('const s=getComputedStyle(document.querySelector(".seal[data-rarity=common]"));return {boxShadow:s.boxShadow,border:s.borderWidth,minWidth:s.minWidth};');assert record['seal']['boxShadow']=='none' and record['seal']['minWidth']=='0px'
ev('MK.tab="packs";await Shell.open("market");return true;')
record['market']=ev('const c=document.querySelector(".mk-hero-text").getBoundingClientRect(),b=document.querySelector(".mk-hero-text .btn").getBoundingClientRect();return {buttonInsidePaper:b.left>=c.left+20&&b.right<=c.right-20&&b.bottom<=c.bottom-16,unrotated:getComputedStyle(document.querySelector(".mk-hero-text")).transform==="none"};');assert all(record['market'].values())
style=lambda:ev('const s=getComputedStyle(document.querySelector(".seg")),b=getComputedStyle(document.querySelector(".seg button[aria-pressed=true]"));return {padding:s.padding,borderRadius:s.borderRadius,selectedRadius:b.borderRadius,selectedBackground:b.backgroundImage};')
market=style();ev('await Shell.open("settings");return true;');settings=style()
ev('await Bridge.invoke("creator_cancel");crReset();S.chosen="matte";await Shell.open("create");await crLoadSample("sCat");return true;');wait('CR.stage==="ready" && CR.res');brush=style();assert market==settings==brush;record['sharedSegmentStyle']=market
# Store real renderer bytes in the webview, never in a mocked session.
ev('window.__reviewRender=async()=>Array.from(new Uint8Array(await Bridge.invoke("creator_render",{materialId:S.chosen,strength:.5,smooth:CR.smooth/12,outline:CR.border,preview:false}))).join(",");window.__reviewBefore=await __reviewRender();return true;')
p=ev('const r=document.querySelector(".frame.checker").getBoundingClientRect(),w=await Bridge.window.outerPosition();return {x:r.x+r.width/2+w.x,y:r.y+r.height/2+w.y,scroll:document.querySelector(".page-in").scrollTop,background:getComputedStyle(document.querySelector(".frame.checker")).backgroundImage};')
mouse(p['x'],p['y'],'click','--repeat','8','--delay','60','4');time.sleep(.3)
record['zoom']=ev('return {scale:CR.zoom.scale,canvasTransform:getComputedStyle(document.querySelector("canvas.cut")).transform,frameTransform:getComputedStyle(document.querySelector(".frame.checker")).transform,scroll:document.querySelector(".page-in").scrollTop,background:getComputedStyle(document.querySelector(".frame.checker")).backgroundImage,rendererUnchanged:(await __reviewRender())===__reviewBefore};')
assert record['zoom']['scale']>1 and record['zoom']['frameTransform']=='none' and record['zoom']['rendererUnchanged']
assert record['zoom']['scroll']==p['scroll'] and record['zoom']['background']==p['background']
# Select a visible opaque pixel and independently map that original-image coordinate to the zoomed canvas.
point=ev('const cv=document.querySelector("canvas.cut"),r=cv.getBoundingClientRect(),k=Math.min(r.width/cv.width,r.height/cv.height),x=cv.width*.5,y=cv.height*.5,w=await Bridge.window.outerPosition();window.__reviewPoint={x,y};document.querySelector(".frame.checker").addEventListener("pointerdown",e=>{window.__reviewActual=canvasPoint(cv,e);},{once:true});return {x:r.left+(r.width-cv.width*k)/2+x*k+w.x,y:r.top+(r.height-cv.height*k)/2+y*k+w.y,alpha:cv.getContext("2d").getImageData(x,y,1,1).data[3]};')
assert point['alpha']>0
mouse(point['x'],point['y'],'mousedown','1','mouseup','1');time.sleep(.6)
record['zoomedBrush']=ev('await CR.queue;const a=__reviewActual,p=__reviewPoint;window.__reviewPainted=await __reviewRender();return {coordinateError:Math.hypot(a.x-p.x,a.y-p.y),changed:__reviewPainted!==__reviewBefore,canUndo:CR.history.canUndo};')
assert record['zoomedBrush']['coordinateError']<3 and record['zoomedBrush']['changed'] and record['zoomedBrush']['canUndo']
# Real UI history shortcuts must preserve both pixels and the preview zoom.
ev('document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"z",metaKey:true,bubbles:true}));return true;');time.sleep(.8)
assert ev('return (await __reviewRender())===__reviewBefore;');record['zoomedUndo']=True
assert ev('return CR.zoom.scale;')==record['zoom']['scale']
ev('document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"z",metaKey:true,shiftKey:true,bubbles:true}));return true;');time.sleep(.8)
assert ev('return (await __reviewRender())===__reviewPainted;');record['zoomedRedo']=True
# Restore the erased original image region at the same transformed coordinate.
ev('document.querySelectorAll(".g-tools .seg button")[1].click();return true;');mouse(point['x'],point['y'],'mousedown','1','mouseup','1');time.sleep(.8)
record['zoomedRestore']=ev('await CR.queue;return (await __reviewRender())===__reviewBefore;');assert record['zoomedRestore']
# Zoom is reset by the visible button, without creating any brush change.
r=ev('const r=document.querySelector(".preview-reset").getBoundingClientRect(),w=await Bridge.window.outerPosition();return {x:r.x+r.width/2+w.x,y:r.y+r.height/2+w.y};');mouse(r['x'],r['y'],'click','1');time.sleep(.3)
assert ev('return CR.zoom.scale===1 && document.querySelector(".preview-reset").hidden && (await __reviewRender())===__reviewBefore;');record['nativeResetWithoutStroke']=True
# Check the coordinate transform again after zooming inside the minimum native window.
ev('await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(720,520));return true;');time.sleep(.5)
r=ev('const r=document.querySelector(".frame.checker").getBoundingClientRect(),w=await Bridge.window.outerPosition();return {x:r.x+r.width/2+w.x,y:r.y+r.height/2+w.y};');mouse(r['x'],r['y'],'click','--repeat','4','--delay','60','4');time.sleep(.2)
assert ev('const cv=document.querySelector("canvas.cut"),r=cv.getBoundingClientRect(),p=canvasPoint(cv,{clientX:r.x+r.width/2,clientY:r.y+r.height/2});return CR.zoom.scale>1 && Math.abs(p.x-cv.width/2)<.01 && Math.abs(p.y-cv.height/2)<.01;');record['minimumWindowZoomCoordinates']=True
ev('await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(1060,700));await Bridge.invoke("creator_cancel");crReset();return true;')
(out/'controls.json').write_text(json.dumps(record,indent=2));print(record)
