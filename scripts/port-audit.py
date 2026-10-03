"""Run the prototype's text overflow scanner in the actual native webview."""
import importlib.util, json
from pathlib import Path
spec=importlib.util.spec_from_file_location('capture',Path(__file__).with_name('port-capture.py'))
c=importlib.util.module_from_spec(spec); spec.loader.exec_module(c)
src=(c.ROOT/'docs/ui-proposals/app/tools/audit.mjs').read_text()
scan=src[src.index('const scan ='):src.index('\n{\n  const b =')]
results=[]
for shell in ['studio','desk']:
    for page in ['today','create','book','packs','gifts','market','materials','settings']:
        value=c.evaluate('Shell.setShell('+json.dumps(shell)+'); await Shell.open('+json.dumps(page)+'); await sleep(800); '+scan+' return scan();')
        results.append(dict(shell=shell,page=page,issues=value))
        print(shell,page,len(value),value[:4],flush=True)
(c.ROOT/'docs/port-spec/compare/native-audit.json').write_text(json.dumps(results,indent=2))
