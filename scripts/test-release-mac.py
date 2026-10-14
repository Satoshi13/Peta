from pathlib import Path
import os,subprocess,tempfile,json,shutil
ROOT=Path.cwd()
with tempfile.TemporaryDirectory(prefix='peta-release-check-') as tmp:
 t=Path(tmp);b=t/'bin';b.mkdir();app=t/'Peta.app';output=t/'final.dmg';log=t/'calls'
 # A copy of the repository's release scripts, with make-dmg.sh replaced by a recorder (it drives Finder and hdiutil).
 repo=t/'repo';(repo/'scripts').mkdir(parents=True);(repo/'src-tauri').mkdir()
 for f in ['release-mac.sh','check-binary-paths.py']:shutil.copy(ROOT/'scripts'/f,repo/'scripts'/f)
 (repo/'src-tauri/tauri.conf.json').write_text(json.dumps({'version':'0.1.0'}))
 SCRIPT=repo/'scripts/release-mac.sh'
 (repo/'scripts/make-dmg.sh').write_text('''import=1
echo '["make-dmg"]' >> "$MOCK_LOG"
if [[ -f "$1/ticket" ]]; then echo app-stapled > "$2"; else echo app-unstapled > "$2"; fi
''')
 mock='''#!/usr/bin/env python3
import os,sys,pathlib,json
name=pathlib.Path(sys.argv[0]).name
with open(os.environ['MOCK_LOG'],'a') as f:f.write(json.dumps([name,*sys.argv[1:]])+'\\n')
app=pathlib.Path(os.environ['PETA_APP_PATH'])
if name=='security':print('  1) mock "Developer ID Application: Test (TEST)"')
elif name=='npm':
 (app/'Contents/MacOS').mkdir(parents=True,exist_ok=True);(app/'Contents/MacOS/Peta').write_text('portable executable')
elif name=='ditto':pathlib.Path(sys.argv[-1]).write_text('zip')
elif name=='xcrun':
 if sys.argv[1:3]==['notarytool','submit']:
  dmg=sys.argv[3].endswith('.dmg')
  print(json.dumps({'status':os.environ.get('MOCK_DMG_STATUS' if dmg else 'MOCK_STATUS','Accepted')}))
 elif sys.argv[1:3]==['stapler','staple']:
  target=pathlib.Path(sys.argv[3])
  if target.suffix=='.app':(app/'ticket').write_text('ticket')
  else:target.write_text(target.read_text()+'dmg-stapled')
'''
 for name in ['security','npm','ditto','xcrun','codesign','spctl']:
  p=b/name;p.write_text(mock);p.chmod(0o755)
 env=dict(os.environ,PATH=str(b)+':'+os.environ['PATH'],MOCK_LOG=str(log),PETA_APP_PATH=str(app),PETA_RELEASE_OUTPUT=str(output))
 for key in ['APPLE_SIGNING_IDENTITY','PETA_NOTARY_PROFILE','MOCK_STATUS','MOCK_DMG_STATUS']:env.pop(key,None)
 run=lambda:subprocess.run(['bash',str(SCRIPT)],env=env,capture_output=True,text=True)
 r=run();assert r.returncode==2 and not log.exists(),r.stderr
 env.update(APPLE_SIGNING_IDENTITY='Developer ID Application: Test (TEST)',PETA_NOTARY_PROFILE='test-only',MOCK_STATUS='Invalid')
 r=run();assert r.returncode!=0 and not output.exists();assert not (app/'ticket').exists()
 log.unlink();env['MOCK_STATUS']='Accepted';env['MOCK_DMG_STATUS']='Invalid'
 r=run();assert r.returncode!=0 and not output.exists(),(r.stdout,r.stderr)
 log.unlink();(app/'ticket').unlink();env['MOCK_DMG_STATUS']='Accepted'
 r=run();assert r.returncode==0,(r.stdout,r.stderr);assert output.read_text()=='app-stapled\ndmg-stapled',output.read_text()
 assert 'publish-release.sh' in r.stdout
 calls=[json.loads(l) for l in log.read_text().splitlines()];names=[c[0] for c in calls]
 assert names==['security','npm','codesign','codesign','ditto','xcrun','xcrun','xcrun','codesign','spctl','make-dmg','codesign','codesign','xcrun','xcrun','xcrun','spctl'],names
 sign=next(c for c in calls if c[0]=='codesign');assert '--options' in sign and 'runtime' in sign and '--timestamp' in sign
 assert calls[5][1:3]==['notarytool','submit'] and '--wait' in calls[5]
 dmg_sign=calls[11];assert '--timestamp' in dmg_sign and dmg_sign[-1].endswith('.dmg')
 assert calls[13][1:3]==['notarytool','submit'] and calls[13][3].endswith('.dmg') and '--wait' in calls[13]
 assert calls[16][1:]==['-a','-vv','--type','open','--context','context:primary-signature',calls[16][-1]]
 log.unlink();r=run();assert r.returncode==2 and not log.exists()
 # --unsigned: no Apple tools or credentials; the ad-hoc app goes straight into the disk image.
 output.unlink();log.unlink(missing_ok=True);(app/'ticket').unlink()
 for key in ['APPLE_SIGNING_IDENTITY','PETA_NOTARY_PROFILE']:env.pop(key,None)
 r=subprocess.run(['bash',str(SCRIPT),'beta','--unsigned'],env=env,capture_output=True,text=True);assert r.returncode==0,(r.stdout,r.stderr)
 assert output.read_text()=='app-unstapled\n' and '--unsigned' in r.stdout
 names=[json.loads(l)[0] for l in log.read_text().splitlines()];assert names==['npm','codesign','make-dmg'],names
 r=subprocess.run(['bash',str(SCRIPT),'beta','--sign-later'],env=env,capture_output=True,text=True);assert r.returncode==2
 print('PASS: missing credentials stop before tools; a rejected app or disk image stops before output; Accepted signs, notarizes and staples the app, then the disk image made from the stapled app; existing output is protected; --unsigned packs the ad-hoc app without Apple. Mock tools only.')
