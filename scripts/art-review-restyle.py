#!/usr/bin/env python3
"""Review exported illustrations against the reference and app-like die cuts."""
from pathlib import Path
import importlib.util
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('restyle',ROOT/'scripts/art-restyle.py')
restyle=importlib.util.module_from_spec(spec); spec.loader.exec_module(restyle)
OUT=ROOT/'docs/art-restyle'; OUT.mkdir(parents=True,exist_ok=True)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',16)

def background(scheme,size):
    if scheme!='wallpaper': return Image.new('RGBA',size,'#F5F0E6' if scheme=='light' else '#23272D')
    y,x=np.mgrid[:size[1],:size[0]]; t=(x/size[0]+y/size[1])/2
    stops=np.array([[170,188,198],[218,198,189],[124,147,139]])
    i=np.minimum((t*2).astype(int),1); f=t*2-i
    rgb=stops[i]*(1-f[:,:,None])+stops[i+1]*f[:,:,None]
    return Image.fromarray(np.uint8(rgb)).convert('RGBA')

for scheme in ('light','dark','wallpaper'):
    for border in (False,True):
        canvas=background(scheme,(1280,1080)); draw=ImageDraw.Draw(canvas)
        ink='#FBF9F4' if scheme=='dark' else '#2B2A28'
        draw.text((24,15),'STYLE-sample / '+('3.5% die-cut + neutral shadow' if border else 'source art / no border or shadow'),fill=ink,font=font)
        for k,name in enumerate(restyle.NAMES):
            im=Image.open(restyle.OUT/f'samples/{name}.png').convert('RGBA')
            if border: im,_=restyle.sticker_with_border(im)
            im.thumbnail((280,275),Image.Resampling.LANCZOS)
            x=(k%4)*320; y=(k//4)*345+45
            canvas.alpha_composite(im,(x+(320-im.width)//2,y+(285-im.height)//2))
            draw.text((x+20,y+295),name,fill=ink,font=font)
        canvas.convert('RGB').save(OUT/f'{"border" if border else "samples"}-{scheme}.jpg',quality=92,optimize=True)
        if scheme=='light' and not border:
            ref=Image.open(ROOT/'docs/art-reference/style-target-stickers.jpg').convert('RGB')
            ref=ref.crop((0,0,ref.width,round(ref.height*.385)))
            ref.thumbnail((650,1000),Image.Resampling.LANCZOS)
            compare=Image.new('RGB',(1950,1080),'#F5F0E6')
            compare.paste(ref,((650-ref.width)//2,50)); compare.paste(canvas.convert('RGB'),(670,0))
            ImageDraw.Draw(compare).text((20,15),'Reference: upper laptop only',fill='#2B2A28',font=font)
            compare.save(OUT/'reference-comparison.jpg',quality=92,optimize=True)

paper=Image.new('RGB',(1280,840),'#F5F0E6'); d=ImageDraw.Draw(paper)
for k,name in enumerate(('cream','kraft')):
    texture=Image.open(restyle.OUT/f'back/paper-{name}.jpg')
    # Actual pixels at 1:1, repeated to expose tile seams.
    tile=Image.new('RGB',(600,600))
    tile.paste(texture.crop((724,724,1024,1024)),(0,0))
    tile.paste(texture.crop((0,724,300,1024)),(300,0))
    tile.paste(texture.crop((724,0,1024,300)),(0,300))
    tile.paste(texture.crop((0,0,300,300)),(300,300))
    paper.paste(tile,(20+k*640,45)); d.text((20+k*640,15),name+' paper / seam crossing / 1:1',font=font,fill='#2B2A28')
arrival=Image.open(restyle.OUT/'arrival/arrival-material.png').convert('RGBA'); arrival.thumbnail((420,170))
paper.paste(arrival,(750,665),arrival)
d.text((25,690),'Kraft compared with arrival-material',font=font,fill='#2B2A28')
paper.save(OUT/'paper-comparison.jpg',quality=92,optimize=True)
print('Wrote reference comparison, three source boards, three die-cut boards, and paper comparison.')
