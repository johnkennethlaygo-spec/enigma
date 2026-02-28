import test from "node:test";
import assert from "node:assert/strict";

import { computeAtrSeries } from "../src/server/indicators/atr.js";
import { computeAdxFromCandles } from "../src/server/indicators/adx.js";
import { percentileRank, computeVolatilityIndexFromCandles } from "../src/server/indicators/volatility.js";
import { computeMarketRegimeFromCandles } from "../src/server/indicators/regime.js";
import { buildMarketRegimeViewModel } from "../src/public/marketRegimeView.js";
import type { Candle } from "../src/server/indicators/types.js";

function constantRangeCandles(count: number): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i += 1) {
    const open = 100 + i;
    candles.push({
      ts: 1_700_000_000 + i * 60,
      open,
      high: open + 5,
      low: open - 5,
      close: open,
      volume: 1000 + i
    });
  }
  return candles;
}

function trendingExpandingCandles(count: number): Candle[] {
  const candles: Candle[] = [];
  let prevClose = 100;
  for (let i = 0; i < count; i += 1) {
    const range = 0.6 + i * 0.03;
    const open = prevClose + 0.35;
    const high = open + range;
    const low = open - range * 0.7;
    const close = open + range * 0.6;
    candles.push({
      ts: 1_700_000_000 + i * 300,
      open,
      high,
      low,
      close,
      volume: 10_000 + i * 20
    });
    prevClose = close;
  }
  return candles;
}

function rangingQuietCandles(count: number): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i += 1) {
    const center = 100 + Math.sin(i / 3) * 0.15;
    const open = center + (i % 2 === 0 ? 0.03 : -0.03);
    const high = center + 0.22;
    const low = center - 0.22;
    const close = center + (i % 2 === 0 ? -0.02 : 0.02);
    candles.push({
      ts: 1_700_000_000 + i * 300,
      open,
      high,
      low,
      close,
      volume: 5_000 + (i % 9) * 50
    });
  }
  return candles;
}

test("ATR(14) stays stable for constant true-range candles", () => {
  const candles = constantRangeCandles(60);
  const atr = computeAtrSeries(candles, 14);
  assert.ok(atr.length > 0);
  for (const value of atr.slice(-10)) {
    assert.ok(Math.abs(value - 10) < 1e-9);
  }
});

test("percentileRank returns deterministic percentile values", () => {
  assert.equal(percentileRank(3, [1, 2, 3, 4, 5]), 0.5);
  assert.equal(percentileRank(1, [1, 2, 3, 4, 5]), 0.1);
  assert.equal(percentileRank(5, [1, 2, 3, 4, 5]), 0.9);
});

test("ADX(14) detects strong trend in directional candles", () => {
  const candles = trendingExpandingCandles(120);
  const adx = computeAdxFromCandles(candles, 14);
  assert.equal(adx.sufficientData, true);
  assert.ok((adx.adx || 0) >= 25);
  assert.ok(["Strong trend", "Very strong trend"].includes(String(adx.label)));
});

test("Volatility index uses ATR percentile and returns bounded score", () => {
  const candles = trendingExpandingCandles(260);
  const vol = computeVolatilityIndexFromCandles({ candles, atrPeriod: 14, percentileWindow: 200 });
  assert.equal(vol.sufficientData, true);
  assert.ok((vol.index || 0) >= 0 && (vol.index || 0) <= 100);
});

test("Regime + UI view-model show Trending & Expanding on synthetic trending/expanding candles", () => {
  const candles = trendingExpandingCandles(260);
  const regime = computeMarketRegimeFromCandles({ candles, adxPeriod: 14, atrPeriod: 14, volatilityWindow: 200 });
  assert.equal(regime.regime, "Trending & Expanding");

  const ui = buildMarketRegimeViewModel({
    current: {
      timeframe: "1h",
      regime: regime.regime,
      strategyHint: regime.strategyHint,
      volatilityIndex: regime.volatilityIndex,
      volatilityLabel: regime.volatilityLabel,
      adx: regime.adx,
      adxLabel: regime.adxLabel,
      sufficientData: regime.sufficientData
    }
  });

  assert.equal(ui.regime, "Trending & Expanding");
  assert.equal(ui.tone, "good");
});

test("Regime + UI view-model show Ranging & Quiet on synthetic ranging/quiet candles", () => {
  const candles = rangingQuietCandles(260);
  const regime = computeMarketRegimeFromCandles({ candles, adxPeriod: 14, atrPeriod: 14, volatilityWindow: 200 });
  assert.equal(regime.regime, "Ranging & Quiet");

  const ui = buildMarketRegimeViewModel({
    current: {
      timeframe: "1h",
      regime: regime.regime,
      strategyHint: regime.strategyHint,
      volatilityIndex: regime.volatilityIndex,
      volatilityLabel: regime.volatilityLabel,
      adx: regime.adx,
      adxLabel: regime.adxLabel,
      sufficientData: regime.sufficientData
    }
  });

  assert.equal(ui.regime, "Ranging & Quiet");
  assert.equal(ui.tone, "warn");
});

test("UI view-model keeps null volatility/adx as N/A (not 0.00)", () => {
  const ui = buildMarketRegimeViewModel({
    current: {
      timeframe: "1h",
      regime: "Unavailable",
      strategyHint: "Wait for sufficient data",
      volatilityIndex: null,
      volatilityLabel: "Unavailable",
      adx: null,
      adxLabel: "Unavailable",
      sufficientData: false
    }
  });

  assert.equal(ui.volatilityText, "N/A");
  assert.equal(ui.adxText, "N/A");
  assert.equal(ui.regime, "Unavailable");
});
