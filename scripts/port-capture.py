"""Capture the real debug Tauri webview alongside the unchanged golden window crop.
Run with DISPLAY and PETA_PORT_CAPTURE_DIR matching the running debug application.
No prototype DOM, mock IPC or desktop is used for the right-hand image.
"""
import json, os, time, subprocess
from pathlib import Path
from PIL import Image, ImageDraw
ROOT = Path(__file__).resolve().parents[1]
CHANNEL = Path(os.environ.get('PETA_PORT_CAPTURE_DIR', '/tmp/peta-capture'))
CHANNEL.mkdir(parents=True, exist_ok=True)

def evaluate(script, timeout=30):
    result = CHANNEL / 'result.json'
    result.unlink(missing_ok=True)
    code = '(async()=>{try{const value=await(async()=>{'+script+'})(); await window.__TAURI__.core.invoke("port_capture_report",{result:{ok:true,value}});}catch(e){await window.__TAURI__.core.invoke("port_capture_report",{result:{ok:false,error:String(e)}});}})();'
    temp = CHANNEL / 'command.tmp'
    temp.write_text(code)
    temp.replace(CHANNEL / 'command.js')
    start = time.monotonic()
    while not result.exists():
        if time.monotonic()-start > timeout: raise TimeoutError('Native capture IPC timed out')
        time.sleep(.1)
    value = json.loads(result.read_text())
    if not value['ok']: raise RuntimeError(value['error'])
    return value.get('value')

def capture(slice_id, golden, delay=1.5):
    time.sleep(delay)
    ids = subprocess.check_output(['xdotool','search','--name','^Peta$'],text=True).split()
    # Peta-app has the 1060x700 webview; layers are display-sized.
    window = next(i for i in ids if any('WIDTH='+str(w) in subprocess.check_output(['xdotool','getwindowgeometry','--shell',i],text=True) for w in [1060,1440]))
    out = ROOT/'docs/port-spec/compare'
    out.mkdir(exist_ok=True)
    name = f'slice-{slice_id:02}-{golden}'
    subprocess.run(['import','-window',window,str(out/(name+'-actual.png'))],check=True)
    reference=Image.open(ROOT/'docs/port-spec/golden'/f'{golden}.jpg').crop((190,79,1250,779))
    actual=Image.open(out/(name+'-actual.png')).convert('RGB')
    if actual.size==(1440,900): actual=actual.crop((190,79,1250,779))
    pair=Image.new('RGB',(2120,732),'#f5f0e6'); pair.paste(reference,(0,32)); pair.paste(actual,(1060,32))
    d=ImageDraw.Draw(pair); d.text((12,8),'Golden (original 1060 x 700 window crop)',fill='#2b2a28'); d.text((1072,8),'Actual Tauri / WebKitGTK (1060 x 700)',fill='#2b2a28')
    pair.save(out/(name+'.jpg'),quality=90)
    print(name, flush=True)

if __name__=='__main__':
    import sys
    evaluate('await Shell.open("settings"); return S.page;')
    capture(int(sys.argv[1]),sys.argv[2])
