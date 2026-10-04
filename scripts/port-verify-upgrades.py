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
if sys.argv[1]=='peel':
    from PIL import Image, ImageDraw
    out=c.ROOT/'docs/port-spec/compare/review-06';out.mkdir(exist_ok=True)
    wid=subprocess.check_output(['xdotool','search','--name','^Peta Layer$'],text=True).split()[0]
    def mouse(*args):subprocess.run(['xdotool',*map(str,args)],check=True)
    def le(s):return ev(s,layer)
    def positions():return le('return await window.__TAURI__.core.invoke("layer_placements");')
    def grab(id):
        p=next(p for p in positions() if p['stickerId']==id)
        return round(p['relativeX']*1440),round(p['relativeY']*900)
    def begin(id):
        x,y=grab(id);mouse('mousemove',x,y,'keydown','Alt_L','mousedown','1');time.sleep(.12);return x,y
    def release():mouse('mouseup','1','keyup','Alt_L');wait('!document.querySelector(".peeling,.peel-curl")',layer)
    def frame():
        subprocess.run(['import','-window',wid,'/tmp/peta-peel-frame.png'],check=True)
        return Image.open('/tmp/peta-peel-frame.png').crop((100,360,530,760)).convert('RGB')
    ev('S.closeOutside=false;await Bridge.invoke("print_later");await Bridge.window.hide();await Bridge.invoke("print_resume");return true;')
    wait('document.querySelector(".print-sheet.ready")',layer)
    x,y=le('const r=document.querySelector(".print-sheet .stk").getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];')
    mouse('mousemove',round(x),round(y),'mousedown','1');time.sleep(.2)
    for i in range(1,11):mouse('mousemove',round(x+(900-x)*i/10),round(y+(280-y)*i/10));time.sleep(.025)
    mouse('mouseup','1');wait('(await window.__TAURI__.core.invoke("layer_info")).editMode',layer)
    wait('!document.querySelector(".print-sheet")',layer)
    le('window.peelHaptics=[];const tap=Haptic.tap.bind(Haptic);Haptic.tap=kind=>{if(Haptic.on)window.peelHaptics.push(kind);tap(kind);};applyLayerPreferences({motion:"full",sound:false,haptics:true});window.peelErrors=[];window.addEventListener("error",e=>window.peelErrors.push(e.message));window.peelFrames=0;const raf=requestAnimationFrame;window.requestAnimationFrame=fn=>{window.peelFrames++;return raf(fn);};return true;')
    baseline=positions();ev('await Bridge.reload();return true;');stock=ev('return S.stock;')
    x,y=begin('PETA-PORT-0011');mouse('mousemove',x+60,y);wait('document.querySelectorAll(".peel-strip").length===12',layer)
    attached=le('const n=document.querySelector(".peeling");window.peelMutations=0;window.peelObserver=new MutationObserver(records=>window.peelMutations+=records.length);window.peelObserver.observe(n,{subtree:true,attributes:true,attributeFilter:["style"]});return {transform:n.style.transform,clip:n.querySelector(".body").style.clipPath,back:getComputedStyle(n.querySelector(".peel-back")).backgroundImage};')
    time.sleep(.4);assert le('return window.peelMutations;')==0
    frame().save(out/'peel-after.png');release();le('window.peelObserver.disconnect();return true;')
    assert positions()==baseline and le('return window.peelHaptics.length;')==0
    records=[]
    for id,dx,dy in [('PETA-PORT-0010',-35,30),('PETA-PORT-0012',0,-55)]:
        x,y=begin(id);mouse('mousemove',x+dx,y+dy);wait('document.querySelectorAll(".peel-strip").length===12',layer)
        records.append(le('const n=document.querySelector(".peeling");return {material:n.dataset.material,clip:n.querySelector(".body").style.clipPath,paper:getComputedStyle(n.querySelector(".peel-back")).backgroundImage};'))
        release();assert positions()==baseline
    x,y=begin('PETA-PORT-0012');mouse('mousemove',x+100,y);wait('document.querySelector(".peel-ready")',layer)
    le('document.querySelector("#layer").dispatchEvent(new PointerEvent("pointercancel",{pointerId:1,clientX:1079,clientY:450}));return true;');release();assert positions()==baseline
    movie=[frame()];x,y=begin('PETA-PORT-0011')
    for dx in range(10,91,10):mouse('mousemove',x+dx,y);time.sleep(.06);movie.append(frame())
    assert le('return Boolean(document.querySelector(".peel-ready"));')
    mouse('mouseup','1','keyup','Alt_L')
    for _ in range(5):time.sleep(.06);movie.append(frame())
    wait('!(await window.__TAURI__.core.invoke("layer_placements")).some(p=>p.stickerId==="PETA-PORT-0011")',layer)
    assert le('return window.peelHaptics;')==['peel']
    ev('await Bridge.reload();return true;');assert ev('return S.lib.some(e=>e.id==="PETA-PORT-0011" && !e.onDesktop);')
    movie.extend([frame()]*4);movie[0].save(out/'peel-motion.gif',save_all=True,append_images=movie[1:],duration=100,loop=0)
    before=Image.open('/tmp/peta-peel-before.png').crop((100,360,530,760)).convert('RGB');after=Image.open(out/'peel-after.png')
    pair=Image.new('RGB',(860,428),'#f5f0e6');pair.paste(before,(0,28));pair.paste(after,(430,28));draw=ImageDraw.Draw(pair);draw.text((10,7),'Before: rigid hinge',fill='#2b2a28');draw.text((440,7),'Actual Tauri: curled paper / same pull',fill='#2b2a28');pair.save(out/'peel-comparison.png')
    le('applyLayerPreferences({motion:"reduce",sound:false,haptics:true});return true;')
    x,y=begin('PETA-PORT-0010');mouse('mousemove',x+20,y);time.sleep(.15)
    assert le('return !document.querySelector(".peel-curl") && document.querySelector(".peeling .body").style.clipPath==="";');release()
    x,y=begin('PETA-PORT-0010');mouse('mousemove',x+100,y);time.sleep(.15);release()
    assert le('return window.peelHaptics;')==['peel','peel']
    le('applyLayerPreferences({motion:"full",sound:false,haptics:false});return true;')
    x,y=begin('PETA-PORT-0012');mouse('mousemove',x+55,y);wait('document.querySelector(".peel-curl")',layer)
    le('applyLayerPreferences({motion:"reduce",sound:false,haptics:false});return true;')
    assert le('return !document.querySelector(".peel-curl");');release()
    le('applyLayerPreferences({motion:"full",sound:false,haptics:false});return true;')
    x,y=begin('PETA-PORT-0012');mouse('mousemove',x+90,y);wait('document.querySelector(".peel-ready")',layer)
    le('await window.__TAURI__.core.invoke("exit_edit_mode");return true;');mouse('mouseup','1','keyup','Alt_L')
    wait('!document.querySelector(".peel-curl,.peeling")',layer)
    assert any(p['stickerId']=='PETA-PORT-0012' for p in positions())
    le('applyLayerPreferences({motion:"reduce",sound:false,haptics:false});return true;');time.sleep(.8)
    frames=le('return window.peelFrames;');time.sleep(.5);assert le('return window.peelFrames;')==frames
    assert le('return window.peelHaptics;')==['peel','peel'] and not le('return window.peelErrors;')
    ev('await Bridge.reload();return true;');assert ev('return S.stock;')==stock
    (out/'peel.json').write_text(json.dumps(dict(actualNativeMousePrintPaste=True,attached=attached,stationaryCurlDoesNotUpdate=True,partialReturnKeepsPlacement=True,materialPapers=records,pointerCancelDoesNotPeel=True,successfulPeelOnce=True,peeledStickerRemainsInBook=True,reduceMotionNoCurl=True,reducedSuccessOnce=True,reduceDuringPullClearsCurl=True,escapeDuringPullReturnsPaper=True,idleRafStops=True,stockUnchanged=True,errors=[]),indent=2))
    print('Native peel: mouse curl/return/commit, three materials, interruptions, Reduce motion, one-shot haptics and idle cleanup passed')
