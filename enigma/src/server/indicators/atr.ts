import type { Candle } from "./types.js";

function clampPositive(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
}

function trueRange(current: Candle, prevClose: number): number {
  const high = clampPositive(current.high);
  const low = clampPositive(current.low);
  const closeRef = clampPositive(prevClose);
  if (!high || !low) return 0;

  const intraday = high - low;
  const highGap = Math.abs(high - closeRef);
  const lowGap = Math.abs(low - closeRef);
  return Math.max(intraday, highGap, lowGap);
}

export function computeAtrSeries(candles: Candle[], period = 14): number[] {
  const size = Number(period || 14);
  if (!Array.isArray(candles) || candles.length < size + 1 || size < 2) {
    return [];
  }

  const trs: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const prev = candles[i - 1];
    const current = candles[i];
    trs.push(trueRange(current, Number(prev?.close || 0)));
  }

  if (trs.length < size) return [];

  const initial = trs.slice(0, size).reduce((sum, value) => sum + value, 0) / size;
  const series = [initial];
  let prevAtr = initial;

  for (let i = size; i < trs.length; i += 1) {
    const nextAtr = (prevAtr * (size - 1) + trs[i]) / size;
    series.push(nextAtr);
    prevAtr = nextAtr;
  }

  return series;
}
