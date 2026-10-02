#!/usr/bin/env python3
"""Check art contract, pixel coverage, shadow envelope and runtime budgets."""
import json,struct,subprocess
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage
ROOT=Path(__file__).resolve().parents[1]; ART=ROOT/'src/art'
manifest=json.loads((ART/'manifest.json').read_text())
errors=[]; checked=0
def require(ok,message):
 if not ok: errors.append(message)
for item in manifest['assets']:
 path=ART/item['file']; require(path.is_file(),'Missing '+item['file'])
 if not path.is_file(): continue
 require(path.stat().st_size<=600000,'Over 600 KB: '+item['file'])
 require(path.stat().st_size==item['bytes'],'Manifest byte mismatch: '+item['file'])
 if path.suffix=='.svg':
  text=path.read_text(); require('<image' not in text and '<text' not in text,'SVG must use paths, no bitmap/font: '+item['file'])
  continue
 im=Image.open(path); require(im.size==(item['width'],item['height']),'Dimensions: '+item['file'])
 require(bool(im.info.get('icc_profile')),'Missing sRGB profile: '+item['file'])
 if path.suffix=='.jpg':
  require(path.stat().st_size<=500000,'Texture exceeds 500 KB: '+item['file']); continue
 require(path.read_bytes()[25]==6,'PNG must be RGB24 + 8-bit alpha: '+item['file'])
 data=np.array(im.convert('RGBA')); a=data[:,:,3]
 require(np.all(data[a==0,:3]==0),'Nonzero invisible RGB: '+item['file'])
 if item.get('intentionalTranslucency'): continue
 core=a>=128; inside=ndimage.binary_erosion(core,iterations=3)
 require(np.all(a[inside]==255),'Internal surface alpha is not 255: '+item['file'])
 distance=ndimage.distance_transform_edt(~core); shadow=(distance>2)&(a>0)
 require(np.all(a[shadow]<=30),'Contact shadow exceeds 12%: '+item['file'])
 require(np.all(distance[a>0]<=6.1),'Contact shadow exceeds 6px: '+item['file'])
 require(np.all(np.ptp(data[:,:,:3][shadow].astype(int),axis=1)<=1),'Tinted contact shadow: '+item['file'])
 if path.parent.name=='samples':
  require(len(np.unique(data[a==255,:3],axis=0))<=4,'Sample exceeds four flat colours: '+item['file'])
  require(max(im.size)==1024,'Sample long edge: '+item['file'])
  require(np.all(a[:8]==0) and np.all(a[-8:]==0) and np.all(a[:,:8]==0) and np.all(a[:,-8:]==0),'Sample transparent 8px margin: '+item['file'])
 checked+=1
# The four separately exported envelope layers must reproduce closed at every pixel.
composite=Image.new('RGBA',(720,480))
for part in ('back','card','pocket','flap'):
 im=Image.open(ART/f'today/envelope-{part}.png').convert('RGBA')
 require(im.size==(720,480),'Envelope shared canvas: '+part)
 composite=Image.alpha_composite(composite,im)
require(np.array_equal(np.array(composite),np.array(Image.open(ART/'today/envelope-closed.png').convert('RGBA'))),'Envelope composite differs from closed')
sheet=Image.open(ART/'creator/cut-line-sheet.png').convert('RGBA')
require(sheet.size==(6720,300),'12-frame sprite canvas')
for frame in range(12):
 require(np.array_equal(np.array(sheet.crop((frame*560,0,(frame+1)*560,300))),np.array(Image.open(ART/f'creator/cut-line-{frame:02}.png').convert('RGBA'))),'Sprite frame differs: '+str(frame))
# User-authorized Stage 1 must retain all original hook ids and data-art values.
from html.parser import HTMLParser
class Hooks(HTMLParser):
 def __init__(self): super().__init__(); self.ids=set(); self.art=set()
 def handle_starttag(self,tag,attrs):
  attrs=dict(attrs)
  if 'id' in attrs: self.ids.add(attrs['id'])
  if 'data-art' in attrs: self.art.add(attrs['data-art'])
for file in ('src/today.html','src/creator.html'):
 before=Hooks(); before.feed(subprocess.check_output(['git','show',f'HEAD:{file}'],cwd=ROOT).decode())
 after=Hooks(); after.feed((ROOT/file).read_text())
 require(before.ids<=after.ids,'Removed ids: '+file); require(before.art<=after.art,'Removed data-art: '+file)
paths={a['file'] for a in manifest['assets']}
actual={str(p.relative_to(ART)) for p in ART.rglob('*') if p.suffix in ('.png','.jpg','.svg')}
require(paths==actual,'Manifest does not cover all runtime assets')
require(sum(e['bytes'] for e in manifest['assets'])<=25000000,'P0 exceeds 25 MB')
tracked=subprocess.check_output(['git','ls-files','assets-src/art'],cwd=ROOT).decode().strip()
require(not tracked,'Generated source art remains tracked')
required=['brand/app-icon-1024.png','brand/logo-wordmark-white.png','brand/logo-wordmark-white.svg','brand/logo-wordmark-ink.svg','today/choice-pack-box.png','today/choice-pack-pouch.png','materials/swatch-matte.png','materials/swatch-kraft.png','materials/swatch-holographic.png','creator/cutting-mat.jpg','creator/tape-1.png','creator/tape-2.png','creator/tape-3.png','creator/tape-4.png']
for name in required: require(name in paths,'Missing required P0 asset: '+name)
if errors:
 print('\n'.join(errors)); raise SystemExit(1)
print(f'PASS: {len(manifest["assets"])} assets; {sum(e["bytes"] for e in manifest["assets"]):,} bytes; interior alpha 255; neutral shadows <=30/255 and <=6px; layer equality; hooks; 4-colour samples; source exclusion.')

