#!/usr/bin/env python3
"""Review chosen v2 exports at exactly half scale; never modify source artwork.

Run after the selected samples have been exported:
    python scripts/art-review-restyle-v2.py

Committed review sheets contain exported artwork, never candidate grids.
Native-scale inspection segments stay in ignored assets-src/art/restyle-v2/.
"""
from pathlib import Path
import hashlib
import importlib.util
import json
import textwrap

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'assets-src/art/restyle-v2'
OLD = WORK / 'old'
OUT = ROOT / 'docs/art-restyle-v2'
SEGMENTS = WORK / 'review-segments'
SPEC = json.loads((WORK / 'spec.json').read_text())
module_spec = importlib.util.spec_from_file_location('art_restyle', ROOT / 'scripts/art-restyle.py')
restyle = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(restyle)
NAMES = restyle.NAMES
SCHEMES = ('light', 'dark', 'wallpaper')
PADDING = 24
GUTTER = 32
HEADER = 52
FOOTER = 94


def font(size):
    path = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
    return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default()


FONT = font(16)
SMALL = font(14)
TITLE = font(20)


def metadata():
    """Accept the ignored job manifests used by the generation workflow."""
    records = {}
    for filename in ('generation.json', 'jobs.json', 'selections.json'):
        path = WORK / filename
        if not path.exists():
            continue
        value = json.loads(path.read_text())
        if isinstance(value, dict):
            value = value.get('jobs', value)
        if isinstance(value, list):
            value = {item.get('name', item.get('id', '')): item for item in value}
        if isinstance(value, dict):
            for name in NAMES:
                if isinstance(value.get(name), dict):
                    records.setdefault(name, {}).update(value[name])
    return records


def background(scheme, size):
    if scheme != 'wallpaper':
        return Image.new('RGBA', size, '#23272D' if scheme == 'dark' else '#F5F0E6')
    y, x = np.mgrid[:size[1], :size[0]]
    t = (x / size[0] + y / size[1]) / 2
    stops = np.array([[170, 188, 198], [218, 198, 189], [124, 147, 139]])
    index = np.minimum((t * 2).astype(int), 1)
    fraction = t * 2 - index
    rgb = stops[index] * (1 - fraction[:, :, None]) + stops[index + 1] * fraction[:, :, None]
    return Image.fromarray(np.uint8(rgb)).convert('RGBA')


def half(image):
    # Exactly 50% of both exported dimensions, rounding odd dimensions once.
    return image.resize((round(image.width / 2), round(image.height / 2)), Image.Resampling.LANCZOS)


