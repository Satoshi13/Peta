#!/usr/bin/env python3
"""Check art contract, pixel coverage, shadow envelope and runtime budgets."""
import json,struct,subprocess,importlib.util
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage
ROOT=Path(__file__).resolve().parents[1]; ART=ROOT/'src/art'
manifest=json.loads((ART/'manifest.json').read_text())
errors=[]; checked=0
spec=importlib.util.spec_from_file_location('art_restyle',ROOT/'scripts/art-restyle.py')
restyle=importlib.util.module_from_spec(spec); spec.loader.exec_module(restyle)
sample_stats=[]
def require(ok,message):
 if not ok: errors.append(message)
for item in manifest['assets']:
 path=ART/item['file']; require(path.is_file(),'Missing '+item['file'])
 if not path.is_file(): continue
 limit=900000 if path.parent.name=='samples' else 600000
 require(path.stat().st_size<=limit,'Over art byte budget: '+item['file'])
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
  rgb=data[a>=128,:3].astype(float)/255
  saturation=(rgb.max(axis=1)-rgb.min(axis=1))/np.maximum(rgb.max(axis=1),1/255)
  p99=float(np.percentile(saturation,99))
  require(p99<=.90,'Sample saturation p99 exceeds 0.90: '+item['file'])
  require(np.all(distance[a>0]<=1.5),'Sample contains a baked contact shadow: '+item['file'])
  bordered,rim=restyle.sticker_with_border(im.convert('RGBA'))
  cut=rim>=.5
  _,n=ndimage.label(cut)
  require(n==1,'Border composite has disconnected pieces: '+item['file'])
  require(not np.any(ndimage.binary_fill_holes(cut)&~cut),'Border composite has holes: '+item['file'])
  ba=np.asarray(bordered)[:,:,3]
  require(np.all(ba[:4]==0) and np.all(ba[-4:]==0) and np.all(ba[:,:4]==0) and np.all(ba[:,-4:]==0),'Border composite clipped: '+item['file'])
  sample_stats.append((item['file'],p99,n))
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
if manifest.get('stage', 1) >= 2:
 required_p1 = {
  'print/print-slot.png':(2400,48),'print/print-slot-glow.png':(2400,160),
  'print/backing-sheet.png':(1000,1500),'fx/peta-tag-ja.png':(480,240),'fx/peta-tag-en.png':(480,240),
  'arrival/arrival-material.png':(480,340),'arrival/arrival-gift.png':(480,340),
  'gift/wax-seal.png':(240,240),'gift/wax-seal-left.png':(240,240),'gift/wax-seal-right.png':(240,240),
  'gift/mystery-sticker.png':(600,600),'gift/note-blank.png':(640,400),
  'back/paper-cream.jpg':(1024,1024),'back/paper-kraft.jpg':(1024,1024),
  'back/stamp-original-frame.png':(480,200),'back/peta-mark-small.png':(320,120),
  'back/edition-ribbon.png':(320,160),'back/torn-edge-mask.png':(1024,128),
  'book/cover-kraft.png':(1600,1100),'book/page-left.jpg':(1400,1000),'book/page-right.jpg':(1400,1000),
  'book/spiral-rings.png':(96,1000),'book/page-curl-shadow.png':(1400,1000),
  'empty/collection-empty.png':(640,400),'empty/nothing-to-peel.png':(640,400),'onboarding/hero.png':(1400,900),
 }
 required_p1.update({f'book/tab-blank-{i}.png':(240,120) for i in range(1,7)})
 required_p1.update({f'samples/{n}.png':None for n in ('cat-skateboard','fried-egg','good-day','blue-flower','polaroid-mountain','retro-computer','coffee-cup','peta-bubble','purple-scribble','film-camera','potted-plant','cassette-tape')})
 for name,size in required_p1.items():
  require(name in paths,'Missing required P1 asset: '+name)
  if name in paths and size:
   require(Image.open(ART/name).size==size,'P1 contract dimensions: '+name)
 for item in manifest['assets']:
  require(all(key in item for key in ('id','file','width','height','alpha','priority','usedBy','prompt','status')),'Missing production metadata: '+item['file'])
 left=Image.open(ART/'gift/wax-seal-left.png').convert('RGBA')
 right=Image.open(ART/'gift/wax-seal-right.png').convert('RGBA')
 whole=Image.open(ART/'gift/wax-seal.png').convert('RGBA')
 require(np.array_equal(np.array(Image.alpha_composite(left,right)),np.array(whole)),'Wax halves do not reproduce intact seal')
 require(not np.any((np.array(left)[:,:,3]>0)&(np.array(right)[:,:,3]>0)),'Wax split overlaps')
 rings=np.array(Image.open(ART/'book/spiral-rings.png').convert('RGBA'))
 require(np.array_equal(rings[:-50],rings[50:]),'Spiral does not tile at 50px pitch')
 for name in ('cream','kraft'):
  paper=np.array(Image.open(ART/f'back/paper-{name}.jpg')).astype(float)
  require(np.abs(paper[0]-paper[-1]).mean()<2 and np.abs(paper[:,0]-paper[:,-1]).mean()<2,'Paper tile seam exceeds subtle texture: '+name)
  if manifest.get('sampleStyle'):
   luminance=paper@np.array([.2126,.7152,.0722])
   require(3<=luminance.std()<=6,'Paper texture standard deviation outside 3–6: '+name)
   base=np.array([245,240,230] if name=='cream' else [201,168,120])
   require(np.max(np.abs(paper.mean(axis=(0,1))-base))<2,'Paper mean palette drift: '+name)
 for name,cap in [('print/print-slot-glow.png',26),('book/page-curl-shadow.png',28)]:
  mask=np.array(Image.open(ART/name).convert('RGBA'))
  require(mask[:,:,3].max()<=cap,'Intentional mask opacity: '+name)
  if 'shadow' in name:
   require(np.all(mask[mask[:,:,3]>0,:3]==43),'Page shadow is tinted')
   require(np.count_nonzero(np.any(mask[:,:,3]>0,axis=0))<=6,'Page shadow wider than six pixels')
 hero=np.array(Image.open(ART/'onboarding/hero.png').convert('RGBA'))
 require(np.all(hero[220:640,480:910,3]==255),'Hero label area not opaque')
 require(np.ptp(hero[220:640,480:910,:3],axis=(0,1)).max()<=1,'Hero centre not blank for runtime text')
 if manifest.get('sampleStyle'):
  h=next(a for a in manifest['assets'] if a['file']=='onboarding/hero.png')
  x,y,w,ht=h['labelRect']; centre=hero[y:y+ht,x:x+w]
  require(np.all(centre[:,:,3]==255) and np.ptp(centre[:,:,:3],axis=(0,1)).max()<=1,'Hero full labelRect is not blank')
  require(len(h['sampleSources'])==5 and len(set(h['sampleSources']))==5,'Hero needs five distinct samples')
  require(all(abs(p['rotationDeg'])<=10 for p in h['placements']),'Hero rotations exceed ten degrees')
  require(max(h['overlapFractions'])<=.15 and max(h['overlapFractions'])>0,'Hero overlap must exist and stay below 15%')
if errors:
 print('\n'.join(errors)); raise SystemExit(1)
print(f'PASS: {len(manifest["assets"])} assets; {sum(e["bytes"] for e in manifest["assets"]):,} bytes; interior alpha 255; neutral shadows <=30/255 and <=6px; layer equality; hooks; sample saturation and hole-free die-cut composites; source exclusion.')
for file,p99,pieces in sample_stats: print(f'  {file}: saturation p99={p99:.3f}, die-cut pieces={pieces}, holes=0')
