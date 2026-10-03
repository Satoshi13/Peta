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
def shot(name,golden=None):
    from PIL import Image,ImageDraw
    rect=ev('const p=await Bridge.window.outerPosition(),s=await Bridge.window.innerSize();return {x:p.x,y:p.y,width:s.width,height:s.height};')
    ids=subprocess.check_output(['xdotool','search','--name','^Peta$'],text=True).split()
    wid=next(i for i in ids if 'WIDTH='+str(rect['width']) in subprocess.check_output(['xdotool','getwindowgeometry','--shell',i],text=True))
    subprocess.run(['xdotool','windowactivate','--sync',wid],check=True);time.sleep(.7)
    subprocess.run(['import','-window','root','/tmp/peta-upgrade-root.png'],check=True)
    actual=Image.open('/tmp/peta-upgrade-root.png').crop((rect['x'],rect['y'],rect['x']+rect['width'],rect['y']+rect['height']))
    actual.save(out/(name+'.png'))
    if golden:
        ref=Image.open(c.ROOT/'docs/port-spec/golden'/(golden+'.jpg')).crop((190,79,1250,779))
        pair=Image.new('RGB',(2120,732),'#f5f0e6');pair.paste(ref,(0,32));pair.paste(actual,(1060,32));d=ImageDraw.Draw(pair);d.text((12,8),'Golden (unchanged)',fill='#2b2a28');d.text((1072,8),'Actual Tauri: all-period List / view switch',fill='#2b2a28');pair.save(out/(name+'-golden.jpg'),quality=90)
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
elif sys.argv[1]=='countdown':
    ev('S.closeOutside=false;await Shell.open("today");window.testIntervals=new Set();const start=window.setInterval.bind(window),stop=window.clearInterval.bind(window);window.setInterval=(fn,ms)=>{const id=start(fn,ms);window.testIntervals.add(id);return id;};window.clearInterval=id=>{window.testIntervals.delete(id);stop(id);};return true;')
    assert not ev('return Boolean(document.querySelector(".envelope-ticket")) || Pages.today.timer!==null;')
    ev('await Bridge.invoke("daily_open_material");await Bridge.reload();Shell.refresh();return true;')
    wait('document.querySelector(".envelope-ticket") && Pages.today.timer!==null')
    first=ev('return {text:document.querySelector(".envelope-clock").textContent,label:document.querySelector(".envelope-ticket").getAttribute("aria-label"),live:document.querySelector(".envelope-ticket").getAttribute("aria-live"),timers:window.testIntervals.size};');time.sleep(2.1)
    assert ev('return document.querySelector(".envelope-clock").textContent;')!=first['text'];assert first['live'] is None and first['timers']==1
    ev('await Shell.go("settings",{instant:true});return true;')
    assert ev('return Pages.today.timer===null && window.testIntervals.size===0;')
    ev('await Shell.go("today",{instant:true});await Shell.close();return true;')
    assert ev('return Pages.today.timer===null && window.testIntervals.size===0;')
    ev('await Bridge.window.show();await Shell.open("today");return true;')
    wait('Pages.today.timer!==null')
    ev('window.testRollovers=0;const changed=Bridge.changed;Bridge.changed=()=>{window.testRollovers++;return changed();};S.envelopeDeadline=Date.now()+500;Pages.today.resume();return true;');time.sleep(1.3)
    assert ev('return window.testRollovers>=1 && window.testIntervals.size===1;')
    ev('await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(1060,700));return true;')
    (out/'countdown.json').write_text(json.dumps(dict(first=first,unopenedHidden=True,secondsAdvance=True,noAriaLive=True,pageLeaveClearsInterval=True,windowHideClearsInterval=True,resumeOneInterval=True,boundaryCallsNativeReloadImmediately=True,actualMidnightAndDevNextDay='macOS checklist'),indent=2));print('Native countdown: display, ticking, leave/hide cleanup, resume and immediate boundary reload passed')
