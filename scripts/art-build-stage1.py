#!/usr/bin/env python3
"""Build aligned P0 art and derivatives. Production-only dependencies listed in docs/art-stage1-report.md."""
from pathlib import Path
import importlib.util, sys, json, math, io, re, html
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps
from scipy import ndimage
import cairosvg, vtracer
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('art_export', ROOT/'scripts/art-export.py')
art=importlib.util.module_from_spec(spec); spec.loader.exec_module(art)
OUT=ROOT/'src/art'
SOURCE=ROOT/'assets-src/art/stage0'
WORK=ROOT/'assets-src/art/stage1'; WORK.mkdir(parents=True,exist_ok=True)
records=[]
def record(rel,id,info,prompt,alpha=True,**extra):
 records.append(dict(id=id,file=rel,**info,alpha=alpha,priority={'BK':'P1','SM':'P1','PK':'P2'}.get(id[:2],'P0'),usedBy={'TD':['today.html'],'MT':['today.html','creator.html'],'CR':['creator.html'],'BR':['brand','art/preview.html'],'BK':['today/choice-collection.png','art/preview.html'],'PK':['today/choice-pack-pouch.png','art/preview.html'],'SM':['art/preview.html']}[id[:2]],prompt=prompt,status='ready',**extra))
def save(rel,id,image,shadow=True,translucent=False,prompt='Derived from approved Stage 0 artwork; corrected coverage alpha and neutral short contact shadow.',**extra):
 info=art.export(image,'src/art/'+rel,shadow,translucent)
 record(rel,id,info,prompt,**extra)
 return Image.open(OUT/rel).convert('RGBA')
def raster(svg):
 return Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode()))).convert('RGBA')
def svg(w,h,body):
 return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{body}</svg>'
def maskpart(im,mask):
 a=np.array(im); a[:,:,3]=np.minimum(a[:,:,3],mask.astype(np.uint8)); return Image.fromarray(a)
