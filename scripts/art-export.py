#!/usr/bin/env python3
"""Stage 1 export: alpha coverage, neutral contact shadows, RGB PNG budgeting.

Dependencies for art production only: Pillow, numpy, scipy.
Originals live in ignored assets-src/art/. No runtime code imports this module.
"""
from pathlib import Path
import argparse
import json
import numpy as np
from PIL import Image, ImageFilter, ImageCms
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
ICC = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()

def clean_alpha(image, translucent=False):
    data = np.array(image.convert('RGBA'))
    old = data[:, :, 3].astype(float)
    solid = old >= 128
    labels, count = ndimage.label(solid)
    sizes = np.bincount(labels.ravel())
    keep = sizes >= 12
    keep[0] = False
    solid = keep[labels]
    inside = ndimage.distance_transform_edt(solid)
    outside, nearest = ndimage.distance_transform_edt(~solid, return_indices=True)
    if translucent:
        alpha = np.where(solid, np.minimum(old, 160), np.where(outside <= 1.2, old, 0))
    else:
        alpha = np.where(solid, np.where((old >= 230) | (inside > 1.5), 255, old * 255 / 253),
                         np.where(outside <= 1.2, np.minimum(old, 127), 0))
    alpha = np.clip(np.rint(alpha), 0, 255).astype(np.uint8)
    edge = (alpha > 0) & ~solid
    rgb = data[:, :, :3]
    rgb[edge] = rgb[nearest[0][edge], nearest[1][edge]]
    data[:, :, 3] = alpha
    data[alpha == 0, :3] = 0
    return Image.fromarray(data), solid

def with_shadow(body, solid, shadow=True):
    if not shadow:
        return body
    distance = ndimage.distance_transform_edt(~solid)
    moved = ndimage.shift(solid.astype(float), (2, 2), order=0, mode='constant', cval=0)
    soft = ndimage.gaussian_filter(moved, 1.15, truncate=2)
    shadow_alpha = np.where((distance <= 6) & ~solid, np.minimum(soft * 30, 30), 0)
    shade = np.zeros((*solid.shape, 4), dtype=np.uint8)
    shade[:, :, :3] = 43  # neutral grey, no kraft/brown pigment
    shade[:, :, 3] = np.rint(shadow_alpha).astype(np.uint8)
    return Image.alpha_composite(Image.fromarray(shade), body)

def fit(image, size, margin=.10, tight=False):
    a = np.asarray(image.convert('RGBA'))[:, :, 3]
    ys, xs = np.where(a >= 128)
    if not len(xs):
        raise ValueError('Empty image')
    image = image.crop((max(0, xs.min()-2), max(0, ys.min()-2), min(image.width, xs.max()+3), min(image.height, ys.max()+3)))
    if tight:
        image.thumbnail((1008, 1008), Image.Resampling.LANCZOS)
        # thumbnail does not upscale; these review samples must have long edge 1024.
        k = 1008 / max(image.size)
        image = image.resize((round(image.width*k), round(image.height*k)), Image.Resampling.LANCZOS)
        canvas = Image.new('RGBA', (image.width+16, image.height+16))
        canvas.paste(image, (8, 8))
        return canvas
    w, h = size
    k = min(w*(1-2*margin)/image.width, h*(1-2*margin)/image.height)
    image = image.resize((round(image.width*k), round(image.height*k)), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', size)
    canvas.paste(image, ((w-image.width)//2, (h-image.height)//2))
    return canvas

def png_budget(image, target, limit=600000):
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    image = image.convert('RGBA')
    alpha = image.getchannel('A')
    original = np.array(image)
    neutral_shadow = (original[:, :, 3] > 0) & (original[:, :, 3] <= 30) & np.all(original[:, :, :3] == 43, axis=2)
    # Quantize RGB only. Alpha stays 8-bit; deliver truecolour RGBA (PNG colour type 6).
    for colours in (None, 256, 192, 128, 96, 64, 48, 32, 24, 16):
        out = image.copy()
        if colours:
            rgb = image.convert('RGB').filter(ImageFilter.GaussianBlur(.35))
            rgb = rgb.quantize(colors=colours, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGB')
            out = rgb.convert('RGBA')
            out.putalpha(alpha)
        data = np.array(out)
        data[neutral_shadow, :3] = 43
        data[data[:, :, 3] == 0, :3] = 0
        out = Image.fromarray(data)
        out.save(target, optimize=True, compress_level=9, icc_profile=ICC)
        if target.stat().st_size <= limit:
            return {'bytes': target.stat().st_size, 'rgbPalette': colours, 'width': out.width, 'height': out.height}
    # Very detailed generated fibres can exceed the budget at Retina dimensions.
    # Smooth their RGB texture rather than lowering resolution or alpha precision.
    for radius in (.8, 1.2, 2.0):
        rgb = image.convert('RGB').filter(ImageFilter.GaussianBlur(radius))
        for colours in (96, 64, 32, 16):
            out = rgb.quantize(colors=colours, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGBA')
            out.putalpha(alpha)
            data = np.array(out)
            data[neutral_shadow, :3] = 43
            data[data[:, :, 3] == 0, :3] = 0
            Image.fromarray(data).save(target, optimize=True, compress_level=9, icc_profile=ICC)
            if target.stat().st_size <= limit:
                return {'bytes': target.stat().st_size, 'rgbPalette': colours, 'textureBlur': radius, 'width': out.width, 'height': out.height}
    raise ValueError(f'PNG exceeds {limit} bytes: {target}')

def export(image, path, shadow=True, translucent=False):
    body, solid = clean_alpha(image, translucent)
    output = with_shadow(body, solid, shadow)
    return png_budget(output, ROOT / path)

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('source')
    p.add_argument('target')
    p.add_argument('--size', nargs=2, type=int)
    p.add_argument('--tight', action='store_true')
    p.add_argument('--no-shadow', action='store_true')
    p.add_argument('--translucent', action='store_true')
    args = p.parse_args()
    image = Image.open(args.source).convert('RGBA')
    if args.size or args.tight:
        image = fit(image, tuple(args.size or (1024, 1024)), tight=args.tight)
    print(json.dumps(export(image, args.target, not args.no_shadow, args.translucent)))
