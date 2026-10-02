#!/usr/bin/env python3
"""Painterly sample inputs and shared delivery builders; production tools only."""
from pathlib import Path
import importlib.util
import json
import html
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'src/art'
WORK=ROOT/'assets-src/art/restyle'
spec=importlib.util.spec_from_file_location('art_export',ROOT/'scripts/art-export.py')
art=importlib.util.module_from_spec(spec); spec.loader.exec_module(art)
NAMES=('cat-skateboard','fried-egg','good-day','blue-flower','polaroid-mountain','retro-computer','coffee-cup','peta-bubble','purple-scribble','film-camera','potted-plant','cassette-tape')

def read_records():
    manifest=json.loads((OUT/'manifest.json').read_text())
    return manifest,{a['file']:a for a in manifest['assets']}

def update(records,rel,info,**extra):
    entry=records[rel]
    for key in ('baseColours','priorityNote','rgbPalette','textureBlur'): entry.pop(key,None)
    entry.update(info,restyle='painterly-illustration',**extra)

def save(records,rel,im,prompt,shadow=True,limit=600000,**extra):
    body,solid=art.clean_alpha(im)
    info=art.png_budget(art.with_shadow(body,solid,shadow),OUT/rel,limit=limit)
    update(records,rel,info,prompt=prompt,**extra)
    return Image.open(OUT/rel).convert('RGBA')