elif sys.argv[1]=='market-owned':
    from PIL import Image, ImageDraw
    out=c.ROOT/'docs/port-spec/compare/review-07';out.mkdir(exist_ok=True)
    def click(expression):
        p=ev('const e=('+expression+');e.scrollIntoView({block:"nearest",behavior:"instant"});await new Promise(requestAnimationFrame);await sleep(80);const r=e.getBoundingClientRect(),w=await Bridge.window.outerPosition();return {x:w.x+r.x+r.width/2,y:w.y+r.y+r.height/2};')
        subprocess.run(['xdotool','mousemove',str(round(p['x'])),str(round(p['y'])),'click','1'],check=True)
    def capture(name):
        width=ev('return innerWidth;')
        windows=subprocess.check_output(['xdotool','search','--name','^Peta$'],text=True).split()
        wid=next(w for w in windows if 'WIDTH='+str(width) in subprocess.check_output(['xdotool','getwindowgeometry','--shell',w],text=True))
        subprocess.run(['xdotool','windowactivate','--sync',wid],check=True);time.sleep(.2)
        rect=ev('const p=await Bridge.window.outerPosition();return {x:p.x,y:p.y,w:innerWidth,h:innerHeight};')
        subprocess.run(['import','-window','root','/tmp/peta-market-review07-root.png'],check=True)
        actual=Image.open('/tmp/peta-market-review07-root.png').crop((rect['x'],rect['y'],rect['x']+rect['w'],rect['y']+rect['h'])).convert('RGB')
        actual.save(out/(name+'.png'));return actual
    def market(shell='studio',width=1060,height=700):
        ev('S.closeOutside=false;MK.tab="packs";MK.sel=null;await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize('+str(width)+','+str(height)+'));Shell.setShell('+json.dumps(shell)+');await Shell.open("market");await document.fonts.ready;return true;')
        wait('document.querySelector(".fan .stk img")?.naturalWidth');wait('!document.querySelector("#toast.on")');time.sleep(.15)
    def status():return ev('return await Bridge.invoke("pack_status");')
    ev('S.closeOutside=false;S.motion="reduce";Bridge.savePreferences();await Bridge.invoke("exit_edit_mode");await Bridge.invoke("print_later");await Bridge.window.show();window.marketCalls=[];const invoke=Bridge.invoke;Bridge.invoke=(name,args)=>{if(name==="pack_install_demo" || name==="pack_open")window.marketCalls.push(name);return invoke(name,args);};return true;')
    market();assert not ev('return Market.own("plants");')
    ev('Array.from(document.querySelectorAll(".mk-tile")).find(e=>e.textContent.includes("Houseplants")).scrollIntoView({block:"center",behavior:"instant"});return true;');time.sleep(.15)
    click('Array.from(document.querySelectorAll(".mk-tile")).find(e=>e.textContent.includes("Houseplants"))');wait('document.querySelector(".mk-detail .btn")')
    ev('document.querySelector(".mk-detail .btn").scrollIntoView({block:"center",behavior:"instant"});return true;');time.sleep(.15)
    click('document.querySelector(".mk-detail .btn")');wait('Market.own("plants") && document.querySelector(".mk-detail .btn").textContent==="On your shelf"')
    baseline=status();stock=ev('return S.stock;')
    assert not ev('return document.querySelector(".mk-detail .btn").disabled;')
    ev('document.querySelector(".mk-detail .btn").scrollIntoView({block:"center",behavior:"instant"});return true;');time.sleep(.15)
    click('document.querySelector(".mk-detail .btn")');wait('Shell.current.dataset.page==="packs" && document.activeElement.dataset.pack==="plants"')
    assert status()==baseline and not ev('return Boolean(document.querySelector(".cer"));')
    records=[]
    for shell in ['studio','desk']:
        for width,height in [(1060,700),(720,520)]:
            market(shell,width,height);capture(shell+'-market-'+str(width))
            click('document.querySelector(".mk-hero .btn")');wait('Shell.current.dataset.page==="packs" && document.activeElement.dataset.pack==="tokyo"')
            assert status()==baseline
            market(shell,width,height)
            ev('Array.from(document.querySelectorAll(".mk-tile")).find(e=>e.textContent.includes("Houseplants")).scrollIntoView({block:"center",behavior:"instant"});return true;');time.sleep(.15)
            badge=ev('const tile=Array.from(document.querySelectorAll(".mk-tile")).find(e=>e.textContent.includes("Houseplants")),b=tile.querySelector(".price.own"),s=getComputedStyle(b),tag=tile.querySelector(".pack-tag").getBoundingClientRect(),r=b.getBoundingClientRect(),page=document.querySelector(".marketpage");return {shell:S.shell,size:[innerWidth,innerHeight],label:tile.getAttribute("aria-label"),background:s.backgroundImage,color:s.color,font:s.fontFamily,spacing:s.letterSpacing,marker:getComputedStyle(b,"::before").content,overflow:page.scrollWidth-page.clientWidth,clip:{x:r.x+r.width/2-110,y:tag.top-8,bottom:r.bottom+12}};')
            assert badge['background']=='none' and badge['spacing'] in ['normal','0px'] and badge['overflow']==0 and '✓' in badge['marker'],badge
            actual=capture(shell+'-owned-'+str(width));records.append(badge)
            if shell=='studio' and width==1060:
                r=badge['clip'];after=actual.crop((round(r['x']),round(r['y']),round(r['x']+220),round(r['bottom'])));after.save(out/'badge-after.png')
                ev('const sheet=Array.from(document.styleSheets).find(s=>s.href?.endsWith("/native.css"));window.ownedRules=Array.from(sheet.cssRules).map((r,i)=>({text:r.cssText,i})).filter(r=>r.text.startsWith(".marketpage .price.own"));window.ownedRules.slice().reverse().forEach(r=>sheet.deleteRule(r.i));return true;');time.sleep(.4)
                r=ev('const t=Array.from(document.querySelectorAll(".mk-tile")).find(e=>e.textContent.includes("Houseplants")),tag=t.querySelector(".pack-tag").getBoundingClientRect(),b=t.querySelector(".price.own").getBoundingClientRect();return {x:b.x+b.width/2-110,y:tag.top-8,bottom:b.bottom+12};')
                before=capture('studio-owned-before');before=before.crop((round(r['x']),round(r['y']),round(r['x']+220),round(r['bottom'])));before.save(out/'badge-before.png')
                ev('const sheet=Array.from(document.styleSheets).find(s=>s.href?.endsWith("/native.css"));window.ownedRules.forEach(r=>sheet.insertRule(r.text,r.i));return true;');time.sleep(.15)
                pair=Image.new('RGB',(440,max(before.height,after.height)+28),'#f5f0e6');pair.paste(before,(0,28));pair.paste(after,(220,28));draw=ImageDraw.Draw(pair);draw.text((10,7),'Before',fill='#2b2a28');draw.text((230,7),'Actual Tauri',fill='#2b2a28');pair.save(out/'badge-comparison.png')
            click('Array.from(document.querySelectorAll(".mk-tile")).find(e=>e.textContent.includes("Houseplants")).querySelector(".price.own")')
            wait('Shell.current.dataset.page==="packs" && document.activeElement.dataset.pack==="plants"')
            wait('(()=>{const r=document.activeElement.getBoundingClientRect(),v=document.querySelector(".packspage").getBoundingClientRect();return r.top>=v.top-1 && r.bottom<=v.bottom+1;})()')
            visible=ev('const r=document.activeElement.getBoundingClientRect(),v=document.querySelector(".packspage").getBoundingClientRect();return {pack:document.activeElement.dataset.pack,visible:r.top>=v.top-1 && r.bottom<=v.bottom+1,ceremony:!!document.querySelector(".cer")};')
            assert visible['visible'] and not visible['ceremony'] and status()==baseline,visible
    market();ev('Array.from(document.querySelectorAll(".mk-tile")).find(e=>e.textContent.includes("Pixel Dream")).scrollIntoView({block:"center",behavior:"instant"});return true;');time.sleep(.15)
    click('Array.from(document.querySelectorAll(".mk-tile")).find(e=>e.textContent.includes("Pixel Dream"))');wait('document.querySelector(".mk-detail .btn")')
    ev('document.querySelector(".mk-detail .btn").click();return true;');assert not ev('return Market.own("pixel");') and status()==baseline
    ev('S.motion="full";Bridge.savePreferences();MK.sel=null;Shell.refresh();return true;');time.sleep(.6)
    ev('document.querySelector(".mk-hero .btn").click();return true;');wait('Shell.current.dataset.page==="packs" && document.activeElement.dataset.pack==="tokyo"')
    market();ev('const tile=Array.from(document.querySelectorAll(".mk-tile")).find(e=>e.textContent.includes("Coffee Club"));tile.scrollIntoView({block:"center",behavior:"instant"});tile.focus({preventScroll:true});return true;');time.sleep(.15)
    subprocess.run(['xdotool','key','Return'],check=True);wait('Shell.current.dataset.page==="packs" && document.activeElement.dataset.pack==="coffee"')
    assert status()==baseline and ev('return S.stock;')==stock
    assert ev('return window.marketCalls;')==['pack_install_demo']
    (out/'market.json').write_text(json.dumps(dict(layouts=records,ownedHeroTileAndDetailNavigate=True,targetPackVisibleAndFocused=True,keyboardEnterNavigate=True,freeGetInstallsOnce=True,paidGetRemainsUnavailable=True,noPackOpened=True,countsAndStockUnchangedOnNavigation=True,reducedAndFullMotionNavigate=True),indent=2))
    print('Native Market: owned hero/tile/detail -> targeted Packs, both shells/sizes, free/paid controls and unchanged counts passed')
