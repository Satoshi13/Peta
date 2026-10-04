"""Native v7 rules regression on an isolated fixture; real commands, gestures and durable SQLite."""
import importlib,json,os,sqlite3,subprocess,time,sys
from pathlib import Path
c=importlib.import_module('port-capture');out=c.ROOT/'docs/port-spec/compare'
data=Path(os.environ['XDG_DATA_HOME'])/'app.peta.desktop';dbpath=data/'peta.db'
assert data.resolve().is_relative_to(Path('/tmp'))
def ev(s):return c.evaluate(s,timeout=60)
def wait(s,label=None):
    start=time.monotonic()
    while not c.evaluate('return Boolean('+s+');',label=label):
        if time.monotonic()-start>60:raise TimeoutError(s)
        time.sleep(.2)
def query(sql):
    with sqlite3.connect(dbpath) as db:return db.execute(sql).fetchall()
def stocks():return ev('return (await Bridge.invoke("material_book")).map(e=>[e.material.id,e.material.count]);')
def go(page):ev('await Bridge.invoke("print_later"); await Bridge.invoke("exit_edit_mode"); S.closeOutside=false; await Bridge.invoke("arrival_open"); await sleep(600); await Shell.open('+json.dumps(page)+'); return true;')
def click(sel):ev('document.querySelector('+json.dumps(sel)+').click(); return true;')
def gesture(sel,dx,dy):
    r=ev('const r=document.querySelector('+json.dumps(sel)+').getBoundingClientRect(),p=await Bridge.window.outerPosition();return {x:p.x+r.x+r.width*.5,y:p.y+r.y+30};')
    subprocess.run(['xdotool','mousemove',str(round(r['x'])),str(round(r['y']))]);time.sleep(.3)
    subprocess.run(['xdotool','mousedown','1']);time.sleep(.15)
    for i in range(1,21):
        subprocess.run(['xdotool','mousemove',str(round(r['x']+dx*i/20)),str(round(r['y']+dy*i/20))]);time.sleep(.03)
    subprocess.run(['xdotool','mouseup','1']);time.sleep(.3)
def finish(material):
    path=str(c.ROOT/'src/art/samples/coffee-cup.png')
    ev('await Bridge.invoke("print_later"); await Bridge.invoke("creator_begin_path",{path:'+json.dumps(path)+',materialId:'+json.dumps(material)+'}); return true;')
    wait('(await Bridge.invoke("creator_info")).phase==="ready"')
    ev('await Bridge.invoke("creator_finish",{materialId:'+json.dumps(material)+',strength:.5,smooth:4/12,outline:20}); return true;')
    return query('SELECT id FROM stickers ORDER BY rowid DESC LIMIT 1')[0][0]
def shelf(golden):
    for shell in ['studio','desk']:
        ev('Shell.setShell('+json.dumps(shell)+'); await Shell.open("packs"); return true;')
        c.capture(8,shell+'-11-packs-shelf')
        # Keep a separate native state after quota use, without modifying the reference.
        if golden:
            base=out/('slice-08-'+shell+'-11-packs-shelf')
            for ext in ['.jpg','-actual.png']:base.with_name(base.name+ext).rename(base.with_name(base.name+'-'+golden+ext))

resultpath=out/'slice-08-rules.json'
if len(sys.argv)>1 and sys.argv[1]=='restart':
    result=json.loads(resultpath.read_text());p=ev('return await Bridge.invoke("print_pending");')
    assert p['stickerId']==result['remainingHead']
    assert len(query('SELECT * FROM print_queue'))==result['remainingCount']
    assert not ev('return (await Bridge.invoke("pack_status")).canOpen;')
    book=ev('const months=await Bridge.invoke("book_index");return (await Promise.all(months.map(m=>Bridge.invoke("book_page",{year:m.year,month:m.month})))).flat().map(e=>e.stickerId);')
    assert all(row[0] in book for row in query('SELECT sticker_id FROM sticker_events'))
    gift=query("SELECT sticker_id FROM gifts_received WHERE gift_id='GIFT-PORT-NAO'")[0][0]
    ev('await Bridge.invoke("daily_stick_from_collection",{stickerId:'+json.dumps(gift)+'});await Bridge.reload();return true;')
    assert ev('return S.lib.find(e=>e.id=='+json.dumps(gift)+').kind;')=='received'
    assert len(query('SELECT * FROM print_queue'))==result['remainingCount']
    result['nativeBookAndReceivedReprint']=True
    result['nativeRestartRetainsQueueAndWelcome']=True;resultpath.write_text(json.dumps(result,indent=2));print(result);sys.exit()
