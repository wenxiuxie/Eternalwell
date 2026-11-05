"""Finish raw renders like photographs: gentle grain, soft vignette, slight warmth; save web-sized JPEG + WebP."""
import pathlib
import sys

from PIL import Image, ImageChops, ImageEnhance, ImageFilter

raw, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
for src in sorted(raw.glob('*.png')):
    im = Image.open(src).convert('RGB')
    w, h = im.size
    # soft vignette
    mask = Image.new('L', (w, h), 0)
    inner = Image.new('L', (int(w * 0.8), int(h * 0.8)), 255)
    mask.paste(inner, (int(w * 0.1), int(h * 0.1)))
    mask = mask.filter(ImageFilter.GaussianBlur(min(w, h) * 0.18))
    dark = ImageEnhance.Brightness(im).enhance(0.86)
    im = Image.composite(im, dark, mask)
    # film grain
    noise = Image.effect_noise((w, h), 18).convert('RGB')
    im = ImageChops.blend(im, ImageChops.overlay(im, noise), 0.10)
    # a touch of warmth and contrast
    r, g, b = im.split()
    im = Image.merge('RGB', (r.point(lambda v: min(255, v * 1.015)), g, b.point(lambda v: v * 0.985)))
    im = ImageEnhance.Contrast(im).enhance(1.04)
    name = src.stem
    im.save(out / f'{name}.jpg', quality=82, optimize=True, progressive=True)
    im.save(out / f'{name}.webp', quality=80, method=6)
    print('finished', name, im.size)
