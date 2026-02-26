# Production Runbook

## Goal
Ship safely with mandatory review + QA gates before deployment.

## Pre-deploy Quality Gate
Run all checks locally:

```bash
npm run qa
```

This runs:
- build
- smoke test
- extended QA test suite

## Environment Requirements
- `NODE_ENV=production`
- `ENIGMA_JWT_SECRET` must be set to a non-default secure value
- `HELIUS_API_KEY` or `SOLANA_RPC_URL` configured
- `ENIGMA_DB_PATH` points to persistent storage

## Render Deployment
1. Ensure CI (`Enigma CI`) is green on `main`.
2. Merge PR with completed QA checklist.
3. Render deploys via `render.yaml`.
4. Verify `/api/health` after deploy.

## Post-deploy Verification
Run quick checks:

```bash
curl -sS https://<your-domain>/api/health
```

Then verify in UI:
- wallet auth
- watchlist save
- watchlist scan
- holders view
- alert feed

## Rollback
If critical issues appear:
1. Roll back to previous Render deploy.
2. Keep incident notes: timestamp, endpoint, error pattern.
3. Open follow-up patch PR with regression test.
