# Enigma Agent

Enigma is a trader productivity AI agent that provides daily briefs, risk checks, research packs, and journaling support.
Enigma does **not** place trades. It helps you make better decisions and maintain discipline.

## Features
- Daily Briefing (watchlist + catalysts + regime notes)
- Risk Check (token/wallet red flags, concentration, suspicious patterns)
- Kill-Switch Score (PASS / CAUTION / BLOCK pre-trade gate)
- Managed Signal API (BUY/SELL/AVOID + suggested levels)
- Wallet login (nonce + signature) with server-side API key management
- Research Pack (summarize sources you provide)
- Journal Assistant (structured logs + weekly review prompts)

## Requirements
- Node.js 18+

## Install
```bash
npm install
cp .env.example .env
npm run build
```

## Run
```bash
npm run dev
# or
npm start
```

## Web Dashboard (Manual + Presentation)
```bash
npm run web
# open http://localhost:3000
```

Pages:
- `/` dashboard for daily brief / risk check / journal
- `/manual.html` operator manual
- `/presentation.html` viewer presentation

## Deploy (Production)
This repo is deploy-ready with Docker + Render blueprint.

### Option A: Render (recommended)
1. Push this folder to GitHub.
2. In Render, create a new **Blueprint** and select this repo.
3. Render will read `render.yaml` and create:
   - web service
   - persistent disk for SQLite (`/var/data`)
4. Set `HELIUS_API_KEY` in Render environment variables.

### Option B: Docker
```bash
docker build -t enigma-agent .
docker run -p 3000:3000 \
  -e ENIGMA_JWT_SECRET=change_me \
  -e HELIUS_API_KEY=your_key \
  -e ENIGMA_DB_PATH=/app/data/enigma_data.sqlite \
  -v $(pwd)/data:/app/data \
  enigma-agent
```

## CLI Usage
```bash
npm run enigma -- --help
npm run enigma -- daily-brief --watchlist "SOL,BONK,WIF"
npm run enigma -- risk-check --mint "<TOKEN_MINT_ADDRESS>"
npm run enigma -- journal --note "Your trade note here"
```

## Agent Console
Run web console:
```bash
npm run web
```

Use:
- Kill-Switch with a mint to get a pre-trade verdict
- Connect Phantom wallet to activate authenticated signal API
- Morning Routine to chain daily brief + kill-switch + risk check + journal
- Agent Chat commands like:
  - `kill switch <MINT>`
  - `daily brief SOL,BONK,WIF`
  - `morning routine SOL,BONK,WIF mint=<MINT>`

## SaaS Auth + Quotas
- `POST /api/auth/nonce` and `POST /api/auth/verify` for wallet sign-in
- `POST /api/signal` requires JWT and enforces per-plan daily quotas
- `GET /api/dashboard/stats` returns win-rate/snipe metrics from local DB

## Configuration
Default config: `src/config/default.json`

You can override via env vars or CLI flags.

Helius setup:
- Set `HELIUS_API_KEY` in `.env` (or set `SOLANA_RPC_URL` directly)
- Enigma will use `https://mainnet.helius-rpc.com/?api-key=...` automatically

## Safety
Enigma provides informational analysis only. It does not:
- execute trades
- provide guaranteed predictions
- help bypass platform rules or manipulate markets
