const authState = document.querySelector("#auth-state");
const watchlistTokenInput = document.querySelector("#watchlist-token-input");
const watchlistChips = document.querySelector("#watchlist-chips");
const watchlistHint = document.querySelector("#watchlist-hint");
const manualMintInput = document.querySelector("#manual-mint");
const scanSecondsInput = document.querySelector("#scan-seconds");
const scanHoursInput = document.querySelector("#scan-hours");
const riskPresetSelect = document.querySelector("#risk-preset");
const thresholdFavorablePatternInput = document.querySelector("#threshold-favorable-pattern");
const thresholdRiskKillInput = document.querySelector("#threshold-risk-kill");
const thresholdConnectedMaxInput = document.querySelector("#threshold-connected-max");
const statsGrid = document.querySelector("#stats-grid");
const statsMeta = document.querySelector("#stats-meta");
const heatmapStrip = document.querySelector("#heatmap-strip");
const sessionTrend = document.querySelector("#session-trend");
const signalFeed = document.querySelector("#signal-feed");
const resultFilterSelect = document.querySelector("#result-filter");
const resultSortSelect = document.querySelector("#result-sort");
const discoveryList = document.querySelector("#discovery-list");
const messages = document.querySelector("#messages");
const alertFeed = document.querySelector("#alert-feed");
const scanStatus = document.querySelector("#scan-status");
const alarmToast = document.querySelector("#alarm-toast");
const planStatus = document.querySelector("#plan-status");
const paperTestStatus = document.querySelector("#paper-test-status");
const paperEnabledInput = document.querySelector("#paper-enabled");
const paperMinPatternInput = document.querySelector("#paper-min-pattern");
const paperMinConfidenceInput = document.querySelector("#paper-min-confidence");
const paperMaxConnectedInput = document.querySelector("#paper-max-connected");
const paperMaxPositionInput = document.querySelector("#paper-max-position");
const paperIntervalInput = document.querySelector("#paper-interval");
const paperSummary = document.querySelector("#paper-summary");
const paperResults = document.querySelector("#paper-results");
const paperEquityChart = document.querySelector("#paper-equity-chart");
const paperPerformanceSummary = document.querySelector("#paper-performance-summary");
const paperPerformanceRuns = document.querySelector("#paper-performance-runs");
const engineEnabledInput = document.querySelector("#engine-enabled");
const engineModeSelect = document.querySelector("#engine-mode");
const engineAmountInput = document.querySelector("#engine-amount");
const engineMaxOpenInput = document.querySelector("#engine-max-open");
const engineTpInput = document.querySelector("#engine-tp");
const engineSlInput = document.querySelector("#engine-sl");
const engineTrailingInput = document.querySelector("#engine-trailing");
const engineHoldMinutesInput = document.querySelector("#engine-hold-minutes");
const engineCooldownInput = document.querySelector("#engine-cooldown");
const enginePollInput = document.querySelector("#engine-poll");
const engineSummary = document.querySelector("#engine-summary");
const engineOpenPositions = document.querySelector("#engine-open-positions");

const connectWalletButton = document.querySelector("#connect-wallet");
const addWatchlistTokenButton = document.querySelector("#add-watchlist-token");
const saveWatchlistButton = document.querySelector("#save-watchlist");
const startScanButton = document.querySelector("#start-scan");
const stopScanButton = document.querySelector("#stop-scan");
const scanOnceButton = document.querySelector("#scan-once");
const applyProPresetButton = document.querySelector("#apply-pro-preset");
const discoverTokensButton = document.querySelector("#discover-tokens");
const scanManualButton = document.querySelector("#scan-manual");
const alertFavorableInput = document.querySelector("#alert-favorable");
const alertHighRiskInput = document.querySelector("#alert-high-risk");
const alertSoundInput = document.querySelector("#alert-sound");
const enableBrowserAlertsButton = document.querySelector("#enable-browser-alerts");
const paperSaveConfigButton = document.querySelector("#paper-save-config");
const paperRunOnceButton = document.querySelector("#paper-run-once");
const paperStartLoopButton = document.querySelector("#paper-start-loop");
const paperStopLoopButton = document.querySelector("#paper-stop-loop");
const paperRefreshPerformanceButton = document.querySelector("#paper-refresh-performance");
const engineSaveConfigButton = document.querySelector("#engine-save-config");
const engineRunTickButton = document.querySelector("#engine-run-tick");
const engineStartLoopButton = document.querySelector("#engine-start-loop");
const engineStopLoopButton = document.querySelector("#engine-stop-loop");
const engineRefreshPositionsButton = document.querySelector("#engine-refresh-positions");

