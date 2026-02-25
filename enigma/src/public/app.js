const authState = document.querySelector("#auth-state");
const watchlistInput = document.querySelector("#watchlist-input");
const scanSecondsInput = document.querySelector("#scan-seconds");
const scanHoursInput = document.querySelector("#scan-hours");
const statsGrid = document.querySelector("#stats-grid");
const signalFeed = document.querySelector("#signal-feed");
const discoveryList = document.querySelector("#discovery-list");
const messages = document.querySelector("#messages");
const scanStatus = document.querySelector("#scan-status");

const connectWalletButton = document.querySelector("#connect-wallet");
const saveWatchlistButton = document.querySelector("#save-watchlist");
const startScanButton = document.querySelector("#start-scan");
const stopScanButton = document.querySelector("#stop-scan");
const scanOnceButton = document.querySelector("#scan-once");
const discoverTokensButton = document.querySelector("#discover-tokens");

let authToken = localStorage.getItem("enigma_token") || "";
let userWallet = localStorage.getItem("enigma_wallet") || "";
let scanTimer = null;
let scanStopAt = 0;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shortMint(mint) {
  const value = String(mint || "").trim();
  if (!value) return "N/A";
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

function formatNumber(value, digits = 2) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatUsd(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "$0";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatPct(value, digits = 2) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0%";
  return `${n.toFixed(digits)}%`;
}

function avatarHtml(token, mint, sizeClass = "token-avatar") {
  const symbol = String(token?.symbol || "?").toUpperCase();
  const initial = escapeHtml(symbol.slice(0, 1) || "?");
  const imageUrl = String(token?.imageUrl || "").trim();

  if (!imageUrl) {
    return `<div class="${sizeClass} fallback">${initial}</div>`;
  }

  return `
    <div class="${sizeClass}">
      <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(symbol)}" loading="lazy" onerror="this.remove()" />
      <span>${initial}</span>
    </div>
  `;
}

function pushMessage(text, type = "info") {
  if (!messages) return;
  const item = document.createElement("div");
  item.className = `msg ${type}`;
  item.textContent = `${new Date().toLocaleTimeString()} - ${text}`;
  messages.prepend(item);
}

function setAuthState() {
  if (!authState) return;
  authState.textContent = authToken
    ? `Connected: ${userWallet.slice(0, 6)}...${userWallet.slice(-6)}`
    : "Not connected";
}

function setScanStatus(text, mode = "idle") {
  if (!scanStatus) return;
  scanStatus.textContent = text;
  scanStatus.classList.remove("ok", "busy", "error");
  if (mode !== "idle") scanStatus.classList.add(mode);
}

async function api(url, body, requireAuth = false, method = body ? "POST" : "GET") {
  const headers = { "Content-Type": "application/json" };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (requireAuth && !authToken) throw new Error("Connect wallet first");

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    if (isJson) throw new Error(payload.error || "Request failed");
    throw new Error(`Request failed (${response.status})`);
  }

  if (!isJson) throw new Error("Server returned non-JSON response");
  return payload;
}

function updateStats(stats) {
  if (!statsGrid) return;
  const totals = stats?.totals || {};
  const quality = stats?.quality || {};

  statsGrid.innerHTML = `
    <div class="stat"><span>Scans</span><strong>${escapeHtml(totals.signals ?? 0)}</strong></div>
    <div class="stat"><span>Wins</span><strong>${escapeHtml(totals.wins ?? 0)}</strong></div>
    <div class="stat"><span>Losses</span><strong>${escapeHtml(totals.losses ?? 0)}</strong></div>
    <div class="stat"><span>Win Rate</span><strong>${escapeHtml(totals.winRatePct ?? 0)}%</strong></div>
    <div class="stat"><span>Avg PnL</span><strong>${escapeHtml(totals.avgPnlPct ?? 0)}%</strong></div>
    <div class="stat"><span>Snipes</span><strong>${escapeHtml(quality.snipes ?? 0)}</strong></div>
  `;
}

async function refreshStats() {
  if (!authToken) return;
  const response = await api("/api/dashboard/stats", null, true);
  updateStats(response.stats);
}

