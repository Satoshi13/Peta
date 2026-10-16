"""Audit Book actions/forms and the original editor in both shells at both supported sizes."""
import importlib,json,subprocess,time,os,re
from pathlib import Path
c=importlib.import_module('port-capture');out=c.ROOT/'docs/port-spec/compare/review-05'
assert Path(os.environ['XDG_DATA_HOME']).resolve().is_relative_to(Path('/tmp'))
src=(c.ROOT/'docs/ui-proposals/app/tools/audit.mjs').read_text();scan=src[src.index('const scan ='):src.index('\n{\n  const b =')]
def ev(s):return c.evaluate(s,timeout=90)
def wait(s):
    start=time.monotonic()
    while not ev('return Boolean('+s+');'):
        assert time.monotonic()-start<90,s;time.sleep(.15)
def shot(name,width):
    ids=subprocess.check_output(['xdotool','search','--name','^Peta$'],text=True).split()
    win=next(i for i in ids if 'WIDTH='+str(width) in subprocess.check_output(['xdotool','getwindowgeometry','--shell',i],text=True))
    subprocess.run(['xdotool','windowactivate','--sync',win],check=True);time.sleep(.5)
    subprocess.run(['import','-window',win,str(out/(name+'.png'))],check=True)
records=[]
for width,height in [(1060,700),(720,520)]:
    for shell in ['studio','desk']:
        ev('await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize('+str(width)+','+str(height)+'));Shell.setShell('+json.dumps(shell)+');S.bookMonth=monthKey(new Date("2026-09-01T12:00:00Z"));BK.sel="PETA-PORT-0010";BK.gift=false;BK.deleteId=null;await Shell.open("book");return true;')
        for state,action in [('detail',None),('delete','delete'),('gift','gift'),('editor','edit')]:
            if action:ev('document.querySelector('+json.dumps('.detail [data-action="'+action+'"]')+').click();return true;')
            if state=='editor':wait('CR.stage==="ready" && CR.res && !document.querySelector(".g-go .btn:not(.paper)").disabled');assert ev('return !document.querySelector(".g-mat button") && Number.isInteger(CR.smooth);')
            else:wait('document.querySelector(".f-front .stk img")?.naturalWidth')
            time.sleep(.9)
            result=ev(scan+' return {issues:scan(),buttons:Array.from(document.querySelectorAll(".detail .book-action")).map(e=>({text:e.textContent,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,radius:getComputedStyle(e).borderRadius,font:getComputedStyle(e).font})),rows:Array.from(document.querySelectorAll(".detail .book-action-row")).map(e=>Array.from(e.children).map(b=>b.getBoundingClientRect().width))};')
            issues=[];known=[]
            for issue in result['issues']:
                match=re.fullmatch(r'(\d+)>(\d+)',issue[2])
                if issue[0]=='spillX' and 'button.btn.paper' in issue[1] and match and int(match[1])-int(match[2])==4:known.append(issue)
                else:issues.append(issue)
            assert not issues,(shell,width,state,issues)
            assert all(abs(b['height']-40)<.001 and b['radius']=='10px' for b in result['buttons']),result
            assert all(len(row)==1 or max(row)-min(row)<1 for row in result['rows'])
            records.append(dict(shell=shell,size=[width,height],state=state,issues=issues,knownPaperArtwork=known,buttons=result['buttons']))
            if state=='editor':
                if width==720:
                    shot(shell+'-original-editing-720',width)
                    bounds=ev('document.querySelector(".g-go").scrollIntoView({block:"end"});await sleep(250);return {save:document.querySelector(".g-go .btn:not(.paper)").getBoundingClientRect().toJSON(),viewport:document.querySelector("#viewport").getBoundingClientRect().toJSON()};')
                    assert bounds['save']['top']>=bounds['viewport']['top'] and bounds['save']['bottom']<=bounds['viewport']['bottom']+.01
                    records[-1]['saveVisibleAfterScroll']=bounds
                    shot(shell+'-original-controls-720',width)
                ev('document.querySelector(".g-go .btn.paper").click();return true;');wait('S.page==="book" && CR.stage==="empty"')
            elif state=='delete':
                if shell=='studio' and width==1060:shot('studio-delete-confirm',width)
                ev('document.querySelector("[data-action=delete-cancel]").click();return true;')
            elif state=='gift':
                if shell=='studio' and width==1060:shot('studio-book-gift-form',width)
                ev('document.querySelector(".gift-form button[type=button]").click();return true;')
ev('await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(1060,700));Shell.setShell("studio");await Shell.open("book");return true;')
(out/'states.json').write_text(json.dumps(records,indent=2));print('Verified 16 detail/delete/Gift/editor states and consistent button geometry')
