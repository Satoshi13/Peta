"""Real Book flip/edit/cancel/save/delete, original identity and desktop/print asset refresh."""
import importlib,json,subprocess,time,os,hashlib,sqlite3
from pathlib import Path
c=importlib.import_module('port-capture');out=c.ROOT/'docs/port-spec/compare/review-05'
data=Path(os.environ['XDG_DATA_HOME']).resolve();assert data.is_relative_to(Path('/tmp'))
def ev(s,label=None):return c.evaluate(s,timeout=90,label=label)
def wait(s):
    start=time.monotonic()
    while not ev('return Boolean('+s+');'):
        assert time.monotonic()-start<90,s;time.sleep(.15)
def ready():wait('CR.stage==="ready" && CR.res && document.querySelector(".g-go .btn:not(.paper)") && !document.querySelector(".g-go .btn:not(.paper)").disabled && document.querySelector(".stk-host img")?.naturalWidth')
def png(id):return hashlib.sha256(bytes(ev('return Array.from(new Uint8Array(await Bridge.invoke("sticker_asset",{stickerId:'+json.dumps(id)+'})));'))).hexdigest()
def preview():return hashlib.sha256(bytes(ev('return Array.from(new Uint8Array(await (await fetch(CR.res.url)).arrayBuffer()));'))).hexdigest()
def book(id):
    ev('await Bridge.reload();const e=S.lib.find(e=>e.id==='+json.dumps(id)+');BK.sel=e.id;BK.gift=false;BK.deleteId=null;S.bookMonth=monthKey(e.date);await Shell.open("book");return true;')
    wait('document.querySelector(".f-front .stk img")?.naturalWidth');time.sleep(.5)
def click(action):ev('document.querySelector('+json.dumps('.detail [data-action="'+action+'"]')+').click();return true;')
def win():
    ids=subprocess.check_output(['xdotool','search','--name','^Peta$'],text=True).split()
    return next(i for i in ids if 'WIDTH=1060' in subprocess.check_output(['xdotool','getwindowgeometry','--shell',i],text=True))
def shot(name):time.sleep(.3);subprocess.run(['import','-window',win(),str(out/(name+'.png'))],check=True)
def settings(outline):ev('const i=document.querySelector(".g-look input[type=range]");i.value='+str(outline)+';i.dispatchEvent(new Event("input",{bubbles:true}));return true;');time.sleep(.5);ready()
def cancel():ev('document.querySelector(".g-go .btn.paper").click();return true;');wait('S.page==="book" && CR.stage==="empty"');time.sleep(.4)
def dbstate(id):
    with sqlite3.connect(data/'app.peta.desktop/peta.db') as db:
        return dict(sticker=db.execute('SELECT id,created_at,original_number,material_id,original_asset_path FROM stickers WHERE id=?',(id,)).fetchone(),placement=db.execute('SELECT * FROM placements WHERE sticker_id=?',(id,)).fetchone(),count=db.execute('SELECT COUNT(*) FROM stickers').fetchone()[0],stock=db.execute("SELECT count FROM material_stock WHERE material_id='holographic'").fetchone()[0],nextNumber=db.execute("SELECT value FROM meta WHERE key='next_original_number'").fetchone(),queue=db.execute('SELECT sticker_id FROM print_queue ORDER BY seq').fetchall())
