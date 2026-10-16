"""Exercise real window-bounded opening, persistent main window and aligned shelf rows."""
import importlib,json,subprocess,time,os
from pathlib import Path
c=importlib.import_module('port-capture');out=c.ROOT/'docs/port-spec/compare/review-03'
assert Path(os.environ['XDG_DATA_HOME']).resolve().is_relative_to(Path('/tmp')), 'Disposable fixture required'
def ev(s):return c.evaluate(s,timeout=60)
def wait(s,timeout=45):
    start=time.monotonic()
    while not ev('return Boolean('+s+');'):
        assert time.monotonic()-start<timeout,s;time.sleep(.15)
def win():
    ids=subprocess.check_output(['xdotool','search','--name','^Peta$'],text=True).split()
    return next(i for i in ids if any('WIDTH='+str(w) in subprocess.check_output(['xdotool','getwindowgeometry','--shell',i],text=True) for w in [1060,720]))
def focus():
    subprocess.run(['xdotool','windowactivate','--sync',win()],check=True);time.sleep(.25)
def rect(sel):return ev('const r=document.querySelector('+json.dumps(sel)+').getBoundingClientRect();return r.toJSON();')
def drag(sel,tear=False):
    focus();r=rect(sel);g=dict(line.split('=') for line in subprocess.check_output(['xdotool','getwindowgeometry','--shell',win()],text=True).splitlines() if '=' in line)
    x=int(g['X'])+r['x']+r['width']*(.14 if tear else .5);y=int(g['Y'])+r['y']+(r['height']*.2 if tear else 24)
    tx=x+r['width']*.95 if tear else x;ty=y if tear else y-200
    subprocess.run(['xdotool','mousemove',str(round(x)),str(round(y)),'mousedown','1'],check=True)
    for i in range(1,17):
        subprocess.run(['xdotool','mousemove',str(round(x+(tx-x)*i/16)),str(round(y+(ty-y)*i/16))],check=True);time.sleep(.025)
    subprocess.run(['xdotool','mouseup','1'],check=True)
def geometry():return ev('return {pos:await Bridge.window.outerPosition(),size:await Bridge.window.outerSize(),visible:await Bridge.window.isVisible(),page:S.page,scene:document.body.dataset.scene};')
def unchanged(before,phase):
    now=geometry();assert now['visible'] and now['pos']==before['pos'] and now['size']==before['size'],(phase,before,now);return dict(phase=phase,geometry=now)
def shot(name):
    time.sleep(.3);subprocess.run(['import','-window',win(),str(out/(name+'.png'))],check=True)
def fit(selectors):
    values=ev('return '+json.dumps(selectors)+'.map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {selector:s,rect:r.toJSON(),width:innerWidth,height:innerHeight};});')
    assert all(v['rect']['x']>=-1 and v['rect']['y']>=-1 and v['rect']['right']<=v['width']+1 and v['rect']['bottom']<=v['height']+1 for v in values),values
    return values
records=[]
def record(value):
    records.append(value); (out/'motion.json').write_text(json.dumps(records,indent=2))
wait('document.querySelectorAll(".nav-item").length===8 && document.querySelector("#viewport .page")');time.sleep(.8)
ev('await Bridge.reload();if(S.packAvailable)await Bridge.invoke("pack_open",{packId:"welcome"});await Bridge.invoke("print_later");return true;')
# Physical tear and pull at both sizes, including disabled Welcome on the same shelf.
for width,height in [(1060,700),(720,520)]:
    for shell in ['studio','desk']:
        ev(f'await Bridge.invoke("print_later");await Bridge.invoke("exit_edit_mode");await Bridge.window.show();await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize({width},{height}));S.closeOutside=true;Bridge.savePreferences();Shell.setShell('+json.dumps(shell)+');await Shell.open("packs");return true;')
        focus();before=geometry();key=f'{shell}-{width}'
        ev('Array.from(document.querySelectorAll(".pack")).find(e=>e.textContent.includes("Tokyo Pack")).click();return true;')
        wait('document.querySelector(".pouch")');time.sleep(.9)
        pouchFit=fit(['.pouch']);phases=[unchanged(before,'pouch')]
        if width==720:shot('pack-'+key+'-pouch')
        drag('.pouch',True);wait('document.querySelector(".pk-sleeve.out")');time.sleep(.9)
        phases.append(unchanged(before,'torn'));drag('.pk-sleeve.out');wait('document.querySelector(".rv-info .keep")');time.sleep(1)
        phases.append(unchanged(before,'reveal'));revealFit=fit(['.rv-holder','.rv-info','.rv-info .keep','.rv-info .btn.paper'])
        shot('pack-'+key+'-reveal')
        keep=shell=='studio'
        ev('document.querySelector('+json.dumps('.rv-info .keep' if keep else '.rv-info .btn.paper')+').click();return true;')
        wait('!document.querySelector(".cer") && !Bridge.busy');time.sleep(1)
        phases.append(unchanged(before,'finished-'+('keep' if keep else 'later')))
        assert ev('return Boolean(S.pending) && !document.body.dataset.scene;')
        record(dict(kind='pack',key=key,physicalTearAndPull=True,outsideClickPreferenceEnabled=True,pouchFit=pouchFit,revealFit=revealFit,phases=phases))
        ev('await Bridge.invoke("print_later");return true;')
