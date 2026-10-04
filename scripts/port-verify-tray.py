"""Click the actual native tray Menu instance and verify native routes/checkbox synchronization."""
import sys,importlib,json,time,subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
c=importlib.import_module('port-capture');ev=c.evaluate
out=c.ROOT/'docs/port-spec/compare/review-02';result={}
ev('await Bridge.invoke("exit_edit_mode");await Bridge.invoke("print_later");await Bridge.window.show();await Shell.open("market");return true;')
def click(y):
 pos=ev('return await Bridge.window.outerPosition();')
 with ThreadPoolExecutor(max_workers=1) as pool:
  popup=pool.submit(ev,'return await Bridge.invoke("port_capture_tray",{popup:true});')
  time.sleep(.5);subprocess.run(['xdotool','mousemove',str(pos['x']+250),str(pos['y']+y-79),'click','1'],check=True);popup.result()
 time.sleep(.3)
click(259);result['nativeTraySettingsRoute']=ev('return S.page==="settings";');assert result['nativeTraySettingsRoute']
click(177);result['nativeTrayOpenRoute']=ev('return S.page==="today";');assert result['nativeTrayOpenRoute']
click(230);result['nativeTrayEditChecked']=ev('return (await Bridge.invoke("port_capture_tray",{popup:false})).items.find(i=>i.id==="edit").checked;');assert result['nativeTrayEditChecked']
ev('await Bridge.invoke("exit_edit_mode");return true;');result['doneUnchecksTray']=ev('return !(await Bridge.invoke("port_capture_tray",{popup:false})).items.find(i=>i.id==="edit").checked;');assert result['doneUnchecksTray']
(out/'tray-actions.json').write_text(json.dumps(result,indent=2));print({k:v for k,v in result.items() if k.startswith('nativeTray') or k=='doneUnchecksTray'})
