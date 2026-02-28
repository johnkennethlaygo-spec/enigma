#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

LOG_FILE="/tmp/enigma_extended_web.log"
: > "$LOG_FILE"

export NODE_ENV=development
export ENIGMA_JWT_SECRET="enigma-extended-qa-secret"
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
    echo "[extended-qa] FAIL: server process exited before startup"
    tail -n 120 "$LOG_FILE"
    exit 1
  fi
  sleep 1
done

PORT="$(grep -oE 'http://localhost:[0-9]+' "$LOG_FILE" | tail -n1 | cut -d: -f3 || true)"
if [[ -z "$PORT" ]]; then
  echo "[extended-qa] FAIL: server failed to start"
  tail -n 80 "$LOG_FILE"
  exit 1
fi

TOKEN="$(node -e "require('dotenv').config(); const jwt=require('jsonwebtoken'); const secret=process.env.ENIGMA_JWT_SECRET || 'dev-secret-change-in-production'; process.stdout.write(jwt.sign({sub: 919191, wallet: '9xQeWvG816bUx9EPfRz4KxM2KkN8YxVUMfyk7Q8xvA5', plan: 'free'}, secret, {expiresIn:'1h'}));")"

curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -X PUT \
  -d '{"mints":"So11111111111111111111111111111111111111112,4k3Dyjzvzp8eMZWUXbcbKQb4VhM3y7f1nJdJ9xYkX8h"}' \
  "http://localhost:$PORT/api/watchlist" > /tmp/enigma_ext_watchlist.json

curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -X POST \
  -d '{"mints":"So11111111111111111111111111111111111111112,4k3Dyjzvzp8eMZWUXbcbKQb4VhM3y7f1nJdJ9xYkX8h"}' \
  "http://localhost:$PORT/api/signals/stream" > /tmp/enigma_ext_stream.json

curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -X POST \
  -d '{"mint":"So11111111111111111111111111111111111111112"}' \
  "http://localhost:$PORT/api/signal" > /tmp/enigma_ext_signal.json

curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  "http://localhost:$PORT/api/token/holders?mint=So11111111111111111111111111111111111111112&limit=12" > /tmp/enigma_ext_holders.json

curl -sS "http://localhost:$PORT/api/openapi.json" > /tmp/enigma_ext_openapi.json
curl -sS "http://localhost:$PORT/api-docs.html" > /tmp/enigma_ext_apidocs.html
curl -sS "http://localhost:$PORT/developers.html" > /tmp/enigma_ext_developers.html

HTTP401="$(curl -s -o /tmp/enigma_ext_unauth.json -w '%{http_code}' "http://localhost:$PORT/api/watchlist")"
HTTP400="$(curl -s -o /tmp/enigma_ext_badreq.json -w '%{http_code}' -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" -X POST -d '{}' "http://localhost:$PORT/api/signal")"

node <<'NODE'
const fs = require("fs");

function must(condition, message) {
  if (!condition) {
    console.error(`[extended-qa] FAIL: ${message}`);
    process.exit(1);
  }
}

const watchlist = JSON.parse(fs.readFileSync("/tmp/enigma_ext_watchlist.json", "utf8"));
const stream = JSON.parse(fs.readFileSync("/tmp/enigma_ext_stream.json", "utf8"));
const singleSignal = JSON.parse(fs.readFileSync("/tmp/enigma_ext_signal.json", "utf8"));
const holders = JSON.parse(fs.readFileSync("/tmp/enigma_ext_holders.json", "utf8"));
const openapi = JSON.parse(fs.readFileSync("/tmp/enigma_ext_openapi.json", "utf8"));
const apiDocsHtml = fs.readFileSync("/tmp/enigma_ext_apidocs.html", "utf8");
const devDocsHtml = fs.readFileSync("/tmp/enigma_ext_developers.html", "utf8");

must(Array.isArray(watchlist.mints) && watchlist.mints.length === 2, "watchlist should save 2 mints");
must(Array.isArray(stream.items) && stream.items.length > 0, "stream should return scan items");

const firstOk = stream.items.find((item) => item.ok && item.signal);
must(Boolean(firstOk), "stream should include at least one successful signal");
must(firstOk.signal.tradePlan && firstOk.signal.sentiment, "signal should include tradePlan and sentiment");
must(singleSignal && singleSignal.signal, "/api/signal should return a signal payload");
must(singleSignal.signal.marketRegime, "signal payload should include marketRegime");

const currentRegime = singleSignal.signal.marketRegime.current || {};
must(typeof currentRegime.timeframe === "string" && currentRegime.timeframe.length > 0, "marketRegime.current.timeframe should be populated");
must(typeof currentRegime.regime === "string" && currentRegime.regime.length > 0, "marketRegime.current.regime should be populated");
if (currentRegime.volatilityIndex !== null) {
  must(
    Number.isFinite(Number(currentRegime.volatilityIndex)) &&
      Number(currentRegime.volatilityIndex) >= 0 &&
      Number(currentRegime.volatilityIndex) <= 100,
    "marketRegime.current.volatilityIndex should be null or 0-100"
  );
}
if (currentRegime.adx !== null) {
  must(Number.isFinite(Number(currentRegime.adx)), "marketRegime.current.adx should be null or numeric");
}

must(Array.isArray(holders.holderProfiles), "holders endpoint should return holderProfiles array");
if (holders.holderProfiles.length > 0) {
  const p = holders.holderProfiles[0];
  must(typeof p.walletSource === "string" && p.walletSource.length > 0, "walletSource should be populated");
}

must(openapi && openapi.openapi && openapi.paths, "openapi should be valid json");
must(Boolean(openapi.paths["/api/signal"]), "openapi should include /api/signal");
must(apiDocsHtml.includes("swagger-ui-bundle.js"), "api docs page should include swagger bundle");
must(devDocsHtml.includes("/api-docs.html"), "developer docs should link to api explorer");

console.log("[extended-qa] PASS: payload checks");
NODE

[[ "$HTTP401" == "401" ]] || { echo "[extended-qa] FAIL: unauthorized expected 401, got $HTTP401"; exit 1; }
[[ "$HTTP400" == "400" ]] || { echo "[extended-qa] FAIL: bad request expected 400, got $HTTP400"; exit 1; }

echo "[extended-qa] PASS: auth and validation checks"
echo "[extended-qa] PASS: all"
