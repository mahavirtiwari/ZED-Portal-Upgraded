"""Draws the ZED-X (Export) certificate artwork from the Gold one (run once; the output is committed).

    python -I backend/tools/make_zedx_artwork.py

Reads  backend/src/Zed.Portal/Assets/Documents/SaGold.jpg and LevelGold.png
Writes backend/src/Zed.Portal/Assets/Documents/SaZEDX.jpg  (certificate background, same layout as SaCertification.json)
       backend/src/Zed.Portal/Assets/Documents/LevelZEDX.png (report badge)

In the colours of the ZED Export badge (teal #2ECAD0 to blue #3A85C4): the gold of the coin, the title ornaments and
the side bar takes the gradient, the coin reads "EXPORT" and the title "ZED-X (Export)". The validity line under
"Certificate Validity :" is left empty: the portal writes the Admin's validity there, and draws the logo uploaded in
Administration -> Certification Levels over the coin when there is one.
"""
import colorsys
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(HERE, '..', 'src', 'Zed.Portal', 'Assets', 'Documents')
FONTS = os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts')

TEAL = (46, 202, 208)   # left of the badge
BLUE = (58, 133, 196)   # right of the badge
NAVY = (20, 45, 66)     # the badge's text shadow
BACKGROUND = (248, 248, 248)


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def is_gold(r, g, b):
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    return 0.05 <= h <= 0.17 and s >= 0.25 and v >= 0.25


def recolour(img, box, vertical=False):
    """Gold pixels in the box take the teal-to-blue gradient (left to right, or top to bottom), keeping their shading."""
    px = img.load()
    x0, y0, x1, y1 = box
    for y in range(y0, y1):
        for x in range(x0, x1):
            p = px[x, y]
            r, g, b = p[:3]
            if not is_gold(r, g, b):
                continue
            t = (y - y0) / max(1, y1 - y0 - 1) if vertical else (x - x0) / max(1, x1 - x0 - 1)
            base = mix(TEAL, BLUE, t)
            _, _, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            k = min(1.15, 0.45 + v * 0.65)  # the gold's light and shade
            px[x, y] = tuple(min(255, round(c * k)) for c in base) + tuple(p[3:])


def gradient_text(img, xy, text, fnt):
    """Text filled with the badge's gradient, left to right."""
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).text(xy, text, font=fnt, fill=255)
    x0, y0, x1, y1 = mask.getbbox()
    fill = Image.new('RGB', img.size)
    fd = ImageDraw.Draw(fill)
    for x in range(x0, x1):
        fd.line([(x, y0), (x, y1)], fill=mix(TEAL, BLUE, (x - x0) / max(1, x1 - x0 - 1)))
    img.paste(fill, (0, 0), mask)


def shadowed(draw, cx, top, text, fnt, offset):
    """White text with the badge's dark shadow, centred on cx."""
    w = draw.textlength(text, font=fnt)
    draw.text((cx - w / 2 + offset, top + offset), text, font=fnt, fill=NAVY)
    draw.text((cx - w / 2, top), text, font=fnt, fill=(255, 255, 255))


def certificate():
    img = Image.open(os.path.join(DOCS, 'SaGold.jpg')).convert('RGB')
    w, _ = img.size
    recolour(img, (0, 640, 160, 900), vertical=True)
    recolour(img, (680, 1080, 1810, 1400))
    recolour(img, (1560, 300, 2260, 980))

    # Title between the ornaments: "ZED GOLD" -> "ZED-X (Export)".
    px = img.load()
    for y in range(1150, 1335):
        for x in range(690, 1800):
            r, g, b = px[x, y]
            if max(r, g, b) - min(r, g, b) > 30:
                px[x, y] = BACKGROUND
    d = ImageDraw.Draw(img)
    big, small = font('georgiab.ttf', 175), font('georgiab.ttf', 92)
    main, sub = 'ZED-X', ' (Export)'
    width = d.textlength(main, font=big) + d.textlength(sub, font=small)
    left = (w - width) / 2
    gradient_text(img, (left, 1135), main, big)
    gradient_text(img, (left + d.textlength(main, font=big), 1205), sub, small)

    # Coin: "GOLD" -> "EXPORT".
    d = ImageDraw.Draw(img)
    coin = px[2130, 745]
    d.rounded_rectangle((1890, 708, 2140, 786), radius=8, fill=coin)
    shadowed(d, 2010, 704, 'EXPORT', font('arialbd.ttf', 58), 4)

    # Validity line (written by the portal): clear "Three years from the date of issue".
    d.rectangle((150, 3150, 660, 3205), fill=BACKGROUND)
    img.save(os.path.join(DOCS, 'SaZEDX.jpg'), quality=92, dpi=(300, 300))


def badge():
    img = Image.open(os.path.join(DOCS, 'LevelGold.png')).convert('RGBA')
    recolour(img, (0, 0, img.width, img.height))
    d = ImageDraw.Draw(img)
    coin = img.getpixel((160, 140))[:3]
    d.rectangle((98, 120, 156, 140), fill=coin)
    shadowed(d, 127, 121, 'EXPORT', font('arialbd.ttf', 14), 1)
    img.save(os.path.join(DOCS, 'LevelZEDX.png'))


if __name__ == '__main__':
    certificate()
    badge()
    print('written to', os.path.abspath(DOCS), file=sys.stderr)
