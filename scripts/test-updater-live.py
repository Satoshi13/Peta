#!/usr/bin/env python3
"""Isolated universal ad-hoc 0.0.1-test -> 0.0.2-test on dev. Never use for distribution."""
import argparse,datetime,json,os,pathlib,plistlib,shutil,subprocess,tempfile,time,sys,signal
ROOT=pathlib.Path(__file__).resolve().parent.parent
CLI=ROOT/'node_modules/.bin/tauri'
BUNDLE=ROOT/'src-tauri/target/universal-apple-darwin/release/bundle/macos/Peta.app'
BUCKET='peta-downloads-dev'
def wrangler(args,**kw):return subprocess.run(['npx','wrangler',*args],cwd=ROOT/'cloudflare/peta-download',**kw)
def main():
 p=argparse.ArgumentParser();p.add_argument('--old-app');p.add_argument('--new-app');p.add_argument('--key');p.add_argument('--skip-location',action='store_true');args=p.parse_args()
 test=pathlib.Path(tempfile.mkdtemp(prefix='peta-updater-live-')).resolve();print('Isolated test:',test,flush=True)
 env=dict(os.environ,CARGO_INCREMENTAL='0',TAURI_SIGNING_PRIVATE_KEY_PASSWORD='',TMPDIR=str(pathlib.Path(tempfile.gettempdir()).resolve()))
 for name in list(env):
  if name.startswith('APPLE_'):env.pop(name)
 if args.key:
  key=pathlib.Path(args.key).resolve()
  if not (str(key).startswith('/private/tmp/') or key.is_relative_to(pathlib.Path(tempfile.gettempdir()).resolve())) or not key.name.startswith('disposable'):raise SystemExit('Use a disposable test key in a temporary directory only.')
 else:
  key=test/'disposable.key';r=subprocess.run([str(CLI),'signer','generate','--ci','--write-keys',str(key)],env=env,capture_output=True)
  if r.returncode:raise SystemExit('Disposable signing failed.')
 public=pathlib.Path(str(key)+'.pub').read_text().strip()
 env.update(TAURI_SIGNING_PRIVATE_KEY=str(key),TAURI_SIGNING_PRIVATE_KEY_PATH=str(key))
 def build(version):
  config=test/(version+'.json');config.write_text(json.dumps({'productName':'Peta','identifier':'app.peta.updater-test','version':version,'bundle':{'createUpdaterArtifacts':True,'macOS':{'signingIdentity':'-'}},'plugins':{'updater':{'pubkey':public,'requireSignedVersion':True,'endpoints':[]},'deep-link':{'desktop':{'schemes':['peta-updater-test']}}}}))
  print('Building',version,flush=True)
  with (test/(version+'.log')).open('w') as log:
   r=subprocess.run([str(CLI),'build','--target','universal-apple-darwin','--features','updater-test','--config',str(config)],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
  if r.returncode:raise RuntimeError('Test build failed; inspect its log in the test directory.')
  return BUNDLE
 old=test/'old/Peta.app';old.parent.mkdir()
 source=pathlib.Path(args.old_app) if args.old_app else build('0.0.1-test')
 subprocess.run(['ditto',str(source),str(old)],check=True)
 with (old/'Contents/Info.plist').open('rb') as f:info=plistlib.load(f)
 if info['CFBundleIdentifier']!='app.peta.updater-test' or info['CFBundleShortVersionString']!='0.0.1-test':raise RuntimeError('Refusing a non-test old app.')
 new=pathlib.Path(args.new_app).resolve() if args.new_app else build('0.0.2-test')
 with (new/'Contents/Info.plist').open('rb') as f:new_info=plistlib.load(f)
 if new_info['CFBundleIdentifier']!='app.peta.updater-test' or new_info['CFBundleShortVersionString']!='0.0.2-test':raise RuntimeError('Refusing a non-test new app.')
 binaries=[old/'Contents/MacOS'/info['CFBundleExecutable'],new/'Contents/MacOS'/info['CFBundleExecutable']]
 for binary in binaries:
  if binary != binary.resolve():raise RuntimeError('Launch paths must not contain symlink ancestors (Tauri current_exe protection).')
  archs=subprocess.check_output(['lipo','-archs',str(binary)],text=True).split();assert set(archs)=={'arm64','x86_64'}
  subprocess.run(['codesign','--verify','--deep','--strict',str(binary.parent.parent.parent)],check=True)
 packages=[]
 for version,app in [('0.0.1-test',old),('0.0.2-test',new)]:
  archive=test/(version+'.app.tar.gz')
  subprocess.run(['bash',str(ROOT/'scripts/updater-artifact.sh'),str(app),version,str(archive)],cwd=ROOT,env=env,check=True)
  packages.append((version,archive))
 # Back up the existing dev switch before changing any release objects.
 backup=test/'latest.backup.json';r=wrangler(['r2','object','get',BUCKET+'/releases/latest.json','--file',str(backup),'--remote'],capture_output=True)
 missing=False
 if r.returncode:
  output=(r.stdout+r.stderr).decode(errors='replace')
  if not any(s in output for s in ['404','does not exist','No object','10007']):raise RuntimeError('Could not back up the dev latest manifest. No release objects changed.')
  missing=True
 uploaded=[];switched=False;process=None
 try:
  for version,archive in packages:
   for suffix,source in [('',archive),('.sig',pathlib.Path(str(archive)+'.sig'))]:
    object=f'{BUCKET}/releases/updates/{version}/Peta.app.tar.gz{suffix}'
    # These exact test versions are reserved for this harness. Never modify non-test versions.
    uploaded.append(object)
    r=wrangler(['r2','object','put',object,'--file',str(source),'--remote'],capture_output=True)
    if r.returncode:raise RuntimeError('Dev test upload failed.')
  archive=packages[1][1]
  manifest={'version':'0.0.2-test','file':'Peta-updater-0.0.2-test.dmg','size':1,'sha256':'0'*64,'minimumSystemVersion':'14.0','architectures':['arm64','x86_64'],'publishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'notarized':False,'update':{'version':'0.0.2-test','file':'updates/0.0.2-test/Peta.app.tar.gz','signature':pathlib.Path(str(archive)+'.sig').read_text().strip(),'notes':'Isolated updater test only.'}}
  manifest_path=test/'latest.test.json';manifest_path.write_text(json.dumps(manifest))
  switched=True
  r=wrangler(['r2','object','put',BUCKET+'/releases/latest.json','--file',str(manifest_path),'--content-type','application/json','--remote'],capture_output=True)
  if r.returncode:raise RuntimeError('Could not publish the dev test switch.')
  library=test/'library';library.mkdir();env['PETA_UPDATER_TEST_ROOT']=str(library)
  if not args.skip_location:env['PETA_UPDATER_TEST_LOCATION']='1'
  print('Launching isolated old app; it will update and restart itself.',flush=True)
  with (test/'app.log').open('w') as log:
   process=subprocess.Popen([str(binaries[0]),'-ApplePersistenceIgnoreState','YES','-NSQuitAlwaysKeepsWindows','NO'],env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
   deadline=time.monotonic()+240
   while time.monotonic()<deadline:
    if (library/'failed.txt').exists():raise RuntimeError((library/'failed.txt').read_text())
    if process.poll() not in (None,0) and not (library/'result.json').exists():raise RuntimeError('The isolated app exited before completing the update. Inspect app.log.')
    if (library/'result.json').exists():
     result=json.loads((library/'result.json').read_text());(test/'result.json').write_text(json.dumps(result,indent=2))
     if not result['dataPreserved']:raise RuntimeError('Data did not survive the update.')
     print(json.dumps({'version':result['version'],'dataPreserved':result['dataPreserved'],'permissionsPreserved':result['permissionsPreserved'],'locationBefore':result['before']['location'],'locationAfter':result['after']['location']}),flush=True);break
    time.sleep(1)
   else:raise RuntimeError('Timed out waiting for the restarted app. Inspect the isolated app log.')
 finally:
  if process:
   # Restarted children inherit this isolated process group too.
   try:os.killpg(process.pid,signal.SIGTERM)
   except ProcessLookupError:pass
  cleanup=[]
  if switched:
   command=['r2','object','delete',BUCKET+'/releases/latest.json','--remote'] if missing else ['r2','object','put',BUCKET+'/releases/latest.json','--file',str(backup),'--content-type','application/json','--remote']
   if wrangler(command,capture_output=True).returncode:cleanup.append('dev latest manifest')
  for object in reversed(uploaded):
   if wrangler(['r2','object','delete',object,'--remote'],capture_output=True).returncode:cleanup.append(object)
  if cleanup:raise RuntimeError('Dev cleanup needs attention: '+', '.join(cleanup))
  print('Dev latest restored; disposable R2 test files removed.',flush=True)
 print('Result and logs:',test,flush=True)
if __name__=='__main__':
 try:main()
 except Exception as error:print(str(error),file=sys.stderr);sys.exit(1)
