#!/usr/bin/env python3
"""Build P1 delivery art. Local generated masters are intentionally not in Git.

Production dependencies: Pillow, numpy, scipy, cairosvg. No app dependencies.
Stage 2 changes only delivery assets, manifest and preview; not app integration.
"""
from pathlib import Path
import importlib.util
import json
import html
import io
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage
import cairosvg

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'src/art'
WORK = ROOT / 'assets-src/art/stage2'
spec = importlib.util.spec_from_file_location('art_export', ROOT / 'scripts/art-export.py')
art = importlib.util.module_from_spec(spec)
spec.loader.exec_module(art)
manifest = json.loads((OUT / 'manifest.json').read_text())
records = {r['file']: r for r in manifest['assets']}
generation = json.loads((WORK / 'generation.json').read_text())

def record(rel, asset_id, info, prompt, alpha=True, **extra):
    records[rel] = dict(id=asset_id, file=rel, **info, alpha=alpha, priority='P1',
                        usedBy=['Phase 4–5 delivery / art/preview.html'],
                        prompt=prompt, status='ready', stage=2, **extra)

def save(rel, asset_id, image, prompt, shadow=True, raw=False, **extra):
    if raw:
        data = np.array(image.convert('RGBA'))
        data[data[:, :, 3] == 0, :3] = 0
        info = art.png_budget(Image.fromarray(data), OUT / rel)
    else:
        info = art.export(image, 'src/art/' + rel, shadow=shadow)
    record(rel, asset_id, info, prompt, **extra)
    return Image.open(OUT / rel).convert('RGBA')

def jpg(rel, asset_id, image, prompt, **extra):
    target = OUT / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    image.convert('RGB').save(target, quality=90, optimize=True, icc_profile=art.ICC)
    if target.stat().st_size > 500000:
        raise ValueError('Texture budget exceeded: ' + rel)
    record(rel, asset_id, dict(width=image.width, height=image.height,
                              bytes=target.stat().st_size), prompt, alpha=False, **extra)
    return Image.open(target).convert('RGB')

def raster(w, h, body):
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{body}</svg>'
    return Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode()))).convert('RGBA')

