function parsePumpFunMintFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (!parts.length) return "";
    const candidate = parts[parts.length - 1] || "";
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(candidate)) {
      return candidate;
    }
    return "";
  } catch {
    return "";
  }
}

function announceMint() {
  const mint = parsePumpFunMintFromUrl(window.location.href);
  if (!mint) return;
  window.dispatchEvent(new CustomEvent("ENIGMA_PUMPFUN_MINT", { detail: { mint } }));
}

announceMint();

const observer = new MutationObserver(() => {
  announceMint();
});

observer.observe(document.documentElement, { subtree: true, childList: true });