records={}
ev('S.closeOutside=false;await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(1060,700));Shell.setShell("studio");await Shell.open("book");return true;')
# Cancelling while the model/editor loads must not resurrect a stale editing session.
records['cancelLoading']=ev('await Bridge.invoke("creator_edit_original",{stickerId:"PETA-PORT-0010"});await Bridge.invoke("creator_cancel");await sleep(1800);await crSync();return (await Bridge.invoke("creator_info")).phase;');assert records['cancelLoading']=='idle'
book('PETA-PORT-0010');subprocess.run(['xdotool','windowactivate','--sync',win()],check=True)
r=ev('const r=document.querySelector(".book-flip").getBoundingClientRect(),p=await Bridge.window.outerPosition();return {x:p.x+r.x+r.width/2,y:p.y+r.y+r.height/2};')
subprocess.run(['xdotool','mousemove',str(round(r['x'])),str(round(r['y'])),'click','1'],check=True);time.sleep(.8)
assert ev('return document.querySelector(".flip-inner").classList.contains("turned") && !document.querySelector(".turn-row");');shot('studio-book-clicked-back')
subprocess.run(['xdotool','key','space'],check=True);time.sleep(.8);assert ev('return !document.querySelector(".flip-inner").classList.contains("turned");')
subprocess.run(['xdotool','key','Return'],check=True);time.sleep(.8);assert ev('return document.querySelector(".flip-inner").classList.contains("turned");');records['mouseAndKeyboardFlip']=True
old=png('PETA-PORT-0010');click('edit');ready();settings(48);cancel();assert png('PETA-PORT-0010')==old;records['legacyEditCancelUnchanged']=True
# Create a real Holographic original, consuming its last material, then edit that same sticker.
ev('await Bridge.invoke("creator_cancel");crReset();CR.border=32;CR.smooth=4;S.chosen="holographic";await Shell.open("create");await crLoadSample("sBubble");return true;');ready();originalPreview=preview()
ev('document.querySelector(".g-go .btn:not(.paper)").click();return true;');wait('CR.stage==="empty" && !Bridge.busy');time.sleep(.8)
id=ev('return (await Bridge.invoke("print_pending")).stickerId;');assert png(id)==originalPreview
layer=ev('return (await window.__TAURI__.webviewWindow.getAllWebviewWindows()).find(w=>w.label.startsWith("layer-")).label;')
ev('await Bridge.invoke("print_paste",{stickerId:'+json.dumps(id)+',x:.62,y:.45,relativeScale:.1});await Bridge.invoke("print_later");await Bridge.invoke("exit_edit_mode");return true;');time.sleep(1)
ev('await Bridge.printAction("daily_stick_from_collection",{stickerId:'+json.dumps(id)+'});await Bridge.printAction("print_resume");await sleep(3200);return true;')
before=dbstate(id);assert before['stock']==0 and before['queue']==[(id,)]
book(id);click('edit');ready();assert ev('return S.chosen==="holographic" && CR.border===32 && !document.querySelector(".g-mat button");');assert preview()==originalPreview
subprocess.run(['xdotool','windowactivate','--sync',win()],check=True);time.sleep(.8)
point=ev('const cv=document.querySelector("canvas.cut"),r=cv.getBoundingClientRect(),a=cv.getContext("2d").getImageData(0,0,cv.width,cv.height).data;let x=Math.floor(cv.width/2),y=Math.floor(cv.height/2);let best=-1;for(let v=15;v<cv.height-15;v+=4){for(let u=15;u<cv.width-15;u+=4){let n=0;for(const dy of [-9,0,9])for(const dx of [-9,0,9])if(a[((v+dy)*cv.width+u+dx)*4+3]>240)n++;if(n>best){best=n;x=u;y=v;}}if(best===9)break;}const k=Math.min(r.width/cv.width,r.height/cv.height),p=await Bridge.window.outerPosition();return {x:p.x+r.x+(r.width-cv.width*k)/2+x*k,y:p.y+r.y+(r.height-cv.height*k)/2+y*k};')
subprocess.run(['xdotool','mousemove',str(round(point['x'])),str(round(point['y'])),'mousedown','1','mouseup','1'],check=True);ready();assert ev('return CR.history.canUndo;');edited=preview();assert edited!=originalPreview
subprocess.run(['xdotool','mousemove','20','20'],check=True)
ev('document.querySelectorAll(".g-tools .btn.paper")[0].click();return true;');time.sleep(.3);ready();assert preview()==originalPreview
ev('document.querySelectorAll(".g-tools .btn.paper")[1].click();return true;');time.sleep(.3);ready();assert preview()==edited
settings(44);edited=preview();shot('studio-original-editing')
ev('document.querySelector(".g-go .btn:not(.paper)").click();return true;');wait('S.page==="book" && !Bridge.busy && CR.stage==="empty"');time.sleep(1)
after=dbstate(id);assert before==after,(before,after);assert png(id)==edited and edited!=originalPreview
# The existing desktop node must receive the new PNG, not a stale cached asset.
layerHashes=ev('return await Promise.all(Array.from(document.querySelectorAll("#layer > .sticker .body > img")).map(async i=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await (await fetch(i.src)).arrayBuffer()))).map(v=>v.toString(16).padStart(2,"0")).join("")));',layer)
assert edited in layerHashes and originalPreview not in layerHashes,layerHashes
printHash=ev('const i=document.querySelector(".print-stage .sheet-stk img");return i ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await (await fetch(i.src)).arrayBuffer()))).map(v=>v.toString(16).padStart(2,"0")).join("") : null;',layer);assert printHash==edited,printHash
records['sameOriginalSaved']=dict(id=id,before=before,after=after,originalPng=originalPreview,editedPng=edited,desktopHashes=layerHashes,printHash=printHash,undoRedo=True)
book(id);click('edit');ready();assert preview()==edited and ev('return CR.border===44 && !CR.history.canUndo && S.stock.holographic===0;');cancel();records['savedCutoutReopensExactly']=True
book(id);click('delete');assert ev('return !!document.querySelector(".book-delete");');shot('studio-delete-confirm');click('delete-cancel');assert png(id)==edited;records['deleteCancelUnchanged']=True
# A queued reprint and its desktop node are removed with the original; remaining entries survive.
ev('await Bridge.printAction("daily_stick_from_collection",{stickerId:'+json.dumps(id)+'});return true;');time.sleep(1);book(id);click('delete');click('delete-confirm');wait('!Bridge.busy && !S.lib.some(e=>e.id==='+json.dumps(id)+')');time.sleep(1)
assert ev('return !(await Bridge.invoke("print_pending")) && await Bridge.window.isVisible();')
deleted=dbstate(id);assert deleted['sticker'] is None and deleted['placement'] is None and deleted['stock']==0 and deleted['count']==before['count']-1
layerState=ev('return {images:await Promise.all(Array.from(document.querySelectorAll("#layer > .sticker .body > img")).map(async i=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await (await fetch(i.src)).arrayBuffer()))).map(v=>v.toString(16).padStart(2,"0")).join(""))),printStage:!!document.querySelector(".print-stage")};',layer)
assert edited not in layerState['images'] and not layerState['printStage'];records['deleteClearsBookDesktopQueue']=dict(state=deleted,layer=layerState)
# A received sticker shows Gift/Stick only and cannot bypass the backend guard.
gift=ev('return await Bridge.invoke("gift_open",{giftId:"GIFT-PORT-NAO"});');received=gift;book(received)
assert ev('return !document.querySelector("[data-action=edit]") && !document.querySelector("[data-action=delete]");')
for cmd in ['creator_edit_original','sticker_delete_original']:
    result=ev('try{await Bridge.invoke('+json.dumps(cmd)+',{stickerId:'+json.dumps(received)+'});return false;}catch(e){return String(e);}');assert result and 'only your original' in result;records[cmd+'ReceivedRejected']=result
# Simulate stale client permissions: Rust refuses, and the asynchronous error leaves Cancel/Delete usable.
ev('S.lib.find(e=>e.id==='+json.dumps(received)+').canManage=true;Shell.refresh();return true;')
click('delete');click('delete-confirm');wait('!Bridge.busy')
assert ev('return !document.querySelector("[data-action=delete-confirm]").disabled && S.lib.some(e=>e.id==='+json.dumps(received)+');')
records['rejectedDeletionKeepsEntryAndEnablesButton']=True
book('PETA-PORT-0010');ev('await Bridge.invoke("print_later");return true;')
(out/'verification.json').write_text(json.dumps(records,indent=2));print('Verified real Book flip, original edit/undo/redo/save/reopen/cancel/delete and refreshed desktop/print assets')
