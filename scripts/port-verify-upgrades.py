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
elif sys.argv[1]=='haptics':
    ev('window.testHaptics=[];const original=Haptic.tap.bind(Haptic);Haptic.tap=kind=>{if(Haptic.on)window.testHaptics.push(kind);original(kind);};return true;')
    ev('window.testHaptics=[];const original=Haptic.tap.bind(Haptic);Haptic.tap=kind=>{if(Haptic.on)window.testHaptics.push(kind);original(kind);};return true;',layer)
    ev('S.haptics=true;S.motion="reduce";S.sound=false;Bridge.savePreferences();await Shell.open("settings");return true;');time.sleep(.3)
    assert ev('return Haptic.on && !Snd.on && document.documentElement.dataset.motion==="reduce";')
    assert ev('return Haptic.on && !Snd.on && document.documentElement.dataset.motion==="reduce";',layer)
    ev('await peelFromDesk("PETA-PORT-0011");return true;')
    assert ev('return window.testHaptics;')==['peel']
    ev('await Cer.openGift(S.gifts.find(g=>!g.opened));document.querySelector(".wax").click();document.querySelector(".wax").click();return true;');time.sleep(.3)
    assert ev('return window.testHaptics;')==['peel','seal']
    wait('document.querySelector(".gsleeve.out")');time.sleep(3)
    ev('document.querySelector(".cer").remove();Bridge.leaveCeremony();Bridge.busy=false;await Bridge.invoke("print_later");await Bridge.invoke("daily_stick_from_collection",{stickerId:"PETA-PORT-0010"});await Bridge.window.hide();await Bridge.invoke("print_resume");return true;')
    wait('document.querySelector(".print-sheet.ready")',layer)
    x,y=ev('const r=document.querySelector(".print-sheet .stk").getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];',layer)
    subprocess.run(['xdotool','mousemove',str(round(x)),str(round(y)),'mousedown','1'],check=True);time.sleep(.2)
    for i in range(1,11):subprocess.run(['xdotool','mousemove',str(round(x+(1100-x)*i/10)),str(round(y+(660-y)*i/10))],check=True);time.sleep(.025)
    subprocess.run(['xdotool','mouseup','1'],check=True);time.sleep(1)
    assert ev('return window.testHaptics;',layer)==['paste']
    ev('S.haptics=false;Bridge.savePreferences();return true;');time.sleep(.3)
    assert not ev('return Haptic.on;',layer)
    ev('await peelFromDesk("PETA-PORT-0010");Haptic.tap("seal");return true;')
    assert ev('return window.testHaptics;')==['peel','seal']
    (out/'haptics.json').write_text(json.dumps(dict(successfulBookPeelOnce=True,duplicateWaxClickOnce=True,nativeMousePrintPasteOnce=True,offPropagates=True,soundsAndMotionIndependent=True,physicalTrackpad='macOS checklist'),indent=2))
    ev('S.haptics=true;S.motion="full";Bridge.savePreferences();await Shell.open("settings");return true;')
    print('Native haptics: paste/peel/seal once, opt-out, and independent settings passed')