let authToken = localStorage.getItem("enigma_token") || "";
let userWallet = localStorage.getItem("enigma_wallet") || "";
let userPlan = localStorage.getItem("enigma_plan") || "free";
let scanTimer = null;
let scanStopAt = 0;
let lastSignalItems = [];
let watchlistMints = [];
let historicalStats = null;
let alertEvents = [];
let sessionTrendPoints = [];
let paperTradeTimer = null;
let paperRunHistory = [];
let engineTimer = null;
const sessionAnalytics = {
  batches: 0,
  tokensSeen: 0,
  favorable: 0,
  caution: 0,
  highRisk: 0,
  patternTotal: 0,
  confidenceTotal: 0,
  connectedTotal: 0,
  lastBatchAt: ""
};
const previousStatusByMint = new Map();
const thresholdStateByMint = new Map();
const alertPrefs = {
  favorable: localStorage.getItem("enigma_alert_favorable") !== "0",
  highRisk: localStorage.getItem("enigma_alert_highrisk") !== "0",
  sound: localStorage.getItem("enigma_alert_sound") !== "0"
};
const riskPresets = {
  conservative: { favorablePatternMin: 80, riskKillMax: 62, connectedMax: 18 },
  balanced: { favorablePatternMin: 72, riskKillMax: 50, connectedMax: 25 },
  aggressive: { favorablePatternMin: 66, riskKillMax: 40, connectedMax: 34 }
};
const alertThresholds = {
  favorablePatternMin: Number(localStorage.getItem("enigma_threshold_fav_pattern") || 72),
  riskKillMax: Number(localStorage.getItem("enigma_threshold_risk_kill") || 50),
  connectedMax: Number(localStorage.getItem("enigma_threshold_connected_max") || 25)
};
const expandedHolders = new Set();
const loadingHolders = new Set();

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shortMint(mint, start = 6, end = 6) {
  const value = String(mint || "").trim();
  if (!value) return "N/A";
  if (value.length <= start + end + 3) return value;
  return `${value.slice(0, start)}...${value.slice(-end)}`;
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

function formatPrice(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "N/A";
  if (n >= 1) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
  return `$${n.toFixed(10).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function formatPct(value, digits = 2) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0%";
  return `${n.toFixed(digits)}%`;
}

const walletSourceDescriptions = {
  "liquidity-pool-candidate": "Likely liquidity pool vault account, usually not a normal trader wallet.",
  "clustered-new-wallet": "Fresh wallet linked with other holders via shared recent signatures.",
  "clustered-wallet": "Wallet appears in a connected holder cluster.",
  "new-wallet": "Wallet looks recently created or newly active.",
  "active-trader-wallet": "Wallet shows notable recent token-account trading activity.",
  "token-account-owner": "Owner resolves directly to the token account.",
  "unattributed-wallet": "No explicit exchange/source label was detected from current heuristics."
};

function describeWalletSource(source) {
  const key = String(source || "unattributed-wallet").trim();
  return (
    walletSourceDescriptions[key] ||
    "Source label provided by configured wallet mapping or inferred heuristics."
  );
}

function sourceLegendHtml() {
  const entries = Object.entries(walletSourceDescriptions);
  return `
    <details class="source-legend">
      <summary>Wallet Source Legend</summary>
      <div class="source-legend-items">
        ${entries
          .map(
            ([name, description]) =>
              `<span class="source-pill" title="${escapeHtml(description)}">${escapeHtml(name)}</span>`
          )
          .join("")}
      </div>
    </details>
  `;
}

function isValidSolanaMint(value) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value || "").trim());
}

function setWatchlistMints(mints) {
  watchlistMints = Array.from(new Set((mints || []).map((value) => String(value || "").trim()).filter(Boolean))).slice(0, 5);
  renderWatchlistChips();
}

function renderWatchlistChips() {
  if (!watchlistChips) return;
  watchlistChips.innerHTML = watchlistMints
    .map(
      (mint) => `
        <div class="watch-chip">
          <code>${escapeHtml(shortMint(mint, 7, 7))}</code>
          <button class="chip-remove" data-remove-watch="${escapeHtml(mint)}" aria-label="Remove mint">x</button>
        </div>
      `
    )
    .join("");

  if (watchlistHint) {
    watchlistHint.textContent = `${watchlistMints.length}/5 selected`;
  }

  document.querySelectorAll("button[data-remove-watch]").forEach((button) => {
    button.addEventListener("click", () => {
      const mint = String(button.getAttribute("data-remove-watch") || "");
      if (!mint) return;
      watchlistMints = watchlistMints.filter((item) => item !== mint);
      renderWatchlistChips();
    });
  });
}

function addWatchlistMintFromInput() {
  const mint = String(watchlistTokenInput?.value || "").trim();
  if (!mint) {
    pushMessage("Paste a mint first", "error");
    return;
  }
  if (!isValidSolanaMint(mint)) {
    pushMessage("Mint format looks invalid", "error");
    return;
  }
  if (watchlistMints.includes(mint)) {
    pushMessage("Mint already in watchlist", "info");
    return;
  }
  if (watchlistMints.length >= 5) {
    pushMessage("Watchlist limit reached (5)", "error");
    return;
  }

  watchlistMints.push(mint);
  renderWatchlistChips();
  if (watchlistTokenInput) watchlistTokenInput.value = "";
}

function resetSessionAnalytics() {
  sessionAnalytics.batches = 0;
  sessionAnalytics.tokensSeen = 0;
  sessionAnalytics.favorable = 0;
  sessionAnalytics.caution = 0;
  sessionAnalytics.highRisk = 0;
  sessionAnalytics.patternTotal = 0;
  sessionAnalytics.confidenceTotal = 0;
  sessionAnalytics.connectedTotal = 0;
  sessionAnalytics.lastBatchAt = "";
  sessionTrendPoints = [];
  previousStatusByMint.clear();
  thresholdStateByMint.clear();
  alertEvents = [];
  renderAlertFeed();
  renderSessionTrend();
}

function buzzAlert() {
  if (!alertPrefs.sound || !window.AudioContext) return;
  const audioContext = new window.AudioContext();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "square";
  oscillator.frequency.value = 720;
  gain.gain.value = 0.03;
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  setTimeout(() => {
    oscillator.stop();
    audioContext.close();
  }, 170);
}

function showAlarmToast(text, tone = "info") {
  if (!alarmToast) return;
  alarmToast.textContent = text;
  alarmToast.className = `alarm-toast show ${tone}`;
  window.setTimeout(() => {
    alarmToast.className = "alarm-toast";
  }, 2600);
}

function triggerAlert(text, tone = "info") {
  pushMessage(text, tone === "warn" ? "error" : "ok");
  showAlarmToast(text, tone);
  buzzAlert();
  pushAlertEvent(text, tone);

  const permission = window.Notification?.permission || "denied";
  if (permission === "granted" && document.hidden) {
    try {
      new window.Notification("Enigma Alert", { body: text });
    } catch {
      // Ignore notification errors in unsupported environments.
    }
  }
}

function evaluateSignalAlerts(items) {
  (items || [])
    .filter((item) => item.ok && item.signal)
    .forEach((item) => {
      const signal = item.signal || {};
      const token = signal.token || {};
      const mint = String(item.mint || signal.mint || token.mint || "");
      const symbol = String(token.symbol || shortMint(mint));
      const status = String(signal.status || "HIGH_RISK");
      const prev = previousStatusByMint.get(mint);
      const pattern = Number(signal.patternScore || 0);
      const killScore = Number(signal.killSwitch?.score || 0);
      const connectedPct = Number(signal.killSwitch?.risk?.holderBehavior?.connectedHolderPct || 0);

      if (prev && prev !== status) {
        if (status === "FAVORABLE" && alertPrefs.favorable) {
          triggerAlert(`${symbol} flipped to FAVORABLE`, "good");
        }
        if (status === "HIGH_RISK" && alertPrefs.highRisk) {
          triggerAlert(`${symbol} flipped to HIGH_RISK`, "warn");
        }
      }

      const currentThresholdState = {
        favorable: status === "FAVORABLE" && pattern >= alertThresholds.favorablePatternMin,
        risk:
          status === "HIGH_RISK" ||
          killScore <= alertThresholds.riskKillMax ||
          connectedPct >= alertThresholds.connectedMax
      };
      const prevThresholdState = thresholdStateByMint.get(mint);
      if (prevThresholdState) {
        if (!prevThresholdState.favorable && currentThresholdState.favorable && alertPrefs.favorable) {
          triggerAlert(
            `${symbol} crossed favorable threshold (pattern ${formatNumber(pattern, 1)} >= ${alertThresholds.favorablePatternMin})`,
            "good"
          );
        }
        if (!prevThresholdState.risk && currentThresholdState.risk && alertPrefs.highRisk) {
          triggerAlert(
            `${symbol} crossed risk threshold (kill ${formatNumber(killScore, 0)}, connected ${formatPct(connectedPct, 1)})`,
            "warn"
          );
        }
      }

      if (mint) {
        previousStatusByMint.set(mint, status);
        thresholdStateByMint.set(mint, currentThresholdState);
      }
    });
}

function updateSessionAnalyticsFromItems(items) {
  const okItems = (items || []).filter((item) => item.ok && item.signal);
  if (!okItems.length) return;

  sessionAnalytics.batches += 1;
  sessionAnalytics.tokensSeen += okItems.length;
  sessionAnalytics.lastBatchAt = new Date().toISOString();

  okItems.forEach((item) => {
    const signal = item.signal || {};
    const status = String(signal.status || "HIGH_RISK");
    if (status === "FAVORABLE") sessionAnalytics.favorable += 1;
    else if (status === "CAUTION") sessionAnalytics.caution += 1;
    else sessionAnalytics.highRisk += 1;

    sessionAnalytics.patternTotal += Number(signal.patternScore || 0);
    sessionAnalytics.confidenceTotal += Number(signal.confidence || 0);
    sessionAnalytics.connectedTotal += Number(
      signal.killSwitch?.risk?.holderBehavior?.connectedHolderPct || 0
    );
  });

  const patternAvg =
    okItems.reduce((sum, item) => sum + Number(item.signal?.patternScore || 0), 0) / okItems.length;
  const favorableCount = okItems.filter((item) => String(item.signal?.status || "") === "FAVORABLE").length;
  const highRiskCount = okItems.filter((item) => String(item.signal?.status || "") === "HIGH_RISK").length;
  const killAvg =
    okItems.reduce((sum, item) => sum + Number(item.signal?.killSwitch?.score || 0), 0) / okItems.length;

  sessionTrendPoints.push({
    ts: new Date().toISOString(),
    patternAvg,
    favorablePct: (favorableCount / okItems.length) * 100,
    highRiskPct: (highRiskCount / okItems.length) * 100,
    killAvg
  });
  sessionTrendPoints = sessionTrendPoints.slice(-40);
  renderSessionTrend();
}

function heatTone(status) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "FAVORABLE") return "good";
  if (normalized === "CAUTION") return "warn";
  return "bad";
}

function renderHeatmap(items = []) {
  if (!heatmapStrip) return;
  const okItems = (items || []).filter((item) => item.ok && item.signal);
  if (!okItems.length) {
    heatmapStrip.innerHTML = `<div class="heat-cell muted">Run a scan to populate heatmap.</div>`;
    return;
  }

  heatmapStrip.innerHTML = okItems
    .map((item) => {
      const signal = item.signal || {};
      const token = signal.token || {};
      const market = signal.market || {};
      const symbol = String(token.symbol || shortMint(item.mint || token.mint || ""));
      const tone = heatTone(signal.status);
      return `
        <div class="heat-cell ${tone}" title="Pattern ${formatNumber(signal.patternScore || 0, 1)} | Kill ${formatNumber(signal.killSwitch?.score || 0, 0)} | Connected ${formatPct(signal.killSwitch?.risk?.holderBehavior?.connectedHolderPct || 0, 1)}">
          <strong>${escapeHtml(symbol)}</strong>
          <span>${escapeHtml(String(signal.status || "N/A"))}</span>
          <em>${formatUsd(market.priceUsd || 0)}</em>
        </div>
      `;
    })
    .join("");
}

function renderSessionTrend() {
  if (!sessionTrend) return;
  if (sessionTrendPoints.length < 2) {
    sessionTrend.innerHTML = `<div class="muted">Session trend appears after at least 2 scan batches.</div>`;
    return;
  }

  const width = 520;
  const height = 130;
  const padX = 10;
  const padY = 10;
  const usableW = width - padX * 2;
  const usableH = height - padY * 2;
  const lastIndex = sessionTrendPoints.length - 1;
  const toY = (value) => padY + (100 - Math.max(0, Math.min(100, value))) / 100 * usableH;
  const toX = (index) => padX + (index / Math.max(1, lastIndex)) * usableW;
  const pathFor = (values) =>
    values
      .map((value, index) => `${index === 0 ? "M" : "L"}${toX(index).toFixed(2)},${toY(value).toFixed(2)}`)
      .join(" ");

  const patternPath = pathFor(sessionTrendPoints.map((point) => point.patternAvg));
  const highRiskPath = pathFor(sessionTrendPoints.map((point) => point.highRiskPct));
  const latest = sessionTrendPoints[lastIndex];

  sessionTrend.innerHTML = `
    <svg class="trend-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <rect x="0" y="0" width="${width}" height="${height}" rx="8" ry="8"></rect>
      <path class="trend-line pattern" d="${patternPath}" />
      <path class="trend-line risk" d="${highRiskPath}" />
    </svg>
    <div class="trend-legend">
      <span><b>Pattern Avg</b> ${formatNumber(latest.patternAvg, 1)}</span>
      <span><b>High-Risk %</b> ${formatPct(latest.highRiskPct, 1)}</span>
      <span><b>Kill Avg</b> ${formatNumber(latest.killAvg, 1)}</span>
    </div>
  `;
}

function renderAlertFeed() {
  if (!alertFeed) return;
  if (!alertEvents.length) {
    alertFeed.innerHTML = `<div class="alert-item muted">No alerts yet. Alerts appear on status flips.</div>`;
    return;
  }

  alertFeed.innerHTML = alertEvents
    .slice(0, 24)
    .map(
      (entry) => `
        <div class="alert-item ${escapeHtml(entry.tone)}">
          <span>${escapeHtml(new Date(entry.ts).toLocaleTimeString())}</span>
          <strong>${escapeHtml(entry.text)}</strong>
        </div>
      `
    )
    .join("");
}

function pushAlertEvent(text, tone) {
  alertEvents.unshift({ ts: new Date().toISOString(), text, tone });
  alertEvents = alertEvents.slice(0, 60);
  renderAlertFeed();
}

function filteredAndSortedItems(items) {
  const filter = String(resultFilterSelect?.value || "all");
  const sortKey = String(resultSortSelect?.value || "pattern_desc");
  const base = (items || []).slice();

  const filtered = base.filter((item) => {
    if (!item?.ok || !item.signal) return filter === "all";
    const status = String(item.signal.status || "high_risk").toLowerCase();
    if (filter === "all") return true;
    return status === filter;
  });

  filtered.sort((a, b) => {
    if (!a.ok && b.ok) return 1;
    if (a.ok && !b.ok) return -1;
    if (!a.ok && !b.ok) return 0;

    const aSignal = a.signal || {};
    const bSignal = b.signal || {};
    const aRisk = Number(aSignal.killSwitch?.risk?.holderBehavior?.connectedHolderPct || 0);
    const bRisk = Number(bSignal.killSwitch?.risk?.holderBehavior?.connectedHolderPct || 0);
    const aLiquidity = Number(aSignal.market?.liquidityUsd || 0);
    const bLiquidity = Number(bSignal.market?.liquidityUsd || 0);
    const aPattern = Number(aSignal.patternScore || 0);
    const bPattern = Number(bSignal.patternScore || 0);
    const aConfidence = Number(aSignal.confidence || 0);
    const bConfidence = Number(bSignal.confidence || 0);

    if (sortKey === "confidence_desc") return bConfidence - aConfidence;
    if (sortKey === "liquidity_desc") return bLiquidity - aLiquidity;
    if (sortKey === "risk_desc") return bRisk - aRisk;
    return bPattern - aPattern;
  });

  return filtered;
}

function holderTier(amountPct) {
  const share = Number(amountPct || 0);
  if (share >= 2) return { icon: "🐋", label: "Whale", className: "tier-whale" };
  if (share >= 0.75) return { icon: "🐟", label: "Fish", className: "tier-fish" };
  return { icon: "🦐", label: "Shrimp", className: "tier-shrimp" };
}

function flowClass(buys, sells) {
  const b = Number(buys || 0);
  const s = Number(sells || 0);
  if (b > s) return "flow-buy";
  if (s > b) return "flow-sell";
  return "flow-neutral";
}

function sparklineSvg(points = []) {
  const values = (points || []).map((value) => Number(value || 0)).filter((value) => value > 0);
  if (values.length < 2) {
    return `<svg class="sparkline" viewBox="0 0 120 36"><text x="4" y="22">No chart</text></svg>`;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const path = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 116 + 2;
      const y = 30 - ((value - min) / span) * 24;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const trendUp = values[values.length - 1] >= values[0];
  const lineClass = trendUp ? "up" : "down";
  return `<svg class="sparkline ${lineClass}" viewBox="0 0 120 36"><path d="${path}" /></svg>`;
}

function avatarHtml(token, sizeClass = "token-avatar") {
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

  if (!planStatus) return;
  if (!authToken) {
    planStatus.textContent = "FREE";
    planStatus.className = "badge";
    return;
  }

  const normalizedPlan = String(userPlan || "free").toLowerCase() === "pro" ? "pro" : "free";
  planStatus.textContent = normalizedPlan.toUpperCase();
  planStatus.className = normalizedPlan === "pro" ? "badge ok" : "badge busy";
}

function setScanStatus(text, mode = "idle") {
  if (!scanStatus) return;
  scanStatus.textContent = text;
  scanStatus.classList.remove("ok", "busy", "error");
  if (mode !== "idle") scanStatus.classList.add(mode);
}

function setPaperStatus(text, mode = "idle") {
  if (!paperTestStatus) return;
  paperTestStatus.textContent = text;
  paperTestStatus.classList.remove("ok", "busy", "error");
  if (mode !== "idle") paperTestStatus.classList.add(mode);
}

function setButtonBusy(button, busy, busyLabel = "Loading...") {
  if (!button) return;
  if (busy) {
    if (!button.dataset.defaultLabel) {
      button.dataset.defaultLabel = button.textContent || "";
    }
    button.disabled = true;
    button.classList.add("loading");
    button.textContent = busyLabel;
    return;
  }

  button.disabled = false;
  button.classList.remove("loading");
  button.textContent = button.dataset.defaultLabel || button.textContent;
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

function syncPaperConfigUi(config) {
  if (!config) return;
  if (paperEnabledInput) paperEnabledInput.checked = Boolean(config.enabled);
  if (paperMinPatternInput) paperMinPatternInput.value = String(config.minPatternScore ?? 74);
  if (paperMinConfidenceInput) paperMinConfidenceInput.value = String(config.minConfidence ?? 0.78);
  if (paperMaxConnectedInput) paperMaxConnectedInput.value = String(config.maxConnectedHolderPct ?? 20);
  if (paperMaxPositionInput) paperMaxPositionInput.value = String(config.maxPositionUsd ?? 75);
  if (paperIntervalInput) paperIntervalInput.value = String(config.scanIntervalSec ?? 30);
}

function readPaperConfigFromUi() {
  return {
    enabled: Boolean(paperEnabledInput?.checked),
    mode: "paper",
    minPatternScore: Math.max(40, Math.min(95, Number(paperMinPatternInput?.value || 74))),
    minConfidence: Math.max(0.1, Math.min(0.99, Number(paperMinConfidenceInput?.value || 0.78))),
    maxConnectedHolderPct: Math.max(1, Math.min(80, Number(paperMaxConnectedInput?.value || 20))),
    requireKillSwitchPass: true,
    maxPositionUsd: Math.max(1, Math.min(50000, Number(paperMaxPositionInput?.value || 75))),
    scanIntervalSec: Math.max(10, Math.min(3600, Number(paperIntervalInput?.value || 30)))
  };
}

function stopPaperLoop() {
  if (paperTradeTimer) {
    clearInterval(paperTradeTimer);
    paperTradeTimer = null;
  }
  setPaperStatus("Idle");
}

function buildProjectedPnl(decision) {
  const confidence = Number(decision.confidence || 0);
  const pattern = Number(decision.patternScore || 0);
  const edge = confidence * 0.7 + pattern / 100 * 0.3;
  const expectedPct = (edge - 0.55) * 18;
  return Number(expectedPct.toFixed(2));
}

function renderPaperResults(payload) {
  if (!paperResults || !paperSummary) return;
  const decisions = Array.isArray(payload?.decisions) ? payload.decisions : [];
  if (!decisions.length) {
    paperSummary.textContent = "No decisions returned from paper test.";
    paperResults.innerHTML = "";
    return;
  }

  const candidates = decisions.filter((item) => item.ok && item.decision === "BUY_CANDIDATE");
  const skipped = decisions.length - candidates.length;
  const simulatedExposure = Number(payload?.summary?.simulatedExposureUsd || 0);
  paperSummary.innerHTML = `
    <strong>${escapeHtml(payload.mode || "paper")}</strong> run at
    ${escapeHtml(new Date(payload.ts || Date.now()).toLocaleTimeString())}:
    ${candidates.length} buy candidates, ${skipped} skipped, simulated max exposure ${formatUsd(simulatedExposure)}.
    ${
      Array.isArray(payload?.warnings) && payload.warnings.length
        ? `<br /><span class="error-text">${escapeHtml(payload.warnings.join(" | "))}</span>`
        : ""
    }
  `;

  paperResults.innerHTML = `
    <table class="paper-results-table">
      <thead>
        <tr>
          <th>Mint</th>
          <th>Decision</th>
          <th>Status</th>
          <th>Pattern</th>
          <th>Confidence</th>
          <th>Projected PnL %</th>
          <th>Main Reason</th>
        </tr>
      </thead>
      <tbody>
        ${decisions
          .map((item) => {
            const reason = Array.isArray(item.reasons) && item.reasons.length ? item.reasons[0] : "-";
            const projectedPnl =
              item.ok && item.decision === "BUY_CANDIDATE" ? `${formatNumber(buildProjectedPnl(item), 2)}%` : "-";
            return `
              <tr>
                <td><code>${escapeHtml(shortMint(item.mint, 6, 6))}</code></td>
                <td><span class="paper-pill ${item.decision === "BUY_CANDIDATE" ? "buy" : "skip"}">${escapeHtml(item.decision || "SKIP")}</span></td>
                <td>${escapeHtml(item.signalStatus || "-")}</td>
                <td>${formatNumber(item.patternScore || 0, 2)}</td>
                <td>${formatNumber(Number(item.confidence || 0) * 100, 1)}%</td>
                <td>${projectedPnl}</td>
                <td>${escapeHtml(reason)}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function renderPaperPerformance(performance) {
  if (!paperPerformanceSummary || !paperPerformanceRuns) return;
  const totals = performance?.totals || {};
  const runs = Array.isArray(performance?.recentRuns) ? performance.recentRuns : [];

  paperPerformanceSummary.innerHTML = `
    <div class="paper-kpi"><span>Total Runs</span><strong>${formatNumber(totals.runs || 0, 0)}</strong></div>
    <div class="paper-kpi"><span>Total Scanned</span><strong>${formatNumber(totals.scanned || 0, 0)}</strong></div>
    <div class="paper-kpi"><span>Buy Candidates</span><strong>${formatNumber(totals.buyCandidates || 0, 0)}</strong></div>
    <div class="paper-kpi"><span>Acceptance Rate</span><strong>${formatPct(totals.acceptanceRatePct || 0, 2)}</strong></div>
    <div class="paper-kpi"><span>Total Exposure</span><strong>${formatUsd(totals.totalExposureUsd || 0)}</strong></div>
    <div class="paper-kpi"><span>Avg Expected PnL</span><strong>${formatPct(totals.avgExpectedPnlPct || 0, 2)}</strong></div>
  `;

  if (!runs.length) {
    paperPerformanceRuns.innerHTML = `<div class="msg">No run history yet. Execute a paper test first.</div>`;
    return;
  }

  paperPerformanceRuns.innerHTML = `
    <table class="paper-results-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Mode</th>
          <th>Scanned</th>
          <th>Candidates</th>
          <th>Skipped</th>
          <th>Exposure</th>
          <th>Expected PnL %</th>
        </tr>
      </thead>
      <tbody>
        ${runs
          .map(
            (run) => `
          <tr>
            <td>${escapeHtml(new Date(run.created_at).toLocaleString())}</td>
            <td><span class="paper-pill ${run.mode === "paper" ? "buy" : "skip"}">${escapeHtml(run.mode)}</span></td>
            <td>${formatNumber(run.scannedCount || 0, 0)}</td>
            <td>${formatNumber(run.buyCandidates || 0, 0)}</td>
            <td>${formatNumber(run.skippedCount || 0, 0)}</td>
            <td>${formatUsd(run.simulatedExposureUsd || 0)}</td>
            <td>${formatPct(run.expectedPnlPct || 0, 2)}</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;

  renderPaperEquityChart(runs);
}

function renderPaperEquityChart(runs) {
  if (!paperEquityChart) return;
  if (!Array.isArray(runs) || runs.length < 2) {
    paperEquityChart.innerHTML = `<div class="muted">Paper equity curve appears after at least 2 runs.</div>`;
    return;
  }

  const chronological = runs.slice().reverse();
  const series = [];
  let equity = 100;
  let peak = 100;
  let maxDrawdown = 0;
  for (const run of chronological) {
    const exp = Number(run.expectedPnlPct || 0);
    equity = equity * (1 + exp / 100);
    peak = Math.max(peak, equity);
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    maxDrawdown = Math.max(maxDrawdown, dd);
    series.push(equity);
  }

  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const width = 520;
  const height = 130;
  const padX = 10;
  const padY = 10;
  const usableW = width - padX * 2;
  const usableH = height - padY * 2;
  const path = series
    .map((value, index) => {
      const x = padX + (index / Math.max(1, series.length - 1)) * usableW;
      const y = padY + (1 - (value - min) / span) * usableH;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  paperEquityChart.innerHTML = `
    <svg class="trend-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <rect x="0" y="0" width="${width}" height="${height}" rx="8" ry="8"></rect>
      <path class="trend-line pattern" d="${path}" />
    </svg>
    <div class="paper-chart-meta">
      <span><strong>Start:</strong> 100.00</span>
      <span><strong>End:</strong> ${formatNumber(series[series.length - 1], 2)}</span>
      <span><strong>Max Drawdown:</strong> ${formatPct(maxDrawdown, 2)}</span>
      <span><strong>Runs:</strong> ${series.length}</span>
    </div>
  `;
}

function syncEngineConfigUi(config) {
  if (!config) return;
  if (engineEnabledInput) engineEnabledInput.checked = Boolean(config.enabled);
  if (engineModeSelect) engineModeSelect.value = String(config.mode || "paper");
  if (engineAmountInput) engineAmountInput.value = String(config.tradeAmountUsd ?? 25);
  if (engineMaxOpenInput) engineMaxOpenInput.value = String(config.maxOpenPositions ?? 3);
  if (engineTpInput) engineTpInput.value = String(config.tpPct ?? 8);
  if (engineSlInput) engineSlInput.value = String(config.slPct ?? 4);
  if (engineTrailingInput) engineTrailingInput.value = String(config.trailingStopPct ?? 3);
  if (engineHoldMinutesInput) engineHoldMinutesInput.value = String(config.maxHoldMinutes ?? 120);
  if (engineCooldownInput) engineCooldownInput.value = String(config.cooldownSec ?? 30);
  if (enginePollInput) enginePollInput.value = String(config.pollIntervalSec ?? 15);
}

function readEngineConfigFromUi() {
  return {
    enabled: Boolean(engineEnabledInput?.checked),
    mode: String(engineModeSelect?.value || "paper"),
    tradeAmountUsd: Math.max(1, Math.min(50000, Number(engineAmountInput?.value || 25))),
    maxOpenPositions: Math.max(1, Math.min(50, Number(engineMaxOpenInput?.value || 3))),
    tpPct: Math.max(0.2, Math.min(200, Number(engineTpInput?.value || 8))),
    slPct: Math.max(0.2, Math.min(99, Number(engineSlInput?.value || 4))),
    trailingStopPct: Math.max(0.1, Math.min(99, Number(engineTrailingInput?.value || 3))),
    maxHoldMinutes: Math.max(1, Math.min(10080, Number(engineHoldMinutesInput?.value || 120))),
    cooldownSec: Math.max(0, Math.min(86400, Number(engineCooldownInput?.value || 30))),
    pollIntervalSec: Math.max(5, Math.min(3600, Number(enginePollInput?.value || 15)))
  };
}

function renderEnginePositions(positions = []) {
  if (!engineOpenPositions) return;
  const rows = Array.isArray(positions) ? positions : [];
  if (!rows.length) {
    engineOpenPositions.innerHTML = `<div class="msg">No open positions.</div>`;
    return;
  }

  engineOpenPositions.innerHTML = `
    <table class="paper-results-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Mint</th>
          <th>Mode</th>
          <th>Entry</th>
          <th>Last</th>
          <th>Size</th>
          <th>PnL %</th>
          <th>Opened</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
          <tr>
            <td>${formatNumber(row.id || 0, 0)}</td>
            <td><code>${escapeHtml(shortMint(row.mint || "", 6, 6))}</code></td>
            <td>${escapeHtml(row.mode || "paper")}</td>
            <td>${formatUsd(row.entryPriceUsd || 0)}</td>
            <td>${formatUsd(row.lastPriceUsd || 0)}</td>
            <td>${formatUsd(row.sizeUsd || 0)}</td>
            <td>${row.pnlPct === null || row.pnlPct === undefined ? "-" : formatPct(row.pnlPct || 0, 2)}</td>
            <td>${escapeHtml(new Date(row.opened_at).toLocaleTimeString())}</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;
}
}

async function loadPaperPerformance() {
  if (!authToken) return;
  const response = await api("/api/autotrade/performance?limit=30", null, true, "GET");
  renderPaperPerformance(response.performance || {});
}

async function loadEngineConfig() {
  if (!authToken) return;
  const response = await api("/api/autotrade/execution-config", null, true, "GET");
  syncEngineConfigUi(response.config || {});
}

async function saveEngineConfig() {
  setButtonBusy(engineSaveConfigButton, true, "Saving...");
  try {
    const response = await api(
      "/api/autotrade/execution-config",
      readEngineConfigFromUi(),
      true,
      "PUT"
    );
    syncEngineConfigUi(response.config || {});
    pushMessage("Engine config saved", "ok");
    return response.config || null;
  } catch (error) {
    pushMessage(`Engine config failed: ${error.message}`, "error");
    throw error;
  } finally {
    setButtonBusy(engineSaveConfigButton, false);
  }
}

async function loadEnginePositions() {
  if (!authToken) return;
  const response = await api("/api/autotrade/positions?status=OPEN", null, true, "GET");
  renderEnginePositions(response.positions || []);
}

function stopEngineLoop() {
  if (engineTimer) {
    clearInterval(engineTimer);
    engineTimer = null;
  }
  if (engineSummary) engineSummary.textContent = "Engine idle.";
}

async function runEngineTickOnce() {
  setButtonBusy(engineRunTickButton, true, "Ticking...");
  try {
    await saveEngineConfig();
    const response = await api("/api/autotrade/engine/tick", {}, true, "POST");
    const opened = (response.actions || []).filter((action) => action.type === "OPEN").length;
    const closed = (response.actions || []).filter((action) => action.type === "CLOSE").length;
    const warnings = Array.isArray(response.warnings) ? response.warnings : [];
    if (engineSummary) {
      engineSummary.innerHTML = `
        Engine tick ${escapeHtml(new Date(response.ts || Date.now()).toLocaleTimeString())}:
        opened ${opened}, closed ${closed}, open now ${formatNumber(response.positions?.openCount || 0, 0)}.
        ${warnings.length ? `<br /><span class="error-text">${escapeHtml(warnings.join(" | "))}</span>` : ""}
      `;
    }
    renderEnginePositions(response.positions?.open || []);
    await loadPaperPerformance();
    pushMessage(`Engine tick done (open ${opened}, close ${closed})`, "ok");
  } catch (error) {
    if (engineSummary) engineSummary.textContent = `Engine error: ${error.message}`;
    pushMessage(`Engine tick failed: ${error.message}`, "error");
  } finally {
    setButtonBusy(engineRunTickButton, false);
  }
}

async function startEngineLoop() {
  setButtonBusy(engineStartLoopButton, true, "Starting...");
  try {
    stopEngineLoop();
    await saveEngineConfig();
    const intervalSec = Math.max(5, Number(enginePollInput?.value || 15));
    await runEngineTickOnce();
    engineTimer = setInterval(async () => {
      await runEngineTickOnce();
    }, intervalSec * 1000);
    pushMessage(`Engine loop started (${intervalSec}s)`, "ok");
  } catch (error) {
    pushMessage(`Engine loop failed: ${error.message}`, "error");
  } finally {
    setButtonBusy(engineStartLoopButton, false);
  }
}

async function loadPaperConfig() {
  if (!authToken) return;
  const response = await api("/api/autotrade/config", null, true, "GET");
  syncPaperConfigUi(response.config || {});
}

async function savePaperConfig() {
  setButtonBusy(paperSaveConfigButton, true, "Saving...");
  try {
    const payload = readPaperConfigFromUi();
    const response = await api("/api/autotrade/config", payload, true, "PUT");
    const currentEngine = await api("/api/autotrade/execution-config", null, true, "GET");
    await api(
      "/api/autotrade/execution-config",
      {
        ...(currentEngine.config || {}),
        tradeAmountUsd: Number(payload.maxPositionUsd || 0),
        mode: "paper"
      },
      true,
      "PUT"
    );
    syncPaperConfigUi(response.config || {});
    await loadEngineConfig();
    pushMessage("Paper trade policy saved", "ok");
    return response.config || null;
  } catch (error) {
    pushMessage(error.message, "error");
    throw error;
  } finally {
    setButtonBusy(paperSaveConfigButton, false);
  }
}

async function runPaperTradeOnce() {
  setButtonBusy(paperRunOnceButton, true, "Running...");
  setPaperStatus("Running", "busy");
  try {
    const savedConfig = await savePaperConfig();
    const response = await api("/api/autotrade/run", {}, true, "POST");
    if (savedConfig) syncPaperConfigUi(savedConfig);
    paperRunHistory.unshift(response);
    paperRunHistory = paperRunHistory.slice(0, 20);
    renderPaperResults(response);
    await loadPaperPerformance();
    setPaperStatus("Live", "ok");
    pushMessage(
      `Paper run completed: ${response.summary?.buyCandidates || 0} candidates, ${response.summary?.skipped || 0} skipped`,
      "ok"
    );
  } catch (error) {
    setPaperStatus("Error", "error");
    pushMessage(`Paper run failed: ${error.message}`, "error");
  } finally {
    setButtonBusy(paperRunOnceButton, false);
  }
}

async function startPaperLoop() {
  setButtonBusy(paperStartLoopButton, true, "Starting...");
  try {
    stopPaperLoop();
    await savePaperConfig();
    const intervalSec = Math.max(10, Number(paperIntervalInput?.value || 30));
    await runPaperTradeOnce();
    paperTradeTimer = setInterval(async () => {
      await runPaperTradeOnce();
    }, intervalSec * 1000);
    setPaperStatus("Looping", "ok");
    pushMessage(`Paper loop started (${intervalSec}s interval)`, "ok");
  } catch (error) {
    setPaperStatus("Error", "error");
    pushMessage(`Paper loop failed: ${error.message}`, "error");
  } finally {
    setButtonBusy(paperStartLoopButton, false);
  }
}

async function loadTokenHolders(mint) {
  const response = await api(`/api/token/holders?mint=${encodeURIComponent(mint)}&limit=40`, null, true, "GET");
  return response;
}

function updateStats(stats) {
  historicalStats = stats || null;
  renderAnalytics();
}

function renderAnalytics() {
  if (!statsGrid) return;
  const totals = historicalStats?.totals || {};
  const usage = historicalStats?.usageToday || {};
  const sessionSamples = Math.max(1, sessionAnalytics.tokensSeen);
  const avgPattern = sessionAnalytics.tokensSeen
    ? sessionAnalytics.patternTotal / sessionSamples
    : 0;
  const avgConfidence = sessionAnalytics.tokensSeen
    ? (sessionAnalytics.confidenceTotal / sessionSamples) * 100
    : Number(historicalStats?.quality?.avgSignalConfidence || 0);
  const avgConnected = sessionAnalytics.tokensSeen
    ? sessionAnalytics.connectedTotal / sessionSamples
    : 0;

  statsGrid.innerHTML = `
    <div class="stat"><span>Session Batches</span><strong>${sessionAnalytics.batches}</strong></div>
    <div class="stat"><span>Tokens Scanned (Session)</span><strong>${sessionAnalytics.tokensSeen}</strong></div>
    <div class="stat"><span>Favorable Hits</span><strong>${sessionAnalytics.favorable}</strong></div>
    <div class="stat"><span>High-Risk Hits</span><strong>${sessionAnalytics.highRisk}</strong></div>
    <div class="stat"><span>Avg Pattern (Session)</span><strong>${formatNumber(avgPattern, 2)}</strong></div>
    <div class="stat"><span>Avg Confidence</span><strong>${formatNumber(avgConfidence, 2)}%</strong></div>
    <div class="stat"><span>Avg Connected</span><strong>${formatPct(avgConnected, 2)}</strong></div>
    <div class="stat"><span>Scans Stored</span><strong>${escapeHtml(totals.signals ?? 0)}</strong></div>
    <div class="stat"><span>Signal API Used</span><strong>${escapeHtml(usage.signal_calls ?? 0)}</strong></div>
    <div class="stat"><span>Chat API Used</span><strong>${escapeHtml(usage.chat_calls ?? 0)}</strong></div>
  `;

  if (statsMeta) {
    const stamp = sessionAnalytics.lastBatchAt
      ? new Date(sessionAnalytics.lastBatchAt).toLocaleTimeString()
      : "No live batch yet";
    statsMeta.textContent = `Live session metrics last updated: ${stamp}. Historical totals remain separate.`;
  }
}

async function refreshStats() {
  if (!authToken) return;
  const response = await api("/api/dashboard/stats", null, true);
  updateStats(response.stats);
}

async function refreshUserProfile() {
  if (!authToken) return;
  const response = await api("/api/auth/me", null, true, "GET");
  const user = response.user || {};
  userWallet = String(user.wallet || userWallet || "");
  userPlan = String(user.plan || userPlan || "free").toLowerCase();
  localStorage.setItem("enigma_wallet", userWallet);
  localStorage.setItem("enigma_plan", userPlan);
  setAuthState();
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
  const holderProfiles = Array.isArray(risk.holderProfiles) ? risk.holderProfiles : [];
  const connectedGroups = Array.isArray(holderBehavior.connectedGroups)
    ? holderBehavior.connectedGroups
    : [];
  const links = signal.links || {};
  const token = signal.token || {};
  const market = signal.market || {};
  const sentiment = signal.sentiment || {};
  const tradePlan = signal.tradePlan || {};
  const riskFlags = Array.isArray(risk.suspiciousPatterns) ? risk.suspiciousPatterns : [];

  const status = String(signal.status || "HIGH_RISK");
  const confidence = Number(signal.confidence || 0);
  const mint = String(item.mint || token.mint || "");
  const participation = Number(market.volume24hUsd || 0) / Math.max(Number(market.liquidityUsd || 0), 1);
  const isExpanded = expandedHolders.has(mint);
  const isLoadingHolders = loadingHolders.has(mint);

  const riskTone =
    status === "FAVORABLE" ? "good" : status === "CAUTION" ? "warn" : "bad";

  const topHolders = isExpanded ? holderProfiles : holderProfiles.slice(0, 6);

  return `
    <article class="card ${status.toLowerCase()}">
      <div class="token-main-head">
        <div class="token-head">
          ${avatarHtml(token)}
          <div class="token-meta">
            <h3>${escapeHtml(token.name || "Unknown Token")}</h3>
            <p>${escapeHtml(token.symbol || "N/A")} | ${escapeHtml(shortMint(mint, 8, 8))}</p>
          </div>
        </div>
        <div class="mini-chart-wrap">
          ${sparklineSvg(signal.miniChart?.points || [])}
        </div>
        <div class="token-price-box">
          <strong>${formatUsd(market.priceUsd || 0)}</strong>
          <span class="pill ${status.toLowerCase()}">${escapeHtml(status.replace("_", " "))}</span>
        </div>
      </div>

      <div class="card-sections">
        <section class="intel-box">
          <h4>Risk Analysis</h4>
          <div class="risk-strip ${riskTone}">
            ${escapeHtml(kill.verdict || "N/A")} ${escapeHtml(formatNumber(kill.score || 0, 0))}/100 | Pattern ${escapeHtml(formatNumber(signal.patternScore || 0, 2))}/100 | Confidence ${escapeHtml(confidence.toFixed(2))}
          </div>
          <div class="sentiment-box">
            <span>Sentiment</span>
            <strong>${escapeHtml(sentiment.label || "Neutral")} (${formatNumber(sentiment.score || 50, 0)}/100)</strong>
            <p>${escapeHtml(sentiment.summary || "Sentiment data unavailable.")}</p>
          </div>
          <div class="mini-grid">
            <div><span>Concentration</span><strong>${escapeHtml(risk.concentrationRisk || "unknown")}</strong></div>
            <div><span>Top-3 Share</span><strong>${formatPct(risk.top3HolderSharePct || 0)}</strong></div>
            <div><span>Mint Auth</span><strong>${risk.hasMintAuthority ? "Active" : "Revoked"}</strong></div>
            <div><span>Freeze Auth</span><strong>${risk.hasFreezeAuthority ? "Active" : "Revoked"}</strong></div>
          </div>
          ${
            riskFlags.length
              ? `<div class="risk-flags">${riskFlags
                  .slice(0, 4)
                  .map((flag) => `<span class="risk-flag">${escapeHtml(flag)}</span>`)
                  .join("")}</div>`
              : `<div class="risk-flags"><span class="risk-flag neutral">No elevated risk flags in this pass.</span></div>`
          }
        </section>

        <section class="intel-box">
          <h4>Trader Plan</h4>
          <div class="mini-grid">
            <div><span>Buy Zone</span><strong>${formatPrice(tradePlan.buyZone?.low)} - ${formatPrice(tradePlan.buyZone?.high)}</strong></div>
            <div><span>Support</span><strong class="price-support">${formatPrice((tradePlan.support || [])[0])} | ${formatPrice((tradePlan.support || [])[1])}</strong></div>
            <div><span>Resistance</span><strong class="price-resistance">${formatPrice((tradePlan.resistance || [])[0])} | ${formatPrice((tradePlan.resistance || [])[1])}</strong></div>
            <div><span>Stop Loss</span><strong class="price-stop">${formatPrice(tradePlan.stopLoss)}</strong></div>
            <div><span>24h Flow</span><strong class="${flowClass(sentiment.orderFlow?.buys24h, sentiment.orderFlow?.sells24h)}">B ${formatNumber(sentiment.orderFlow?.buys24h || 0, 0)} / S ${formatNumber(sentiment.orderFlow?.sells24h || 0, 0)}</strong></div>
            <div><span>24h Change</span><strong>${formatPct(market.priceChange24hPct)}</strong></div>
            <div><span>Liquidity</span><strong>${formatUsd(market.liquidityUsd)}</strong></div>
            <div><span>24h Volume</span><strong>${formatUsd(market.volume24hUsd)}</strong></div>
            <div><span>Participation</span><strong>${formatNumber(participation, 2)}</strong></div>
            <div><span>FDV</span><strong>${formatUsd(market.fdvUsd)}</strong></div>
          </div>
          <p class="plan-note">${escapeHtml(tradePlan.recommendation || "")}</p>
        </section>
      </div>

      <section class="intel-box holder-box">
        <h4>Holder Pattern Behavior</h4>
        <div class="behavior-summary">
          <span>Connected: <strong>${formatPct(holderBehavior.connectedHolderPct || 0)}</strong></span>
          <span>New Wallets: <strong>${formatPct(holderBehavior.newWalletHolderPct || 0)}</strong></span>
          <span>Groups: <strong>${formatNumber(holderBehavior.connectedGroupCount || 0, 0)}</strong></span>
          <span>Avg Wallet Age: <strong>${formatNumber(holderBehavior.avgWalletAgeDays || 0, 1)}d</strong></span>
        </div>
        ${sourceLegendHtml()}

        <div class="table-wrap">
          <table class="holder-table">
            <thead>
              <tr>
                <th>Wallet</th>
                <th>Share</th>
                <th>Age</th>
                <th>Source</th>
                <th>Group</th>
                <th>Buys/Sells</th>
                <th>Tags</th>
              </tr>
            </thead>
            <tbody>
              ${
                topHolders.length
                  ? topHolders
                      .map(
                        (holder) => {
                          const tier = holderTier(holder.amountPct);
                          return `
                        <tr>
                          <td>
                            <span class="holder-tier ${tier.className}" title="${tier.label}">
                              <span class="tier-icon">${tier.icon}</span>
                              <code>${escapeHtml(shortMint(holder.owner, 5, 5))}</code>
                            </span>
                          </td>
                          <td><strong>${formatPct(holder.amountPct || 0)}</strong></td>
                          <td>${holder.walletAgeDays === null ? "N/A" : `${formatNumber(holder.walletAgeDays, 1)}d`}</td>
                          <td><span class="source-pill" title="${escapeHtml(describeWalletSource(holder.walletSource))}">${escapeHtml(holder.walletSource || "unattributed-wallet")}</span></td>
                          <td>${holder.connectedGroupId ? `#${holder.connectedGroupId}` : "-"}</td>
                          <td class="${flowClass(holder.buyTxCount, holder.sellTxCount)}">${formatNumber(holder.buyTxCount || 0, 0)} / ${formatNumber(holder.sellTxCount || 0, 0)}</td>
                          <td>${escapeHtml((holder.tags || []).join(", ") || "-")}</td>
                        </tr>
                      `;
                        }
                      )
                      .join("")
                  : `<tr><td colspan="7">Holder profile unavailable for this scan.</td></tr>`
              }
            </tbody>
          </table>
        </div>

        ${
          connectedGroups.length
            ? `<div class="cluster-wrap">${connectedGroups
                .slice(0, 3)
                .map(
                  (group) => `<span class="cluster-chip">Cluster #${group.id}: ${group.holderCount} holders | ${formatPct(group.holdPct || 0)} | ${escapeHtml(group.reason || "shared activity")}</span>`
                )
                .join("")}</div>`
            : ""
        }

        <div class="holder-actions-row">
          <button class="secondary tiny-btn" data-expand-holders="${escapeHtml(mint)}">
            ${isExpanded ? "Collapse Holder List" : "Expand Holder List"}
          </button>
          ${
            isLoadingHolders
              ? `<span class="holders-loading">Loading holder behavior...</span>`
              : ""
          }
        </div>
      </section>

      <div class="mint-row">
        <code>${escapeHtml(mint)}</code>
        <button class="tiny-btn" data-copy-mint="${escapeHtml(mint)}">Copy</button>
      </div>

      <div class="row links">
        <a href="${escapeHtml(links.dexscreener || "#")}" target="_blank" rel="noreferrer">DexScreener</a>
        <a href="${escapeHtml(links.birdeye || "#")}" target="_blank" rel="noreferrer">Birdeye</a>
        <a href="${escapeHtml(links.solscan || "#")}" target="_blank" rel="noreferrer">Solscan</a>
      </div>
    </article>
  `;
}

function attachCardHandlers() {
  document.querySelectorAll("button[data-copy-mint]").forEach((button) => {
    button.addEventListener("click", async () => {
      const mint = String(button.getAttribute("data-copy-mint") || "");
      if (!mint) return;
      await navigator.clipboard.writeText(mint);
      pushMessage(`Copied mint ${shortMint(mint)}`, "info");
    });
  });

  document.querySelectorAll("button[data-expand-holders]").forEach((button) => {
    button.addEventListener("click", async () => {
      const mint = String(button.getAttribute("data-expand-holders") || "");
      if (!mint) return;

      if (expandedHolders.has(mint)) {
        expandedHolders.delete(mint);
        renderSignals(lastSignalItems);
        return;
      }

      expandedHolders.add(mint);
      loadingHolders.add(mint);
      renderSignals(lastSignalItems);

      try {
        const details = await loadTokenHolders(mint);
        const match = lastSignalItems.find((item) => item.ok && (item.mint === mint || item.signal?.mint === mint));
        if (match?.signal?.killSwitch?.risk) {
          match.signal.killSwitch.risk.holderProfiles = details.holderProfiles || [];
          match.signal.killSwitch.risk.holderBehavior = details.holderBehavior || {};
        }
      } catch (error) {
        pushMessage(`Holder expansion failed for ${shortMint(mint)}: ${error.message}`, "error");
      } finally {
        loadingHolders.delete(mint);
        renderSignals(lastSignalItems);
      }
    });
  });
}

function renderSignals(items) {
  if (!signalFeed) return;
  lastSignalItems = items || [];
  renderHeatmap(lastSignalItems);
  const viewItems = filteredAndSortedItems(lastSignalItems);
  if (!viewItems.length) {
    signalFeed.innerHTML = `<article class="card empty-state"><p>No results match current filters yet.</p></article>`;
    return;
  }
  signalFeed.innerHTML = viewItems.map((item) => signalCard(item)).join("");
  attachCardHandlers();
}

function syncThresholdUi() {
  if (thresholdFavorablePatternInput) {
    thresholdFavorablePatternInput.value = String(alertThresholds.favorablePatternMin);
  }
  if (thresholdRiskKillInput) {
    thresholdRiskKillInput.value = String(alertThresholds.riskKillMax);
  }
  if (thresholdConnectedMaxInput) {
    thresholdConnectedMaxInput.value = String(alertThresholds.connectedMax);
  }
}

function persistThresholds() {
  localStorage.setItem("enigma_threshold_fav_pattern", String(alertThresholds.favorablePatternMin));
  localStorage.setItem("enigma_threshold_risk_kill", String(alertThresholds.riskKillMax));
  localStorage.setItem("enigma_threshold_connected_max", String(alertThresholds.connectedMax));
}

function applyPreset(name) {
  const preset = riskPresets[name] || riskPresets.balanced;
  alertThresholds.favorablePatternMin = preset.favorablePatternMin;
  alertThresholds.riskKillMax = preset.riskKillMax;
  alertThresholds.connectedMax = preset.connectedMax;
  syncThresholdUi();
  persistThresholds();
  pushMessage(
    `Applied ${name} preset: favorable >= ${preset.favorablePatternMin}, risk kill <= ${preset.riskKillMax}, connected >= ${preset.connectedMax}%`,
    "info"
  );
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
              ${avatarHtml(token, "token-avatar small")}
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
      setButtonBusy(button, true, "Adding...");
      try {
        const mint = String(button.getAttribute("data-add-mint") || "");
        if (!mint) return;
        const saved = await api("/api/watchlist/add", { mint }, true);
        setWatchlistMints(saved.mints || []);
        pushMessage(`Added ${shortMint(mint)} to watchlist`, "ok");
      } catch (error) {
        pushMessage(error.message, "error");
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
}

async function scanWatchlist() {
  const response = await api("/api/watchlist/scan", {}, true);
  const items = response.items || [];
  renderSignals(items);
  updateSessionAnalyticsFromItems(items);
  evaluateSignalAlerts(items);
  renderAnalytics();
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
  setButtonBusy(startScanButton, true, "Starting...");
  const intervalSec = Math.max(10, Number(scanSecondsInput?.value || 30));
  const durationHours = Math.min(24, Math.max(1, Number(scanHoursInput?.value || 24)));

  try {
    stopScan();
    resetSessionAnalytics();
    renderAnalytics();
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
  } finally {
    setButtonBusy(startScanButton, false);
  }
}

async function connectWallet() {
  setButtonBusy(connectWalletButton, true, "Connecting...");
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
    userPlan = String(verify.user?.plan || "free").toLowerCase();
    localStorage.setItem("enigma_token", authToken);
    localStorage.setItem("enigma_wallet", userWallet);
    localStorage.setItem("enigma_plan", userPlan);
    setAuthState();
    pushMessage("Wallet connected", "ok");

    const watchlist = await api("/api/watchlist", null, true);
    setWatchlistMints(watchlist.mints || []);

    await refreshStats();
    await refreshUserProfile();
    await loadPaperConfig();
    await loadPaperPerformance();
    await loadEngineConfig();
    await loadEnginePositions();
  } catch (error) {
    pushMessage(error.message, "error");
  } finally {
    setButtonBusy(connectWalletButton, false);
  }
}

async function saveWatchlist() {
  setButtonBusy(saveWatchlistButton, true, "Saving...");
  try {
    const mints = watchlistMints.join(",");
    if (!mints) {
      throw new Error("Add at least 1 mint before saving");
    }
    const saved = await api("/api/watchlist", { mints }, true, "PUT");
    setWatchlistMints(saved.mints || []);
    pushMessage(`Saved watchlist (${saved.mints.length}/5)`, "ok");
  } catch (error) {
    pushMessage(error.message, "error");
  } finally {
    setButtonBusy(saveWatchlistButton, false);
  }
}

async function discoverSuggestions() {
  setButtonBusy(discoverTokensButton, true, "Scanning...");
  try {
    const response = await api("/api/discovery/suggest", { limit: 5 }, true);
    renderDiscovery(response.items || []);
    pushMessage(`Loaded ${response.items?.length || 0} discovery suggestions`, "ok");
  } catch (error) {
    pushMessage(error.message, "error");
  } finally {
    setButtonBusy(discoverTokensButton, false);
  }
}

async function scanManualMint() {
  const mint = String(manualMintInput?.value || "").trim();
  if (!mint) {
    pushMessage("Enter a mint address first", "error");
    return;
  }

  setButtonBusy(scanManualButton, true, "Scanning...");
  try {
    const response = await api("/api/signal", { mint }, true);
    const items = [{ mint, ok: true, signalId: response.signalId, signal: response.signal }];
    renderSignals(items);
    updateSessionAnalyticsFromItems(items);
    evaluateSignalAlerts(items);
    renderAnalytics();
    pushMessage(`Manual scan completed for ${shortMint(mint)}`, "ok");
  } catch (error) {
    pushMessage(error.message, "error");
  } finally {
    setButtonBusy(scanManualButton, false);
  }
}

async function hydrateSession() {
  if (!authToken) return;

  try {
    const watchlist = await api("/api/watchlist", null, true);
    setWatchlistMints(watchlist.mints || []);
    await refreshUserProfile();
    await refreshStats();
    await loadPaperConfig();
    await loadPaperPerformance();
    await loadEngineConfig();
    await loadEnginePositions();
  } catch {
    authToken = "";
    userWallet = "";
    userPlan = "free";
    localStorage.removeItem("enigma_token");
    localStorage.removeItem("enigma_wallet");
    localStorage.removeItem("enigma_plan");
    setAuthState();
  }
}

function syncAlertUi() {
  if (alertFavorableInput) alertFavorableInput.checked = alertPrefs.favorable;
  if (alertHighRiskInput) alertHighRiskInput.checked = alertPrefs.highRisk;
  if (alertSoundInput) alertSoundInput.checked = alertPrefs.sound;
}

function persistAlertPrefs() {
  localStorage.setItem("enigma_alert_favorable", alertPrefs.favorable ? "1" : "0");
  localStorage.setItem("enigma_alert_highrisk", alertPrefs.highRisk ? "1" : "0");
  localStorage.setItem("enigma_alert_sound", alertPrefs.sound ? "1" : "0");
}

async function enableBrowserAlerts() {
  if (!window.Notification) {
    pushMessage("Browser notifications are not supported here", "error");
    return;
  }
  const permission = await window.Notification.requestPermission();
  if (permission === "granted") {
    pushMessage("Browser popup alerts enabled", "ok");
  } else {
    pushMessage("Browser popup alerts were blocked", "error");
  }
}

connectWalletButton?.addEventListener("click", connectWallet);
addWatchlistTokenButton?.addEventListener("click", addWatchlistMintFromInput);
watchlistTokenInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addWatchlistMintFromInput();
  }
});
saveWatchlistButton?.addEventListener("click", saveWatchlist);
startScanButton?.addEventListener("click", startScan);
stopScanButton?.addEventListener("click", stopScan);
scanOnceButton?.addEventListener("click", async () => {
  setButtonBusy(scanOnceButton, true, "Scanning...");
  try {
    await scanWatchlist();
  } finally {
    setButtonBusy(scanOnceButton, false);
  }
});
discoverTokensButton?.addEventListener("click", discoverSuggestions);
scanManualButton?.addEventListener("click", scanManualMint);
resultFilterSelect?.addEventListener("change", () => {
  renderSignals(lastSignalItems);
});
resultSortSelect?.addEventListener("change", () => {
  renderSignals(lastSignalItems);
});
applyProPresetButton?.addEventListener("click", () => {
  applyPreset(String(riskPresetSelect?.value || "balanced"));
});
thresholdFavorablePatternInput?.addEventListener("change", () => {
  alertThresholds.favorablePatternMin = Math.max(
    40,
    Math.min(95, Number(thresholdFavorablePatternInput.value || 72))
  );
  persistThresholds();
  syncThresholdUi();
});
thresholdRiskKillInput?.addEventListener("change", () => {
  alertThresholds.riskKillMax = Math.max(10, Math.min(90, Number(thresholdRiskKillInput.value || 50)));
  persistThresholds();
  syncThresholdUi();
});
thresholdConnectedMaxInput?.addEventListener("change", () => {
  alertThresholds.connectedMax = Math.max(
    5,
    Math.min(60, Number(thresholdConnectedMaxInput.value || 25))
  );
  persistThresholds();
  syncThresholdUi();
});
alertFavorableInput?.addEventListener("change", () => {
  alertPrefs.favorable = Boolean(alertFavorableInput.checked);
  persistAlertPrefs();
});
alertHighRiskInput?.addEventListener("change", () => {
  alertPrefs.highRisk = Boolean(alertHighRiskInput.checked);
  persistAlertPrefs();
});
alertSoundInput?.addEventListener("change", () => {
  alertPrefs.sound = Boolean(alertSoundInput.checked);
  persistAlertPrefs();
});
enableBrowserAlertsButton?.addEventListener("click", enableBrowserAlerts);
paperSaveConfigButton?.addEventListener("click", async () => {
  await savePaperConfig();
});
paperRunOnceButton?.addEventListener("click", async () => {
  await runPaperTradeOnce();
});
paperStartLoopButton?.addEventListener("click", async () => {
  await startPaperLoop();
});
paperStopLoopButton?.addEventListener("click", () => {
  stopPaperLoop();
  pushMessage("Paper loop stopped", "info");
});
paperRefreshPerformanceButton?.addEventListener("click", async () => {
  setButtonBusy(paperRefreshPerformanceButton, true, "Refreshing...");
  try {
    await loadPaperPerformance();
    pushMessage("Paper performance refreshed", "ok");
  } catch (error) {
    pushMessage(`Performance refresh failed: ${error.message}`, "error");
  } finally {
    setButtonBusy(paperRefreshPerformanceButton, false);
  }
});
engineSaveConfigButton?.addEventListener("click", async () => {
  await saveEngineConfig();
});
engineRunTickButton?.addEventListener("click", async () => {
  await runEngineTickOnce();
});
engineStartLoopButton?.addEventListener("click", async () => {
  await startEngineLoop();
});
engineStopLoopButton?.addEventListener("click", () => {
  stopEngineLoop();
  pushMessage("Engine loop stopped", "info");
});
engineRefreshPositionsButton?.addEventListener("click", async () => {
  setButtonBusy(engineRefreshPositionsButton, true, "Refreshing...");
  try {
    await loadEnginePositions();
    pushMessage("Positions refreshed", "ok");
  } catch (error) {
    pushMessage(`Position refresh failed: ${error.message}`, "error");
  } finally {
    setButtonBusy(engineRefreshPositionsButton, false);
  }
});

setAuthState();
syncAlertUi();
syncThresholdUi();
renderHeatmap([]);
renderWatchlistChips();
renderAnalytics();
renderAlertFeed();
renderSessionTrend();
setPaperStatus("Idle");
if (engineSummary) engineSummary.textContent = "Engine idle.";
hydrateSession();
pushMessage("Workflow: connect wallet -> add watchlist mints -> save -> start dynamic scan.", "info");
pushMessage("Read Risk Analysis first. Trade Plan is guidance, not execution or financial advice.", "info");
pushMessage("Paper Trade Test Lab: run simulated policy entries before any live execution.", "info");
