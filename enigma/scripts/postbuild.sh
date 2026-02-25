#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p dist/config dist/public
cp -f src/config/default.json dist/config/default.json
cp -f src/public/* dist/public/
