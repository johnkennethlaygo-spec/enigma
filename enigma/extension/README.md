# KOBECOIN AI Guardian Guard Extension (MV3)

## What this extension does
- Detects Pump.fun token mint from current tab URL
- Auto-scans on navigation (toggleable)
- Sends mint to your KOBECOIN backend `/api/signal`
- Shows structured verdict (`FAVORABLE` / `CAUTION` / `HIGH_RISK`) and key risk fields
- One-click add mint to KOBECOIN watchlist (`/api/watchlist/add`)
- Side panel with latest verdict + scan history

## Install (Developer mode)
1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder: `enigma/extension`

## Configure
1. Open extension popup
2. Set `API Base URL` (local backend: `http://localhost:3000`)
3. Paste wallet JWT token in `JWT Token`
4. Enable/disable: `Alert HIGH_RISK`, `Alert CAUTION`, `Auto-scan on navigation`
5. Click `Save Settings`

## JWT token source
- Connect wallet in KOBECOIN web app (`/`)
- Open browser devtools console and run:
  - `localStorage.getItem("enigma_token")`
- Paste token into extension popup

## Usage flow
1. Open Pump.fun token page
2. Click `Detect Mint` (or rely on auto-detection)
3. Click `Scan` for manual scan confirmation
4. Use `Add to Watchlist` to push mint into web app watchlist
5. Click `Open Side Panel` to monitor rolling scan history

## Investor preview page
- Open: `/extension-preview.html` on your KOBECOIN web app
- This page presents the extension product narrative and prototype flow for stakeholders

## Security note
- JWT is stored in extension synced storage.
- Do not use this extension profile on shared browsers.