def jpeg(image, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.convert('RGB').save(path, quality=94, optimize=True, subsampling=0)


def text_lines(draw, position, message, fill, width=62):
    x, y = position
    for line in textwrap.wrap(message, width=width):
        draw.text((x, y), line, fill=fill, font=SMALL)
        y += 19


def source_rows(images, border=False):
    painted = {}
    for name, image in images.items():
        if border:
            image, _ = restyle.sticker_with_border(image)
        painted[name] = half(image)
    cell_width = max(image.width for image in painted.values()) + GUTTER
    art_height = max(image.height for image in painted.values())
    size = (PADDING * 2 + cell_width * len(NAMES), HEADER + art_height + FOOTER)
    kind = 'border' if border else 'source'
    mode = 'App-like 3.5% die cut + neutral shadow' if border else 'Source exports / no border or shadow'
    rows = {}
    for scheme in SCHEMES:
        canvas = background(scheme, size)
        draw = ImageDraw.Draw(canvas)
        ink = '#FBF9F4' if scheme == 'dark' else '#2B2A28'
        draw.text((PADDING, 14), 'STYLE-sample v2 / exactly 50% / ' + mode, fill=ink, font=TITLE)
        for index, name in enumerate(NAMES):
            image = painted[name]
            x = PADDING + index * cell_width
            canvas.alpha_composite(image, (x + (cell_width - image.width) // 2,
                                          HEADER + (art_height - image.height) // 2))
            draw.text((x + 8, HEADER + art_height + 10), name, fill=ink, font=FONT)
            medium = SPEC['subjects'][name]['medium']
            text_lines(draw, (x + 8, HEADER + art_height + 34), medium, ink, width=58)
        jpeg(canvas, OUT / f'{kind}-row-{scheme}.jpg')
        rows[scheme] = canvas
        # Three consecutive samples per PNG preserve the row's pixel scale.
        # Cropping never refits the illustration to a new bounding box.
        for start in range(0, len(NAMES), 3):
            end = min(start + 3, len(NAMES))
            left = PADDING + start * cell_width
            right = PADDING + end * cell_width
            segment = canvas.crop((left, 0, right, canvas.height))
            segment.save(SEGMENTS / f'{kind}-{scheme}-{start + 1:02}-{end:02}.png')
    return rows, cell_width


def reference_upper():
    prepared = WORK / 'reference-upper.png'
    if prepared.exists():
        return Image.open(prepared).convert('RGB')
    image = Image.open(ROOT / 'docs/art-reference/style-target-stickers.jpg').convert('RGB')
    # Same upper-PC-only crop as the first restyle review; exclude the Tokyo Pack.
    return image.crop((0, 0, image.width, round(image.height * .385)))


def reference_comparison(row):
    reference = reference_upper()
    top_height = reference.height + 74
    compare = Image.new('RGB', (row.width, top_height + row.height), '#F5F0E6')
    draw = ImageDraw.Draw(compare)
    draw.text((PADDING, 15), 'Reference: upper laptop stickers only / source row below stays exactly 50%',
              fill='#2B2A28', font=TITLE)
    compare.paste(reference, (PADDING, 48))
    compare.paste(row.convert('RGB'), (0, top_height))
    jpeg(compare, OUT / 'reference-comparison.jpg')
    # Separate native-resolution reference lets reviewers inspect it beside row segments.
    reference.save(SEGMENTS / 'reference-upper.png')


def comparisons(images, jobs):
    entries = []
    for name in NAMES:
        old_path = OLD / f'{name}.png'
        new_path = restyle.OUT / f'samples/{name}.png'
        previous = Image.open(old_path).convert('RGBA')
        current = images[name]
        old_hash = hashlib.sha256(old_path.read_bytes()).hexdigest()
        new_hash = hashlib.sha256(new_path.read_bytes()).hexdigest()
        retained = old_hash == new_hash
        pair = [half(previous), half(current)]
        cell_width = max(image.width for image in pair) + 48
        art_height = max(image.height for image in pair)
        canvas = background('light', (PADDING * 2 + cell_width * 2, art_height + 180))
        draw = ImageDraw.Draw(canvas)
        ink = '#2B2A28'
        required = SPEC['subjects'][name]['mandatory']
        category = 'Mandatory' if required else 'Recommended'
        decision = 'old export retained byte-for-byte' if retained else 'new export selected'
        draw.text((PADDING, 12), f'{name} / {category} / {decision}', fill=ink, font=TITLE)
        for index, image in enumerate(pair):
            x = PADDING + index * cell_width
            label = 'OLD / previous restyle / 50%' if index == 0 else 'SELECTED / current export / 50%'
            draw.text((x + 8, 49), label, fill=ink, font=FONT)
            canvas.alpha_composite(image, (x + (cell_width - image.width) // 2,
                                          79 + (art_height - image.height) // 2))
        medium = SPEC['subjects'][name]['medium']
        message = 'Old version retained; see selection reason in report.' if retained else 'Selected medium: ' + medium
        text_lines(draw, (PADDING + 8, 89 + art_height), message, ink, width=115)
        jpeg(canvas, OUT / 'comparisons' / f'{name}.jpg')
        entry = dict(name=name, mandatory=required, retained=retained,
                     oldSha256=old_hash, currentSha256=new_hash,
                     oldDimensions=list(previous.size), currentDimensions=list(current.size),
                     halfDimensions=list(pair[1].size), medium=medium)
        job = jobs.get(name, {})
        for key in ('selectedQuadrant', 'reason', 'selectionReason', 'decision'):
            if key in job:
                entry[key] = job[key]
        entries.append(entry)
    return entries


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    SEGMENTS.mkdir(parents=True, exist_ok=True)
    images = {}
    for name in NAMES:
        path = restyle.OUT / f'samples/{name}.png'
        image = Image.open(path).convert('RGBA')
        if max(image.size) != 1024:
            raise ValueError(f'{name}: export long edge must be 1024, got {image.size}')
        if not (OLD / f'{name}.png').is_file():
            raise FileNotFoundError(f'Missing byte-exact old sample: {OLD / (name + ".png")}')
        images[name] = image
    rows, cell_width = source_rows(images)
    source_rows(images, border=True)
    reference_comparison(rows['light'])
    entries = comparisons(images, metadata())
    review = dict(style='STYLE-sample v2', scale=.5, order=list(NAMES),
                  singleRowDimensions=list(rows['light'].size), cellWidth=cell_width,
                  samples=entries)
    (OUT / 'review-index.json').write_text(json.dumps(review, ensure_ascii=False, indent=2) + '\n')
    print('Wrote six exact-half-scale single-row JPEGs, upper-reference comparison, and 12 old/new pairs.')
    print(f'Native-scale PNG inspection segments: {SEGMENTS.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
