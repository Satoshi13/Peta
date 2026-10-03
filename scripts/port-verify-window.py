"""Real native window controls/gestures and preferences, under an X11 window manager."""
import importlib,json,subprocess,time
c=importlib.import_module('port-capture')
def ev(s):return c.evaluate(s)
def wait(s):
    for _ in range(50):
        if ev('return Boolean('+s+');'):return
        time.sleep(.1)
    raise RuntimeError(s)
def mouse(x,y,*args):
    subprocess.run(['xdotool','mousemove',str(round(x)),str(round(y))],check=True)
    if args:
        time.sleep(.3) # Let WebKit receive the pointer's new coordinates before the button event.
        subprocess.run(['xdotool',*args],check=True)
ev('await Bridge.invoke("print_later"); S.closeOutside=false; S.motion="full"; S.sound=true; Bridge.savePreferences(); await Bridge.invoke("arrival_open"); await sleep(500); await Shell.open("settings"); await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(1060,700)); await Bridge.window.setPosition(new window.__TAURI__.dpi.LogicalPosition(190,79)); return true;')
# GTK creates tiny helper windows with the same title; activate only the content window.
ids=subprocess.check_output(['xdotool','search','--onlyvisible','--name','^Peta$'],text=True).split()
wid=next(i for i in ids if 'WIDTH=1060' in subprocess.check_output(['xdotool','getwindowgeometry','--shell',i],text=True))
subprocess.run(['xdotool','windowactivate','--sync',wid],check=True)
time.sleep(1)
pos=ev('return await Bridge.window.outerPosition();')
mouse(pos['x']+250,pos['y']+12,'mousedown','1');time.sleep(.5);
for i in range(1,11):mouse(pos['x']+250+i*5,pos['y']+12+i*4);time.sleep(.05)
subprocess.run(['xdotool','mouseup','1'],check=True);time.sleep(.3)
moved=ev('return await Bridge.window.outerPosition();')
if moved==pos:raise RuntimeError('Native drag strip did not move the window')
time.sleep(1)
size=ev('return await Bridge.window.innerSize();')
r=ev('const r=document.getElementById("resize-h").getBoundingClientRect(),p=await Bridge.window.outerPosition(); return {x:p.x+r.x+r.width/2,y:p.y+r.y+r.height/2};')
mouse(r['x'],r['y'],'mousedown','1');time.sleep(.5);
for i in range(1,11):mouse(r['x']-i*43,r['y']-i*35);time.sleep(.05)
subprocess.run(['xdotool','mouseup','1'],check=True);time.sleep(1)
minimum=ev('return await Bridge.window.innerSize();')
if minimum['width']<720 or minimum['height']<520 or minimum==size:raise RuntimeError('Resize/minimum constraint failed')
ev('await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(1060,700)); await Bridge.window.setPosition(new window.__TAURI__.dpi.LogicalPosition(190,79)); return true;')
time.sleep(.5)
ev('document.getElementById("wc-zoom").click(); return true;');wait('await Bridge.window.isMaximized()')
maximized=ev('return await Bridge.window.innerSize();')
ev('document.getElementById("wc-zoom").click(); return true;');wait('!(await Bridge.window.isMaximized())')
ev('document.getElementById("wc-min").click(); return true;');wait('await Bridge.window.isMinimized()')
ev('await Bridge.invoke("arrival_open"); return true;');wait('!(await Bridge.window.isMinimized())')
ev('await Shell.open("settings"); document.getElementById("wc-close").click(); return true;');wait('!(await Bridge.window.isVisible())')
ev('await Bridge.invoke("arrival_open"); return true;');wait('await Bridge.window.isVisible()')
subprocess.run(['xdotool','key','Escape'],check=True);wait('!(await Bridge.window.isVisible())')
ev('await Bridge.invoke("arrival_open"); await sleep(500); await Shell.open("settings"); return true;')
ev('S.closeOutside=true; Bridge.savePreferences(); return true;');mouse(40,40,'click','1');wait('!(await Bridge.window.isVisible())')
ev('S.closeOutside=false; await Bridge.invoke("arrival_open"); await sleep(500); await Shell.open("settings"); document.querySelectorAll(".switch")[0].click(); document.querySelectorAll(".switch")[2].click(); return true;')
label=ev('return (await window.__TAURI__.webviewWindow.getAllWebviewWindows()).find(w=>w.label.startsWith("layer-")).label;')
main=ev('return {sound:Snd.on,motion:document.documentElement.dataset.motion,stored:JSON.parse(localStorage.getItem("peta.preferences"))};')
layer=c.evaluate('return {sound:Snd.on,motion:document.documentElement.dataset.motion};',label=label)
if main['sound'] or layer['sound'] or main['motion']!='reduce' or layer['motion']!='reduce':raise RuntimeError('Preferences did not reach the layer')
ev('S.closeOutside=false; S.motion="full"; S.sound=true; Bridge.savePreferences(); await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(1060,700)); await Bridge.window.setPosition(new window.__TAURI__.dpi.LogicalPosition(190,79)); return true;')
result=dict(maximizeRestore=True,maximized=maximized,minimizeResume=True,redClose=True,escapeClose=True,dragStrip=True,nativeResize=True,minimum=minimum,outsideClose=True,preferences=dict(main=main,layer=layer))
(c.ROOT/'docs/port-spec/compare/slice-07-window.json').write_text(json.dumps(result,indent=2));print(result)
