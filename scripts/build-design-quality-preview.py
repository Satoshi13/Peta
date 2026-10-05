"""Inline every image and the Special Elite font of design-quality-preview.src.html into one self-contained file.
Klee One (~9MB per weight) is not embedded; the page falls back to Noteworthy / cursive for the two handwriting spots.
Run: python3 scripts/build-design-quality-preview.py
"""
import re, base64, io
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]
DIR = ROOT / 'docs/ui-proposals'
src = (DIR / 'design-quality-preview.src.html').read_text(encoding='utf-8')
cache = {}

def data_uri(rel):
    if rel in cache: return cache[rel]
    p = (DIR / rel).resolve()
    if p.suffix == '.svg':
        uri = 'data:image/svg+xml;base64,' + base64.b64encode(p.read_bytes()).decode()
    else:
        im = Image.open(p)
        before = 'design-quality/' in rel
        maxw = 1060 if before else (512 if p.suffix == '.jpg' else 420)
        if im.width > maxw: im = im.resize((maxw, round(im.height * maxw / im.width)), Image.LANCZOS)
        buf = io.BytesIO()
        if before or p.suffix == '.jpg':
            im.convert('RGB').save(buf, 'JPEG', quality=84, optimize=True); mime = 'image/jpeg'
        else:
            im.convert('RGBA').save(buf, 'WEBP', quality=84, method=6); mime = 'image/webp'
        uri = f'data:{mime};base64,' + base64.b64encode(buf.getvalue()).decode()
    cache[rel] = uri
    return uri

# CSS url(...) and src="..." / JS template url(...) pointing at the art or the before screenshots
pat = re.compile(r'(\.\./\.\./src/art/[A-Za-z0-9_./-]+\.(?:png|jpg|svg)|design-quality/[a-z-]+\.png)')
out = pat.sub(lambda m: data_uri(m.group(1)), src)

# the JS builds sidebar icons from a template: url(../../src/art/${n.i}); embed the icons it can reach
icons = ['today/envelope-closed.png','today/choice-create.png','today/choice-collection.png','today/choice-pack-pouch.png','today/choice-gift.png','materials/swatch-holographic.png','ui/icon-market.png','ui/icon-settings.png']
mapjs = '{' + ','.join(f'"{i}":"{data_uri("../../src/art/"+i)}"' for i in icons) + '}'
out = out.replace('const NAV = [', 'const ICONS = ' + mapjs + ';\nconst NAV = [', 1)
out = out.replace('url(../../src/art/${n.i})', 'url(${ICONS[n.i]})').replace("url(../../src/art/ui/icon-settings.png)", "url(${ICONS['ui/icon-settings.png']})")

# fonts: Special Elite only
font = base64.b64encode((ROOT / 'src/fonts/SpecialElite-Regular.ttf').read_bytes()).decode()
face = '@font-face{font-family:"Special Elite";src:url(data:font/ttf;base64,' + font + ') format("truetype");font-display:swap}'
out = out.replace('<link rel="stylesheet" href="../../src/fonts/fonts.css">', '<style>' + face + '</style>')
(DIR / 'design-quality-preview.html').write_text(out, encoding='utf-8')
print('written', len(out)//1024, 'KB;', len(cache), 'assets')
