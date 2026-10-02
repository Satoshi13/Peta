#!/usr/bin/env python3
"""Make generated sticker art feel printed / hand-made instead of "AI-smooth".

What gives generated illustrations away, and what this does about it:
  * the same oil-paint micro-texture everywhere        -> median flatten (edge-keeping) + re-sharpen
  * airbrushed gradients and too many colours          -> partial palette reduction (screen-print feel)
  * enamel-like specular highlights                    -> highlight compression
  * perfectly registered colour                        -> sub-pixel offset of the colour channels (riso misregistration)
  * clean digital finish                               -> fine ink/paper grain + soft paper-fibre mottling

The alpha channel is never touched, so cut-out edges and the die-cut checks stay valid.
Dependencies: Pillow, numpy (no scipy). Originals are never overwritten unless --in-place is given.

  python3 scripts/art-humanize.py src/art/samples/cat-skateboard.png /tmp/cat.png --strength 0.6
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def lerp(a, b, t):
    return a + (b - a) * t


def humanize(img: Image.Image, strength: float = 0.5, seed: int = 7) -> Image.Image:
    s = float(np.clip(strength, 0.0, 1.0))
    rgba = img.convert("RGBA")
    alpha = rgba.getchannel("A")
    solid = np.array(alpha) > 0
    rng = np.random.default_rng(seed)

    # paint transparent pixels with nearby colour so filters do not bleed black/white into the edge
    base = Image.new("RGB", rgba.size, (0, 0, 0))
    arr = np.array(rgba)
    rgb = arr[..., :3].astype(np.float32)
    if solid.any():
        mean = rgb[solid].mean(axis=0)
        rgb[~solid] = mean
    work = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
    orig = np.array(work).astype(np.float32)

    # 1. flatten the uniform impasto streaks, keep the shapes
    size = 5 if s < 0.8 else 7
    flat = np.array(work.filter(ImageFilter.MedianFilter(size))).astype(np.float32)
    flat = np.array(Image.fromarray(flat.astype(np.uint8)).filter(
        ImageFilter.UnsharpMask(radius=1.6, percent=int(lerp(40, 90, s)), threshold=2))).astype(np.float32)
    out = lerp(orig, flat, 0.85 * s)

    # 2. fewer colours: a partial palette reduction removes airbrush gradients
    colours = int(lerp(64, 22, s))
    quant = np.array(Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
                     .quantize(colors=colours, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
                     .convert("RGB")).astype(np.float32)
    out = lerp(out, quant, 0.4 * s)

    # 3. enamel highlights: compress the brightest values toward a paper white
    lum = out.mean(axis=2, keepdims=True)
    knee = 205.0
    over = np.clip((lum - knee) / (255.0 - knee), 0, 1)
    out = out - over * lerp(0, 22, s)

    # 4. misregistration: shift red and blue against green by a pixel or so
    dx = 1 if s >= 0.8 else 0  # colour fringes on thin lines (whiskers) read as dirt, so only at the top end
    if dx:
        out[..., 0] = np.roll(out[..., 0], dx, axis=1)
        out[..., 2] = np.roll(out[..., 2], -dx, axis=1)
        out[..., 0] = np.roll(out[..., 0], 1, axis=0)

    # 5. ink grain (fine) and paper mottling (soft, large)
    h, w = out.shape[:2]
    fine = rng.normal(0, 1, (h, w)).astype(np.float32)
    fine_img = Image.fromarray(((fine * 40) + 128).clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))
    fine = (np.array(fine_img).astype(np.float32) - 128) / 40.0
    mott = rng.normal(0, 1, (h // 12 + 2, w // 12 + 2)).astype(np.float32)
    mott_img = Image.fromarray(((mott * 40) + 128).clip(0, 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    mott = (np.array(mott_img).astype(np.float32) - 128) / 40.0
    grain = fine * lerp(0, 5.5, s) + mott * lerp(0, 4.0, s)
    out = out + grain[..., None]

    out = np.clip(out, 0, 255).astype(np.uint8)
    res = np.dstack([out, np.array(alpha)])
    res[~solid, :3] = 0
    return Image.fromarray(res, "RGBA")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("dst", nargs="?")
    ap.add_argument("--strength", type=float, default=0.5)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--in-place", action="store_true")
    a = ap.parse_args()
    dst = Path(a.src) if a.in_place else Path(a.dst)
    humanize(Image.open(a.src), a.strength, a.seed).save(dst, optimize=True)
    print(f"{a.src} -> {dst} (strength {a.strength})")


if __name__ == "__main__":
    main()