elif sys.argv[1]=='book':
    ev('S.closeOutside=false;S.bookView="list";S.motion="full";Bridge.savePreferences();BK.sel=null;await Bridge.invoke("print_later");await Shell.open("book");return true;')
    wait('document.querySelector(".tile-stk .stk img")?.naturalWidth')
    assert ev('return !document.querySelector("nav.months,.month-title") && document.querySelectorAll(".tile").length===S.lib.length;')
    ev('document.querySelector(".tile[data-sticker=\\"PETA-PORT-0010\\"]").click();return true;')
    wait('document.querySelector(".book-flip .stk img")?.naturalWidth')
    selection=ev('return BK.sel;')
    ev('document.querySelectorAll(".book-view button")[1].click();return true;')
    assert ev('return BK.sel;')==selection
    assert ev('return JSON.parse(localStorage.getItem("peta.preferences")).bookView;')=="calendar"
    wait('document.querySelector(".calendar-grid") && document.querySelector(".detail")')
    ev('document.querySelectorAll(".book-view button")[0].click();return true;')
    assert ev('return BK.sel;')==selection
    ev('BK.sel=null;Shell.refresh();return true;')
    records=[]
    src=(c.ROOT/'docs/ui-proposals/app/tools/audit.mjs').read_text();scan=src[src.index('const scan ='):src.index('\n{\n  const b =')]
    for shell in ['studio','desk']:
        for width,height in [(1060,700),(720,520)]:
            for mode in ['list','calendar']:
                ev('await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize('+str(width)+','+str(height)+'));Shell.setShell('+json.dumps(shell)+');S.bookView='+json.dumps(mode)+';S.bookMonth=monthKey(S.today);BK.sel=null;await Shell.open("book");await document.fonts.ready;return true;');time.sleep(1)
                result=ev(scan+'return {shell:S.shell,mode:S.bookView,size:[innerWidth,innerHeight],issues:scan(),grid:document.querySelector(".calendar-grid,.bk-grid").getBoundingClientRect().toJSON(),root:document.querySelector(".bookpage").getBoundingClientRect().toJSON(),scrollWidth:document.querySelector(".bookpage").scrollWidth,clientWidth:document.querySelector(".bookpage").clientWidth,aspectErrors:Array.from(document.querySelectorAll(".calendar-sticker .stk")).filter(e=>Math.abs(e.clientWidth/e.clientHeight-e.querySelector("img").naturalWidth/e.querySelector("img").naturalHeight)>.05).length};')
                assert result['scrollWidth']==result['clientWidth'] and result['aspectErrors']==0,result
                assert not result['issues'],result
                records.append(result);shot(shell+'-book-'+mode+'-'+str(width),shell+'-09-book' if mode=='list' and width==1060 else None)
    ev('await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(1060,700));Shell.setShell("studio");S.bookMonth=monthKey(S.today);S.bookView="calendar";await Shell.open("book");document.querySelector(".calendar-day[data-date=\\"2026-10-04\\"]").click();return true;')
    wait('document.querySelectorAll(".book-day-choices button").length>=2')
    latest=ev('return BK.sel;')
    ev('document.querySelectorAll(".book-day-choices button")[1].click();return true;')
    assert ev('return BK.sel;')!=latest
    wait('document.querySelector(".book-flip .stk img")?.naturalWidth')
    ev('document.querySelector(".book-flip").click();return true;')
    assert ev('return document.querySelector(".flip-inner").classList.contains("turned");')
    ev('document.querySelector(".detail .x").click();S.bookMonth=monthKey(new Date("2026-07-01T12:00:00"));Shell.refresh();return true;')
    assert ev('return document.querySelector(".calendar-heading p").textContent;')=='0 days stuck · 0 Petas'
    shot('studio-calendar-empty-month')
    ev('document.querySelector("[aria-label=\\"Next month\\"]").click();return true;');time.sleep(.7)
    assert ev('return S.bookMonth;')==2026*12+7
    ev('S.bookMonth=monthKey(S.today);Shell.refresh();return true;')
    assert ev('return document.querySelector("[aria-label=\\"Next month\\"]").disabled;')
    # Extra history exists only in this disposable SQLite fixture; no schema or product rules change.
    import sqlite3
    dbpath=Path(os.environ['XDG_DATA_HOME'])/'app.peta.desktop/peta.db'
    with sqlite3.connect(dbpath) as d:
        d.executemany('INSERT OR IGNORE INTO sticker_events VALUES (?,?,?)',[(f'2026-09-{day:02}','PETA-PORT-0010','collection') for day in range(1,31)])
    ev('await Bridge.reload();S.bookMonth=monthKey(new Date("2026-09-01T12:00:00"));Shell.refresh();return true;')
    assert ev('return document.querySelector(".calendar-complete").textContent;')=='30/30 COMPLETE'
    shot('studio-calendar-complete')
    ev('Shell.refresh();return true;')
    assert not ev('return document.querySelector(".calendar-complete").classList.contains("press");')
    with sqlite3.connect(dbpath) as d:
        import datetime
        start=datetime.date(2024,1,1)
        d.executemany('INSERT OR IGNORE INTO sticker_events VALUES (?,?,?)',[((start+datetime.timedelta(days=i)).isoformat(),'PETA-PORT-0010','collection') for i in range(400)])
    ev('await Bridge.reload();S.bookView="list";BK.sel=null;Shell.refresh();return true;');time.sleep(.5)
    lazy=ev('return {tiles:document.querySelectorAll(".tile").length,loaded:document.querySelectorAll(".tile-stk .stk").length};')
    assert lazy['tiles']>=400 and lazy['loaded']<lazy['tiles']/4,lazy
    ev('document.querySelector(".bookpage").scrollTop=document.querySelector(".bookpage").scrollHeight;return true;');time.sleep(.5)
    assert ev('return Boolean(Array.from(document.querySelectorAll(".tile-stk")).at(-1).querySelector(".stk"));')
    ev('await Shell.go("today",{instant:true});return true;');assert ev('return Pages.book.observer===null;')
    ev('await Shell.open("book");S.bookView="list";Shell.refresh();document.querySelector(".tile[data-sticker=\\"PETA-PORT-0012\\"]").click();return true;')
    wait('document.querySelector(".detail [data-action=peel]")')
    ev('document.querySelector(".detail [data-action=peel]").click();return true;')
    wait('document.querySelector(".detail [data-action=stick]")')
    ev('document.querySelectorAll(".book-view button")[1].click();document.querySelector(".detail [data-action=gift]").click();return true;')
    assert ev('return Boolean(document.querySelector(".gift-form"));')
    ev('document.querySelector(".gift-form button[type=button]").click();document.querySelector(".detail [data-action=stick]").click();return true;');time.sleep(.5)
    with sqlite3.connect(dbpath) as d: assert d.execute("SELECT 1 FROM print_queue WHERE sticker_id='PETA-PORT-0012'").fetchone()
    ev('await Bridge.invoke("print_later");return true;')
    (out/'book.json').write_text(json.dumps(dict(layouts=records,selectionPreserved=True,dayThumbnailsSwitch=True,clickToFlip=True,emptyMonthNavigation=True,noFutureMonth=True,completeOnce=True,lazy=lazy,observerDisconnectedOnLeave=True,preferencesSaved=True,listPeelCalendarGiftStick=True),indent=2));print('Native Book: two modes/shells/sizes, selection, thumbnails, flip, empty months, COMPLETE and lazy 400+ tiles passed')