# Real Today acquisition, at the minimum size. Keep the card in the tray.
ev('await Bridge.window.show();await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(720,520));Shell.setShell("studio");await Shell.open("today");return true;');focus();before=geometry()
ev('document.querySelector(".btn.open").click();return true;');wait('document.querySelector(".pouch")');time.sleep(.9)
phases=[unchanged(before,'material-pouch')];drag('.pouch',True);wait('document.querySelector(".mcard.in-wrap.out")');time.sleep(.9);drag('.mcard.in-wrap.out');wait('document.querySelector(".rv-info .keep")');time.sleep(1)
phases.append(unchanged(before,'material-reveal'));materialFit=fit(['.mcard.big','.rv-info','.rv-info .keep']);shot('material-studio-720-reveal')
# Moving over and then away from the material must tilt it without losing its reveal position.
origin=rect('.mcard.big');g=dict(line.split('=') for line in subprocess.check_output(['xdotool','getwindowgeometry','--shell',win()],text=True).splitlines() if '=' in line)
subprocess.run(['xdotool','mousemove',str(round(int(g['X'])+origin['x']+origin['width']*.3)),str(round(int(g['Y'])+origin['y']+origin['height']*.6))],check=True);time.sleep(.2)
fit(['.mcard.big'])
subprocess.run(['xdotool','mousemove',str(int(g['X'])+8),str(int(g['Y'])+8)],check=True);time.sleep(.6)
restored=rect('.mcard.big');assert abs(restored['x']-origin['x'])<1 and abs(restored['y']-origin['y'])<1,(origin,restored)
ev('document.querySelector(".rv-info .keep").click();return true;');wait('!document.querySelector(".cer") && !Bridge.busy');time.sleep(.8)
phases.append(unchanged(before,'material-kept'));assert ev('return S.dayState==="opened" && Boolean(document.querySelector(".t-mat"));')
record(dict(kind='material',key='studio-720',physicalTearAndPull=True,tiltKeepsRevealPosition=True,revealFit=materialFit,phases=phases))
# Both sealed inbox items: Keep and Later, at the minimum size, with real open-gift IPC.
for shell,keep in [('studio',True),('desk',False)]:
    ev('await Bridge.invoke("print_later");await Bridge.window.show();Shell.setShell('+json.dumps(shell)+');await Shell.open("gifts");return true;');focus();before=geometry()
    ev('document.querySelector(".gift").click();return true;');wait('document.querySelector(".wax")');time.sleep(.9)
    phases=[unchanged(before,'gift-envelope')];envFit=fit(['.env-wrap'])
    ev('document.querySelector(".wax").click();return true;');wait('document.querySelector(".pk-sleeve.out")');time.sleep(.8);drag('.pk-sleeve.out');wait('document.querySelector(".rv-info .keep")');time.sleep(1)
    phases.append(unchanged(before,'gift-reveal'));revealFit=fit(['.rv-holder','.rv-info','.rv-info .keep']);shot('gift-'+shell+'-720-reveal')
    ev('document.querySelector('+json.dumps('.rv-info .keep' if keep else '.rv-info .btn.paper')+').click();return true;');wait('!document.querySelector(".cer") && !Bridge.busy');time.sleep(.8)
    phases.append(unchanged(before,'gift-finished'));record(dict(kind='gift',key=shell+'-720',envFit=envFit,revealFit=revealFit,phases=phases))
# Create completion also leaves the window open, including native creator_finish.
ev('await Bridge.invoke("print_later");await Bridge.window.show();await Bridge.invoke("creator_cancel");crReset();S.chosen="matte";await Shell.open("create");return true;');focus();before=geometry()
ev('document.querySelector(".sample").click();return true;');wait('CR.stage==="ready" && CR.res && !document.querySelector(".g-go button:not(.paper)").disabled',60)
ev('document.querySelector(".g-go button:not(.paper)").click();return true;');wait('CR.stage==="empty" && !Bridge.busy',60);time.sleep(1)
record(dict(kind='create',phases=[unchanged(before,'created')],emptyEditorReady=ev('return Boolean(document.querySelector(".cr-empty"));')))
# Programmatic print focus is exempt; a later manual outside click still follows Settings.
focus();time.sleep(.3);assert ev('return !Bridge.printFocusTransfer;')
subprocess.run(['xdotool','mousemove','20','20','click','1'],check=True);wait('!(await Bridge.window.isVisible())')
record(dict(manualOutsideClickStillCloses=True))
ev('S.closeOutside=false;Bridge.savePreferences();await Bridge.invoke("print_later");await Bridge.invoke("exit_edit_mode");await Bridge.window.show();await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(1060,700));await Shell.open("packs");return true;')
(out/'motion.json').write_text(json.dumps(records,indent=2));print('Verified',len(records),'native opening/completion cases',flush=True)
