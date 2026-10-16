"""Disposable signing key and pruning regression checks. Never print the generated private key."""
from pathlib import Path
import importlib.util,tempfile,subprocess,os,base64,json
ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('prune',ROOT/'scripts/prune-releases.py');prune=importlib.util.module_from_spec(spec);spec.loader.exec_module(prune)
objects=[{'key':f'releases/Peta-{v}.dmg','size':10} for v in ['0.1.0','0.2.0','0.3.0','0.4.0']]
objects += [{'key':f'releases/updates/{v}/Peta.app.tar.gz{ext}','size':5} for v in ['0.1.0','0.2.0','0.3.0','0.4.0'] for ext in ['', '.sig']]
objects += [{'key':'releases/unrelated.key','size':4},{'key':'releases/latest.json','size':20}]
latest={'version':'0.1.0','file':'Peta-0.1.0.dmg','update':{'file':'updates/0.1.0/Peta.app.tar.gz'}}
result=prune.plan(objects,latest,2)
assert result['versions']==4 and result['bytes']==104
assert result['remove']==['releases/Peta-0.2.0.dmg','releases/updates/0.2.0/Peta.app.tar.gz','releases/updates/0.2.0/Peta.app.tar.gz.sig']
# Version order handles 0.10 versus 0.9 and stable versus prerelease; unrelated keys stay untouched.
assert prune.plan([{'key':f'releases/Peta-{v}.dmg','size':1} for v in ['0.9.0','0.10.0-rc.1','0.10.0']],{'version':'0.10.0','file':'Peta-0.10.0.dmg'},1)['remove']==['releases/Peta-0.10.0-rc.1.dmg','releases/Peta-0.9.0.dmg']
with tempfile.TemporaryDirectory(prefix='peta-disposable-updater-') as tmp:
 t=Path(tmp);key=t/'test.key';app=t/'Peta.app';(app/'Contents').mkdir(parents=True);(app/'Contents/test-ticket').write_text('stapled test')
 env=dict(os.environ,TAURI_SIGNING_PRIVATE_KEY_PASSWORD='')
 r=subprocess.run([str(ROOT/'node_modules/.bin/tauri'),'signer','generate','--ci','--write-keys',str(key)],env=env,capture_output=True)
 assert r.returncode==0,'Disposable test key generation failed.'
 env['TAURI_SIGNING_PRIVATE_KEY_PATH']=str(key)
 archive=t/'Peta.app.tar.gz'
 r=subprocess.run(['bash',str(ROOT/'scripts/updater-artifact.sh'),str(app),'0.0.2-test',str(archive)],env=env,capture_output=True)
 assert r.returncode==0,'Disposable artifact signing failed.'
 assert archive.is_file() and Path(str(archive)+'.sig').is_file()
 text=base64.b64decode(Path(str(archive)+'.sig').read_text()).decode()
 assert '0.0.2-test' in text,'The signature must bind the app version.'
 r=subprocess.run(['bash',str(ROOT/'scripts/updater-artifact.sh'),str(app),'0.0.2-test',str(archive)],env=env,capture_output=True)
 assert r.returncode!=0,'Existing artifacts must not be overwritten.'
print('PASS: disposable updater signature binds version; old releases list correctly; latest references are protected.')
