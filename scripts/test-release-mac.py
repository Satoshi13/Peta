from pathlib import Path
import os,subprocess,tempfile,json
ROOT=Path.cwd();SCRIPT=ROOT/'scripts/release-mac.sh'
with tempfile.TemporaryDirectory(prefix='peta-release-check-') as tmp:
 t=Path(tmp);b=t/'bin';b.mkdir();app=t/'Peta.app';output=t/'final.zip';log=t/'calls'
 mock='''#!/usr/bin/env python3
import os,sys,pathlib,json
name=pathlib.Path(sys.argv[0]).name
with open(os.environ['MOCK_LOG'],'a') as f:f.write(json.dumps([name,*sys.argv[1:]])+'\\n')
app=pathlib.Path(os.environ['PETA_APP_PATH'])
if name=='security':print('  1) mock "Developer ID Application: Test (TEST)"')
elif name=='npm':
 (app/'Contents/MacOS').mkdir(parents=True,exist_ok=True);(app/'Contents/MacOS/Peta').write_text('portable executable')
elif name=='ditto':pathlib.Path(sys.argv[-1]).write_text('stapled' if (app/'ticket').exists() else 'unstapled')
elif name=='xcrun':
 if sys.argv[1:3]==['notarytool','submit']:print(json.dumps({'status':os.environ.get('MOCK_STATUS','Accepted')}))
 elif sys.argv[1:3]==['stapler','staple']:(app/'ticket').write_text('ticket')
'''
 for name in ['security','npm','ditto','xcrun','codesign','spctl']:
  p=b/name;p.write_text(mock);p.chmod(0o755)
 env=dict(os.environ,PATH=str(b)+':'+os.environ['PATH'],MOCK_LOG=str(log),PETA_APP_PATH=str(app),PETA_RELEASE_OUTPUT=str(output))
 for key in ['APPLE_SIGNING_IDENTITY','PETA_NOTARY_PROFILE']:env.pop(key,None)
 r=subprocess.run(['bash',str(SCRIPT)],env=env,capture_output=True,text=True);assert r.returncode==2 and not log.exists(),r.stderr
 env.update(APPLE_SIGNING_IDENTITY='Developer ID Application: Test (TEST)',PETA_NOTARY_PROFILE='test-only',MOCK_STATUS='Invalid')
 r=subprocess.run(['bash',str(SCRIPT)],env=env,capture_output=True,text=True);assert r.returncode!=0 and not output.exists();assert not (app/'ticket').exists()
 log.unlink();env['MOCK_STATUS']='Accepted'
 r=subprocess.run(['bash',str(SCRIPT)],env=env,capture_output=True,text=True);assert r.returncode==0,(r.stdout,r.stderr);assert output.read_text()=='stapled'
 calls=[json.loads(l) for l in log.read_text().splitlines()];names=[c[0] for c in calls]
 assert names==['security','npm','codesign','codesign','ditto','xcrun','xcrun','xcrun','codesign','spctl','ditto'],calls
 sign=next(c for c in calls if c[0]=='codesign');assert '--options' in sign and 'runtime' in sign and '--timestamp' in sign
 assert calls[5][1:3]==['notarytool','submit'] and '--wait' in calls[5]
 log.unlink();r=subprocess.run(['bash',str(SCRIPT)],env=env,capture_output=True,text=True);assert r.returncode==2 and not log.exists()
 print('PASS: missing credentials stop before tools; rejection stops before stapling; Accepted verifies and repacks the attached ticket; existing output is protected. Mock tools only.')
