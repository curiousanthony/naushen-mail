#!/usr/bin/env bash
# Build Mailroom and install it to /Applications (no prompts).
#   scripts/dev-install.sh            # build for this Mac's architecture, install
#   DEST=~/Applications scripts/dev-install.sh
set -euo pipefail

cd "$(dirname "$0")/.."
DEST="${DEST:-/Applications}"
APP_NAME="Mailroom.app"

case "$(uname -m)" in
  arm64) OUT="release/mac-arm64" ; ARCH_FLAG="--arm64" ;;
  x86_64) OUT="release/mac" ; ARCH_FLAG="--x64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

echo "==> Building bundles"
npm run build

echo "==> Packaging ($ARCH_FLAG, unpacked .app)"
rm -rf "$OUT/$APP_NAME"
npx electron-builder --mac --dir "$ARCH_FLAG"

if [ ! -d "$OUT/$APP_NAME" ]; then
  echo "Expected $OUT/$APP_NAME was not produced" >&2
  exit 1
fi

# Quit a running copy so the bundle can be replaced cleanly.
osascript -e 'tell application "Mailroom" to quit' >/dev/null 2>&1 || true
sleep 1

echo "==> Installing to $DEST/$APP_NAME"
mkdir -p "$DEST"
rm -rf "$DEST/$APP_NAME"
ditto "$OUT/$APP_NAME" "$DEST/$APP_NAME"

# Locally built, so there is nothing to protect against: drop the quarantine flag if present.
xattr -dr com.apple.quarantine "$DEST/$APP_NAME" 2>/dev/null || true

echo "==> Installed: $DEST/$APP_NAME"
echo "    Launch with: open -a Mailroom"