elif sys.argv[1]=='book-empty':
    ev('S.closeOutside=false;S.bookView="calendar";S.motion="full";BK.sel=null;await Shell.open("book");return true;');time.sleep(1.6)
    wait('document.querySelector(".calendar-add").getAnimations().every(a=>a.playState!=="running")')
    ev('document.querySelector(".today-empty").click();return true;');wait('S.page==="today" && Shell.current.dataset.page==="today" && document.querySelector(".t-arrived")')
    ev('S.motion="reduce";Bridge.savePreferences();await Shell.open("book");return true;')
    assert ev('return getComputedStyle(document.querySelector(".calendar-add")).animationName;')=='none'
    records=[]
    for shell in ['studio','desk']:
        for mode in ['list','calendar']:
            ev('await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(720,520));Shell.setShell('+json.dumps(shell)+');S.bookView='+json.dumps(mode)+';BK.sel="PETA-PORT-0012";BK.day="2026-10-02";await Shell.open("book");return true;');time.sleep(.3)
            wait('document.querySelector(".bookpage").scrollWidth===document.querySelector(".bookpage").clientWidth && document.querySelector(".f-front .stk img")?.naturalWidth')
            result=ev('const r=document.querySelector(".bookpage"),g=document.querySelector(".bk-main");return {shell:S.shell,mode:S.bookView,detail:!!document.querySelector(".detail"),grid:g.getBoundingClientRect().toJSON(),root:r.getBoundingClientRect().toJSON(),scrollWidth:r.scrollWidth,clientWidth:r.clientWidth};')
            assert result['detail'] and result['scrollWidth']==result['clientWidth'],result
            records.append(result)
    (out/'book-empty.json').write_text(json.dumps(dict(todayPlusUsesExistingToday=True,finitePulseSettles=True,reducedMotionNoPulse=True,minimumDetails=records),indent=2));print('Native empty Today/finite pulse/reduced motion and four minimum detail states passed')
