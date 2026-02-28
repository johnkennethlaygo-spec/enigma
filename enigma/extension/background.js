const DEFAULT_SETTINGS = {
  apiBaseUrl: "http://localhost:3000",
  authToken: "",
  alertHighRisk: true,
  alertCaution: false,
  autoScanOnNavigation: true
};

function parsePumpFunMintFromUrl(url) {
  try {
    const u = new URL(String(url || ""));
    const parts = u.pathname.split("/").filter(Boolean);
    const candidate = parts[parts.length - 1] || "";
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(candidate) ? candidate : "";
  } catch {
    return "";
  }
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
    title,
    message
  });
}

async function appendScanHistory(entry) {
  const state = await chrome.storage.local.get({ recentScans: [] });
  const current = Array.isArray(state.recentScans) ? state.recentScans : [];
  const next = [entry, ...current].slice(0, 25);
  await chrome.storage.local.set({ recentScans: next, lastScan: entry });
}

async function scanMintInternal(mint) {
  const settings = await getSettings();
  if (!settings.authToken) {
    throw new Error("Missing JWT token. Set it in extension settings.");
  }

  const response = await fetch(`${settings.apiBaseUrl}/api/signal`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.authToken}`
    },
    body: JSON.stringify({ mint })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Scan failed");
  }

  const signal = payload?.signal || {};
  const status = String(signal.status || "UNKNOWN");
  const scanEntry = {
    ts: new Date().toISOString(),
    mint,
    status,
    patternScore: Number(signal.patternScore || 0),
    confidence: Number(signal.confidence || 0),
    killScore: Number(signal?.killSwitch?.score || 0)
  };
  await appendScanHistory(scanEntry);

  if (status === "HIGH_RISK" && settings.alertHighRisk) {
    notify("KOBECOIN HIGH_RISK", `Token ${mint.slice(0, 6)}... is HIGH_RISK`);
  }
  if (status === "CAUTION" && settings.alertCaution) {
    notify("KOBECOIN CAUTION", `Token ${mint.slice(0, 6)}... is CAUTION`);
  }

  return payload;
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...(await chrome.storage.sync.get(DEFAULT_SETTINGS)) });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ENIGMA_SCAN_MINT") {
    (async () => {
      try {
        const mint = String(message.mint || "").trim();
        if (!mint) throw new Error("Mint is required");
        const payload = await scanMintInternal(mint);
        sendResponse({ ok: true, payload });
      } catch (error) {
        sendResponse({ ok: false, error: String(error?.message || error) });
      }
    })();
    return true;
  }

  if (message?.type === "ENIGMA_GET_HISTORY") {
    (async () => {
      const state = await chrome.storage.local.get({ recentScans: [] });
      sendResponse({ ok: true, recentScans: state.recentScans || [] });
    })();
    return true;
  }

  return false;
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab?.url) return;
  if (changeInfo.status !== "complete") return;

  const settings = await getSettings();
  if (!settings.autoScanOnNavigation) return;

  const mint = parsePumpFunMintFromUrl(tab.url);
  if (!mint) return;

  const cache = await chrome.storage.local.get({ lastAutoScanMint: "" });
  if (cache.lastAutoScanMint === mint) return;

  try {
    await scanMintInternal(mint);
    await chrome.storage.local.set({ lastAutoScanMint: mint });

    if (chrome.sidePanel?.open) {
      try {
        await chrome.sidePanel.open({ tabId });
      } catch {
        // Side panel open is best effort.
      }
    }
  } catch {
    // Ignore auto-scan errors to avoid noisy tab updates.
  }
});
