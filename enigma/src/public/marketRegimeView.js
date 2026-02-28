function safeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function volatilityBand(index) {
  const n = safeNumber(index);
  if (n === null) return "Unavailable";
  if (n >= 66) return "High";
  if (n >= 33) return "Medium";
  return "Low";
}

function regimeTone(regimeLabel) {
  const label = String(regimeLabel || "").toLowerCase();
  if (label.includes("trending")) return "good";
  if (label.includes("choppy")) return "bad";
  if (label.includes("ranging")) return "warn";
  return "warn";
}

export function buildMarketRegimeViewModel(marketRegime) {
  const current = marketRegime?.current || {};
  const volatilityIndex = safeNumber(current.volatilityIndex);
  const adx = safeNumber(current.adx);
  const regime = String(current.regime || "Unavailable");
  const strategyHint = String(current.strategyHint || "Wait for sufficient data");

  return {
    timeframe: String(current.timeframe || marketRegime?.preferredTimeframe || "1h"),
    volatilityIndex,
    volatilityText: volatilityIndex === null ? "N/A" : volatilityIndex.toFixed(2),
    volatilityLabel: String(current.volatilityLabel || volatilityBand(volatilityIndex)),
    volatilityBand: volatilityBand(volatilityIndex),
    adx,
    adxText: adx === null ? "N/A" : adx.toFixed(2),
    adxLabel: String(current.adxLabel || "Unavailable"),
    regime,
    strategyHint,
    tone: regimeTone(regime),
    sufficientData: Boolean(current.sufficientData),
    note: String(current.note || "")
  };
}
