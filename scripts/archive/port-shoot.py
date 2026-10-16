"""Native counterpart of shoot.mjs, selectable by port slice. Real gestures and Rust IPC."""
import importlib, json, time, subprocess, sys, sqlite3, os
from pathlib import Path
c=importlib.import_module('port-capture')
slice_id=int(sys.argv[1]); shell=sys.argv[2] if len(sys.argv)>2 else 'studio'
output_slice=int(sys.argv[3]) if len(sys.argv)>3 else slice_id
def wait_for(condition,timeout=30):
    start=time.monotonic()
    while not c.evaluate('return Boolean('+condition+');'):
        if time.monotonic()-start>timeout: raise TimeoutError(condition)
        time.sleep(.15)
def go(page): c.evaluate('await Bridge.window.show(); await Shell.open('+json.dumps(page)+'); return S.page;')
def click(sel): c.evaluate('document.querySelector('+json.dumps(sel)+').click(); return true;')
def shot(name): c.capture(output_slice,shell+'-'+name)
def gesture(sel,tear=False):
    r=c.evaluate('const r=document.querySelector('+json.dumps(sel)+').getBoundingClientRect(); return [r.left,r.top,r.width,r.height];')
    ids=subprocess.check_output(['xdotool','search','--name','^Peta$'],text=True).split()
    geom=next(subprocess.check_output(['xdotool','getwindowgeometry','--shell',i],text=True) for i in ids if any('WIDTH='+str(w) in subprocess.check_output(['xdotool','getwindowgeometry','--shell',i],text=True) for w in [1060,1440]))
    g=dict(line.split('=') for line in geom.splitlines() if '=' in line); x=int(g['X'])+r[0]+r[2]*(.14 if tear else .5); y=int(g['Y'])+r[1]+(r[3]*.2 if tear else 30)
    subprocess.run(['xdotool','mousemove',str(round(x)),str(round(y)),'mousedown','1'],check=True)
    for i in range(1,19 if tear else 15):
        subprocess.run(['xdotool','mousemove',str(round(x+i*r[2]*.06 if tear else x)),str(round(y if tear else y-i*16))],check=True); time.sleep(.025)
    subprocess.run(['xdotool','mouseup','1'],check=True)
c.evaluate('S.closeOutside=false; Shell.setShell('+json.dumps(shell)+'); return true;')
if slice_id==2:
    go('today'); shot('01-today-envelope'); click('.btn.open'); wait_for('document.querySelector(".pouch")'); time.sleep(1.5); shot('02-today-pouch')
    gesture('.pouch',True); wait_for('document.querySelector(".pouch.torn")'); time.sleep(1.5); shot('03-today-pouch-torn')
    gesture('.mcard.in-wrap'); wait_for('document.querySelector(".rv-btns .btn")'); time.sleep(2); shot('04-today-material-reveal')
    click('.rv-btns .btn'); wait_for('!Bridge.busy'); shot('05-today-opened')
elif slice_id==3:
    c.evaluate('BK.sel=null; S.bookMonth=null; return true;'); go('book'); shot('09-book'); click('.tile'); shot('10-book-detail'); click('.turn-row button'); time.sleep(.7)
    go('gifts'); shot('15-gifts'); go('materials'); shot('19-materials')
elif slice_id==4:
    c.evaluate('await Bridge.invoke("creator_cancel"); crReset(); if(S.stock.holographic>0) S.chosen="holographic"; return true;'); go('create'); shot('06-create-empty'); click('.sample:nth-child(3)'); wait_for('CR.stage==="ready" && CR.res',60); shot('07-create-cutting-mat')
elif slice_id==5:
    data=Path(os.environ['XDG_DATA_HOME'])/'app.peta.desktop'/'peta.db'
    if not data.resolve().is_relative_to(Path('/tmp')): raise RuntimeError('Disposable capture data required')
    db=sqlite3.connect(data)
    db.execute('UPDATE daily_records SET sticker_id=NULL,source_type=NULL,confirmed_at=NULL,used_at=NULL')
    db.execute("UPDATE pack_items SET opened_at=NULL,sticker_id=NULL WHERE pack_id='welcome'")
    db.commit();db.close()
    c.evaluate('Bridge.busy=false; document.querySelector(".cer")?.remove(); await Bridge.leaveCeremony(); await Bridge.invoke("print_later"); return true;')
    go('packs'); shot('11-packs-shelf'); click('.pack:not(:disabled)'); wait_for('document.querySelector(".pouch")'); shot('12-pack-ceremony')
    gesture('.pouch',True); wait_for('document.querySelector(".pk-sleeve.out")'); shot('13-pack-torn'); gesture('.pk-sleeve'); wait_for('document.querySelector(".rv-btns")'); time.sleep(2); shot('14-pack-reveal')
    click('.rv-btns .btn.paper'); wait_for('!document.querySelector(".cer")')
elif slice_id==6:
    c.evaluate('MK.tab="packs"; MK.sel=null; return true;'); go('market'); wait_for('document.querySelectorAll(".fan-s .stk").length===4',60); shot('16-market-packs'); click('.mk-seg button:nth-child(2)'); shot('17-market-materials'); click('.mk-seg button:nth-child(3)'); wait_for('document.querySelectorAll(".cr-av .stk").length===5',60); shot('18-market-creators')
