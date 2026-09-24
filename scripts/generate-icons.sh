#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
for command in rsvg-convert magick iconutil; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done

icon_tmp=$(mktemp -d)
trap 'rm -rf "$icon_tmp"' EXIT

for name in douchat douchat-dev; do
  rsvg-convert -w 1024 -h 1024 "resources/icons/$name.svg" -o "$icon_tmp/$name.png"
  iconset="$icon_tmp/$name.iconset"
  mkdir -p "$iconset"
  for size in 16 32 128 256 512; do
    magick "$icon_tmp/$name.png" -resize "${size}x${size}" "$iconset/icon_${size}x${size}.png"
    double=$((size * 2))
    magick "$icon_tmp/$name.png" -resize "${double}x${double}" "$iconset/icon_${size}x${size}@2x.png"
  done
  iconutil -c icns "$iconset" -o "$icon_tmp/$name.icns"
done

magick "$icon_tmp/douchat.png" -define icon:auto-resize=256,128,64,48,32,16 "$icon_tmp/douchat.ico"
for name in douchat douchat-dev; do
  cp "$icon_tmp/$name.png" "$icon_tmp/$name.icns" resources/icons/
done
cp "$icon_tmp/douchat.ico" resources/icons/
