import { fetchCandlesFromGeckoTerminal, supportedMarketTimeframes, type MarketTimeframe } from "./candles.js";
import { computeMarketRegimeFromCandles } from "./indicators/regime.js";

export interface TimeframeRegime {
  timeframe: MarketTimeframe;
  volatilityIndex: number | null;
  volatilityLabel: "Low" | "Medium" | "High" | "Unavailable";
  adx: number | null;
  adxLabel: "Sideways" | "Developing trend" | "Strong trend" | "Very strong trend" | "Unavailable";
  regime: "Trending & Expanding" | "Trending & Stable" | "Choppy & Volatile" | "Ranging & Quiet" | "Unavailable";
  strategyHint: string;
  sufficientData: boolean;
  candleCount: number;
  note?: string;
}

const MARKET_REGIME_CACHE_TTL_MS = Math.max(
  10_000,
  Number(process.env.ENIGMA_MARKET_REGIME_CACHE_TTL_SEC || 45) * 1000
);

const marketRegimeCache = new Map<
  string,
  {
    expiresAt: number;
    payload: BuildMarketRegimeOutput;
  }
>();

type BuildMarketRegimeOutput = {
  source: "geckoterminal";
  supportedTimeframes: MarketTimeframe[];
  preferredTimeframe: MarketTimeframe;
  current: TimeframeRegime;
  byTimeframe: Record<MarketTimeframe, TimeframeRegime>;
  computedAt: string;
};

function defaultUnavailable(timeframe: MarketTimeframe): TimeframeRegime {
  return {
    timeframe,
    volatilityIndex: null,
    volatilityLabel: "Unavailable",
    adx: null,
    adxLabel: "Unavailable",
    regime: "Unavailable",
    strategyHint: "Wait for sufficient data",
    sufficientData: false,
    candleCount: 0,
    note: "Insufficient candles"
  };
}

function choosePrimaryRegime(results: TimeframeRegime[], preferred: MarketTimeframe): TimeframeRegime {
  const preferredResult = results.find((entry) => entry.timeframe === preferred);
  if (preferredResult?.sufficientData) return preferredResult;

  const fallbackOrder: MarketTimeframe[] = ["1h", "15m", "5m", "4h", "1d"];
  for (const tf of fallbackOrder) {
    const candidate = results.find((entry) => entry.timeframe === tf);
    if (candidate?.sufficientData) return candidate;
  }

  return preferredResult || results[0] || defaultUnavailable(preferred);
}

export async function buildMarketRegime(input: {
  pairAddress: string;
  preferredTimeframe?: MarketTimeframe;
  limit?: number;
  includeAllTimeframes?: boolean;
}): Promise<BuildMarketRegimeOutput> {
  const pairAddress = String(input.pairAddress || "").trim();
  const preferred = input.preferredTimeframe || "1h";
  const allTimeframes = supportedMarketTimeframes();
  const includeAllTimeframes = Boolean(input.includeAllTimeframes);
  const timeframes = includeAllTimeframes ? allTimeframes : [preferred];
  const limit = input.limit || 240;

  const cacheKey = `${pairAddress}::${preferred}::${includeAllTimeframes ? "all" : "single"}::${limit}`;
  const now = Date.now();
  const cached = marketRegimeCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.payload;
  }

  if (!pairAddress) {
    const empty = allTimeframes.reduce(
      (acc, timeframe) => {
        acc[timeframe] = defaultUnavailable(timeframe);
        return acc;
      },
      {} as Record<MarketTimeframe, TimeframeRegime>
    );

    return {
      source: "geckoterminal",
      supportedTimeframes: allTimeframes,
      preferredTimeframe: preferred,
      current: empty[preferred],
      byTimeframe: empty,
      computedAt: new Date().toISOString()
    };
  }

  const results = await Promise.all(
    timeframes.map(async (timeframe) => {
      const candles = await fetchCandlesFromGeckoTerminal({
        pairAddress,
        timeframe,
        limit
      });

      const regime = computeMarketRegimeFromCandles({
        candles,
        atrPeriod: 14,
        adxPeriod: 14,
        volatilityWindow: 200
      });

      const output: TimeframeRegime = {
        timeframe,
        volatilityIndex: regime.volatilityIndex,
        volatilityLabel: regime.volatilityLabel,
        adx: regime.adx,
        adxLabel: regime.adxLabel,
        regime: regime.regime,
        strategyHint: regime.strategyHint,
        sufficientData: regime.sufficientData,
        candleCount: candles.length,
        note: regime.note
      };
      return output;
    })
  );

  const byTimeframe = results.reduce(
    (acc, entry) => {
      acc[entry.timeframe] = entry;
      return acc;
    },
    allTimeframes.reduce(
      (base, timeframe) => {
        base[timeframe] = defaultUnavailable(timeframe);
        return base;
      },
      {} as Record<MarketTimeframe, TimeframeRegime>
    )
  );

  const payload: BuildMarketRegimeOutput = {
    source: "geckoterminal",
    supportedTimeframes: allTimeframes,
    preferredTimeframe: preferred,
    current: choosePrimaryRegime(results, preferred),
    byTimeframe,
    computedAt: new Date().toISOString()
  };

  marketRegimeCache.set(cacheKey, {
    expiresAt: now + MARKET_REGIME_CACHE_TTL_MS,
    payload
  });

  return payload;
}
