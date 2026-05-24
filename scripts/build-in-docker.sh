#!/usr/bin/env bash
# Build a native-module-heavy target inside the official electron-userland builder image.
# Use this for linux/x64 and win/x64 from a non-matching host (e.g. mac arm64).
#
# Usage:
#   bash scripts/build-in-docker.sh linux --x64
#   bash scripts/build-in-docker.sh win   --x64
#
# Why Docker: node-pty has no prebuilds for linux-x64 / win32-x64. node-gyp
# cannot cross-compile native modules, so we run the build on a linux/amd64
# container where the toolchain is native to the target arch.

set -euo pipefail

PLATFORM=${1:?"first arg must be 'linux' or 'win'"}
shift

case "$PLATFORM" in
  linux) BUILDER_FLAGS=(--linux AppImage "$@") ;;
  win)   BUILDER_FLAGS=(--win nsis "$@") ;;
  *) echo "unknown platform: $PLATFORM (expected linux|win)"; exit 1 ;;
esac

# electronuserland/builder:wine bundles Wine for cross-building Windows.
# electronuserland/builder:22 is enough for Linux.
IMAGE="electronuserland/builder:22"
if [ "$PLATFORM" = "win" ]; then
  IMAGE="electronuserland/builder:wine"
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

docker run --rm --platform linux/amd64 \
  -v "$REPO_ROOT":/project \
  -v "$HOME/.cache/electron":/root/.cache/electron \
  -v "$HOME/.cache/electron-builder":/root/.cache/electron-builder \
  -w /project \
  "$IMAGE" \
  bash -c "rm -rf node_modules package-lock.json && npm install --no-audit --no-fund && npm run build && npx electron-builder ${BUILDER_FLAGS[*]}"

echo
echo "✓ ${PLATFORM} build done."
echo "  Tip: run 'npm install' on the host afterwards to restore mac arm64 native modules for dev."