function metric(label, value, tone = "") {
  return `<div class="metric ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function signalCard(item) {
  if (!item.ok) {
    return `
      <article class="card bad">
        <div class="token-head">
          <div class="token-avatar fallback">!</div>
          <div class="token-meta">
            <h3>${escapeHtml(shortMint(item.mint))}</h3>
            <p class="mint">${escapeHtml(item.mint)}</p>
          </div>
        </div>
        <p class="error-text">${escapeHtml(item.error || "scan failed")}</p>
      </article>
    `;
  }

  const signal = item.signal || {};
  const kill = signal.killSwitch || {};
  const risk = kill.risk || {};
  const holderBehavior = risk.holderBehavior || {};
  const links = signal.links || {};
  const token = signal.token || {};

  const status = String(signal.status || "HIGH_RISK");
  const confidence = Number(signal.confidence || 0);
  const mint = String(item.mint || token.mint || "");
  const participation = Number(signal.market?.volume24hUsd || 0) / Math.max(Number(signal.market?.liquidityUsd || 0), 1);

  const reasons = Array.isArray(signal.reasons) ? signal.reasons.slice(0, 3) : [];

  return `
    <article class="card ${status.toLowerCase()}">
      <div class="row between top-row">
        <div class="token-head">
          ${avatarHtml(token, mint)}
          <div class="token-meta">
            <h3>${escapeHtml(token.symbol || shortMint(mint))}</h3>
            <p>${escapeHtml(token.name || "Unknown Token")}</p>
          </div>
        </div>
        <span class="pill ${status.toLowerCase()}">${escapeHtml(status.replace("_", " "))} | ${escapeHtml(confidence.toFixed(2))}</span>
      </div>

      <div class="mint-row">
        <code>${escapeHtml(shortMint(mint))}</code>
        <button class="tiny-btn" data-copy-mint="${escapeHtml(mint)}">Copy</button>
      </div>

      <div class="metric-grid">
        ${metric("Kill-Switch", `${kill.verdict || "N/A"} (${formatNumber(kill.score, 0)}/100)`)}
        ${metric("Pattern", `${formatNumber(signal.patternScore, 2)}/100`)}
        ${metric("Liquidity", formatUsd(signal.market?.liquidityUsd))}
        ${metric("24h Volume", formatUsd(signal.market?.volume24hUsd))}
        ${metric("24h Change", formatPct(signal.market?.priceChange24hPct), Number(signal.market?.priceChange24hPct || 0) >= 0 ? "good" : "bad")}
        ${metric("Participation", formatNumber(participation, 2))}
      </div>

      <div class="behavior-row">
        <span>Connected: <strong>${formatPct(holderBehavior.connectedHolderPct)}</strong></span>
        <span>New Wallets: <strong>${formatPct(holderBehavior.newWalletHolderPct)}</strong></span>
        <span>Clusters: <strong>${formatNumber(holderBehavior.connectedGroupCount, 0)}</strong></span>
      </div>

      ${
        reasons.length
          ? `<ul class="reasons">${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>`
          : ""
      }

      <div class="row links">
        <a href="${escapeHtml(links.dexscreener || "#")}" target="_blank" rel="noreferrer">DexScreener</a>
        <a href="${escapeHtml(links.birdeye || "#")}" target="_blank" rel="noreferrer">Birdeye</a>
        <a href="${escapeHtml(links.solscan || "#")}" target="_blank" rel="noreferrer">Solscan</a>
      </div>

      <div class="row actions">
        <button data-resolve-win="${item.signalId}" ${item.signalId ? "" : "disabled"}>Mark Forecast Win</button>
        <button data-resolve-loss="${item.signalId}" class="secondary" ${item.signalId ? "" : "disabled"}>Mark Forecast Fail</button>
      </div>
    </article>
  `;
}

function attachCardHandlers() {
  document.querySelectorAll("button[data-resolve-win]").forEach((button) => {
    button.addEventListener("click", async () => {
      const signalId = Number(button.getAttribute("data-resolve-win"));
      if (!signalId) return;
      await api("/api/forecast/resolve", { signalId, won: true, pnlPct: 8 }, true);
      pushMessage(`Signal ${signalId} marked WIN`, "ok");
      await refreshStats();
    });
  });

  document.querySelectorAll("button[data-resolve-loss]").forEach((button) => {
    button.addEventListener("click", async () => {
      const signalId = Number(button.getAttribute("data-resolve-loss"));
      if (!signalId) return;
      await api("/api/forecast/resolve", { signalId, won: false, pnlPct: -5 }, true);
      pushMessage(`Signal ${signalId} marked LOSS`, "error");
      await refreshStats();
    });
  });

  document.querySelectorAll("button[data-copy-mint]").forEach((button) => {
    button.addEventListener("click", async () => {
      const mint = String(button.getAttribute("data-copy-mint") || "");
      if (!mint) return;
      await navigator.clipboard.writeText(mint);
      pushMessage(`Copied mint ${shortMint(mint)}`, "info");
    });
  });
}

function renderSignals(items) {
  if (!signalFeed) return;
  signalFeed.innerHTML = items.map((item) => signalCard(item)).join("");
  attachCardHandlers();
}

function renderDiscovery(items) {
  if (!discoveryList) return;
  discoveryList.innerHTML = items
    .map((item) => {
      const signal = item.signal || {};
      const links = signal.links || {};
      const token = signal.token || {};
      const mint = String(item.mint || token.mint || "");

      return `
        <article class="discover-item">
          <div class="row between">
            <div class="token-head compact">
              ${avatarHtml(token, mint, "token-avatar small")}
              <div class="token-meta">
                <h3>${escapeHtml(token.symbol || shortMint(mint))}</h3>
                <p>${escapeHtml(shortMint(mint))}</p>
              </div>
            </div>
            <span class="pill ${String(signal.status || "CAUTION").toLowerCase()}">${escapeHtml(signal.status || "N/A")}</span>
          </div>
          <div class="discover-actions">
            <a href="${escapeHtml(links.dexscreener || "#")}" target="_blank" rel="noreferrer">DexScreener</a>
            <a href="${escapeHtml(links.birdeye || "#")}" target="_blank" rel="noreferrer">Birdeye</a>
            <button data-add-mint="${escapeHtml(mint)}">Add to Watchlist</button>
          </div>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll("button[data-add-mint]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const mint = String(button.getAttribute("data-add-mint") || "");
        if (!mint) return;
        const saved = await api("/api/watchlist/add", { mint }, true);
        if (watchlistInput) watchlistInput.value = saved.mints.join(",");
        pushMessage(`Added ${shortMint(mint)} to watchlist`, "ok");
      } catch (error) {
        pushMessage(error.message, "error");
      }
    });
  });
}