elif sys.argv[1]=='countdown-layout':
    from PIL import Image,ImageDraw
    out=c.ROOT/'docs/port-spec/compare/review-08';out.mkdir(exist_ok=True)
    ev('S.closeOutside=false;S.motion="reduce";Bridge.savePreferences();await Bridge.invoke("print_later");await Bridge.window.show();await Bridge.reload();return true;')
    assert ev('return S.dayState==="opened";')
    records=[]
    for shell in ['studio','desk']:
        for width,height in [(1060,700),(720,520)]:
            ev('await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize('+str(width)+','+str(height)+'));Shell.setShell('+json.dumps(shell)+');await Shell.open("today");await document.fonts.ready;return true;');time.sleep(.3)
            r=ev('const p=document.querySelector(".today"),t=p.querySelector(".envelope-ticket"),clock=t.querySelector(".envelope-clock"),before=p.scrollHeight;Pages.today.suspend();t.style.display="none";const without=p.scrollHeight;t.style.display="";const widths=["00:00:00","11:11:11","88:88:88","25:59:59"].map(text=>{Array.from(clock.children).forEach((e,i)=>e.textContent=text[i]);return {ticket:t.getBoundingClientRect().width,clock:clock.getBoundingClientRect().width,cells:Array.from(clock.children,e=>e.getBoundingClientRect().width)};});Pages.today.resume();const a=t.getBoundingClientRect(),b=p.querySelector(".ph-text").getBoundingClientRect(),v=p.getBoundingClientRect();return {shell:S.shell,width:innerWidth,height:innerHeight,scrollHeight:before,withoutTicket:without,viewport:p.clientHeight,added:before-without,widths,inHeader:t.closest(".ph")!==null,visible:a.top>=v.top && a.bottom<=v.bottom && a.right<=v.right,noTitleOverlap:a.left>=b.right,noAriaLive:!t.hasAttribute("aria-live")};')
            assert r['added']==0 and r['inHeader'] and r['visible'] and r['noTitleOverlap'] and r['noAriaLive'],r
            assert all(w==r['widths'][0] for w in r['widths']),r
            records.append(r)
            shot(shell+'-'+str(width)+'-after')
            before=Image.open(out/(shell+'-'+str(width)+'-before.png'));after=Image.open(out/(shell+'-'+str(width)+'-after.png'))
            pair=Image.new('RGB',(width*2,height+28),'#f5f0e6');pair.paste(before,(0,28));pair.paste(after,(width,28));d=ImageDraw.Draw(pair);d.text((12,7),'Before',fill='#2b2a28');d.text((width+12,7),'Actual Tauri: header ticket / fixed digits',fill='#2b2a28');pair.save(out/(shell+'-'+str(width)+'-comparison.jpg'),quality=90)
            if width==1060:
                ref=Image.open(c.ROOT/'docs/port-spec/golden'/(shell+'-05-today-opened.jpg')).crop((190,79,1250,779))
                pair.paste(ref,(0,28));d.text((12,7),'Golden (unchanged)',fill='#2b2a28');pair.save(out/(shell+'-golden.jpg'),quality=90)
    first=ev('return document.querySelector(".envelope-clock").textContent;');time.sleep(2.1)
    assert ev('return document.querySelector(".envelope-clock").textContent;')!=first
    ev('await Shell.go("settings");return true;');assert ev('return Pages.today.timer===null;')
    ev('await Shell.go("today");return true;');assert ev('return Pages.today.timer!==null;')
    ev('await Shell.close();return true;');assert ev('return Pages.today.timer===null;')
    ev('await Bridge.window.show();await Shell.open("today");return true;');wait('Pages.today.timer!==null')
    (out/'layout.json').write_text(json.dumps(dict(layouts=records,secondsAdvance=True,pageLeaveStopsTimer=True,windowCloseStopsTimer=True,resumeRestartsTimer=True),indent=2))
    print('Native countdown layout: no added scroll, fixed ticket/cells, both shells/sizes, ticking and timer lifetime passed')
