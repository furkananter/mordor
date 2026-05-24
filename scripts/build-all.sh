#!/usr/bin/env bash
# Build every artifact: mac (arm64+x64), win (arm64+x64), linux (arm64+x64).
#
# Runs the native targets first (fast, no Docker), then the Docker-based
# linux/x64 and win/x64 builds. After that, restores host (mac arm64) native
# modules so `npm run dev` keeps working.
#
# Assumes:
#   - host is macOS Apple Silicon
#   - Docker Desktop is running

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== 1/4  macOS arm64 + x64 ==="
npm run dist:mac

echo
echo "=== 2/4  Windows arm64 ==="
npx electron-builder --win --arm64

echo
echo "=== 3/4  Linux arm64 ==="
npx electron-builder --linux --arm64

echo
echo "=== 4/4  Linux x64 + Windows x64 (Docker) ==="
bash scripts/build-in-docker.sh linux --x64
bash scripts/build-in-docker.sh win --x64

echo
echo "=== Restoring host native modules for dev ==="
npm install --no-audit --no-fund

echo
echo "✓ All builds complete. Artifacts in ./release/"
ls -1 release/ | grep -E '\.(dmg|zip|exe|AppImage|deb|rpm)$' || true
