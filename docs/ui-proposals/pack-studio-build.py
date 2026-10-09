#!/usr/bin/env python3
"""Build pack-studio-preview.standalone.html: one file that opens from file:// (or any server) with no src/ next to it.
Images are re-encoded to WebP at a sensible size, the fonts are subset, the CSS url()s are inlined and the JS gets ART_MAP.
Run from anywhere:  python3 docs/ui-proposals/pack-studio-build.py   (needs Pillow and fonttools)"""
import base64, io, json, re
from pathlib import Path
from PIL import Image

UI = Path(__file__).resolve().parent
ROOT = UI.parent.parent
ART = ROOT / "src" / "art"
SRC = UI / "pack-studio-preview.html"
OUT = UI / "pack-studio-preview.standalone.html"
CAP = {"samples": 380, "pack": 640, "notes": 260, "ui": 600, "market": 520, "book": 700}

def b64(data: bytes, mime: str) -> str:
    return f"data:{mime};base64," + base64.b64encode(data).decode()

def encode(rel: str) -> str:
    im = Image.open(ART / rel)
    cap = CAP.get(rel.split("/")[0], 600)
    if max(im.size) > cap:
        k = cap / max(im.size); im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    buf = io.BytesIO()
    if rel.endswith(".jpg"): im.convert("RGB").save(buf, "WEBP", quality=72, method=6)
    else: im.convert("RGBA").save(buf, "WEBP", quality=88, method=6, alpha_quality=95)
    return b64(buf.getvalue(), "image/webp")

def subset(path: Path, text: str) -> str:
    from fontTools import subset as st
    o = st.Options(); o.layout_features = ["*"]; o.flavor = "woff2"
    f = st.load_font(str(path), o); s = st.Subsetter(o); s.populate(text=text); s.subset(f)
    buf = io.BytesIO(); st.save_font(f, buf, o); return b64(buf.getvalue(), "font/woff2")

def main():
    html = SRC.read_text()
    used = set(re.findall(r'src/art/([\w\-./]+\.(?:png|jpg))', html))                       # CSS url(...)
    used |= set(re.findall(r'A\("([\w\-./]+\.(?:png|jpg))"', html))                            # A("notes/paper-clip.png")
    used |= {f"samples/{p.name}" for p in (ART / "samples").glob("*.png")}                    # the sticker list holds bare file names
    used |= {"pack/pack-kraft.png", "pack/pack-matte.png", "pack/pack-holographic.png"}
    art_map = {rel: encode(rel) for rel in sorted(used)}
    print(f"{len(art_map)} images, {sum(len(v) for v in art_map.values()) / 1e6:.2f} MB (base64)")
    html = re.sub(r'url\((["\']?)(?:\.\./)+src/art/([\w\-./]+)\1\)', lambda m: f'url("{art_map[m.group(2)]}")', html)
    latin = "".join(chr(c) for c in range(32, 127)) + "…—–·→←↑↓✓“”’‘"
    fonts = "\n".join([
        f'@font-face {{ font-family: "Special Elite"; src: url("{subset(ROOT / "src/fonts/SpecialElite-Regular.ttf", latin)}") format("woff2"); font-weight: 400; }}',
        f'@font-face {{ font-family: "Klee One"; src: url("{subset(ROOT / "src/fonts/KleeOne-Regular.ttf", latin)}") format("woff2"); font-weight: 400; }}',
        f'@font-face {{ font-family: "Klee One"; src: url("{subset(ROOT / "src/fonts/KleeOne-SemiBold.ttf", latin)}") format("woff2"); font-weight: 600; }}',
        f'@font-face {{ font-family: "Kalam"; src: url("{b64((ROOT / "src/fonts/Kalam-Regular-Latin.woff2").read_bytes(), "font/woff2")}") format("woff2"); font-weight: 400; }}',
        f'@font-face {{ font-family: "Patrick Hand"; src: url("{b64((ROOT / "src/fonts/PatrickHand-Regular-Latin.woff2").read_bytes(), "font/woff2")}") format("woff2"); font-weight: 400; }}',
    ])
    html = html.replace('<link rel="stylesheet" href="../../src/fonts/fonts.css" />', f"<style>\n{fonts}\n</style>")
    html = html.replace("<script>\nconst ART", "<script>window.ART_MAP = " + json.dumps(art_map, separators=(",", ":")) + ";</script>\n<script>\nconst ART", 1)
    assert "../../src/" not in html.replace('const ART = "../../src/art/"', ""), "a path to src/ is left"
    OUT.write_text(html)
    print(f"wrote {OUT.name}: {OUT.stat().st_size / 1e6:.2f} MB")

main()
