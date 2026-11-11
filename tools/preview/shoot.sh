#!/bin/sh
# Capture de la page d'aperçu en Chrome sans fenêtre : shoot.sh <sortie.png> <requête> [largeur] [hauteur]
# Le serveur de dev doit tourner (npx vite --port 5199).
CH="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
OUT="$1"; Q="$2"; W="${3:-1600}"; H="${4:-900}"
PROF="$TEMP/chrome-shot-$$-$(date +%s%N)"
"$CH" --headless=new --enable-unsafe-webgpu --hide-scrollbars --window-size="$W,$H" --virtual-time-budget=25000 \
  --user-data-dir="$PROF" --screenshot="$OUT" "http://localhost:${PORT:-5199}/tools/preview/index.html?$Q" 2>&1 | grep -i "written|error" | grep -v externally_managed
rm -rf "$PROF"