elif sys.argv[1]=='print-pause':
    from PIL import Image,ImageDraw
    out=c.ROOT/'docs/port-spec/compare/review-09';out.mkdir(exist_ok=True)
    ev('S.closeOutside=false;S.motion="reduce";Bridge.savePreferences();await Bridge.invoke("print_later");await Bridge.invoke("exit_edit_mode");await Bridge.reload();window.printStock=JSON.stringify(S.stock);await Bridge.invoke("daily_stick_from_collection",{stickerId:"PETA-PORT-0010"});await Bridge.invoke("daily_stick_from_collection",{stickerId:"PETA-PORT-0011"});await Bridge.window.hide();await Bridge.invoke("print_resume");return true;')
    wait('document.querySelector(".print-sheet.ready")',layer)
    first=ev('return await Bridge.invoke("print_pending");')
    def paste():
        x,y=ev('const r=document.querySelector(".print-sheet .stk").getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];',layer)
        subprocess.run(['xdotool','mousemove',str(round(x)),str(round(y)),'mousedown','1'],check=True);time.sleep(.15)
        for i in range(1,11):
            subprocess.run(['xdotool','mousemove',str(round(x+(800-x)*i/10)),str(round(y+(550-y)*i/10))],check=True);time.sleep(.025)
        subprocess.run(['xdotool','mouseup','1'],check=True)
        wait('!document.querySelector(".print-sheet")',layer)
    paste();time.sleep(.7)
    next=ev('return await Bridge.invoke("print_pending");')
    assert next and first['stickerId']!=next['stickerId']
    assert ev('return (await window.__TAURI__.core.invoke("layer_info")).editMode;',layer)
    subprocess.run(['import','-window','root',str(out/'print-after.png')],check=True)
    before=Image.open(out/'print-before.png');after=Image.open(out/'print-after.png');pair=Image.new('RGB',(2880,928),'#f5f0e6');pair.paste(before,(0,28));pair.paste(after,(1440,28));d=ImageDraw.Draw(pair);d.text((12,7),'Before: another sheet appears automatically',fill='#2b2a28');d.text((1452,7),'Actual Tauri: next job stays queued',fill='#2b2a28');pair.save(out/'print-comparison.jpg',quality=90)
    ev('await Bridge.invoke("exit_edit_mode");await Bridge.window.show();await Shell.open("book");return true;');time.sleep(.3)
    assert not ev('return !!document.querySelector(".print-sheet");',layer) and ev('return await Bridge.invoke("print_pending");')==next
    repeated=ev('try {await Bridge.invoke("print_paste",{stickerId:'+json.dumps(first['stickerId'])+',x:.5,y:.5});return false;}catch {return true;}')
    assert repeated and ev('return await Bridge.invoke("print_pending");')==next
    ev('await Bridge.window.hide();await Bridge.invoke("print_resume");return true;');wait('document.querySelector(".print-sheet.ready")',layer)
    assert ev('return await Bridge.invoke("print_pending");')==next
    ev('await Bridge.invoke("print_later");return true;');wait('!document.querySelector(".print-sheet")',layer)
    assert ev('return await Bridge.invoke("print_pending");')==next
    ev('await Bridge.reload();return true;');assert ev('return JSON.stringify(S.stock)===window.printStock;')
    (out/'print.json').write_text(json.dumps(dict(first=first,next=next,actualMousePaste=True,noAutomaticNextSheet=True,editModeAfterPaste=True,exitEditAndBookDoNotResume=True,explicitResumeShowsSameNext=True,laterKeepsNext=True,repeatedPasteRejected=True,stockUnchanged=True),indent=2))
    print('Native print: one mouse paste pauses, next job retained, explicit Resume/Later, no duplicate spend and stock unchanged passed')
