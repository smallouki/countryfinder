#!/usr/bin/env bash
# Build a directory that matches the CI Firefox package (manifest-firefox.json → manifest.json).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-"$ROOT/build/firefox-addon"}"
rm -rf "$OUT"
mkdir -p "$OUT"
cp "$ROOT/manifest-firefox.json" "$OUT/manifest.json"
cp "$ROOT/service_worker.js" "$ROOT/resolve_core.js" "$ROOT/options.html" "$ROOT/options.js" "$ROOT/options.css" "$ROOT/LICENSE" "$ROOT/README.md" "$OUT/"
cp -r "$ROOT/content" "$ROOT/icons" "$OUT/"
echo "Prepared Firefox add-on directory: $OUT"