def painted_input(name):
    cfg=json.loads((WORK/'generation.json').read_text())[name]
    im=Image.open(WORK/cfg['file']).convert('RGBA'); w,h=im.size; k=cfg['selectedQuadrant']
    im=im.crop(((k%2)*w//2,(k//2)*h//2,((k%2)+1)*w//2,((k//2)+1)*h//2))
    data=np.array(im)
    labels,_=ndimage.label(data[:,:,3]>=128)
    counts=np.bincount(labels.ravel()); keep=counts>=max(20,counts[1:].max()*.002)
    keep[0]=False; core=keep[labels]
    distance=ndimage.distance_transform_edt(~core)
    data[distance>1.2]=0
    im=art.fit(Image.fromarray(data),(1024,1024),tight=True)
    return im,cfg

def silhouette(alpha,border):
    """Follow cutout.rs silhouette: distance grow, bridge, shrink, fill holes, soft edge."""
    subject=alpha>.5
    distance=ndimage.distance_transform_edt(~subject)
    bridge=border*.9
    grown=distance<=border+bridge
    outside_distance=ndimage.distance_transform_edt(grown)
    shape=(outside_distance>bridge)|subject
    shape=ndimage.binary_fill_holes(shape)
    sigma=np.clip(border*.12,1.2,4)
    radius=max(1,int(np.floor((np.sqrt(4*sigma*sigma+1)-1)/2+.5)))
    soft=shape.astype(float)
    for _ in range(3): soft=ndimage.uniform_filter(soft,2*radius+1,mode='constant')
    return np.clip((soft-.5)*1.8+.5,0,1)

def sticker_with_border(im,fraction=.035):
    border=max(im.size)*fraction
    pad=int(np.ceil(border*2.5))+8
    canvas=Image.new('RGBA',(im.width+2*pad,im.height+2*pad)); canvas.paste(im,(pad,pad))
    alpha=np.array(canvas.getchannel('A'))/255
    rim=silhouette(alpha,border)
    shape=Image.new('RGBA',canvas.size,'#FBF9F4'); shape.putalpha(Image.fromarray(np.rint(rim*255).astype('uint8')))
    shadow_alpha=ndimage.gaussian_filter(ndimage.shift(rim,(2,2),order=0),1.15)*.10
    shadow=Image.new('RGBA',canvas.size,(43,43,43,0)); shadow.putalpha(Image.fromarray(np.rint(shadow_alpha*255).astype('uint8')))
    return Image.alpha_composite(Image.alpha_composite(shadow,shape),canvas),rim

def finish(manifest,records):
    manifest['assets']=list(records.values())
    manifest.setdefault('sampleStyle','STYLE-sample / painterly gouache illustration; supersedes STYLE-lite')
    manifest['sampleBudgetBytes']=900000
    (OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    old=(OUT/'preview.html').read_text()
    prefix=old.split('<main>')[0]
    prefix=prefix.replace('Peta / Stage 1 + 2 art','Peta / Painterly samples + Stage 1 + 2 art')
    if manifest.get('sampleStyleVersion')==2:
        prefix=prefix.replace('Painterly samples','Sample v2')
        prefix=prefix.replace('見本12枚はペイント調のイラストです。','見本12枚は題材ごとに画材を変え、形と陰影を省いたイラストです。')
    note='<p>見本12枚はペイント調のイラストです。見本PNGには白フチ・接地影・背景を含めず、各900KB以下で書き出しています。</p>'
    if manifest.get('sampleStyleVersion')==2:
        note=note.replace('見本12枚はペイント調のイラストです。','見本12枚は題材ごとに画材を変え、形と陰影を省いたイラストです。')
    if note not in prefix: prefix=prefix.replace('</header>',note+'</header>')
    cards=[]
    for entry in records.values():
        rel=html.escape(entry['file'])
        note=' · 意図的な半透明' if entry.get('intentionalTranslucency') else ''
        cards.append(f'<figure data-file="{rel}" data-priority="{entry["priority"]}"><a class="canvas" href="{rel}"><img loading="lazy" src="{rel}" alt="{rel}"></a><figcaption><strong>{entry["id"]}</strong> · {entry["priority"]} · {rel}<small>{entry["width"]} × {entry["height"]} px · {entry["bytes"]/1000:.1f} KB{note}</small><details><summary>制作記録</summary><p>{html.escape(entry["prompt"])}</p></details></figcaption></figure>')
    (OUT/'preview.html').write_text(prefix+'<main>'+''.join(cards)+'</main></body></html>')

def stage1(make_cover):
    manifest,records=read_records()
    for name in NAMES:
        im,cfg=painted_input(name)
        save(records,'samples/'+name+'.png',im,cfg['prompt'].replace('\n\nundefined\n\n','\n\n'),False,900000,
             selectedQuadrant=cfg['selectedQuadrant'],transparentMarginPx=8,
             **({key:cfg[key] for key in ('medium','selectionReason','mandatory') if key in cfg}),
             usedBy=['Welcome Pack / art preview']+
             (['onboarding/hero.png'] if name in ('cat-skateboard','fried-egg','blue-flower','good-day','polaroid-mountain') else [])+
             (['book/cover-kraft.png','today/choice-collection.png'] if name=='blue-flower' else []))
    flower=Image.open(OUT/'samples/blue-flower.png').convert('RGBA')
    cover=save(records,'book/cover-kraft.png',make_cover(flower),
        'Same approved kraft cover geometry; replaced flower with painterly samples/blue-flower.png.',
        sampleSources=['blue-flower'],usedBy=['today/choice-collection.png','art/preview.html'])
    save(records,'today/choice-collection.png',art.fit(cover,(384,384)),
        'Retina thumbnail of the updated BK-01 cover with the painterly blue flower.',sampleSources=['blue-flower'])
    finish(manifest,records)

def paper_texture(base,seed):
    rng=np.random.default_rng(seed); noise=rng.normal(0,1,(1024,1024))
    def norm(a): return (a-a.mean())/a.std()
    cloud=norm(ndimage.gaussian_filter(noise,32,mode='wrap'))
    fibres=norm(ndimage.gaussian_filter(rng.normal(0,1,(1024,1024)),(.55,5),mode='wrap'))
    grain=norm(ndimage.gaussian_filter(rng.normal(0,1,(1024,1024)),.65,mode='wrap'))
    field=norm(cloud*2.7+fibres*2+grain*1.4)*4.5
    rgb=np.clip(np.array(base)[None,None,:]+field[:,:,None],0,255).astype('uint8')
    rgb[-1]=rgb[0]; rgb[:,-1]=rgb[:,0]
    return Image.fromarray(rgb)

def make_hero(raster):
    # Same cream-paper scaffold, with a quiet irregular deckled edge and two loose clusters.
    top=' '.join(f'L{x} {85+2*np.sin(x*.19)+np.sin(x*.37):.2f}' for x in range(130,1262,12))
    bottom=' '.join(f'L{x} {815+2*np.sin(x*.17):.2f}' for x in range(1262,118,-12))
    hero=raster(1400,900,f'<path d="M119 100{top}L1271 797{bottom}Z" fill="#F5F0E6"/>')
    placements=[('polaroid-mountain',(235,255),(170,352),8),
                ('cat-skateboard',(270,290),(132,128),-6),
                ('fried-egg',(220,175),(1000,130),4),
                ('blue-flower',(220,260),(990,300),8),
                ('good-day',(250,210),(945,520),-7)]
    masks=[]
    for name,size,pos,angle in placements:
        im=Image.open(OUT/f'samples/{name}.png').convert('RGBA'); im.thumbnail(size,Image.Resampling.LANCZOS)
        im,_=sticker_with_border(im)
        im=im.rotate(angle,Image.Resampling.BICUBIC,expand=True)
        # Trim padding for predictable measured layout; rim stays intact.
        bounds=im.getchannel('A').getbbox(); im=im.crop(bounds)
        mask=np.zeros((900,1400),dtype=bool)
        x,y=pos; mask[y:y+im.height,x:x+im.width]=np.array(im)[:,:,3]>=128
        masks.append(mask)
        hero.alpha_composite(im,pos)
    fractions=[]
    for i,a in enumerate(masks):
        other=np.logical_or.reduce([b for j,b in enumerate(masks) if j!=i])
        fractions.append(float((a&other).sum()/a.sum()))
    return hero,placements,fractions

def stage2(raster):
    manifest,records=read_records()
    for name,base,seed in [('cream',(245,240,230),730),('kraft',(201,168,120),731)]:
        rel=f'back/paper-{name}.jpg'; im=paper_texture(base,seed)
        im.save(OUT/rel,quality=90,optimize=True,icc_profile=art.ICC)
        decoded=np.array(Image.open(OUT/rel)).astype(float)
        lum=decoded@np.array([.2126,.7152,.0722])
        update(records,rel,dict(width=1024,height=1024,bytes=(OUT/rel).stat().st_size),
               prompt='Seamless '+name+' paper; periodic fine fibres, grain and soft cloud mottling, mean palette preserved.',
               textureLumaStd=float(lum.std()),meanRGB=decoded.mean(axis=(0,1)).tolist(),tileable=True)
    hero,placements,overlap=make_hero(raster)
    save(records,'onboarding/hero.png',hero,
        'Five painterly sample stickers in two loose overlapping clusters, tilted within 10 degrees; quiet deckled cream sheet and reserved central label area.',
        labelRect=[470,200,455,470],sampleSources=[p[0] for p in placements],
        placements=[dict(sample=p[0],maxSize=list(p[1]),position=list(p[2]),rotationDeg=p[3]) for p in placements],
        overlapFractions=overlap)
    finish(manifest,records)
