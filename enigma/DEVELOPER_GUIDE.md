# Enigma Developer Guide

## Overview
Enigma is a modular tool-using agent.
Architecture:
- `agent/` orchestration + prompts + schemas
- `tools/` external actions (web, on-chain, storage)
- `workflows/` end-to-end tasks (daily brief, risk check, journal)
- `cli.ts` user entrypoint

## Local Setup
### Prerequisites
- Node.js 18+
- Git

### Install
```bash
npm install
cp .env.example .env
```

## Run (dev)
```bash
npm run dev
```
Starts the viewer website on `http://localhost:3000`.

## Run (production)
```bash
npm run build
npm start
```

## CLI Commands
Enigma exposes workflows via CLI:
- `daily-brief`
- `risk-check`
- `journal`

Examples:
```bash
npm run enigma -- daily-brief --watchlist "SOL,BONK,WIF"
npm run enigma -- risk-check --mint "<TOKEN_MINT_ADDRESS>"
npm run enigma -- journal --note "Entered on breakout; kept risk small."
```

## Website Pages
- `/` interactive dashboard for workflows
- `/manual.html` operator manual
- `/presentation.html` viewer presentation board

## Agent API Endpoints
- `POST /api/agent/chat`
- `POST /api/agent/morning-routine`
- `POST /api/kill-switch`
- `GET /api/history`
- `POST /api/auth/nonce`
- `POST /api/auth/verify`
- `POST /api/signal` (JWT required)
- `GET /api/dashboard/stats` (JWT required)

## Configuration
File: `src/config/default.json`

Recommended fields:
- `agent.name`: "Enigma"
- `agent.mode`: "analysis" | "strict"
- `limits.maxToolCalls`
- `risk.allowDangerousOps`: false by default
- `sources.news`: list of allowed domains (optional)
- `onchain.rpcUrl` and provider keys

Env overrides:
- `SOLANA_RPC_URL`
- `ENIGMA_LOG_LEVEL`
- `ENIGMA_STORAGE`
- `ENIGMA_JWT_SECRET`

## Adding a New Workflow
1. Create file in `src/workflows/`, e.g. `positionReview.ts`
2. Export a function that accepts a context (`AgentContext`)
3. Register it in `src/cli.ts`

Minimal workflow contract:
- input: parsed args
- steps: call agent planner + tools
- output: JSON + human markdown summary

## Adding a New Tool
Tools must be:
- deterministic (as much as possible)
- logged
- safe (no destructive actions without confirmation)

Steps:
1. Create file in `src/tools/`
2. Add typed interface to `AgentTools`
3. Add test coverage for tool output format

## Output Schemas
All workflows should output both:
- human: markdown summary
- data: structured JSON

Rationale: JSON enables dashboards, bots, storage, and analytics.

## Safety / Guardrails
Enigma should:
- cite sources when it claims facts from web/news
- label uncertainty explicitly
- avoid trade execution behavior
- require confirmation for anything risky (file deletion, sending messages, etc.)

## Testing
Recommended:
- unit tests for tools (mock network calls)
- golden tests for workflows (snapshot outputs)

Commands:
```bash
npm test
npm run lint
```

## Packaging
To publish a CLI:
- set `bin` in `package.json` to point to compiled CLI
- run `npm pack` or publish to npm (private/public)

## Troubleshooting
- Missing env var: check `.env`
- RPC failures: verify `SOLANA_RPC_URL`
- Rate limits: add caching + exponential backoff
