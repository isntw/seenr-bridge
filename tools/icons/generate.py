#!/usr/bin/env python3
"""Regenerates the committed PWA icons from the SVG sources.

Needs macOS (qlmanage) and Pillow, neither of which is a project dependency:

    python3 -m venv /tmp/icons-venv
    /tmp/icons-venv/bin/pip install pillow
    /tmp/icons-venv/bin/python tools/icons/generate.py
"""
import re
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent.parent / 'public'
SQUARE = HERE / 'icon-square.svg'
BADGE = HERE / 'icon-badge.svg'
ROUNDED = HERE / 'icon.svg'
VIEWBOX = 512
# Single source of truth for the corner radius: whatever icon.svg draws.
RX = float(re.search(r'rx="([\d.]+)"', ROUNDED.read_text()).group(1))


def rasterise(svg: Path, size: int) -> Image.Image:
    """qlmanage writes <name>.png beside the source; render, load, clean up."""
    subprocess.run(['qlmanage', '-t', '-s', str(size), '-o', str(HERE), str(svg)],
                   check=True, capture_output=True)
    tmp = HERE / f'{svg.name}.png'
    im = Image.open(tmp).convert('RGBA')
    im.load()
    tmp.unlink()
    if im.size != (size, size):
        sys.exit(f'qlmanage produced {im.size} for {svg.name}, wanted {size}x{size}')
    return im


def round_corners(im: Image.Image) -> Image.Image:
    size = im.width
    ss = 4  # supersample the mask so its edge is antialiased, not jagged
    mask = Image.new('L', (size * ss, size * ss), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size * ss - 1, size * ss - 1],
        radius=RX / VIEWBOX * size * ss, fill=255)
    im.putalpha(mask.resize((size, size), Image.LANCZOS))
    return im


def badge(im: Image.Image) -> Image.Image:
    # Android paints the alpha channel of a notification badge with its own accent
    # colour and discards the rest, so the glyph has to BE the alpha. qlmanage
    # flattens transparency onto white, hence a black-on-white source inverted here.
    mask = im.convert('L').point(lambda v: 255 - v)
    out = Image.new('RGBA', im.size, (255, 255, 255, 0))
    out.putalpha(mask)
    return out


def write(im: Image.Image, name: str) -> None:
    path = PUBLIC / name
    im.save(path, optimize=True)
    print(f'  public/{name:<24} {path.stat().st_size:>7} bytes  {im.width}x{im.height}'
          f'  mode={im.mode}')


print('writing:')
for size in (192, 512):
    write(round_corners(rasterise(SQUARE, size)), f'icon-{size}.png')
# Full-bleed and deliberately opaque: iOS and Android apply their own mask, so
# these carry no alpha channel at all.
write(rasterise(SQUARE, 512).convert('RGB'), 'icon-maskable-512.png')
write(rasterise(SQUARE, 180).convert('RGB'), 'apple-touch-icon.png')
write(badge(rasterise(BADGE, 96)), 'badge-96.png')
shutil.copy(ROUNDED, PUBLIC / 'favicon.svg')
print(f'  public/{"favicon.svg":<24} {(PUBLIC / "favicon.svg").stat().st_size:>7} bytes')
