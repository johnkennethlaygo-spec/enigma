#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

LOG_FILE="/tmp/enigma_smoke_web.log"
: > "$LOG_FILE"

export NODE_ENV=development
export ENIGMA_JWT_SECRET="enigma-smoke-secret"
export SOLANA_RPC_URL="${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}"

cleanup() {
  if [[ -n "${WEB_PID:-}" ]]; then
    kill "$WEB_PID" >/dev/null 2>&1 || true
    wait "$WEB_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

npm run web > "$LOG_FILE" 2>&1 &
WEB_PID=$!

for _ in $(seq 1 60); do
  if grep -qE 'http://localhost:[0-9]+' "$LOG_FILE"; then
    break
  fi
  if ! kill -0 "$WEB_PID" >/dev/null 2>&1; then
    echo "[smoke] server process exited before startup"
    tail -n 120 "$LOG_FILE"
    exit 1
  fi
  sleep 1
done

PORT="$(grep -oE 'http://localhost:[0-9]+' "$LOG_FILE" | tail -n1 | cut -d: -f3 || true)"
if [[ -z "$PORT" ]]; then
  echo "[smoke] server failed to start"
  tail -n 80 "$LOG_FILE"
  exit 1
fi

echo "[smoke] server on port $PORT"

TOKEN="$(node -e "require('dotenv').config(); const jwt=require('jsonwebtoken'); const secret=process.env.ENIGMA_JWT_SECRET || 'dev-secret-change-in-production'; process.stdout.write(jwt.sign({sub: 909090, wallet: 'Qa8v2dQf5LZ1bR7hQwH4uXxS9nY3kPm5uK2v1r8t9Zx', plan: 'free'}, secret, {expiresIn:'1h'}));")"

curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -X PUT \
  -d '{"mints":"So11111111111111111111111111111111111111112,4k3Dyjzvzp8eMZWUXbcbKQb4VhM3y7f1nJdJ9xYkX8h"}' \
  "http://localhost:$PORT/api/watchlist" > /tmp/enigma_smoke_watchlist.json

curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -X POST \
  -d '{}' \
  "http://localhost:$PORT/api/watchlist/scan" > /tmp/enigma_smoke_scan.json

curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -X POST \
  -d '{"mint":"So11111111111111111111111111111111111111112"}' \
  "http://localhost:$PORT/api/signal" > /tmp/enigma_smoke_signal.json

curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -X POST \
  -d '{"limit":3}' \
  "http://localhost:$PORT/api/discovery/suggest" > /tmp/enigma_smoke_discovery.json

curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  "http://localhost:$PORT/api/dashboard/stats" > /tmp/enigma_smoke_stats.json

node <<'NODE'
const fs = require('fs');

function must(cond, msg) {
  if (!cond) {
    console.error(`[smoke] FAIL: ${msg}`);
    process.exit(1);
  }
}

const watchlist = JSON.parse(fs.readFileSync('/tmp/enigma_smoke_watchlist.json', 'utf8'));
const scan = JSON.parse(fs.readFileSync('/tmp/enigma_smoke_scan.json', 'utf8'));
const singleSignal = JSON.parse(fs.readFileSync('/tmp/enigma_smoke_signal.json', 'utf8'));
const discovery = JSON.parse(fs.readFileSync('/tmp/enigma_smoke_discovery.json', 'utf8'));
const stats = JSON.parse(fs.readFileSync('/tmp/enigma_smoke_stats.json', 'utf8'));

must(Array.isArray(watchlist.mints) && watchlist.mints.length > 0, 'watchlist save should return mints');
must(Array.isArray(scan.items), 'scan should return items array');
must(scan.items.length > 0, 'scan should return at least one item');

const firstScan = scan.items[0] || {};
must(typeof firstScan.mint === 'string' && firstScan.mint.length > 0, 'scan item should include mint');
if (firstScan.ok) {
  must(firstScan.signal && typeof firstScan.signal === 'object', 'ok scan item should include signal object');
  must(firstScan.signal.token && typeof firstScan.signal.token === 'object', 'signal should include token metadata');
  must(typeof firstScan.signal.status === 'string', 'signal should include status');
}

must(singleSignal && singleSignal.signal && typeof singleSignal.signal === 'object', '/api/signal should return signal object');
must(singleSignal.signal.marketRegime && typeof singleSignal.signal.marketRegime === 'object', 'signal should include marketRegime');
const currentRegime = singleSignal.signal.marketRegime.current || {};
must(
  typeof currentRegime.timeframe === 'string' && currentRegime.timeframe.length > 0,
  'marketRegime.current.timeframe should be populated'
);
must(
  typeof currentRegime.regime === 'string' && currentRegime.regime.length > 0,
  'marketRegime.current.regime should be populated'
);
if (currentRegime.volatilityIndex !== null) {
  must(
    Number.isFinite(Number(currentRegime.volatilityIndex)) &&
      Number(currentRegime.volatilityIndex) >= 0 &&
      Number(currentRegime.volatilityIndex) <= 100,
    'marketRegime.current.volatilityIndex should be null or 0-100'
  );
}
if (currentRegime.adx !== null) {
  must(Number.isFinite(Number(currentRegime.adx)), 'marketRegime.current.adx should be null or numeric');
}

must(Array.isArray(discovery.items), 'discovery should return items array');
if (discovery.items.length > 0) {
  const firstDiscovery = discovery.items[0];
  must(typeof firstDiscovery.mint === 'string' && firstDiscovery.mint.length > 0, 'discovery item should include mint');
  must(firstDiscovery.signal && typeof firstDiscovery.signal === 'object', 'discovery item should include signal');
}

must(stats && stats.stats && typeof stats.stats === 'object', 'stats should return stats object');
must(stats.stats.totals && typeof stats.stats.totals === 'object', 'stats should include totals');

console.log('[smoke] PASS: watchlist, scan, discovery, and stats endpoints look healthy');
NODE
