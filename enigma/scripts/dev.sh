#!/usr/bin/env bash
set -euo pipefail

npm install
cp -n .env.example .env || true
npm run dev
