#!/usr/bin/env python3
"""Owner's mix decision (2026-10-02): keep the v2 sample for most subjects, but go back to the v1 (painterly)
version for a few, then rebuild everything that is composed from the samples (hero, cover, cover thumbnail).

Works from the committed runtime PNGs only (no assets-src needed). Needs Pillow, numpy, scipy, cairosvg.
  python3 scripts/art-mix-samples.py
"""
import importlib.util
import io
import json
import subprocess
from pathlib import Path

import cairosvg
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'src/art'
V1_COMMIT = '243162f'  # "art: restyle samples — painterly illustration"
KEEP_V1 = ('blue-flower', 'polaroid-mountain', 'good-day', 'purple-scribble')
REASON = {
    'blue-flower': 'v1 を採用(オーナー判断)。v2 は線が細く花が貧相になったため。',
    'polaroid-mountain': 'v1 を採用(オーナー判断)。v2 は風景が粗くなったため。',
    'good-day': 'v1 を採用(オーナー判断)。v2 は色がくすみ字が詰まって重くなったため。',
    'purple-scribble': 'v1 を一時採用(オーナー判断)。v2 は角ばって字に見えるため。仕様(平らなマーカーの一筆線)に合う作り直しが必要。',
}


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


restyle = load('art_restyle', ROOT / 'scripts/art-restyle.py')
art = restyle.art


def raster(w, h, body):
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{body}</svg>'
    return Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode()))).convert('RGBA')


def make_cover(flower):
    """Same notebook cover geometry as art-build-stage1.py; only the flower sticker differs."""
    body = ('<defs><linearGradient id="kraft" x2="0" y2="1"><stop stop-color="#D1B183"/><stop offset="1" stop-color="#C9A878"/></linearGradient>'
            '<pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#B8996E" stroke-width="1" opacity=".32"/></pattern></defs>'
            '<rect x="150" y="146" width="1350" height="824" rx="28" fill="#B08A5B"/><rect x="145" y="130" width="1350" height="824" rx="28" fill="url(#kraft)"/>'
            '<rect x="160" y="146" width="1320" height="793" rx="18" fill="url(#grid)"/><path d="M175 942h1294" stroke="#DDBF94" stroke-width="4"/>')
    for y in range(172, 927, 48):
        body += (f'<circle cx="173" cy="{y+6}" r="8" fill="#796C59"/><path d="M175 {y}C85 {y-22} 85 {y+34} 175 {y+16}" fill="none" stroke="#858A90" stroke-width="10" stroke-linecap="round"/>'
                 f'<path d="M174 {y-2}C97 {y-19} 96 {y+28} 171 {y+13}" fill="none" stroke="#D8DCE2" stroke-width="3" stroke-linecap="round"/>')
    cover = raster(1600, 1100, body)
    sticker = flower.copy()
    sticker.thumbnail((245, 270), Image.Resampling.LANCZOS)
    padded = Image.new('RGBA', (sticker.width + 32, sticker.height + 32))
    padded.paste(sticker, (16, 16))
    sticker = padded
    fm = ndimage.binary_fill_holes(np.asarray(sticker)[:, :, 3] >= 128)
    rim = ndimage.binary_dilation(fm, iterations=10)
    rim_image = Image.new('RGBA', sticker.size, '#FBF9F4')
    rim_image.putalpha(Image.fromarray((rim * 255).astype('uint8')))
    cover.alpha_composite(Image.alpha_composite(rim_image, sticker), (1170, 680))
    return cover


def main():
    manifest, records = restyle.read_records()
    old = json.loads(subprocess.check_output(['git', 'show', f'{V1_COMMIT}:src/art/manifest.json'], cwd=ROOT))
    old_records = {a['file']: a for a in old['assets']}

    for name in KEEP_V1:
        rel = f'samples/{name}.png'
        (OUT / rel).write_bytes(subprocess.check_output(['git', 'show', f'{V1_COMMIT}:src/{"art/" + rel}'], cwd=ROOT))
        entry = dict(old_records[rel])
        entry.update(bytes=(OUT / rel).stat().st_size, selectionReason=REASON[name], mixDecision='v1-kept')
        entry['usedBy'] = records[rel].get('usedBy', entry.get('usedBy'))
        records[rel] = entry
    for name in restyle.NAMES:
        if name not in KEEP_V1:
            records[f'samples/{name}.png'].setdefault('mixDecision', 'v2')

    # everything composed from the samples
    flower = Image.open(OUT / 'samples/blue-flower.png').convert('RGBA')
    cover = restyle.save(records, 'book/cover-kraft.png', make_cover(flower),
                         'Same approved kraft cover geometry with the chosen samples/blue-flower.png.', sampleSources=['blue-flower'],
                         usedBy=['today/choice-collection.png', 'art/preview.html'])
    restyle.save(records, 'today/choice-collection.png', art.fit(cover, (384, 384)),
                 'Retina thumbnail of the updated BK-01 cover.', sampleSources=['blue-flower'])
    hero, placements, overlap = restyle.make_hero(raster)
    restyle.save(records, 'onboarding/hero.png', hero,
                 'Five samples on a deckled cream sheet, gently tilted and overlapping around a blank central area.',
                 labelRect=[470, 200, 455, 470], sampleSources=[p[0] for p in placements], overlapFractions=overlap,
                 placements=[dict(sample=p[0], maxSize=list(p[1]), position=list(p[2]), rotationDeg=p[3]) for p in placements])
    for rel in ('book/cover-kraft.png', 'today/choice-collection.png', 'onboarding/hero.png'):
        records[rel]['restyle'] = 'mixed-v1-v2'

    manifest['sampleStyle'] = ('Mixed set (owner decision 2026-10-02): v2 simple forms for most subjects; v1 painterly for '
                               + ', '.join(KEEP_V1) + '. See mixDecision on each sample.')
    restyle.finish(manifest, records)
    print('hero overlap fractions:', [round(o, 3) for o in overlap])


if __name__ == '__main__':
    main()
