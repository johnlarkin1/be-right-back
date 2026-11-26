#!/usr/bin/env bash
# Build the Be Right Back design system files into design-system/dist/project.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
APP="$ROOT/apps/desktop"
DIST="$HERE/dist"
BUILD="$HERE/.build"

if [ ! -d "$APP/node_modules" ]; then
  (cd "$APP" && npm ci --no-audit --no-fund)
fi

rm -rf "$DIST" "$BUILD"
mkdir -p "$DIST" "$BUILD"

# 1. Hand-written content: brand book, guidelines, previews, types.
cp -R "$HERE/project" "$DIST/project"

# 2. Tokens.
python3 "$HERE/scripts/tokens.py" "$DIST" "$BUILD" "$(git -C "$ROOT" rev-parse --short HEAD)" "$(date -u +%F)"

# 3. Stylesheet: the app's compiled CSS, minus the values that tokens.json owns.
(cd "$APP" && npx vite build --outDir "$BUILD/vite" --emptyOutDir --logLevel warn)
NODE_PATH="$APP/node_modules" node "$HERE/scripts/css.cjs" "$BUILD"/vite/assets/index-*.css "$BUILD/names.json" "$DIST/project/components/bundle.css"

# 4. Component bundle and React.
node "$HERE/scripts/bundle.mjs" "$DIST/project/components"

echo "Built $DIST/project"
