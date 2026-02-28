import type { Candle } from "./types.js";

export interface AdxResult {
  adx: number | null;
  plusDi: number | null;
  minusDi: number | null;
  label: "Sideways" | "Developing trend" | "Strong trend" | "Very strong trend" | "Unavailable";
  sufficientData: boolean;
  period: number;
  note?: string;
}

function safe(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value;
}

function trueRange(current: Candle, previous: Candle): number {
  const intraday = safe(current.high) - safe(current.low);
  const highGap = Math.abs(safe(current.high) - safe(previous.close));
  const lowGap = Math.abs(safe(current.low) - safe(previous.close));
  return Math.max(intraday, highGap, lowGap);
}

function adxStrengthLabel(value: number): AdxResult["label"] {
  if (value < 20) return "Sideways";
  if (value < 25) return "Developing trend";
  if (value <= 40) return "Strong trend";
  return "Very strong trend";
}

export function computeAdxFromCandles(candles: Candle[], period = 14): AdxResult {
  const p = Math.max(2, Number(period || 14));
  if (!Array.isArray(candles) || candles.length < p * 2 + 1) {
    return {
      adx: null,
      plusDi: null,
      minusDi: null,
      label: "Unavailable",
      sufficientData: false,
      period: p,
      note: `Need at least ${p * 2 + 1} candles for ADX(${p}).`
    };
  }

  const trs: number[] = [];
  const plusDms: number[] = [];
  const minusDms: number[] = [];

  for (let i = 1; i < candles.length; i += 1) {
    const prev = candles[i - 1];
    const current = candles[i];

    const upMove = safe(current.high) - safe(prev.high);
    const downMove = safe(prev.low) - safe(current.low);

    const plusDm = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDm = downMove > upMove && downMove > 0 ? downMove : 0;

    trs.push(trueRange(current, prev));
    plusDms.push(plusDm);
    minusDms.push(minusDm);
  }

  let smTr = trs.slice(0, p).reduce((sum, value) => sum + value, 0);
  let smPlus = plusDms.slice(0, p).reduce((sum, value) => sum + value, 0);
  let smMinus = minusDms.slice(0, p).reduce((sum, value) => sum + value, 0);

  const dxValues: number[] = [];
  let latestPlusDi = 0;
  let latestMinusDi = 0;
  let latestAdx: number | null = null;

  for (let i = p; i < trs.length; i += 1) {
    if (i > p) {
      smTr = smTr - smTr / p + trs[i];
      smPlus = smPlus - smPlus / p + plusDms[i];
      smMinus = smMinus - smMinus / p + minusDms[i];
    }

    if (smTr <= 0) {
      dxValues.push(0);
      continue;
    }

    const plusDi = (smPlus / smTr) * 100;
    const minusDi = (smMinus / smTr) * 100;
    latestPlusDi = plusDi;
    latestMinusDi = minusDi;

    const diSum = plusDi + minusDi;
    const dx = diSum <= 0 ? 0 : (Math.abs(plusDi - minusDi) / diSum) * 100;
    dxValues.push(dx);

    if (dxValues.length === p) {
      latestAdx = dxValues.reduce((sum, value) => sum + value, 0) / p;
    } else if (dxValues.length > p && latestAdx !== null) {
      latestAdx = (latestAdx * (p - 1) + dx) / p;
    }
  }

  if (latestAdx === null) {
    return {
      adx: null,
      plusDi: null,
      minusDi: null,
      label: "Unavailable",
      sufficientData: false,
      period: p,
      note: `Insufficient DX values for ADX(${p}).`
    };
  }

  const adx = Number(latestAdx.toFixed(2));
  return {
    adx,
    plusDi: Number(latestPlusDi.toFixed(2)),
    minusDi: Number(latestMinusDi.toFixed(2)),
    label: adxStrengthLabel(adx),
    sufficientData: true,
    period: p
  };
}
