const refreshButton = document.querySelector("#refresh");
const lastCard = document.querySelector("#last-card");
const historyEl = document.querySelector("#history");

function shortMint(mint) {
  const v = String(mint || "");
  return v.length > 12 ? `${v.slice(0, 6)}...${v.slice(-6)}` : v;
}

function row(entry) {
  return `
    <div class="item">
      <div class="row"><span class="mono">${shortMint(entry.mint)}</span><span class="badge ${entry.status}">${entry.status}</span></div>
      <div class="row"><span>Pattern ${Number(entry.patternScore || 0).toFixed(2)}</span><span>Conf ${(Number(entry.confidence || 0) * 100).toFixed(1)}%</span></div>
      <div class="row"><span>Kill ${Number(entry.killScore || 0).toFixed(0)}</span><span>${new Date(entry.ts).toLocaleTimeString()}</span></div>
    </div>
  `;
}

async function loadHistory() {
  const response = await chrome.runtime.sendMessage({ type: "ENIGMA_GET_HISTORY" });
  const history = Array.isArray(response?.recentScans) ? response.recentScans : [];

  if (!history.length) {
    lastCard.innerHTML = `<div>No scans yet. Run a scan from popup or open Pump.fun token pages.</div>`;
    historyEl.innerHTML = "";
    return;
  }

  lastCard.innerHTML = `
    <div class="row"><strong>Latest Verdict</strong><span class="badge ${history[0].status}">${history[0].status}</span></div>
    <div class="row"><span class="mono">${history[0].mint}</span></div>
    <div class="row"><span>Pattern ${Number(history[0].patternScore || 0).toFixed(2)}</span><span>Conf ${(Number(history[0].confidence || 0) * 100).toFixed(1)}%</span></div>
  `;

  historyEl.innerHTML = history.slice(0, 12).map(row).join("");
}

refreshButton.addEventListener("click", loadHistory);
loadHistory();
