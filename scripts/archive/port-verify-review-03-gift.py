"""Review 03: window-bounded Gift sealing and native finished-PNG file round trip."""
import importlib,json,struct,subprocess,time,os
from pathlib import Path
c=importlib.import_module('port-capture')
data=Path(os.environ['XDG_DATA_HOME']).resolve(); assert data.is_relative_to(Path('/tmp'))
out=c.ROOT/'docs/port-spec/compare/review-03'
file=Path('/tmp/peta-review03-roundtrip.peta');file.unlink(missing_ok=True)
def ev(s):return c.evaluate(s)
def wait(s,seconds=30):
    start=time.monotonic()
    while not ev('return Boolean('+s+');'):
        if time.monotonic()-start>seconds:raise TimeoutError(s)
        time.sleep(.15)
def choose(path,save=False):
    title='^Save File$' if save else '^Open File$'
    for _ in range(50):
        windows=subprocess.run(['xdotool','search','--onlyvisible','--name',title],capture_output=True,text=True).stdout.split()
        if windows:break
        time.sleep(.1)
    else:raise TimeoutError('Native file dialog did not appear')
    subprocess.run(['xdotool','windowactivate','--sync',windows[-1]],check=True)
    time.sleep(.5)
    subprocess.run(['xdotool','key','ctrl+l','ctrl+a'],check=True);time.sleep(.2)
    subprocess.run(['xdotool','type','--clearmodifiers',str(path)],check=True)
    subprocess.run(['xdotool','key','Return'],check=True)
    if windows:
        time.sleep(.3)
        geom=subprocess.check_output(['xdotool','getwindowgeometry','--shell',windows[-1]],text=True)
        g=dict(line.split('=') for line in geom.splitlines() if '=' in line)
        subprocess.run(['xdotool','mousemove','--window',windows[-1],str(int(g['WIDTH'])-48),str(int(g['HEIGHT'])-26)],check=True)
        time.sleep(.3);subprocess.run(['xdotool','click','1'],check=True)
ev('await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(720,520)); Shell.setShell("desk"); await Bridge.invoke("print_later"); S.closeOutside=false; await Bridge.invoke("arrival_open"); await sleep(600); await Shell.open("book"); BK.sel="PETA-PORT-0011"; BK.gift=true; S.bookMonth=monthKey(new Date("2026-10-01T12:00:00Z")); Shell.refresh(); return true;')
before=ev('return {position:await Bridge.window.outerPosition(),size:await Bridge.window.outerSize(),visible:await Bridge.window.isVisible()};')
ev('document.querySelector(".gift-form input").value="Native QA"; document.querySelector(".gift-form input:nth-of-type(1)").value="Native QA"; document.querySelector(".gift-form").requestSubmit(); return true;')
wait('Bridge.dialogOpen');choose(file,save=True)
wait('!Bridge.dialogOpen',60)
if not file.exists():raise RuntimeError('Native save dialog did not write the gift')
wait('document.querySelector(".env-wrap.send")')
time.sleep(.6)
sealing=ev('const r=document.querySelector(".env-wrap.send").getBoundingClientRect();return {position:await Bridge.window.outerPosition(),size:await Bridge.window.outerSize(),visible:await Bridge.window.isVisible(),envelope:r.toJSON(),viewport:[innerWidth,innerHeight]};')
assert sealing['position']==before['position'] and sealing['size']==before['size'] and sealing['visible']
r=sealing['envelope'];assert r['x']>=0 and r['y']>=0 and r['right']<=720 and r['bottom']<=520
ids=subprocess.check_output(['xdotool','search','--name','^Peta$'],text=True).split()
window=next(i for i in ids if 'WIDTH=720' in subprocess.check_output(['xdotool','getwindowgeometry','--shell',i],text=True))
subprocess.run(['import','-window',window,str(out/'gift-desk-720-sealing.png')],check=True)
wait('!document.querySelector(".cer")',30)
finished=ev('return {position:await Bridge.window.outerPosition(),size:await Bridge.window.outerSize(),visible:await Bridge.window.isVisible(),bookDetail:!!document.querySelector(".detail"),giftForm:!!document.querySelector(".gift-form")};')
assert finished['position']==before['position'] and finished['size']==before['size'] and finished['visible'] and finished['bookDetail'] and not finished['giftForm']
raw=file.read_bytes();assert raw[:9]==b'PETAGIFT\x01'
n=struct.unpack('>I',raw[9:13])[0];head=json.loads(raw[13:13+n]);png=raw[13+n:13+n+head['pngLen']]
original=(data/'app.peta.desktop/assets/stickers/PETA-PORT-0011/rendered.png').read_bytes()
assert png==original and png[:8]==b'\x89PNG\r\n\x1a\n'
ev('await Shell.open("gifts"); Pages.gifts.receiveFile(); return true;');wait('Bridge.dialogOpen');choose(file);wait('!Bridge.dialogOpen',60)
gift=ev('return (await Bridge.invoke("gift_inbox")).find(g=>g.giftId=='+json.dumps(head['giftId'])+');')
assert gift and gift['openedAt'] is None
result=dict(nativeSaveDialog=True,nativeOpenDialog=True,sealedInbox=True,finishedPngUnchanged=True,header=head,fileBytes=len(raw),before=before,sealing=sealing,finished=finished)
(out/'gift-file.json').write_text(json.dumps(result,indent=2));print(result)