async function scanWatchlist() {
  const response = await api("/api/watchlist/scan", {}, true);
  renderSignals(response.items || []);
  await refreshStats();
  pushMessage(`Scanned ${response.watchlist?.length || 0} watchlist tokens`, "ok");
}

function stopScan() {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  scanStopAt = 0;
  setScanStatus("Stopped");
}

async function startScan() {
  const intervalSec = Math.max(10, Number(scanSecondsInput?.value || 30));
  const durationHours = Math.min(24, Math.max(1, Number(scanHoursInput?.value || 24)));

  stopScan();
  await scanWatchlist();

  scanStopAt = Date.now() + durationHours * 60 * 60 * 1000;
  setScanStatus("Live", "ok");

  scanTimer = setInterval(async () => {
    if (Date.now() >= scanStopAt) {
      stopScan();
      pushMessage("Scan duration ended", "info");
      return;
    }

    try {
      setScanStatus("Scanning", "busy");
      await scanWatchlist();
      setScanStatus("Live", "ok");
    } catch (error) {
      setScanStatus("Error", "error");
      pushMessage(error.message, "error");
    }
  }, intervalSec * 1000);
}

async function connectWallet() {
  try {
    const provider = window.solana;
    if (!provider || !provider.isPhantom) {
      throw new Error("Phantom wallet not found");
    }

    const connected = await provider.connect();
    const wallet = connected.publicKey.toString();

    const nonce = await api("/api/auth/nonce", { wallet });
    const encoded = new TextEncoder().encode(nonce.message);
    const signed = await provider.signMessage(encoded, "utf8");
    const signatureBase64 = btoa(String.fromCharCode(...signed.signature));

    const verify = await api("/api/auth/verify", {
      wallet,
      nonce: nonce.nonce,
      signature: signatureBase64
    });

    authToken = verify.token;
    userWallet = wallet;
    localStorage.setItem("enigma_token", authToken);
    localStorage.setItem("enigma_wallet", userWallet);
    setAuthState();
    pushMessage("Wallet connected", "ok");

    const watchlist = await api("/api/watchlist", null, true);
    if (watchlistInput && watchlist.mints?.length) {
      watchlistInput.value = watchlist.mints.join(",");
    }

    await refreshStats();
  } catch (error) {
    pushMessage(error.message, "error");
  }
}

async function saveWatchlist() {
  try {
    const mints = String(watchlistInput?.value || "").trim();
    const saved = await api("/api/watchlist", { mints }, true, "PUT");
    if (watchlistInput) watchlistInput.value = saved.mints.join(",");
    pushMessage(`Saved watchlist (${saved.mints.length}/5)`, "ok");
  } catch (error) {
    pushMessage(error.message, "error");
  }
}

async function discoverSuggestions() {
  try {
    const response = await api("/api/discovery/suggest", { limit: 5 }, true);
    renderDiscovery(response.items || []);
    pushMessage(`Loaded ${response.items?.length || 0} discovery suggestions`, "ok");
  } catch (error) {
    pushMessage(error.message, "error");
  }
}

async function hydrateSession() {
  if (!authToken) return;

  try {
    const watchlist = await api("/api/watchlist", null, true);
    if (watchlistInput && watchlist.mints?.length) {
      watchlistInput.value = watchlist.mints.join(",");
    }
    await refreshStats();
  } catch {
    authToken = "";
    userWallet = "";
    localStorage.removeItem("enigma_token");
    localStorage.removeItem("enigma_wallet");
    setAuthState();
  }
}

connectWalletButton?.addEventListener("click", connectWallet);
saveWatchlistButton?.addEventListener("click", saveWatchlist);
startScanButton?.addEventListener("click", startScan);
stopScanButton?.addEventListener("click", stopScan);
scanOnceButton?.addEventListener("click", scanWatchlist);
discoverTokensButton?.addEventListener("click", discoverSuggestions);

setAuthState();
hydrateSession();
pushMessage("Connect wallet, save up to 5 mints, then run scan.", "info");
