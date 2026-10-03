"""Native upgrade checks on the disposable /tmp fixture; one capture IPC call at a time."""
import importlib,json,os,sys,time,subprocess
from pathlib import Path
c=importlib.import_module('port-capture');out=c.ROOT/'docs/port-spec/compare/upgrade-2026-10-04'
assert Path(os.environ['XDG_DATA_HOME']).resolve().is_relative_to(Path('/tmp'))
def ev(s,label=None):return c.evaluate(s,timeout=90,label=label)
def wait(s,label=None):
    start=time.monotonic()
    while not ev('return Boolean('+s+');',label):
        assert time.monotonic()-start<60,s;time.sleep(.15)
wait('document.querySelectorAll(".nav-item").length===8')
layer=ev('return (await window.__TAURI__.webviewWindow.getAllWebviewWindows()).find(w=>w.label.startsWith("layer-")).label;')
def state():return ev('return {status:await window.__TAURI__.core.invoke("reflection_status"),frames:window.testReflectionFrames||0,nodes:Array.from(document.querySelectorAll("#layer>.sticker")).map(e=>({material:e.dataset.material,transform:e.style.transform,sx:e.style.getPropertyValue("--sx"),sy:e.style.getPropertyValue("--sy"),sa:e.style.getPropertyValue("--sa")}))};',layer)
if sys.argv[1]=='reflection':
    wait('document.querySelectorAll("#layer>.sticker").length===3',layer)
    ev('applyLayerPreferences({motion:"full",sound:false});const original=requestAnimationFrame;window.testReflectionFrames=0;window.requestAnimationFrame=fn=>{window.testReflectionFrames++;return original(fn);};return true;',layer);time.sleep(.5)
    before=state();assert before['status']['activeLayers']==1
    ev('await window.__TAURI__.event.emit("cursor-reflect",{x:100,y:100,inside:true});return true;',layer);time.sleep(1)
    after=state();assert after['frames']>before['frames'];assert after['nodes']!=before['nodes']
    for a,b in zip(before['nodes'],after['nodes']):
        assert a['transform']==b['transform']
        if a['material']!='holographic':assert a==b
    time.sleep(.4);assert state()['frames']==after['frames']
    ev('await window.__TAURI__.event.emit("cursor-reflect",{x:0,y:0,inside:false});return true;',layer);time.sleep(1)
    outside=state();assert outside['nodes']==before['nodes']
    ev('document.querySelector("#edit-done").dispatchEvent(new PointerEvent("pointermove",{bubbles:true,clientX:1100,clientY:30}));return true;',layer);time.sleep(1)
    controls=state();assert controls['nodes']!=outside['nodes']
    for a,b in zip(outside['nodes'],controls['nodes']):
        assert a['transform']==b['transform']
        if a['material']!='holographic':assert a==b

    ev('applyLayerPreferences({motion:"reduce",sound:false});return true;',layer);time.sleep(.3)
    reduced=state();assert reduced['status']['activeLayers']==0 and not reduced['status']['timerRunning']
    time.sleep(.3);assert state()['status']['cursorReads']==reduced['status']['cursorReads'] and state()['frames']==reduced['frames']
    ev('applyLayerPreferences({motion:"full",sound:false});await window.__TAURI__.core.invoke("peel_sticker",{stickerId:"PETA-PORT-0012"});return true;',layer);time.sleep(.5)
    empty=state();assert empty['status']['activeLayers']==0 and not empty['status']['timerRunning']
    time.sleep(.3);assert state()['status']['cursorReads']==empty['status']['cursorReads']
    (out/'reflection.json').write_text(json.dumps(dict(before=before,after=after,outside=outside,controls=controls,reduced=reduced,noHolo=empty,globalMacCursor='not executable on Linux'),indent=2));print('Native reflection: band only, fallback, frame convergence, Reduce motion and zero-Holo stop passed')
