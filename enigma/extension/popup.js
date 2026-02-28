const DEFAULTS = {
  apiBaseUrl: "http://localhost:3000",
  authToken: "",
  alertHighRisk: true,
  alertCaution: false,
  autoScanOnNavigation: true
};

const apiBaseInput = document.querySelector("#api-base");
const authTokenInput = document.querySelector("#auth-token");
const mintInput = document.querySelector("#mint");
const detectButton = document.querySelector("#detect");
const scanButton = document.querySelector("#scan");
const addWatchlistButton = document.querySelector("#add-watchlist");
const openSidePanelButton = document.querySelector("#open-sidepanel");
const saveButton = document.querySelector("#save");
const statusEl = document.querySelector("#status");
const resultEl = document.querySelector("#result");
const alertHigh = document.querySelector("#alert-high");
const alertCaution = document.querySelector("#alert-caution");
const autoScan = document.querySelector("#auto-scan");
const investorPreview = document.querySelector("#investor-preview");

function setStatus(text, tone = "") {
  statusEl.textContent = text;
  statusEl.style.color = tone === "error" ? "#8c2f2f" : tone === "ok" ? "#225f3d" : "#5f4123";
}

function parsePumpFunMintFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (!parts.length) return "";
    const candidate = parts[parts.length - 1] || "";
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(candidate) ? candidate : "";
  } catch {
    return "";
  }
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  apiBaseInput.value = settings.apiBaseUrl || DEFAULTS.apiBaseUrl;
  authTokenInput.value = settings.authToken || "";
  alertHigh.checked = Boolean(settings.alertHighRisk);
  alertCaution.checked = Boolean(settings.alertCaution);
  autoScan.checked = Boolean(settings.autoScanOnNavigation);
  investorPreview.href = `${apiBaseInput.value.replace(/\/$/, "")}/extension-preview.html`;
}

async function saveSettings() {
  const next = {
    apiBaseUrl: String(apiBaseInput.value || "").trim(),
    authToken: String(authTokenInput.value || "").trim(),
    alertHighRisk: Boolean(alertHigh.checked),
    alertCaution: Boolean(alertCaution.checked),
    autoScanOnNavigation: Boolean(autoScan.checked)
  };
  await chrome.storage.sync.set(next);
  investorPreview.href = `${next.apiBaseUrl.replace(/\/$/, "")}/extension-preview.html`;
  setStatus("Settings saved", "ok");
}

async function detectMint() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const mint = parsePumpFunMintFromUrl(String(tab?.url || ""));
  if (!mint) {
    setStatus("No pump.fun mint detected in current tab", "error");
    return;
  }
  mintInput.value = mint;
  setStatus("Mint detected", "ok");
}

async function scanMint() {
  try {
    await saveSettings();
    const mint = String(mintInput.value || "").trim();
    if (!mint) {
      setStatus("Mint is required", "error");
      return;
    }

    setStatus("Scanning...", "");
    const response = await chrome.runtime.sendMessage({ type: "ENIGMA_SCAN_MINT", mint });
    if (!response?.ok) {
      throw new Error(response?.error || "Scan failed");
    }

    const signal = response.payload?.signal || {};
    resultEl.textContent = JSON.stringify(
      {
        mint,
        status: signal.status,
        patternScore: signal.patternScore,
        confidence: signal.confidence,
        killSwitch: signal.killSwitch,
        tradePlan: signal.tradePlan
      },
      null,
      2
    );
    setStatus(`Scan complete: ${String(signal.status || "UNKNOWN")}`, "ok");
  } catch (error) {
    setStatus(String(error.message || error), "error");
  }
}

async function addToWatchlist() {
  try {
    await saveSettings();
    const mint = String(mintInput.value || "").trim();
    if (!mint) {
      setStatus("Mint is required", "error");
      return;
    }

    const settings = await chrome.storage.sync.get(DEFAULTS);
    const response = await fetch(`${settings.apiBaseUrl}/api/watchlist/add`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${settings.authToken || ""}`
      },
      body: JSON.stringify({ mint })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || "Failed to add to watchlist");
    }

    setStatus(`Added to watchlist (${(payload.mints || []).length}/5)`, "ok");
  } catch (error) {
    setStatus(String(error.message || error), "error");
  }
}

async function openSidePanel() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
    setStatus("Side panel opened", "ok");
  } catch (error) {
    setStatus(`Cannot open side panel: ${String(error.message || error)}`, "error");
  }
}

detectButton.addEventListener("click", detectMint);
scanButton.addEventListener("click", scanMint);
addWatchlistButton.addEventListener("click", addToWatchlist);
openSidePanelButton.addEventListener("click", openSidePanel);
saveButton.addEventListener("click", saveSettings);

loadSettings().then(() => detectMint());
