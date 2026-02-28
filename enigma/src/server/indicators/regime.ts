import { computeAdxFromCandles } from "./adx.js";
import type { Candle } from "./types.js";
import { computeVolatilityIndexFromCandles } from "./volatility.js";

export type RegimeLabel =
  | "Trending & Expanding"
  | "Trending & Stable"
  | "Choppy & Volatile"
  | "Ranging & Quiet"
  | "Unavailable";

export interface MarketRegimeComputation {
  volatilityIndex: number | null;
  volatilityLabel: "Low" | "Medium" | "High" | "Unavailable";
  adx: number | null;
  adxLabel: "Sideways" | "Developing trend" | "Strong trend" | "Very strong trend" | "Unavailable";
  regime: RegimeLabel;
  strategyHint: string;
  sufficientData: boolean;
  details: {
    atrPeriod: number;
    adxPeriod: number;
    volatilityWindow: number;
    candleCount: number;
    atrSampleSize: number;
  };
  note?: string;
}

export function resolveRegimeLabel(adx: number, volatilityIndex: number): RegimeLabel {
  // Regime thresholds are intentionally simple and explicit so they are easy to tune per strategy.
  if (adx >= 25 && volatilityIndex >= 60) return "Trending & Expanding";
  if (adx >= 25 && volatilityIndex < 60) return "Trending & Stable";
  if (adx < 20 && volatilityIndex >= 60) return "Choppy & Volatile";
  return "Ranging & Quiet";
}

function strategyHint(regime: RegimeLabel): string {
  if (regime === "Trending & Expanding") return "Breakout favored";
  if (regime === "Trending & Stable") return "Trend-following favored";
  if (regime === "Choppy & Volatile") return "Reduce size; confirmation-only entries";
  if (regime === "Ranging & Quiet") return "Mean-reversion favored";
  return "Wait for sufficient data";
}

export function computeMarketRegimeFromCandles(input: {
  candles: Candle[];
  atrPeriod?: number;
  adxPeriod?: number;
  volatilityWindow?: number;
}): MarketRegimeComputation {
  const atrPeriod = Math.max(2, Number(input.atrPeriod || 14));
  const adxPeriod = Math.max(2, Number(input.adxPeriod || 14));
  const volatilityWindow = Math.max(20, Number(input.volatilityWindow || 200));

  const vol = computeVolatilityIndexFromCandles({
    candles: input.candles,
    atrPeriod,
    percentileWindow: volatilityWindow
  });
  const adx = computeAdxFromCandles(input.candles, adxPeriod);

  const hasData = vol.sufficientData && adx.sufficientData && vol.index !== null && adx.adx !== null;

  if (!hasData) {
    return {
      volatilityIndex: vol.index,
      volatilityLabel: vol.label,
      adx: adx.adx,
      adxLabel: adx.label,
      regime: "Unavailable",
      strategyHint: strategyHint("Unavailable"),
      sufficientData: false,
      details: {
        atrPeriod,
        adxPeriod,
        volatilityWindow,
        candleCount: (input.candles || []).length,
        atrSampleSize: vol.sampleSize
      },
      note: vol.note || adx.note || "Market regime unavailable due to insufficient candles."
    };
  }

  const regime = resolveRegimeLabel(Number(adx.adx), Number(vol.index));

  return {
    volatilityIndex: Number(vol.index),
    volatilityLabel: vol.label,
    adx: Number(adx.adx),
    adxLabel: adx.label,
    regime,
    strategyHint: strategyHint(regime),
    sufficientData: true,
    details: {
      atrPeriod,
      adxPeriod,
      volatilityWindow,
      candleCount: (input.candles || []).length,
      atrSampleSize: vol.sampleSize
    }
  };
}
