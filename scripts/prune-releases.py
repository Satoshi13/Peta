#!/usr/bin/env python3
"""List release storage and ask before pruning. Credentials stay in memory, never in argv or logs."""
import argparse,json,pathlib,re,subprocess,urllib.request,urllib.parse,sys,tempfile
ROOT=pathlib.Path(__file__).resolve().parent.parent
VERSION=r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?'
def plan(objects, latest, keep=3):
 if keep<1:raise ValueError('Keep at least one version.')
 versions={}
 for obj in objects:
  key=obj['key']; m=re.fullmatch(r'releases/(?:Peta(?:-offline)?-('+VERSION+r')\.dmg|updates/('+VERSION+r')/Peta\.app\.tar\.gz(?:\.sig)?)',key)
  if not m:continue
  version=re.sub(r'^releases/(?:Peta(?:-offline)?-|updates/)', '', key).split('/')[0].removesuffix('.dmg')
  versions.setdefault(version,[]).append(obj)
 def semver(v):
  main,_,pre=v.partition('-');return (*map(int,main.split('.')),not bool(pre),tuple((0,int(x)) if x.isdigit() else (1,x) for x in pre.split('.')))
 retained=set(sorted(versions,key=semver,reverse=True)[:keep])|{latest['version']}
 # Independently protect every exact path referenced by the current manifest.
 protected={'releases/latest.json','releases/'+latest['file']}
 if latest.get('update'):protected|={'releases/'+latest['update']['file'],'releases/'+latest['update']['file']+'.sig'}
 remove=sorted(o['key'] for v,rows in versions.items() if v not in retained for o in rows if o['key'] not in protected)
 return {'bytes':sum(int(o['size']) for o in objects),'versions':len(versions),'remove':remove}
def wrangler(args,**kwargs):
 return subprocess.run(['npx','wrangler',*args],cwd=ROOT/'cloudflare/peta-download',**kwargs)
def inventory(bucket, account):
 r=wrangler(['auth','token','--json'],capture_output=True,text=True)
 if r.returncode:raise RuntimeError('Cannot obtain Wrangler credentials. Nothing was removed.')
 try:
  credentials=json.loads(r.stdout);token=credentials.get('token')
  if not isinstance(token,str) or not token:raise ValueError()
 except Exception:raise RuntimeError('Wrangler credentials are unavailable. Nothing was removed.') from None
 objects=[];cursor=None
 while True:
  query=urllib.parse.urlencode(({'cursor':cursor} if cursor else {}))
  req=urllib.request.Request(f'https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/{bucket}/objects?{query}',headers={'Authorization':'Bearer '+token})
  try:
   with urllib.request.urlopen(req,timeout=30) as response:data=json.load(response)
  except Exception:raise RuntimeError('Could not list release storage. Nothing was removed.') from None
  if not data.get('success') or not isinstance(data.get('result'),list):raise RuntimeError('Invalid storage listing. Nothing was removed.')
  objects.extend(data['result']);cursor=data.get('result_info',{}).get('cursor')
  if not cursor:break
 return objects

def current_manifest(bucket):
 with tempfile.TemporaryDirectory(prefix='peta-current-release-') as tmp:
  path=pathlib.Path(tmp)/'latest.json'
  r=wrangler(['r2','object','get',bucket+'/releases/latest.json','--file',str(path),'--remote'],capture_output=True)
  try:
   if r.returncode:raise ValueError()
   value=json.loads(path.read_text())
   if not isinstance(value.get('version'),str) or not isinstance(value.get('file'),str):raise ValueError()
   return value
  except Exception:raise RuntimeError('Cannot recheck the live latest manifest. Nothing was removed.') from None

def main():
 p=argparse.ArgumentParser();p.add_argument('target',choices=['dev','prod']);p.add_argument('manifest');p.add_argument('--keep',type=int,default=3);args=p.parse_args()
 latest=json.loads(pathlib.Path(args.manifest).read_text());bucket='peta-downloads-'+args.target
 # Account ID is public configuration, never an API credential.
 config=(ROOT/'cloudflare/peta-download/wrangler.jsonc').read_text();account=re.search(r'"account_id"\s*:\s*"([a-f0-9]{32})"',config).group(1)
 objects=inventory(bucket,account);latest=current_manifest(bucket);result=plan(objects,latest,args.keep)
 print(f"Bucket storage: {result['bytes']:,} bytes ({result['bytes']/1024**3:.2f} GiB), {result['versions']} versions. R2 free storage: 10 GB.")
 if not result['remove']:print('No old releases to remove.');return
 print('Older release files eligible for removal:');print('\n'.join(result['remove']))
 if input('Delete these files? [y/N] ').lower()!='y':print('Nothing was removed.');return
 for key in result['remove']:
  if key not in plan(objects,current_manifest(bucket),args.keep)['remove']:
   print('Skipped a file protected by the current latest manifest.');continue
  if wrangler(['r2','object','delete',bucket+'/'+key,'--remote']).returncode:raise RuntimeError('Removal stopped. Run the listing again before retrying.')
if __name__=='__main__':
 try:main()
 except (RuntimeError,ValueError) as e:print(str(e),file=sys.stderr);sys.exit(1)