assert query('PRAGMA user_version')[0][0]==7
assert not query('SELECT * FROM print_queue'), 'Use a fresh disposable v6 fixture'
opened=ev('const a=await Bridge.invoke("daily_open_material"); const before=await Bridge.invoke("material_book"); await Bridge.invoke("daily_open_material"); return {date:a.date,material:a.material.id,before,after:await Bridge.invoke("material_book")};')
assert opened['before']==opened['after']
matte_before=stocks();made=[finish('matte'),finish('matte')];assert matte_before==stocks()
assert ev('return (await Bridge.invoke("pack_status")).canOpen;'), 'Creation must not claim Welcome'
made.append(finish('kraft'));made.append(finish('holographic'))
exhausted=False
try:finish('kraft')
except RuntimeError as e:exhausted='material' in str(e).lower()
assert exhausted and len(query('SELECT * FROM print_queue'))==4
before_packs=stocks()
market=[ev('return await Bridge.invoke("pack_open",{packId:"coffee"});') for _ in range(2)]
assert before_packs==stocks() and market[1]['remaining']==market[0]['remaining']-1
assert ev('return (await Bridge.invoke("pack_status")).canOpen;'), 'Market must not claim Welcome'
go('packs');shelf('before')
click('.pack:not(:disabled)');wait('document.querySelector(".pouch")');time.sleep(1)
# Tear from the tab's left side, then pull the revealed sleeve.
r=ev('const r=document.querySelector(".pouch").getBoundingClientRect(),p=await Bridge.window.outerPosition();return {x:p.x+r.x+r.width*.14,y:p.y+r.y+r.height*.2,w:r.width};')
subprocess.run(['xdotool','mousemove',str(round(r['x'])),str(round(r['y'])),'mousedown','1']);time.sleep(.2)
for i in range(1,21):subprocess.run(['xdotool','mousemove',str(round(r['x']+r['w']*.9*i/20)),str(round(r['y']))]);time.sleep(.03)
subprocess.run(['xdotool','mouseup','1']);wait('document.querySelector(".pk-sleeve.out")');time.sleep(1)
gesture('.pk-sleeve',0,-240);wait('document.querySelector(".rv-btns .btn.paper")');time.sleep(1);click('.rv-btns .btn.paper');wait('!document.querySelector(".cer")')
assert not ev('return (await Bridge.invoke("pack_status")).canOpen;')
try:ev('return await Bridge.invoke("pack_open",{packId:"welcome"});');raise AssertionError('Second Welcome was allowed')
except RuntimeError as e:assert 'welcome_already_opened_today' in str(e)
assert before_packs==stocks()
go('packs');shelf('used')
gifts=[]
for giftid in ['GIFT-PORT-NAO','GIFT-PORT-YUKI']:
    go('gifts');ev('Cer.openGift(S.gifts.find(g=>g.id=='+json.dumps(giftid)+')); return true;');time.sleep(1)
    click('.wax');wait('S.gifts.find(g=>g.id=='+json.dumps(giftid)+').opened');time.sleep(.5)
    gesture('.gsleeve',0,-180);wait('document.querySelector(".rv-btns .btn.paper")');time.sleep(1);click('.rv-btns .btn.paper');wait('!document.querySelector(".cer")')
    gifts.append(giftid)
assert before_packs==stocks() and len(query('SELECT * FROM print_queue'))==9
assert len(query('SELECT * FROM sticker_events'))==9
# Paste two FIFO heads with real native mouse gestures and ensure the next sheet appears.
ev('await Bridge.window.hide(); await Bridge.invoke("print_resume"); return true;')
label=ev('return (await window.__TAURI__.webviewWindow.getAllWebviewWindows()).find(w=>w.label.startsWith("layer-")).label;')
for expected in made[:2]:
    wait('document.querySelector(".print-sheet.ready")',label)
    pending=c.evaluate('return await window.__TAURI__.core.invoke("print_pending");',label=label);assert pending['stickerId']==expected
    r=c.evaluate('const r=document.querySelector(".print-sheet .stk").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};',label=label)
    subprocess.run(['xdotool','mousemove',str(round(r['x'])),str(round(r['y']))]);time.sleep(.2);subprocess.run(['xdotool','mousedown','1']);time.sleep(.15)
    for i in range(1,21):subprocess.run(['xdotool','mousemove',str(round(r['x']+(1100-r['x'])*i/20)),str(round(r['y']+(600-r['y'])*i/20))]);time.sleep(.03)
    subprocess.run(['xdotool','mouseup','1']);wait('(await window.__TAURI__.core.invoke("print_pending")).stickerId!=='+json.dumps(expected),label)
remaining=ev('return await Bridge.invoke("print_pending");')
assert remaining['stickerId']==made[2]
assert len(query('SELECT * FROM print_queue'))==7
result=dict(date=opened['date'],oneMaterialPerDay=True,unlimitedMatte=True,made=made,finiteStockEnforced=exhausted,marketTwice=market,welcomeIndependentOnce=True,giftsTwice=gifts,noPackOrGiftMaterialCost=True,nativeFifoPasteTwo=True,allBookHistoryRetained=True,remainingHead=remaining['stickerId'],remainingCount=7,nativeRestartRetainsQueueAndWelcome=False)
resultpath.write_text(json.dumps(result,indent=2));print(result)
ev('await Bridge.invoke("print_later");await Bridge.invoke("exit_edit_mode");return true;')