elif sys.argv[1]=='hover':
    from PIL import Image,ImageDraw
    out=c.ROOT/'docs/port-spec/compare'/ (sys.argv[2] if len(sys.argv)>2 else 'review-10');out.mkdir(exist_ok=True)
    ev('S.closeOutside=false;S.motion="full";S.chosen="holographic";Bridge.savePreferences();await Bridge.invoke("print_later");await Bridge.invoke("exit_edit_mode");await Bridge.window.show();await Bridge.reload();window.hoverStock=JSON.stringify(S.stock);window.hoverCalls=[];const invoke=Bridge.invoke;Bridge.invoke=(cmd,args)=>{if(["creator_finish","pack_open","gift_open","daily_stick_from_collection"].includes(cmd))window.hoverCalls.push(cmd);return invoke(cmd,args);};const add=EventTarget.prototype.addEventListener;EventTarget.prototype.addEventListener=function(type,...args){if(type==="pointermove" && this instanceof Element && this.matches(".stk-pane .frame"))this.hoverBindings=(this.hoverBindings||0)+1;return add.call(this,type,...args);};return true;')
    def move(selector,x=.5,y=.5):
        r=ev('const e=document.querySelector('+json.dumps(selector)+');e.scrollIntoView({block:"center",behavior:"instant"});await sleep(80);const r=e.getBoundingClientRect(),p=await Bridge.window.outerPosition();return {x:p.x+r.x+r.width*'+str(x)+',y:p.y+r.y+r.height*'+str(y)+'};')
        subprocess.run(['xdotool','mousemove',str(round(r['x'])),str(round(r['y']))],check=True);time.sleep(.22)
    def rect(selector):return ev('const e=document.querySelector('+json.dumps(selector)+'),r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,transform:getComputedStyle(e).transform};')
    def stable(selector):
        move(selector);before=rect(selector)
        for x,y in [(.02,.02),(.98,.02),(.98,.98),(.02,.98),(.5,.5)]:
            move(selector,x,y);assert rect(selector)==before,(selector,before,rect(selector))
        return before
    ev('await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(1060,700));Shell.setShell("studio");await Shell.open("create");await crLoadSample("sBubble");return true;')
    wait('CR.stage==="ready" && CR.res && document.querySelector(".mtray")')
    layouts=[]
    for shell in ['studio','desk']:
        for width,height in [(1060,700),(720,520)]:
            ev('await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize('+str(width)+','+str(height)+'));Shell.setShell('+json.dumps(shell)+');return true;');wait('CR.res && document.querySelector(".mtray")')
            card=stable('.mtray [data-m="holographic"]')
            assert card['transform']=='none' and not ev('return Boolean(document.querySelector(".mtray .tape"));')
            ev('window.materialNodes=Array.from(document.querySelectorAll(".mtray .mcard"));return true;')
            for id in ['matte','holographic','kraft','matte','holographic']:
                selector='.mtray [data-m="'+id+'"]';move(selector);subprocess.run(['xdotool','click','1'],check=True)
                wait('S.chosen==='+json.dumps(id)+' && CR.res?.material==='+json.dumps(id))
                assert ev('return window.materialNodes.every((e,i)=>e===document.querySelectorAll(".mtray .mcard")[i]) && document.activeElement.dataset.m==='+json.dumps(id)+' && document.querySelectorAll(".mtray [aria-checked=true]").length===1;')
            layouts.append(dict(shell=shell,size=[width,height],materialCard=card,selectionPreservesNodesAndFocus=True))
            move('.mtray [data-m="holographic"]',.8,.3);shot(shell+'-create-'+str(width))
            if shell=='studio' and width==1060:
                actual=Image.open(out/'studio-create-1060.png');r=ev('const r=document.querySelector(".g-mat").getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};');after=actual.crop((round(r['x']-12),round(r['y']-15),round(r['x']+r['w']+12),round(r['y']+r['h']+15)));after.save(out/'material-after.png');before=Image.open(out/'material-before.png');pair=Image.new('RGB',(before.width+after.width,max(before.height,after.height)+28),'#f5f0e6');pair.paste(before,(0,28));pair.paste(after,(before.width,28));d=ImageDraw.Draw(pair);d.text((12,7),'Before',fill='#2b2a28');d.text((before.width+12,7),'Actual Tauri',fill='#2b2a28');pair.save(out/'material-comparison.png')
    assert ev('return document.querySelector(".stk-pane .frame").hoverBindings;')==1
    move('.stk-pane .frame',.7,.3);preview=ev('return document.querySelector(".stk-host").style.transform;');move('.stk-pane .frame',.7,.3);assert ev('return document.querySelector(".stk-host").style.transform;')==preview
    controls=[]
    for page,selector in [('materials','.mbook:not(:disabled)'),('packs','.pack:not(:disabled)'),('gifts','.gift:not(:disabled)'),('market','.mk-tile')]:
        ev('await Shell.go('+json.dumps(page)+');return true;');time.sleep(.7);controls.append(dict(page=page,rect=stable(selector)))
        assert not ev('return Array.from(Shell.current.querySelectorAll(".open-cta")).some(e=>getComputedStyle(e).transform!=="none");')
        if page=='materials':
            ev('S.motion="reduce";Bridge.savePreferences();return true;');move(selector,.8,.2)
            assert 'perspective' not in ev('return document.querySelector(".mbook:not(:disabled) .mcard").style.transform;')
            ev('S.motion="full";Bridge.savePreferences();return true;')
    ev('await Bridge.invoke("creator_cancel");crReset();await Shell.go("create");return true;');time.sleep(.7)
    controls.extend([dict(page='create/drop',rect=stable('.drop')),dict(page='create/sample',rect=stable('.sample'))])
    ev('S.motion="reduce";Bridge.savePreferences();return true;');move('.sample');assert ev('return getComputedStyle(document.querySelector(".sample img")).transform;')=='none'
    corner=ev('const e=document.querySelector(".resize-h"),s=getComputedStyle(e);return {background:s.backgroundImage,color:s.backgroundColor,before:getComputedStyle(e,"::before").content,after:getComputedStyle(e,"::after").content,body:getComputedStyle(document.body).backgroundColor};')
    assert corner['background']=='none' and corner['color']=='rgba(0, 0, 0, 0)'
    ev('await Bridge.reload();return true;');assert ev('return JSON.stringify(S.stock)===window.hoverStock && window.hoverCalls.length===0;')
    (out/'hover.json').write_text(json.dumps(dict(layouts=layouts,controls=controls,onePreviewFollowBinding=True,repeatPositionGivesSameTilt=True,reduceMotionStopsFollow=True,stockUnchanged=True,noPrintOrOpenCommands=True,resizeCorner=corner),indent=2))
    print('Native hover: stable material nodes/focus/geometry, other control hit areas, one preview binding, Reduce motion and transparent resize corner passed')
