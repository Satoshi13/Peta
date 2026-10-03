"""Run the prototype's text overflow scanner in the actual native webview.
Usage: python3 scripts/port-audit.py [slice number] [comma-separated pages]
"""
import importlib.util,json,sys,re
from pathlib import Path
spec=importlib.util.spec_from_file_location('capture',Path(__file__).with_name('port-capture.py'))
c=importlib.util.module_from_spec(spec); spec.loader.exec_module(c)
src=(c.ROOT/'docs/ui-proposals/app/tools/audit.mjs').read_text()
scan=src[src.index('const scan ='):src.index('\n{\n  const b =')]
results=[]; pages=(sys.argv[2] if len(sys.argv)>2 else 'today,create,book,packs,gifts,market,materials,settings').split(',')
for width,height in [(1060,700),(720,520)]:
    c.evaluate(f'await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize({width},{height})); return true;')
    for shell in ['studio','desk']:
        for page in pages:
            value=c.evaluate('Shell.setShell('+json.dumps(shell)+'); await Shell.open('+json.dumps(page)+'); await sleep(600); '+scan+' return scan();')
            known=[]; actionable=[]
            for issue in value:
                match=re.fullmatch(r'(\d+)>(\d+)',issue[2])
                # The unchanged paper artwork extends exactly four pixels outside the button.
                if issue[0]=='spillX' and 'button.btn.paper' in issue[1] and match and int(match[1])-int(match[2])==4:
                    known.append(dict(issue=issue,reason='WebKit includes ::before paper art inset -3px -4px in scrollWidth'))
                else: actionable.append(issue)
            results.append(dict(size=[width,height],shell=shell,page=page,issues=actionable,knownFalsePositives=known))
            print(width,height,shell,page,len(actionable),actionable[:4],"known paper-art:",len(known),flush=True)
c.evaluate('await Bridge.window.setSize(new window.__TAURI__.dpi.LogicalSize(1060,700)); return true;')
name=f'slice-{int(sys.argv[1]):02}-audit.json' if len(sys.argv)>1 else 'native-audit.json'
(c.ROOT/'docs/port-spec/compare'/name).write_text(json.dumps(results,indent=2))
