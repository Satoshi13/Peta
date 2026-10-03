"""Capture and exercise the real native desktop Print -> Grab -> Paste flow."""
import importlib,json,time,subprocess,sqlite3,os
from pathlib import Path
from PIL import Image,ImageDraw
c=importlib.import_module('port-capture')
shell=__import__('sys').argv[1]
out=c.ROOT/'docs/port-spec/compare'
dbpath=Path(os.environ['XDG_DATA_HOME'])/'app.peta.desktop'/'peta.db'
if not dbpath.resolve().is_relative_to(Path('/tmp')): raise RuntimeError('Disposable fixture required')
db=sqlite3.connect(dbpath)
if db.execute('PRAGMA user_version').fetchone()[0]>=7: db.execute('DELETE FROM print_queue')
db.execute('UPDATE daily_records SET sticker_id=NULL,source_type=NULL,confirmed_at=NULL,used_at=NULL');db.execute("UPDATE material_stock SET count=1 WHERE material_id='holographic'");db.commit();db.close()
c.evaluate('await Bridge.invoke("print_later"); S.closeOutside=false; Shell.setShell('+json.dumps(shell)+'); await Bridge.invoke("creator_cancel"); crReset(); S.chosen="holographic"; await Bridge.window.show(); await Shell.open("create"); await crLoadSample("sCoffee"); return true;')
def wait(script,label=None,timeout=60):
    start=time.monotonic()
    while not c.evaluate('return Boolean('+script+');',label=label):
        if time.monotonic()-start>timeout: raise TimeoutError(script)
        time.sleep(.2)
c.evaluate('await Bridge.reload(); for(const e of S.lib.filter(e=>e.onDesktop&&!e.id.startsWith("PETA-PORT-"))) await Bridge.invoke("peel_sticker",{stickerId:e.id}); return true;')
wait('CR.stage==="ready" && CR.res')
c.evaluate('document.querySelector(".g-go .btn:not(.paper)").click(); return true;')
labels=c.evaluate('return (await window.__TAURI__.webviewWindow.getAllWebviewWindows()).map(w=>w.label);')
label=next(x for x in labels if x.startswith('layer-'))
wait('document.querySelector(".print-sheet.ready")',label)
time.sleep(.6) # Wait for the original 400ms hint entrance before the still comparison.
pending=c.evaluate('return await window.__TAURI__.core.invoke("print_pending");',label=label)
name=f'slice-07-{shell}-08-printed'
subprocess.run(['import','-window','root',str(out/(name+'-actual.png'))],check=True)
ref=Image.open(next((c.ROOT/'docs/port-spec/golden').glob(f'{shell}-08-*.jpg'))); actual=Image.open(out/(name+'-actual.png')).convert('RGB')
pair=Image.new('RGB',(2880,932),'#f5f0e6');pair.paste(ref,(0,32));pair.paste(actual,(1440,32));d=ImageDraw.Draw(pair);d.text((12,8),'Golden (1440 x 900)',fill='#2b2a28');d.text((1452,8),'Actual Tauri desktop layers (real X11 background)',fill='#2b2a28');pair.save(out/(name+'.jpg'),quality=90)
r=c.evaluate('const r=document.querySelector(".print-sheet .stk").getBoundingClientRect(); return [r.left,r.top,r.width,r.height];',label=label)
x=r[0]+r[2]/2;y=r[1]+r[3]/2
# Return a moved sticker to the sheet before committing an actual paste.
subprocess.run(['xdotool','mousemove',str(round(x)),str(round(y)),'mousedown','1'],check=True);time.sleep(.2)
grab=c.evaluate('const b=document.querySelector(".sticker.print-grab .body");return {transform:getComputedStyle(b).transform,timings:b.getAnimations().map(a=>a.effect.getTiming().duration)};',label=label)
subprocess.run(['xdotool','mousemove',str(round(x+20)),str(round(y+10)),'mouseup','1'],check=True)
returned=c.evaluate('return Array.from(document.querySelectorAll(".sticker.print-grab")).flatMap(e=>[...e.getAnimations(),...e.querySelector(".body").getAnimations()]).map(a=>a.effect.getTiming().duration);',label=label)
time.sleep(.4)
assert 160 in grab['timings'] and 260 in returned
assert c.evaluate('return document.querySelector(".print-sheet img").style.visibility==="" && !document.querySelector(".sticker.print-grab");',label=label)
assert c.evaluate('return (await window.__TAURI__.core.invoke("print_pending")).stickerId;',label=label)==pending['stickerId']
subprocess.run(['xdotool','mousemove',str(round(x)),str(round(y)),'mousedown','1'],check=True);time.sleep(.2)
for i in range(1,21):
    subprocess.run(['xdotool','mousemove',str(round(x+(1100-x)*i/20)),str(round(y+(600-y)*i/20))],check=True);time.sleep(.02)
subprocess.run(['xdotool','mouseup','1'],check=True);time.sleep(.2)
tag=c.evaluate('return document.querySelector(".peta-tag")?.dataset.art;',label=label)
subprocess.run(['import','-window','root',str(out/f'slice-07-{shell}-pasted-actual.png')],check=True)
wait('!document.querySelector(".print-sheet")',label)
placement=c.evaluate('return (await window.__TAURI__.core.invoke("layer_placements")).find(p=>p.stickerId==='+json.dumps(pending['stickerId'])+');',label=label)
if not placement or not tag: raise RuntimeError('Native drag did not paste with a Peta! tag')
# Move the new sticker and peel it with the existing native keyboard path.
subprocess.run(['xdotool','mousemove','1100','600','mousedown','1'],check=True);time.sleep(.1)
subprocess.run(['xdotool','mousemove','1140','660','mouseup','1'],check=True);time.sleep(.5)
moved=c.evaluate('return (await window.__TAURI__.core.invoke("layer_placements")).find(p=>p.stickerId==='+json.dumps(pending['stickerId'])+');',label=label)
if moved['relativeX']==placement['relativeX'] and moved['relativeY']==placement['relativeY']:raise RuntimeError('Desktop drag did not persist')
subprocess.run(['xdotool','key','Delete'],check=True);time.sleep(.6)
peeled=c.evaluate('return !(await window.__TAURI__.core.invoke("layer_placements")).some(p=>p.stickerId==='+json.dumps(pending['stickerId'])+');',label=label)
if not peeled:raise RuntimeError('Peel failed')
c.evaluate('await window.__TAURI__.core.invoke("exit_edit_mode"); return true;',label=label)
record=dict(shell=shell,grabAnimation=grab,returnAnimation=returned,returnedWithoutPasting=True,printed=True,pasted=True,tag=tag,placement=placement,moved=moved,peeled=peeled,labels=labels)
(out/f'slice-07-{shell}-flow.json').write_text(json.dumps(record,indent=2));print(record)