def generated(job,size,choice=0,tight=False,shadow=True):
 config=json.loads((WORK/'generation.json').read_text())[job]
 im=Image.open(WORK/config['file']).convert('RGBA'); w,h=im.size
 cell=im.crop(((choice%2)*w//2,(choice//2)*h//2,((choice%2)+1)*w//2,((choice//2)+1)*h//2))
 cell=art.fit(cell,size,tight=tight)
 return cell,config['prompt']
def source(rel):
 return Image.open(SOURCE/rel).convert('RGBA')
def flat_colours(image,colours):
 data=np.array(image.convert('RGBA'))
 palette=np.array([tuple(bytes.fromhex(c.lstrip('#'))) for c in colours],dtype=float)
 pixels=data[:,:,:3].astype(float)
 distances=np.sum((pixels[:,:,None,:]-palette[None,None,:,:])**2,axis=3)
 colour_index=ndimage.median_filter(np.argmin(distances,axis=2),size=5)
 data[:,:,:3]=palette[colour_index].astype('uint8')
 return Image.fromarray(data)
# Brush lettering: preserve the approved hand rather than substituting a font.
logo,_=art.clean_alpha(source('brand/logo-wordmark-ink.png'))
a=np.asarray(logo)[:,:,3]; solid=a>=128
mask=Image.fromarray(np.where(solid,0,255).astype('uint8')).convert('RGB')
mask.save(WORK/'logo-trace.png')
vtracer.convert_image_to_svg_py(str(WORK/'logo-trace.png'),str(WORK/'logo-trace.svg'),colormode='binary',mode='spline',filter_speckle=24,corner_threshold=60,length_threshold=4,splice_threshold=45,path_precision=2)
trace=(WORK/'logo-trace.svg').read_text()
paths=re.findall(r'<path[^>]+>',trace)
# Binary tracing produces only the black brush silhouette, including letter counters.
for colour,name in [('#2B2A28','ink'),('#FBF9F4','white')]:
 body=''.join(re.sub(r'fill="[^"]+"',f'fill="{colour}"',p) for p in paths)
 vector=svg(1600,700,body)
 rel=f'brand/logo-wordmark-{name}.svg'; (OUT/rel).write_text(vector)
 record(rel,'BR-01',dict(width=1600,height=700,bytes=(OUT/rel).stat().st_size), 'Vector paths traced from the approved Peta brush lettering; no fonts or embedded bitmap.')
 save(f'brand/logo-wordmark-{name}.png','BR-01',raster(vector),False,prompt='Rasterized from the matching path-only Peta wordmark SVG.')
tray=svg(44,44,'<path fill="#000" d="M10 5h22a7 7 0 0 1 7 7v15L27 39H12a7 7 0 0 1-7-7V12a7 7 0 0 1 5-7zm19 21v10l8-8h-6a2 2 0 0 1-2-2z"/>')
(OUT/'brand/tray-template.svg').write_text(tray)
record('brand/tray-template.svg','BR-03',dict(width=44,height=44,bytes=len(tray.encode())), 'Hand drawn monochrome peeled-corner sticker silhouette; black template image.')
save('brand/tray-template@2x.png','BR-03',raster(tray),False,prompt='44px rasterization of the monochrome SVG template icon.')
icon,p=generated('app-icon',(1024,1024),3)
icon_alpha=np.asarray(icon)[:,:,3]; icon_y,icon_x=np.where(icon_alpha>=128)
tile=icon.crop((icon_x.min(),icon_y.min(),icon_x.max()+1,icon_y.max()+1)).resize((824,824),Image.Resampling.LANCZOS)
icon=Image.new('RGBA',(1024,1024)); icon.paste(tile,(100,100))
save('brand/app-icon-1024.png','BR-02',icon,prompt=p)
# Stage 0 sample corrections, retained without die-cut rims or shadows.
for name in ('cat-skateboard','fried-egg'):
 colours=['#F8E6C7','#E1A361','#AF754B','#4D6570'] if name=='cat-skateboard' else ['#FBF4E3','#F8DDA4','#F8C42F','#EAB322']
 save(f'samples/{name}.png','SM-01',flat_colours(source(f'samples/{name}.png'),colours),False,priorityNote='Stage 0 correction, not Stage 2 production.',baseColours=colours)
flower,p=generated('blue-flower',(1024,1024),0,True)
flower=save('samples/blue-flower.png','SM-01',flat_colours(flower,['#7291D0','#496CAF','#789361','#F7E7AC']),False,prompt=p,priorityNote='Stage 0 correction.',baseColours=['#7291D0','#496CAF','#789361','#F7E7AC'])
pouch,p=generated('pack-pouch',(768,1024),1)
pouch=save('pack/pack-pouch-closed.png','PK-02',pouch,prompt=p,priorityNote='Stage 0 correction; no Pack-opening implementation.')
# Reconstruct the approved simple notebook geometry with quiet kraft surfaces.
# A flat grid avoids seams from replacing the original watercolour flower patch.
cover_body='<defs><linearGradient id="kraft" x2="0" y2="1"><stop stop-color="#D1B183"/><stop offset="1" stop-color="#C9A878"/></linearGradient><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#B8996E" stroke-width="1" opacity=".32"/></pattern></defs><rect x="150" y="146" width="1350" height="824" rx="28" fill="#B08A5B"/><rect x="145" y="130" width="1350" height="824" rx="28" fill="url(#kraft)"/><rect x="160" y="146" width="1320" height="793" rx="18" fill="url(#grid)"/><path d="M175 942h1294" stroke="#DDBF94" stroke-width="4"/>'
for y in range(172,927,48):
 cover_body+=f'<circle cx="173" cy="{y+6}" r="8" fill="#796C59"/><path d="M175 {y}C85 {y-22} 85 {y+34} 175 {y+16}" fill="none" stroke="#858A90" stroke-width="10" stroke-linecap="round"/><path d="M174 {y-2}C97 {y-19} 96 {y+28} 171 {y+13}" fill="none" stroke="#D8DCE2" stroke-width="3" stroke-linecap="round"/>'
cover=raster(svg(1600,1100,cover_body))
sticker=flower.copy(); sticker.thumbnail((245,270),Image.Resampling.LANCZOS)
fm=np.asarray(sticker)[:,:,3]>=128
rim=ndimage.binary_dilation(fm,iterations=10)
rim_image=Image.new('RGBA',sticker.size,'#FBF9F4'); rim_image.putalpha(Image.fromarray((rim*255).astype('uint8')))
badge=Image.alpha_composite(rim_image,sticker)
cover.alpha_composite(badge,(1170,680))
cover=save('book/cover-kraft.png','BK-01',cover,priorityNote='Stage 0 correction.')
# Envelope: one shared 720x480 master, split on the exact same V boundary.
env,_=art.clean_alpha(source('today/envelope-closed.png'))
ea=np.asarray(env)[:,:,3]
yy,xx=np.mgrid[0:480,0:720]
fold=60+205*(1-np.minimum(np.abs(xx-360)/288,1))
flap_mask=np.where(yy<=fold,255,0).astype('uint8')
pocket_mask=255-flap_mask
back=Image.new('RGBA',(720,480),'#C9A878'); back.putalpha(Image.fromarray(ea))
draw=ImageDraw.Draw(back)
draw.polygon([(77,68),(643,68),(360,265)],fill='#B08A5B')
back.putalpha(Image.fromarray(ea))
save('today/envelope-back.png','TD-01',back,layerGroup='envelope',labelRect=[360,250,235,118])
card=raster(svg(720,480,'<rect x="145" y="94" width="430" height="308" rx="13" fill="#FBF9F4" stroke="#EFE8DA" stroke-width="2"/>'))
save('today/envelope-card.png','TD-01',card,False,layerGroup='envelope')
save('today/envelope-pocket.png','TD-01',maskpart(env,pocket_mask),False,layerGroup='envelope',labelRect=[360,250,235,118])
save('today/envelope-flap.png','TD-01',maskpart(env,flap_mask),False,layerGroup='envelope',pivot=[360,60])
closed=Image.new('RGBA',(720,480))
for name in ('back','card','pocket','flap'):
 closed=Image.alpha_composite(closed,Image.open(OUT/f'today/envelope-{name}.png').convert('RGBA'))
# Do not change final RGB/alpha after compositing, so exported parts equal the closed PNG byte-for-pixel.
closed.save(OUT/'today/envelope-closed.png',optimize=True,compress_level=9,icc_profile=art.ICC)
record('today/envelope-closed.png','TD-01',dict(width=720,height=480,bytes=(OUT/'today/envelope-closed.png').stat().st_size),'Exact pixel composite: back → card → pocket → flap.',layerGroup='envelope',labelRect=[360,250,235,118])
# Holographic card keeps the approved pastel membrane and white inner rim.
holo=save('today/material-card-holographic.png','TD-03',source('today/material-card-holographic.png'),labelRect=[48,205,465,100],material='holographic')
# Matte and kraft: same geometry and blank lower-third label, using quiet paper tones.
rng=np.random.default_rng(1302)
for name,colour in [('matte',(245,240,230)),('kraft',(201,168,120))]:
 texture=np.zeros((380,560,4),dtype=np.uint8); texture[:,:,:3]=colour
 noise=rng.normal(0,.7,(380,560,1))
 texture[:,:,:3]=np.clip(texture[:,:,:3].astype(float)+noise,0,255).astype('uint8')
 shape=Image.new('L',(560,380)); d=ImageDraw.Draw(shape); d.rounded_rectangle((44,48,516,332),18,fill=255)
 texture[:,:,3]=np.asarray(shape)
 card=Image.fromarray(texture)
 d=ImageDraw.Draw(card); d.rounded_rectangle((57,217,503,316),12,fill='#FBF9F4')
 save(f'today/material-card-{name}.png','TD-03',card,labelRect=[57,217,446,99],material=name,prompt=f'Constructed paper card, shared blank-label geometry; {name} palette from Stage 0 STYLE LOCK.')
# Foil layers share their master and a short horizontal torn boundary.
foil,p=generated('foil',(720,480),0)
foil,_=art.clean_alpha(foil)
yy,xx=np.mgrid[0:480,0:720]; tear=235+8*np.sin(xx*.10)+4*np.sin(xx*.29)
front_mask=np.where(yy>=tear,255,0).astype('uint8')
save('today/foil-back.png','TD-02',maskpart(foil,255-front_mask),False,prompt=p,layerGroup='foil')
save('today/foil-front.png','TD-02',maskpart(foil,front_mask),True,prompt=p,layerGroup='foil')
# Object choices derive from the same approved/corrected masters.
for job,rel,choice in [('choice-create','choice-create',0),('choice-gift','choice-gift',0),('choice-pack-box','choice-pack-box',0)]:
 im,p=generated(job,(384,384),choice); save(f'today/{rel}.png','TD-05',im,prompt=p)
save('today/choice-collection.png','TD-05',art.fit(cover,(384,384)),prompt='Retina thumbnail of corrected BK-01 cover; same paper and blue flower.')
save('today/choice-pack-pouch.png','TD-05',art.fit(pouch,(384,384)),prompt='Retina thumbnail of corrected PK-02 silver pouch; same gentle folds and blank label.')
note,p=generated('see-you-tomorrow',(640,360),0)
save('today/see-you-tomorrow.png','TD-06',note,prompt=p)
# Swatches: quiet centred material-only chips with a white die-cut rim.
for name in ('matte','kraft','holographic'):
 sw=Image.new('RGBA',(192,192)); d=ImageDraw.Draw(sw); d.rounded_rectangle((20,20,172,172),28,fill='#FBF9F4')
 if name=='holographic':
  tex=source('today/material-card-holographic.png').crop((80,72,460,196)).resize((136,136),Image.Resampling.LANCZOS)
 else:
  tex=Image.new('RGBA',(136,136),'#F5F0E6' if name=='matte' else '#C9A878')
  d=ImageDraw.Draw(tex)
  for _ in range(180):
   x,y=rng.integers(0,136,2); d.line((int(x),int(y),int(x+2),int(y)),fill='#E9E2D5' if name=='matte' else '#C1A172',width=1)
 mask=Image.new('L',(136,136)); ImageDraw.Draw(mask).rounded_rectangle((0,0,135,135),20,fill=255); tex.putalpha(mask)
 sw.alpha_composite(tex,(28,28)); save(f'materials/swatch-{name}.png','MT-01',sw,prompt=f'Material-only {name} swatch derived from the approved Peta palette and holographic film.')
# Small hand-drawn star sprite; no external shadows.
sheet=Image.new('RGBA',(1024,256))
for i in range(4):
 star=raster(svg(256,256,f'<path fill="{["#F6C6E3","#C9C3F5","#BFE3F7","#F7F0BE"][i]}" d="M128 72Q136 119 184 128Q136 137 128 184Q119 137 72 128Q119 119 128 72Z"/><path fill="#FBF9F4" d="M190 40l4 19 18 5-18 5-4 18-5-18-18-5 18-5z"/>'))
 sheet.paste(star,(i*256,0))
save('today/sparkles-sheet.png','TD-04',sheet,False,prompt='Four 256px frames of tiny hand-drawn pastel four-point stars; 600ms transient reveal only.')
# Accurate mat grid: generated texture contributes only the very subtle surface.
mat_config=json.loads((WORK/'generation.json').read_text())['cutting-mat']
mat_im,_=generated('cutting-mat',(2400,1200),0)
texture=mat_im.convert('RGB').resize((2400,1200)).filter(ImageFilter.GaussianBlur(12))
texture=Image.blend(Image.new('RGB',(2400,1200),'#71958D'),texture,.05)
draw=ImageDraw.Draw(texture)
for x in range(0,2400,40):
 draw.line((x,0,x,1200),fill='#93B0A8' if x%200 else '#AAC4BB',width=1 if x%200 else 2)
for y in range(0,1200,40):
 draw.line((0,y,2400,y),fill='#93B0A8' if y%200 else '#AAC4BB',width=1 if y%200 else 2)
for name,dark in [('cutting-mat',False),('cutting-mat-dark',True)]:
 im=texture if not dark else Image.blend(texture,Image.new('RGB',texture.size,'#263C38'),.52)
 im.save(OUT/f'creator/{name}.jpg',quality=90,optimize=True,icc_profile=art.ICC)
 record(f'creator/{name}.jpg','CR-01',dict(width=2400,height=1200,bytes=(OUT/f'creator/{name}.jpg').stat().st_size),mat_config['prompt']+' Accurate drawn grid replaces model grid; no numbers.',alpha=False)
# Twelve aligned cat cut-line frames. The silhouette itself is deliberately 30% translucent.
catpath='M170 218Q153 189 164 155L159 67Q158 56 169 62L215 91Q280 64 345 91L391 62Q403 56 401 69L397 155Q409 189 391 218Q370 244 280 247Q192 245 170 218Z'
sheet=Image.new('RGBA',(6720,300))
for frame in range(12):
 # Flatten path length with SVG dash progression; final view is a dashed full loop.
 length=(frame+1)/12
 # Explicit evenly spaced dots around a sampled, smooth cat silhouette keep a stable 12-frame construction.
 full=raster(svg(560,300,f'<path d="{catpath}" fill="#F5F0E6" fill-opacity=".3"/>'))
 mask=np.asarray(full)[:,:,3]>0
 edge=mask & ~ndimage.binary_erosion(mask)
 coords=np.column_stack(np.where(edge))
 # Sort by angle around the centre: this cat contour is star-shaped and has a stable angular order.
 order=np.argsort(np.arctan2(coords[:,0]-160,coords[:,1]-280)); coords=coords[order]
 distances=np.r_[0,np.cumsum(np.linalg.norm(np.diff(coords,axis=0),axis=1))]
 samples=np.arange(0,distances[-1],14); dots=coords[np.searchsorted(distances,samples)]
 draw=ImageDraw.Draw(full)
 for y,x in dots[:max(3,round(len(dots)*length))]: draw.ellipse((int(x)-2,int(y)-2,int(x)+2,int(y)+2),fill='#2B2A28')
 if frame==11:
  draw.line((424,68,424,82),fill='#C9A878',width=2); draw.line((417,75,431,75),fill='#C9A878',width=2)
  draw.line((134,214,134,228),fill='#C9A878',width=2); draw.line((127,221,141,221),fill='#C9A878',width=2)
 # Preserve intentional 30% fill, opaque ink dots and antialiased outline.
 art.png_budget(full,OUT/f'creator/cut-line-{frame:02}.png')
 record(f'creator/cut-line-{frame:02}.png','CR-02',dict(width=560,height=300,bytes=(OUT/f'creator/cut-line-{frame:02}.png').stat().st_size),'Deterministic progressive dashed cat cut-line; cream silhouette intentionally alpha 30%.',intentionalTranslucency=True,frame=frame)
 sheet.paste(full,(frame*560,0))
art.png_budget(sheet,OUT/'creator/cut-line-sheet.png')
record('creator/cut-line-sheet.png','CR-02',dict(width=6720,height=300,bytes=(OUT/'creator/cut-line-sheet.png').stat().st_size),'Exact horizontal concatenation of the 12 aligned cut-line frames.',intentionalTranslucency=True)
# Four SVG-designed translucent washi strips; pattern printed on cream/pastel paper.
path='M42 40l5-7 6 5 5-7 6 5h346l7-5 7 7 7-5-4 14 5 7-5 7 5 8-5 7 5 8-5 6 4 8-8-4-6 5-6-5H62l-7 5-7-6-7 5 4-12-5-8 5-7-5-7 5-7-4-8 5-6z'
for i in range(1,5):
 body=f'<defs><clipPath id="clip"><path d="{path}"/></clipPath><linearGradient id="rain"><stop stop-color="#F6C6E3"/><stop offset=".25" stop-color="#C9C3F5"/><stop offset=".5" stop-color="#BFE3F7"/><stop offset=".75" stop-color="#C8F2DC"/><stop offset="1" stop-color="#F7F0BE"/></linearGradient></defs>'
 body+=f'<path d="{path}" fill="{"url(#rain)" if i==1 else "#F5F0E6"}" opacity=".62"/>'
 if i==3:
  body+='<g clip-path="url(#clip)" stroke="#2B2A28" stroke-width="2" opacity=".32">'+''.join(f'<path d="M{x} 105l55-80"/>' for x in range(20,450,26))+'</g>'
 if i==4:
  body+='<g clip-path="url(#clip)" fill="#2B2A28" opacity=".32">'+''.join(f'<circle cx="{x}" cy="{y}" r="2"/>' for x in range(55,430,22) for y in range(48,100,18))+'</g>'
 tape=raster(svg(480,140,body)); art.png_budget(tape,OUT/f'creator/tape-{i}.png')
 record(f'creator/tape-{i}.png','CR-03',dict(width=480,height=140,bytes=(OUT/f'creator/tape-{i}.png').stat().st_size),'Drawn zigzag washi strip; rainbow / cream / graphite stripes / graphite dots. Paper intentionally translucent; no shadows.',intentionalTranslucency=True)
manifest=dict(stage=1,status='complete-pending-review',sourcePolicy='assets-src/art/ ignored and untracked; only optimized runtime copies in src/art/.',alphaPolicy='Opaque surfaces 255; AA at contour; tape and cut-line silhouette intentionally translucent.',shadowPolicy=dict(colour='#2B2B2B',maxAlpha=30,maxOpacity=30/255,extentPx=6,offsetPx=[2,2]),assets=records)
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
cards=[]
for entry in records:
 rel=entry['file']; label=html.escape(rel)
 cards.append(f'<figure><a class="canvas" href="{label}"><img loading="lazy" src="{label}" alt="{label}"></a><figcaption><strong>{entry["id"]}</strong> · {label}<small>{entry["width"]} × {entry["height"]} px · {entry["bytes"]/1000:.1f} KB</small><details><summary>制作記録</summary><p>{html.escape(entry["prompt"])}</p></details></figcaption></figure>')
preview='''<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Peta · Art preview</title>
<style>*{box-sizing:border-box}body{margin:0;padding:32px;background:#f5f0e6;color:#2b2a28;font:14px/1.6 system-ui,sans-serif}h1{margin:0;font-size:28px}header{max-width:900px;margin-bottom:24px}a{color:inherit}label{display:inline-block;padding:8px 16px;margin:0 16px 24px 0;border:1px solid #bcae99;border-radius:24px;cursor:pointer}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:20px}figure{margin:0;overflow:hidden;background:#fbf9f4;border:1px solid #ded5c6;border-radius:16px}.canvas{height:230px;display:grid;place-items:center;padding:20px;background:#f5f0e6}.canvas img{max-width:100%;max-height:190px;object-fit:contain}figcaption{padding:16px;overflow-wrap:anywhere}small{display:block;color:#7a7061}details{margin-top:10px}summary{cursor:pointer}details p{font-size:12px;max-height:220px;overflow:auto}#dark:checked~main .canvas{background:#23272d}#wallpaper:checked~main .canvas{background:linear-gradient(140deg,#aabcc6,#dac6bd 50%,#7c938b)}input{accent-color:#857256}</style></head><body>
<header><h1>Peta / Stage 1 art</h1><p>紙、箔、ステッカーをライト・ダーク・壁紙風の背景で比較できます。画像を開くと実ピクセルで確認できます。<a href="manifest.json">Manifest</a> · <a href="../today.html">Today</a> · <a href="../creator.html">Cutting Mat</a></p><p>不透明面はalpha 255。縁のアンチエイリアス、半透明のテープ、カット線の淡いシルエットは透過を保持。接地影は無彩色・最大12%・6px以内です。</p></header>
<input type="radio" name="background" id="light" checked><label for="light">ライト</label><input type="radio" name="background" id="dark"><label for="dark">ダーク</label><input type="radio" name="background" id="wallpaper"><label for="wallpaper">壁紙風</label><main>'''+''.join(cards)+'</main></body></html>'
(OUT/'preview.html').write_text(preview)
print(f'Built {len(records)} assets; '+str(sum(e["bytes"] for e in records))+' bytes',flush=True)
