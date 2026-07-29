#!/usr/bin/env bash
# Regenerates the committed PWA icons from the SVG sources. macOS only
# (qlmanage); the PNGs are committed so no build or CI step needs this.
set -euo pipefail
cd "$(dirname "$0")"
out=../../public

render() { # <source.svg> <size> <dest.png>
  qlmanage -t -s "$2" -o . "$1" >/dev/null 2>&1
  mv "$1.png" "$out/$3"
}

render icon.svg        192 icon-192.png
render icon.svg        512 icon-512.png
render icon-square.svg 512 icon-maskable-512.png
render icon-square.svg 180 apple-touch-icon.png
cp icon.svg "$out/favicon.svg"

echo "wrote:"
for f in icon-192.png icon-512.png icon-maskable-512.png apple-touch-icon.png favicon.svg; do
  echo "  public/$f"
done
