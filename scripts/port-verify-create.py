"""Check the actual Rust brush history and the prototype control bindings in the native app."""
import importlib,json,subprocess,time
c=importlib.import_module('port-capture')
c.evaluate("await Bridge.window.show(); await Shell.open('create'); return true;")
if not c.evaluate("return CR.stage==='ready';"): raise RuntimeError('Load a sample first')
c.evaluate("window.__portRender=async()=>Array.from(new Uint8Array(await Bridge.invoke('creator_render',{materialId:S.chosen,strength:.5,smooth:CR.smooth/12,outline:CR.border,preview:false}))).join(','); window.__portBefore=await window.__portRender(); return true;")
def brush(fraction):
    r=c.evaluate("const r=document.querySelector('.frame.checker').getBoundingClientRect(); return [r.left,r.top,r.width,r.height];")
    ids=subprocess.check_output(['xdotool','search','--name','^Peta$'],text=True).split()
    geom=next(subprocess.check_output(['xdotool','getwindowgeometry','--shell',i],text=True) for i in ids if 'WIDTH=1060' in subprocess.check_output(['xdotool','getwindowgeometry','--shell',i],text=True))
    g=dict(line.split('=') for line in geom.splitlines() if '=' in line)
    subprocess.run(['xdotool','mousemove',str(round(int(g['X'])+r[0]+r[2]*fraction)),str(round(int(g['Y'])+r[1]+r[3]*fraction)),'mousedown','1','mouseup','1'],check=True)
    time.sleep(.5)
brush(.5)
result=c.evaluate('''
const before=window.__portBefore, render=window.__portRender;
await CR.queue;
const painted=await render();
if(before===painted || !CR.history.canUndo) throw Error('Erase did not change the Rust pixels');
document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,bubbles:true}));
await sleep(800);
const undone=await render();
if(undone!==before || !CR.history.canRedo) throw Error('Cmd-Z did not restore the image');
document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,shiftKey:true,bubbles:true}));
await sleep(800);
if(await render()!==painted) throw Error('Shift-Cmd-Z did not redo');
await Bridge.invoke('creator_undo');
const outline=document.querySelector('.g-look input');
outline.value='64'; outline.dispatchEvent(new Event('input',{bubbles:true}));
await sleep(1000);
if(CR.border!==64 || await render()===before) throw Error('Outline binding failed');
outline.value='20'; outline.dispatchEvent(new Event('input',{bubbles:true}));
const restore=document.querySelectorAll('.g-tools .seg button')[1]; restore.click();
return true;
''',60)
brush(.05)
result=c.evaluate('''await CR.queue;
if(!CR.history.canUndo) throw Error('Restore did not enter history');
return {erase:true,restore:true,undo:true,redo:true,outlineRange:[4,64],outlineDefault:20,cuttingEngine:'Rust creator session'};
''',60)
(c.ROOT/'docs/port-spec/compare/slice-04-controls.json').write_text(json.dumps(result,indent=2))
print(result)
