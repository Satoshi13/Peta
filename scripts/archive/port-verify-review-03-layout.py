"""Confirm shelf rows and the native binding phase after resize and scroll."""
import importlib,json,os,subprocess,time
from pathlib import Path
c=importlib.import_module('port-capture');out=c.ROOT/'docs/port-spec/compare/review-03'
assert Path(os.environ['XDG_DATA_HOME']).resolve().is_relative_to(Path('/tmp'))
for state in json.loads((out/'layout-after.json').read_text()):
    if state['page']!='packs':continue
    rows={}
    for pack in state['packs']:rows.setdefault(round(pack['rect']['top']),[]).append(pack)
    assert any(p['disabled'] for p in state['packs']) and any(not p['disabled'] for p in state['packs'])
    for row in rows.values():
        for key in ['bag','label','action']:
            assert max(p[key]['top'] for p in row)-min(p[key]['top'] for p in row)<1,(state,key)
records=[]
for width,height in [(1060,700),(720,520),(1060,700)]:
    c.evaluate('S.closeOutside=false;await Bridge.window.show();Shell.setShell("desk");await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize('+str(width)+','+str(height)+'));BK.sel=null;S.bookMonth=null;await Shell.open("book");await sleep(600);return true;')
    value=c.evaluate('const band=document.querySelector(".binding-band"),middle=band.firstElementChild,gutter=document.querySelector(".page-gutter"),page=document.querySelector(".page[data-page=book]");return {viewport:[innerWidth,innerHeight],band:band.getBoundingClientRect().toJSON(),middle:middle.getBoundingClientRect().toJSON(),capHeights:[parseFloat(getComputedStyle(band,"::before").height),parseFloat(getComputedStyle(band,"::after").height)],gutterLeft:getComputedStyle(gutter).left,coverBorder:getComputedStyle(page,"::before").borderTopWidth,oldCoilCount:document.querySelectorAll(".coil").length};')
    band=value['band'];middle=value['middle'];pitch=band['width']/128*50
    assert band['width']==54 and abs(band['height']/pitch-round(band['height']/pitch))<1e-6
    assert value['capHeights']==[27,27] and middle['top']==band['top']+27 and middle['bottom']==band['bottom']-27
    assert value['gutterLeft']=='0px' and value['coverBorder']=='0px' and value['oldCoilCount']==0
    value['scrolled']=c.evaluate('const p=document.querySelector(".page-in");p.scrollTop=p.scrollHeight;await new Promise(requestAnimationFrame);return {binding:document.querySelector(".binding-band").getBoundingClientRect().toJSON(),scrollTop:p.scrollTop,maximum:p.scrollHeight-p.clientHeight};')
    assert value['scrolled']['binding']==band and abs(value['scrolled']['scrollTop']-value['scrolled']['maximum'])<=1
    records.append(value)
(out/'binding.json').write_text(json.dumps(records,indent=2));print('Shelf alignment and native resized/scrolled binding verified')
# A Book reprint also keeps the main window while the real desktop layer takes focus.
ids=subprocess.check_output(['xdotool','search','--name','^Peta$'],text=True).split()
window=next(i for i in ids if 'WIDTH=1060' in subprocess.check_output(['xdotool','getwindowgeometry','--shell',i],text=True))
subprocess.run(['xdotool','windowactivate','--sync',window],check=True);time.sleep(.3)
c.evaluate('S.closeOutside=true;S.bookMonth=monthKey(new Date("2026-09-01T12:00:00Z"));BK.sel="PETA-PORT-0009";BK.gift=false;Shell.refresh();await sleep(600);return true;')
before=c.evaluate('return {position:await Bridge.window.outerPosition(),size:await Bridge.window.outerSize(),visible:await Bridge.window.isVisible()};')
after=c.evaluate('document.querySelector(".detail .actions .btn:not(.paper)").click();await sleep(1800);return {position:await Bridge.window.outerPosition(),size:await Bridge.window.outerSize(),visible:await Bridge.window.isVisible(),page:S.page,selected:BK.sel,recorded:(await Bridge.invoke("book_page",{year:S.today.getFullYear(),month:S.today.getMonth()+1})).some(e=>e.stickerId==="PETA-PORT-0009" && e.date===S.today.toISOString().slice(0,10))};')
assert before['position']==after['position'] and before['size']==after['size'] and after['visible'] and after['page']=='book' and after['selected'] is None and after['recorded']
(out/'book-print.json').write_text(json.dumps(dict(before=before,after=after,outsideClickPreferenceEnabled=True),indent=2))
c.evaluate('S.closeOutside=false;await Bridge.invoke("print_later");return true;')
print('Native Book reprint keeps main window')
