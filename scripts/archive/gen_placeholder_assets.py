"""Phase 0 placeholder art: a flat cat sticker (white die-cut border), app icon, tray template icon.
Replace src/assets/cat.png with any transparent PNG to try other stickers."""
from PIL import Image, ImageDraw, ImageFilter

S = 4  # supersample


def cat_mask_and_art(size=600):
    w = size * S
    art = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    d = ImageDraw.Draw(art)
    k = w / 600
    fur, dark, pink = (232, 176, 110, 255), (60, 44, 38, 255), (240, 140, 150, 255)
    # ears
    d.polygon([(130*k, 250*k), (150*k, 90*k), (270*k, 190*k)], fill=fur)
    d.polygon([(470*k, 250*k), (450*k, 90*k), (330*k, 190*k)], fill=fur)
    d.polygon([(158*k, 215*k), (165*k, 135*k), (225*k, 190*k)], fill=pink)
    d.polygon([(442*k, 215*k), (435*k, 135*k), (375*k, 190*k)], fill=pink)
    # body + head
    d.ellipse((150*k, 330*k, 450*k, 560*k), fill=fur)
    d.ellipse((110*k, 150*k, 490*k, 450*k), fill=fur)
    # stripes
    for x in (260, 300, 340):
        d.rounded_rectangle((x*k-6*k, 158*k, x*k+6*k, 215*k), 6*k, fill=(196, 130, 70, 255))
    # eyes, nose, mouth
    for cx in (220, 380):
        d.ellipse((cx*k-26*k, 270*k, cx*k+26*k, 330*k), fill=dark)
        d.ellipse((cx*k-9*k, 280*k, cx*k+3*k, 292*k), fill=(255, 255, 255, 255))
    d.polygon([(285*k, 345*k), (315*k, 345*k), (300*k, 365*k)], fill=pink)
    d.line([(300*k, 365*k), (300*k, 380*k)], fill=dark, width=int(4*k))
    d.arc((262*k, 370*k, 300*k, 400*k), 0, 180, fill=dark, width=int(4*k))
    d.arc((300*k, 370*k, 338*k, 400*k), 0, 180, fill=dark, width=int(4*k))
    for y in (350, 372):
        d.line([(120*k, y*k), (205*k, (y+8)*k)], fill=dark, width=int(3*k))
        d.line([(480*k, y*k), (395*k, (y+8)*k)], fill=dark, width=int(3*k))
    # tail
    d.arc((380*k, 400*k, 560*k, 560*k), 270, 80, fill=fur, width=int(36*k))
    return art


def die_cut(art, border_px):
    alpha = art.getchannel("A")
    r = border_px * S
    # approximate round dilation by blurring then thresholding
    blurred = alpha.filter(ImageFilter.GaussianBlur(r / 2.2)).point(lambda v: 255 if v > 18 else 0)
    smooth = blurred.filter(ImageFilter.GaussianBlur(S * 2)).point(lambda v: 255 if v > 128 else 0)
    white = Image.new("RGBA", art.size, (255, 255, 255, 255))
    white.putalpha(smooth)
    out = Image.alpha_composite(white, art)
    return out


cat = die_cut(cat_mask_and_art(), 26)
bbox = cat.getbbox()
cat = cat.crop(bbox)
side = max(cat.size)
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
canvas.paste(cat, ((side - cat.width) // 2, (side - cat.height) // 2))
canvas = canvas.resize((512, 512), Image.LANCZOS)
canvas.save("src/assets/cat.png")

# app icon: cat sticker on rounded kraft square
icon = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
ImageDraw.Draw(icon).rounded_rectangle((16, 16, 496, 496), 110, fill=(214, 190, 150, 255))
small = canvas.resize((360, 360), Image.LANCZOS)
icon.alpha_composite(small, (76, 76))
icon.save("src-tauri/icons/icon.png")

# tray icon: macOS template image (alpha only matters)
t = Image.new("RGBA", (S * 44, S * 44), (0, 0, 0, 0))
td = ImageDraw.Draw(t)
td.rounded_rectangle((S * 5, S * 5, S * 39, S * 39), S * 10, fill=(0, 0, 0, 255))
td.polygon([(S*39, S*27), (S*39, S*39), (S*27, S*39)], fill=(0, 0, 0, 0))   # peeled corner
td.polygon([(S*39, S*27), (S*27, S*39), (S*28, S*28)], fill=(0, 0, 0, 120))
td.ellipse((S * 14, S * 14, S * 30, S * 30), fill=(0, 0, 0, 0))
t.resize((44, 44), Image.LANCZOS).save("src-tauri/icons/tray.png")
print("ok")