def generated(job, size=None, tight=False):
    cfg = generation[job]
    im = Image.open(WORK / cfg['file']).convert('RGBA')
    k = cfg['selectedQuadrant']
    w, h = im.size
    cell = im.crop(((k % 2)*w//2, (k//2)*h//2, ((k % 2)+1)*w//2, ((k//2)+1)*h//2))
    # Discard detached generation crumbs before fitting; keep intentional disconnected letters.
    data=np.array(cell)
    labels,_=ndimage.label(data[:,:,3]>=128)
    counts=np.bincount(labels.ravel())
    keep=counts>=max(12,counts[1:].max()*.001)
    keep[0]=False
    solid=keep[labels]
    distance=ndimage.distance_transform_edt(~solid)
    data[distance>1.2]=0
    cell=Image.fromarray(data)
    return art.fit(cell, size or (1024,1024), tight=tight), cfg['prompt'], k

def flat(image, colours):
    data = np.array(image)
    palette = np.array([tuple(bytes.fromhex(c.lstrip('#'))) for c in colours], dtype=float)
    distance = ((data[:, :, None, :3].astype(float) - palette[None, None])**2).sum(axis=3)
    indices = ndimage.median_filter(distance.argmin(axis=2), size=3)
    data[:, :, :3] = palette[indices].astype('uint8')
    return Image.fromarray(data)

# Remaining Welcome Pack illustrations. The approved cat / egg / flower stay unchanged.
sample_colours = {
    'good-day': ['#D8453A','#FBF9F4','#2B2A28'],
    'polaroid-mountain': ['#FBF9F4','#BFE3F7','#789361','#4D6570'],
    'retro-computer': ['#F5F0E6','#C9A878','#789361','#4D6570'],
    'coffee-cup': ['#FBF9F4','#C9A878','#B08A5B','#4D6570'],
    'peta-bubble': ['#7291D0','#F7E7AC'],
    'purple-scribble': ['#A28AC3'],
    'film-camera': ['#F5F0E6','#C9A878','#4D6570','#2B2A28'],
    'potted-plant': ['#C9A878','#B08A5B','#789361','#4D6570'],
    'cassette-tape': ['#F5F0E6','#C9A878','#7291D0','#4D6570'],
}
for name, colours in sample_colours.items():
    im, prompt, k = generated(name, tight=True)
    save('samples/'+name+'.png', 'SM-01', flat(im, colours), prompt, shadow=False,
         selectedQuadrant=k, baseColours=colours, transparentMarginPx=8)

# Abstract print mouth: quiet geometry, no printer body.
slot = raster(2400,48,
    '<rect x="120" y="17" width="2160" height="15" rx="7.5" fill="#2B2A28"/>'
    '<path d="M132 30H2268" stroke="#EFE8DA" stroke-width="2"/>'
    '<path d="M132 19H2268" stroke="#4D4B47" stroke-width="2"/>')
save('print/print-slot.png','PR-01',slot,'Constructed abstract rounded paper-output slit; graphite and warm lower-edge highlight. No printer body.')
yy,xx = np.mgrid[:160,:2400]
glow = np.zeros((160,2400,4),dtype=np.uint8)
glow[:,:,:3] = (251,249,244)
horizontal = np.clip((xx-120)/40,0,1)*np.clip((2280-xx)/40,0,1)
glow[:,:,3] = np.rint(26*np.exp(-((yy-65)/25)**2)*horizontal).astype('uint8')
save('print/print-slot-glow.png','PR-01',Image.fromarray(glow),
     'Warm-white additive lighting mask, separate from contact shadow; alpha <=26/255.',
     shadow=False,raw=True,intentionalTranslucency=True,opacityMax=26,blendMode='screen',role='light-mask')

# Backing paper is opaque per requested coverage correction. A pale tint conveys glassine.
backing = raster(1000,1500,'<rect x="100" y="120" width="800" height="1260" fill="#F5F0E6"/>'+
    ''.join(f'<path d="M{x-9} {y}h18M{x} {y-9}v18" stroke="#D2CABC" stroke-width="3"/>'
            for x,y in [(126,146),(874,146),(126,1354),(874,1354)]))
watermark = Image.open(OUT/'brand/logo-wordmark-ink.png').convert('RGBA')
watermark.thumbnail((80,35),Image.Resampling.LANCZOS)
data = np.array(watermark); a=data[:,:,3]
# Keep marks very faint in the paper's RGB while final surface stays opaque.
mark = Image.new('RGBA',watermark.size, (211,204,191,0)); mark.putalpha(Image.fromarray(np.rint(a*.30).astype('uint8')))
for y in range(210,1310,170):
    for x in range(170,870,180): backing.alpha_composite(mark,(x,y))
save('print/backing-sheet.png','PR-02',backing,
     'Opaque pale glassine backing strip; approved brush Peta marks faintly repeated in RGB, registration crosses at four corners. Blank side edges.',labelRect=[130,170,740,1150])

# Generated tags; lettering reviewed before candidate selection.
for name in ['peta-tag-ja','peta-tag-en']:
    im,p,k = generated(name,(480,240))
    save('fx/'+name+'.png','FX-01',im,p,selectedQuadrant=k)

# Arrival material derives from the same approved envelope with identical palette.
env = art.fit(Image.open(OUT/'today/envelope-closed.png').convert('RGBA'),(480,340),margin=.1)
save('arrival/arrival-material.png','AR-01',env,
     'Resized approved Today kraft envelope; matching cat doodle and blank paper label.',labelRect=[240,171,157,83])
gift,p,k = generated('arrival-gift',(480,340))
save('arrival/arrival-gift.png','AR-01',gift,p,selectedQuadrant=k,labelRect=[305,220,98,39])

# Wax halves partition the final exported intact master exactly, including its shadow.
wax,p,k = generated('wax-seal',(240,240))
wax = save('gift/wax-seal.png','GF-01',wax,p,selectedQuadrant=k,layerGroup='wax-seal')
data = np.array(wax)
yy,xx = np.mgrid[:240,:240]
points = np.array([[0,119],[44,119],[61,125],[83,114],[101,127],[121,116],[139,124],[156,113],[179,125],[202,117],[240,120]])
boundary = np.interp(yy,points[:,0],points[:,1])
for name,mask in [('left',xx<boundary),('right',xx>=boundary)]:
    part=data.copy(); part[~mask]=0
    save('gift/wax-seal-'+name+'.png','GF-01',Image.fromarray(part),
         'Exact partition of wax-seal master along shared jagged vertical crack.',
         shadow=False,raw=True,layerGroup='wax-seal',sharedBoundary=points.tolist())

mystery,p,k = generated('mystery-sticker',(600,600))
mystery,_=art.clean_alpha(mystery)
data=np.array(mystery); rgb=data[:,:,:3].astype(float)
# Light paper is deliberately translucent, dark hidden silhouette and white ? are opaque.
light=rgb.mean(axis=2)>160
dark=(rgb.mean(axis=2)<195)&(np.ptp(rgb,axis=2)<30)&(data[:,:,3]>128)
dark=ndimage.binary_fill_holes(ndimage.binary_closing(dark,iterations=3))
paper=light & ~ndimage.binary_dilation(dark,iterations=2) & (data[:,:,3]>0)
data[paper,3]=np.rint(data[paper,3]*.48).astype('uint8')
save('gift/mystery-sticker.png','GF-02',Image.fromarray(data),p,shadow=False,raw=True,
     selectedQuadrant=k,intentionalTranslucency=True,role='glassine-wrapper',paperOpacity=.48)
note,p,k=generated('note-blank',(640,400))
save('gift/note-blank.png','GF-03',note,p,selectedQuadrant=k,labelRect=[100,215,430,90])

# Truly periodic, very restrained paper fibres, with no rendered object or lighting gradient.
def paper(size,base,seed):
    rng=np.random.default_rng(seed)
    noise=rng.normal(0,1,size[::-1])
    field=ndimage.gaussian_filter(noise,5,mode='wrap')*2.5
    fibres=ndimage.gaussian_filter(noise,(.45,2.5),mode='wrap')*.48
    texture=np.clip(np.array(base)[None,None,:]+(field+fibres)[:,:,None],0,255).astype('uint8')
    texture[-1]=texture[0]; texture[:,-1]=texture[:,0]
    return Image.fromarray(texture)
for name,base in [('cream',(245,240,230)),('kraft',(201,168,120))]:
    im=paper((1024,1024),base,20 if name=='cream' else 21)
    jpg('back/paper-'+name+'.jpg','BC-01',im,
        'Periodic uncoated '+name+' paper fibres; wrap-mode noise, matched opposing boundary pixels before JPEG encoding. Even lighting.',tileable=True)

stamp = raster(480,200,
    '<g fill="none" stroke="#2B2A28" stroke-linecap="round" stroke-linejoin="round">'
    '<path d="M43 34Q236 32 437 36L438 164Q238 168 42 165Z" stroke-width="3.4"/>'
    '<path d="M53 43L428 44L427 155L52 155Z" stroke-width="2"/>'+
    ''.join(f'<path d="M{x-8} {y}h16M{x} {y-8}v16" stroke-width="2.2"/>' for x,y in [(34,26),(446,26),(34,174),(446,174)])+'</g>')
save('back/stamp-original-frame.png','BC-02',stamp,
     'Hand-drawn double rectangular stamp frame with corner registration ticks; blank interior.',shadow=False,labelRect=[65,55,350,88])
small=art.fit(Image.open(OUT/'brand/logo-wordmark-ink.png').convert('RGBA'),(320,120),margin=.08)
save('back/peta-mark-small.png','BC-03',small,'Scaled approved brush lettering, no font replacement.',shadow=False)
ribbon=raster(320,160,
    '<path d="M46 48L274 47L263 80L277 111L43 112L56 80Z" fill="#EFE8DA"/>'
    '<path d="M46 48L60 80L43 112M274 47L260 80L277 111" fill="none" stroke="#C9A878" stroke-width="2"/>')
save('back/edition-ribbon.png','BC-04',ribbon,'Blank cream paper edition ribbon with folded ends.',labelRect=[74,58,170,42])
xs=np.arange(80,945,8); ys=84+5*np.sin(xs*.19)+3*np.sin(xs*.71)
path='M80 24H944V'+str(ys[-1])+' '+ ' '.join(f'L{x} {y:.2f}' for x,y in zip(xs[::-1],ys[::-1]))+'Z'
save('back/torn-edge-mask.png','BC-05',raster(1024,128,f'<path d="{path}" fill="#F5F0E6"/>'),
     'Deckled cream-paper bottom edge, no text. Alpha can be used as an edge mask.',shadow=False,role='edge-mask')

# Matching book pages with dot grid and punched holes, no baked-in month labels.
for side in ['left','right']:
    page=paper((1400,1000),(245,240,230),30)
    draw=ImageDraw.Draw(page)
    binding_x=1358 if side=='left' else 42
    for y in range(25,1000,50):
        draw.ellipse((binding_x-8,y-8,binding_x+8,y+8),fill='#D8D1C5')
        draw.ellipse((binding_x-6,y-6,binding_x+6,y+6),fill='#E6DFD2')
    for x in range(90,1320,40):
        for y in range(60,950,40): draw.ellipse((x,y,x+1,y+1),fill='#DDD6C9')
    # A six-pixel gentle binding gutter, no broad dark gradient.
    for step in range(6):
        x=1399-step if side=='left' else step
        draw.line((x,0,x,999),fill=tuple(round(v*(1-.06*(1-step/6))) for v in (245,240,230)))
    jpg('book/page-'+side+'.jpg','BK-02',page,
        'Cream notebook page, faint dot grid, evenly spaced punched ring holes; matching six-pixel binding gutter.',bindingEdge='right' if side=='left' else 'left',ringHoleCenters=[[binding_x,y] for y in range(25,1000,50)])
rings=''
for y in range(25,1000,50):
    d=f'M70 {y-11}C41 {y-19} 15 {y-12} 15 {y}C15 {y+12} 43 {y+19} 70 {y+11}'
    rings+=f'<path d="{d}" fill="none" stroke="#9AA1AB" stroke-width="8" stroke-linecap="round"/><path d="{d}" fill="none" stroke="#D8DCE2" stroke-width="3" stroke-linecap="round"/>'
save('book/spiral-rings.png','BK-03',raster(96,1000,rings),'Semi-flat silver spiral, 50px repeating pitch; 20 aligned rings and transparent vertical tile seam.',shadow=False,tileableAxis='y',repeatPx=50)
for i,colour in enumerate(['#F5F0E6','#C9A878','#F6C6E3','#C8F2DC','#BFE3F7','#F7F0BE'],1):
    tab=raster(240,120,f'<path d="M25 23H180Q214 23 214 45V75Q214 97 180 97H25Z" fill="{colour}"/><path d="M31 29H178" stroke="#FBF9F4" stroke-width="2" opacity=".6"/>')
    save(f'book/tab-blank-{i}.png','BK-04',tab,'Blank rounded index tab; shared geometry in '+colour+'.',labelRect=[58,36,129,49],colour=colour)
curl=np.zeros((1000,1400,4),dtype=np.uint8); curl[:,:,:3]=43
# Page-curl shadow is a deliberately translucent mask, capped at 12%, six pixels wide.
for x in range(697,703):
    vertical=np.sin(np.linspace(0,math.pi,1000))**.7
    curl[:,x,3]=np.rint(28*vertical*(1-abs(x-699.5)/3.5)).astype('uint8')
save('book/page-curl-shadow.png','BK-05',Image.fromarray(curl),
     'Neutral page-curl shadow mask, six-pixel crease strip fading at both ends; alpha <=28/255.',
     shadow=False,raw=True,intentionalTranslucency=True,role='shadow-mask',opacityMax=28,shadowWidthPx=6)

# Empty states use quiet linework, not text or a UI screenshot.
sheet='<rect x="64" y="44" width="512" height="312" rx="12" fill="#F5F0E6"/>'
dashes=''
for x,y,w,h in [(101,84,112,94),(254,79,125,102),(419,86,113,91),(110,226,118,88),(264,223,111,99),(425,222,107,97)]:
    dashes+=f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="23" fill="none" stroke="#C9BDA9" stroke-width="2.5" stroke-dasharray="5 7"/>'
save('empty/collection-empty.png','EM-01',raster(640,400,sheet+dashes),'Empty cream sticker sheet with six faint dashed die-cut shapes; no text.')
peel='<path d="M410 113H471V174Q438 143 410 113Z" fill="#FBF9F4"/><path d="M410 113Q438 142 471 174" fill="none" stroke="#D8D1C5" stroke-width="2"/>'
save('empty/nothing-to-peel.png','EM-02',raster(640,400,sheet+peel),'One empty backing sheet with only a tiny peeled corner trace; no sticker or text.')

# Onboarding reuses the actual delivered illustrations, not re-generated lookalikes.
hero=raster(1400,900,'<path d="M130 89L1260 80L1271 810L119 818Z" fill="#F5F0E6"/>')
placements=[('cat-skateboard',(280,290),(138,101),-6),('fried-egg',(215,170),(981,119),6),
            ('blue-flower',(225,285),(171,498),-5),('good-day',(255,240),(959,514),5)]
for name,size,position,angle in placements:
    im=Image.open(OUT/f'samples/{name}.png').convert('RGBA'); im.thumbnail(size,Image.Resampling.LANCZOS)
    padded=Image.new('RGBA',(im.width+24,im.height+24))
    padded.paste(im,(12,12))
    im=padded
    # White die-cut rim belongs to onboarding placement, not the sample source artwork.
    alpha=im.getchannel('A'); rim=alpha.filter(ImageFilter.MaxFilter(15))
    backed=Image.new('RGBA',im.size,'#FBF9F4'); backed.putalpha(rim)
    backed=Image.alpha_composite(backed,im).rotate(angle,Image.Resampling.BICUBIC,expand=True)
    hero.alpha_composite(backed,position)
save('onboarding/hero.png','OB-01',hero,'Four delivered sample stickers placed on a cream paper sheet; central area blank for runtime Peta, tagline and Begin.',labelRect=[470,200,455,470],sampleSources=[p[0] for p in placements])

manifest['stage']=2
manifest['status']='complete-pending-review'
manifest['alphaPolicy']='Opaque surfaces alpha 255; AA contours; washi, cut-line silhouette, glow, glassine wrapper and page-curl mask intentionally translucent.'
manifest['assets']=list(records.values())
manifest['deliveryStages']={'1':'P0 integrated; existing logic preserved','2':'P1 assets only; no app integration','3':'not started'}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')

# Keep one catalogue for all delivered stages and expose declared translucency explicitly.
cards=[]
for entry in records.values():
    rel=html.escape(entry['file'])
    note=' · 意図的な半透明' if entry.get('intentionalTranslucency') else ''
    cards.append(f'<figure data-file="{rel}" data-priority="{entry["priority"]}"><a class="canvas" href="{rel}"><img loading="lazy" src="{rel}" alt="{rel}"></a><figcaption><strong>{entry["id"]}</strong> · {entry["priority"]} · {rel}<small>{entry["width"]} × {entry["height"]} px · {entry["bytes"]/1000:.1f} KB{note}</small><details><summary>制作記録</summary><p>{html.escape(entry["prompt"])}</p></details></figcaption></figure>')
old=(OUT/'preview.html').read_text()
prefix=old.split('<main>')[0].split('<div>表示対象</div>')[0].replace('Stage 1 art','Stage 1 + 2 art')
prefix=prefix.replace('カット線の淡いシルエットは透過を保持。','カット線の淡いシルエット、光マスク、グラシン包装、ページ影マスクは意図的な透過を保持。')
if '#p1:checked' not in prefix:
    prefix=prefix.replace('</style>', '#p1:checked~main figure:not([data-priority="P1"]){display:none}#p0:checked~main figure:not([data-priority="P0"]){display:none}</style>')
prefix+='<div>表示対象</div><input type="radio" name="priority" id="all" checked><label for="all">すべて</label><input type="radio" name="priority" id="p1"><label for="p1">P1</label><input type="radio" name="priority" id="p0"><label for="p0">P0</label>'
(OUT/'preview.html').write_text(prefix+'<main>'+''.join(cards)+'</main></body></html>')
print(f'Built Stage 2: {len(records)} total assets; {sum(e["bytes"] for e in records.values()):,} bytes',flush=True)
