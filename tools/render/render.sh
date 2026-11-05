#!/usr/bin/env bash
# Renders the site's 3D "photos" with headless Edge (software WebGL), then finishes them with Pillow.
# Needs the repo root served on port 8011:  python -m http.server 8011 --bind 127.0.0.1
set -euo pipefail
cd "$(dirname "$0")/../.."
EDGE="${EDGE:-/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe}"
ROOT="$(pwd -W)"; RAW="$ROOT/tools/render/raw"; OUT="$ROOT/site/v7/assets/img"
mkdir -p "$RAW" "$OUT"
render() { # name scene w h
  timeout 300 "$EDGE" --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars \
    --user-data-dir="$RAW/.edge" --window-size=$3,$4 --virtual-time-budget=60000 \
    --screenshot="$RAW/$1.png" "http://127.0.0.1:8011/tools/render/studio.html?scene=$2&w=$3&h=$4" >/dev/null 2>&1
  echo "rendered $1"
}
render still-life      still     1600 2000
render skin-hair       skin      1600 1600
render supplements     supp      1600 1600
render clinic-interior arches    2520 1080
render clinic-space    arches2   2520 1080
render arcade          corridor  1600 2000
render arcade-2        corridor2 1600 2000
python tools/render/finish.py "$RAW" "$OUT"
