"""Verify native print sequencing/reprint gestures after all eight slices, on a disposable v7 fixture."""
import sys,importlib,time,json,subprocess,sqlite3,os
from pathlib import Path
c=importlib.import_module('port-capture')
dbpath=Path(os.environ["XDG_DATA_HOME"])/"app.peta.desktop/peta.db"
assert dbpath.resolve().is_relative_to(Path("/tmp")), "Disposable fixture required"
with sqlite3.connect(dbpath) as db:
    assert db.execute("PRAGMA user_version").fetchone()[0]==7
    assert not db.execute("SELECT * FROM print_queue").fetchall(), "Finish or clear the disposable queue first"
ev=c.evaluate
label=ev('return (await window.__TAURI__.webviewWindow.getAllWebviewWindows()).find(w=>w.label.startsWith("layer-")).label;')
def le(s):return ev(s,label=label)
def wait(s):
    start=time.monotonic()
    while not le('return Boolean('+s+');'):
        if time.monotonic()-start>30:raise TimeoutError(s)
        time.sleep(.1)
def drag(x,y,tx,ty):
    subprocess.run(['xdotool','mousemove',str(round(x)),str(round(y)),'mousedown','1'],check=True);time.sleep(.2)
    for i in range(1,11):subprocess.run(['xdotool','mousemove',str(round(x+(tx-x)*i/10)),str(round(y+(ty-y)*i/10))],check=True);time.sleep(.025)
    subprocess.run(['xdotool','mouseup','1'],check=True)
def point():return le('const r=document.querySelector(".print-sheet .stk").getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];')
ev('await Bridge.invoke("print_later"); await Bridge.invoke("exit_edit_mode"); await Bridge.window.hide(); return true;')
ids=[]
for _ in range(2):
    ev('await Bridge.invoke("creator_begin_path",{path:'+json.dumps(str(c.ROOT/'src/art/samples/coffee-cup.png'))+',materialId:"matte"}); return true;')
    start=time.monotonic()
    while ev('return (await Bridge.invoke("creator_info")).phase;')!='ready':
        assert time.monotonic()-start<30;time.sleep(.2)
    ev('await Bridge.invoke("creator_finish",{materialId:"matte",strength:.5,smooth:4/12,outline:20}); return true;')
    db=sqlite3.connect(Path(os.environ['XDG_DATA_HOME'])/'app.peta.desktop/peta.db');ids.append(db.execute('SELECT id FROM stickers ORDER BY rowid DESC LIMIT 1').fetchone()[0]);db.close()
ev('await Bridge.invoke("print_resume");return true;')
for id in ids:
    wait('document.querySelector(".print-sheet.ready")')
    assert le('return (await window.__TAURI__.core.invoke("print_pending")).stickerId;')==id
    x,y=point();drag(x,y,1000,600)
    wait('!(await window.__TAURI__.core.invoke("layer_placements")).every(p=>p.stickerId!=='+json.dumps(id)+')')
    # The preceding sheet remains while its hint fades, then retracts before another feed.
    assert le('return !document.querySelector(".print-sheet.ready") && Boolean(document.querySelector(".print-sheet"));')
    if id==ids[1]:wait('!document.querySelector(".print-sheet")')
# Reprint an already placed item; returning it must retain its old desktop placement.
original=le('return (await window.__TAURI__.core.invoke("layer_placements")).find(p=>p.stickerId==='+json.dumps(ids[0])+');')
ev('await Bridge.invoke("daily_stick_from_collection",{stickerId:'+json.dumps(ids[0])+'}); await Bridge.window.hide(); await Bridge.invoke("print_resume");return true;')
wait('document.querySelector(".print-sheet.ready")');x,y=point();drag(x,y,x+20,y+10);time.sleep(.5)
assert le('return (await window.__TAURI__.core.invoke("layer_placements")).find(p=>p.stickerId==='+json.dumps(ids[0])+');')==original
assert le('return Array.from(document.querySelectorAll(".sticker")).some(e=>e.style.transform.includes("translate3d("));')
assert le('return document.querySelector(".print-sheet img").style.visibility==="" && !document.querySelector(".print-grab");')
x,y=point();drag(x,y,1080,660);wait('!document.querySelector(".print-sheet")')
updated=le('return (await window.__TAURI__.core.invoke("layer_placements")).find(p=>p.stickerId==='+json.dumps(ids[0])+');')
assert updated['relativeX']!=original['relativeX'] and updated['relativeY']!=original['relativeY']
for id in ids:ev('await Bridge.invoke("peel_sticker",{stickerId:'+json.dumps(id)+'});return true;')
ev('await Bridge.invoke("exit_edit_mode");return true;')
record=dict(nativeFifoPasteTwoWithRetractionBeforeNextFeed=True,placedReprintReturnKeepsOriginal=True,placedReprintPasteMovesOriginal=True,original=original,updated=updated)
(c.ROOT/'docs/port-spec/compare/slice-07-motion.json').write_text(json.dumps(record,indent=2));print(record)