elif sys.argv[1]=='reflection':
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
elif sys.argv[1]=='material':
    ev('S.closeOutside=false;S.motion="full";S.bookView="list";Bridge.savePreferences();await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(1060,700));Shell.setShell("studio");BK.sel=null;await Shell.open("today");document.querySelector(".t-arrived .btn.open").click();return true;')
    wait('document.querySelector(".pouch")')
    def pull_material():
        ev('document.querySelector(".pouch").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));return true;')
        wait('document.querySelector(".mcard.in-wrap.out")')
        text=ev('document.querySelector(".mcard.in-wrap.out").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));return document.querySelector(".cer-hint").textContent;')
        assert text=='Tilt it to catch the light.',text
        wait('document.querySelector(".rv-info")?.style.pointerEvents===""')
        time.sleep(.8)
    def material_bounds():return ev('const card=document.querySelector(".material-card-position .mcard").getBoundingClientRect(),hint=document.querySelector(".cer-hint").getBoundingClientRect(),info=document.querySelector(".rv-info").getBoundingClientRect(),button=document.querySelector(".rv-info .keep").getBoundingClientRect();return {shell:S.shell,size:[innerWidth,innerHeight],card:card.toJSON(),hint:hint.toJSON(),info:info.toJSON(),button:button.toJSON(),text:document.querySelector(".cer-hint").textContent};')
    def no_overlap(result):
        assert result['card']['top']>result['hint']['bottom'] and result['card']['bottom']<result['info']['top'],result
        assert result['button']['bottom']<=result['size'][1] and result['card']['left']>=0 and result['card']['right']<=result['size'][0],result
    pull_material();actual=material_bounds();no_overlap(actual);shot('studio-material-actual-1060')
    ev('document.querySelector(".rv-info .keep").click();return true;');wait('!document.querySelector(".cer") && !Bridge.busy && document.querySelector(".envelope-ticket")')
    records=[]
    # Replay the same native component with existing Holographic art (longest recipe), without granting stock again.
    for shell in ['studio','desk']:
        for width,height in [(1060,700),(720,520)]:
            ev('await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize('+str(width)+','+str(height)+'));Shell.setShell('+json.dumps(shell)+');window.materialPreview=Cer.openMaterial(MAT.holographic).then(async result=>{result.node.remove();await result.close();});return true;')
            pull_material();result=material_bounds();no_overlap(result);records.append(result);shot(shell+'-material-'+str(width))
            if width==1060:
                ev('await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(720,520));return true;');time.sleep(.5)
                resized=material_bounds();no_overlap(resized);records.append(dict(afterResize=True,**resized))
            ev('document.querySelector(".rv-info .keep").click();return true;');wait('!document.querySelector(".cer")')
    ev('await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(1060,700));Shell.setShell("studio");await Shell.open("packs");Cer.openPack(S.packs.find(p=>p.id==="tokyo"));return true;')
    wait('document.querySelector(".pouch")')
    ev('document.querySelector(".pouch").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));return true;');wait('document.querySelector(".pk-sleeve.out")')
    pack_hint=ev('document.querySelector(".pk-sleeve.out").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));return document.querySelector(".cer-hint").textContent;');assert pack_hint=='Tilt it to catch the light.'
    wait('document.querySelector(".rv-btns .paper")');time.sleep(1)
    ev('document.querySelector(".rv-btns .paper").click();return true;');wait('!document.querySelector(".cer")')
    ev('await Shell.open("gifts");Cer.openGift(S.gifts.find(g=>!g.opened));return true;');wait('document.querySelector(".wax")')
    ev('document.querySelector(".wax").click();return true;');wait('document.querySelector(".gsleeve.out")');time.sleep(1.2)
    gift_hint=ev('document.querySelector(".gsleeve.out").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));return document.querySelector(".cer-hint").textContent;');assert gift_hint=='Tilt it to catch the light.'
    wait('document.querySelector(".rv-btns .paper")');time.sleep(1)
    ev('document.querySelector(".rv-btns .paper").click();return true;');wait('!document.querySelector(".cer")')
    (out/'material.json').write_text(json.dumps(dict(actualTodayOpeningAndKeep=actual,layouts=records,immediateMaterialHint=True,immediatePackHint=pack_hint,immediateGiftHint=gift_hint,resizeKeepsBounds=True,noNewStockFromComponentReplay=True),indent=2));print('Native material: immediate hint, card/hint/info/button bounds in both sizes/shells, live resize, actual Keep, Pack/Gift prompts passed')
