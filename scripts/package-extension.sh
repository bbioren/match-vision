#!/usr/bin/env bash
# Builds extension/ into a Chrome Web Store-ready zip in dist/.
# Usage: ./scripts/package-extension.sh
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(python3 -c "import json; print(json.load(open('extension/manifest.json'))['version'])")
ZIP_NAME="matchvision-eye-tracker-v${VERSION}.zip"

mkdir -p dist
rm -f "dist/$ZIP_NAME"
find extension -name ".DS_Store" -delete

(cd extension && zip -r -X "../dist/$ZIP_NAME" . -x "*.DS_Store")

echo ""
echo "Packaged: dist/$ZIP_NAME"
echo "Upload this file directly to the Chrome Web Store Developer Dashboard."
