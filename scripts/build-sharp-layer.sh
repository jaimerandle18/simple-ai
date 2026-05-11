#!/bin/bash
# Build sharp Lambda layer for linux-x64 (Lambda runtime)
# Run before `cdk deploy` when sharp version changes
set -e

LAYER_DIR="$(cd "$(dirname "$0")/../layers/sharp/nodejs" && pwd)"

echo "Installing sharp + linux-x64 binaries..."
cd "$LAYER_DIR"
rm -rf node_modules package-lock.json
npm install --force
# Remove macOS binaries (not needed in Lambda)
rm -rf node_modules/@img/sharp-darwin-* node_modules/@img/sharp-libvips-darwin-*
echo "Sharp layer built: $(du -sh node_modules | cut -f1)"