elif sys.argv[1]=='material-reduced':
    ev('S.motion="reduce";Bridge.savePreferences();S.closeOutside=false;await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(720,520));Shell.setShell("desk");window.testResizeObservers=0;const Original=ResizeObserver;window.ResizeObserver=class extends Original {observe(...args){if(!this.active){this.active=true;window.testResizeObservers++;}super.observe(...args);}disconnect(){if(this.active){this.active=false;window.testResizeObservers--;}super.disconnect();}};window.testRafs=0;const raf=requestAnimationFrame;window.requestAnimationFrame=fn=>{window.testRafs++;return raf(fn);};window.stockBeforeReplay=JSON.stringify(S.stock);window.materialPreview=Cer.openMaterial(MAT.holographic).then(async result=>{result.node.remove();await result.close();});return true;')
    ev('document.querySelector(".pouch").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));return true;');wait('document.querySelector(".mcard.in-wrap.out")')
    assert ev('return window.testRafs;')==0
    ev('document.querySelector(".mcard.in-wrap.out").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));return true;');wait('document.querySelector(".rv-info")?.style.pointerEvents===""')
    assert ev('return window.testResizeObservers;')==1
    animations=ev('return document.querySelector(".cer").getAnimations({subtree:true}).map(a=>({duration:a.effect.getTiming().duration,iterations:a.effect.getTiming().iterations}));')
    assert all(a['duration']<=1 and a['iterations']==1 for a in animations),animations
    ev('document.querySelector(".rv-info .keep").click();return true;');wait('!document.querySelector(".cer")')
    assert ev('return window.testResizeObservers;')==0
    ev('await Bridge.reload();return true;');assert ev('return JSON.stringify(S.stock)===window.stockBeforeReplay;')
    p=out/'material.json';v=json.loads(p.read_text());v.update(reducedAnimations=animations,noReducedTearRaf=True,resizeObserverDisposed=True,replayStockUnchanged=True);p.write_text(json.dumps(v,indent=2))
    ev('S.motion="full";Bridge.savePreferences();await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(1060,700));Shell.setShell("studio");await Shell.open("today");return true;')
    shot('studio-today-countdown-1060')
    print('Native reduced material: no manual tear RAF, short finite animations, observer disposed, stock unchanged passed')
