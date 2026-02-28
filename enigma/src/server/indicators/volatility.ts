import { computeAtrSeries } from "./atr.js";
import type { Candle } from "./types.js";

export interface VolatilityIndexResult {
  index: number | null;
  label: "Low" | "Medium" | "High" | "Unavailable";
  currentAtr: number | null;
  sampleSize: number;
  sufficientData: boolean;
  note?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function percentileRank(value: number, values: number[]): number {
  if (!Number.isFinite(value)) return 0;
  const clean = (values || []).filter((entry) => Number.isFinite(entry));
  if (!clean.length) return 0;

  let below = 0;
  let equal = 0;
  for (const entry of clean) {
    if (entry < value) below += 1;
    else if (entry === value) equal += 1;
  }

  return clamp((below + equal * 0.5) / clean.length, 0, 1);
}

function volatilityLabel(index: number): "Low" | "Medium" | "High" {
  if (index >= 66) return "High";
  if (index >= 33) return "Medium";
  return "Low";
}

export function computeVolatilityIndexFromCandles(input: {
  candles: Candle[];
  atrPeriod?: number;
  percentileWindow?: number;
}): VolatilityIndexResult {
  const atrPeriod = Math.max(2, Number(input.atrPeriod || 14));
  const percentileWindow = Math.max(20, Number(input.percentileWindow || 200));
  const atrSeries = computeAtrSeries(input.candles || [], atrPeriod);

  if (atrSeries.length < 5) {
    return {
      index: null,
      label: "Unavailable",
      currentAtr: null,
      sampleSize: atrSeries.length,
      sufficientData: false,
      note: "Insufficient candles for ATR percentile volatility index."
    };
  }

  const sample = atrSeries.slice(-percentileWindow);
  const currentAtr = sample[sample.length - 1];
  const index = Number((percentileRank(currentAtr, sample) * 100).toFixed(2));

  return {
    index,
    label: volatilityLabel(index),
    currentAtr: Number(currentAtr.toFixed(10)),
    sampleSize: sample.length,
    sufficientData: true
  };
}
