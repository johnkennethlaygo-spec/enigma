import type { AgentContext } from "../agent/schema.js";
import { killSwitch } from "../workflows/killSwitch.js";

interface DexScreenerTokenResponse {
  pairs?: Array<{
    dexId?: string;
    pairAddress?: string;
    url?: string;
    priceUsd?: string;
    liquidity?: { usd?: number };
    volume?: { h24?: number };
    priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
    fdv?: number;
    txns?: { h24?: { buys?: number; sells?: number } };
    chainId?: string;
    pairCreatedAt?: number;
    baseToken?: { address?: string; name?: string; symbol?: string };
    info?: { imageUrl?: string; header?: string; openGraph?: string };
  }>;
}

interface DexScreenerProfile {
  chainId?: string;
  tokenAddress?: string;
  icon?: string;
  header?: string;
}

export interface DiscoveryCandidate {
  mint: string;
  iconUrl?: string;
  headerUrl?: string;
}

async function fetchDiscoverySource(url: string): Promise<DexScreenerProfile[]> {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) return [];
    const json = (await response.json()) as DexScreenerProfile[];
    if (!Array.isArray(json)) return [];
    return json;
  } catch {
    return [];
  }
}

async function fetchMarketSnapshot(mint: string): Promise<Record<string, unknown>> {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${mint}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`DexScreener HTTP ${response.status}`);
  }

  const json = (await response.json()) as DexScreenerTokenResponse;
  const solPairs = (json.pairs || []).filter((pair) => pair.chainId === "solana");
  const best = solPairs.sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0))[0];

  if (!best) {
    throw new Error("No liquid Solana pair found");
  }

  return {
    source: "dexscreener",
    dexId: best.dexId || "unknown",
    pairAddress: best.pairAddress || "unknown",
    pairUrl: best.url || "",
    pairCreatedAt: Number(best.pairCreatedAt || 0),
    tokenAddress: String(best.baseToken?.address || mint),
    tokenName: String(best.baseToken?.name || "Unknown Token"),
    tokenSymbol: String(best.baseToken?.symbol || "N/A"),
    imageUrl: String(best.info?.imageUrl || best.info?.openGraph || ""),
    headerUrl: String(best.info?.header || ""),
    priceUsd: Number(best.priceUsd || 0),
    liquidityUsd: Number(best.liquidity?.usd || 0),
    volume24hUsd: Number(best.volume?.h24 || 0),
    buys24h: Number(best.txns?.h24?.buys || 0),
    sells24h: Number(best.txns?.h24?.sells || 0),
    priceChange5mPct: Number(best.priceChange?.m5 || 0),
    priceChange1hPct: Number(best.priceChange?.h1 || 0),
    priceChange6hPct: Number(best.priceChange?.h6 || 0),
    priceChange24hPct: Number(best.priceChange?.h24 || 0),
    fdvUsd: Number(best.fdv || 0)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toPrice(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number(value.toPrecision(8));
}

function buildMiniChart(price: number, changes: { m5: number; h1: number; h6: number; h24: number }) {
  if (!price || price <= 0) return { points: [], labels: ["24h", "6h", "1h", "5m", "now"] };

  const p24 = price / (1 + changes.h24 / 100 || 1);
  const p6 = price / (1 + changes.h6 / 100 || 1);
  const p1 = price / (1 + changes.h1 / 100 || 1);
  const p5 = price / (1 + changes.m5 / 100 || 1);
  return {
    points: [p24, p6, p1, p5, price].map((p) => Number(p.toPrecision(8))),
    labels: ["24h", "6h", "1h", "5m", "now"]
  };
}

export async function generateSignal(context: AgentContext, mint: string): Promise<Record<string, unknown>> {
  const [kill, snapshot] = await Promise.all([killSwitch(context, mint), fetchMarketSnapshot(mint)]);

  const killScore = Number(kill.data.score || 0);
  const killVerdict = String(kill.data.verdict || "BLOCK");
  const liquidity = Number(snapshot.liquidityUsd || 0);
  const volume = Number(snapshot.volume24hUsd || 0);
  const change24h = Number(snapshot.priceChange24hPct || 0);
  const holderBehavior =
    ((kill.data.risk as Record<string, unknown> | undefined)?.holderBehavior as Record<string, unknown>) ||
    {};

  const liquidityScore = clamp((liquidity / 250000) * 100, 0, 100);
  const participationScore = clamp((volume / Math.max(liquidity, 1)) * 100, 0, 100);
  const momentumScore = clamp(50 + change24h, 0, 100);
  const connectedPenalty = clamp(Number(holderBehavior.connectedHolderPct || 0) * 0.45, 0, 45);
  const newWalletPenalty = clamp(Number(holderBehavior.newWalletHolderPct || 0) * 0.3, 0, 30);
  const buys24h = Number(snapshot.buys24h || 0);
  const sells24h = Number(snapshot.sells24h || 0);
  const orderFlow = buys24h + sells24h > 0 ? buys24h / (buys24h + sells24h) : 0.5;

  let patternScore =
    killScore * 0.45 + liquidityScore * 0.2 + participationScore * 0.15 + momentumScore * 0.2;
  patternScore -= connectedPenalty + newWalletPenalty;
  patternScore = clamp(patternScore, 0, 100);

  let status: "FAVORABLE" | "CAUTION" | "HIGH_RISK" = "CAUTION";
  if (killVerdict === "BLOCK" || patternScore < 45) {
    status = "HIGH_RISK";
  } else if (patternScore >= 70 && killVerdict === "PASS") {
    status = "FAVORABLE";
  }

  const price = Number(snapshot.priceUsd || 0);
  const volShock = clamp(Math.abs(change24h) / 100, 0.03, 0.28);
  const support1 = toPrice(price * (1 - volShock * 0.75));
  const support2 = toPrice(price * (1 - volShock * 1.2));
  const resistance1 = toPrice(price * (1 + volShock * 0.9));
  const resistance2 = toPrice(price * (1 + volShock * 1.5));
  const entryLow = toPrice(price * (1 - volShock * 0.55));
  const entryHigh = toPrice(price * (1 - volShock * 0.2));
  const stopLoss = toPrice(support2 * 0.98);

  let sentimentLabel: "Bullish" | "Neutral" | "Bearish" = "Neutral";
  let sentimentScore = 50;
  sentimentScore += (orderFlow - 0.5) * 50;
  sentimentScore += change24h * 0.4;
  sentimentScore += (status === "FAVORABLE" ? 10 : status === "HIGH_RISK" ? -12 : 0);
  sentimentScore -= connectedPenalty * 0.35 + newWalletPenalty * 0.2;
  sentimentScore = clamp(sentimentScore, 0, 100);
  if (sentimentScore >= 62) sentimentLabel = "Bullish";
  else if (sentimentScore <= 38) sentimentLabel = "Bearish";
  const miniChart = buildMiniChart(price, {
    m5: Number(snapshot.priceChange5mPct || 0),
    h1: Number(snapshot.priceChange1hPct || 0),
    h6: Number(snapshot.priceChange6hPct || 0),
    h24: change24h
  });

  const reasons = [
    `Kill-switch: ${killVerdict} (${killScore}/100)`,
    `Pattern score: ${patternScore.toFixed(2)}/100`,
    `Liquidity: $${liquidity.toLocaleString()}`,
    `Participation (vol/liquidity): ${(volume / Math.max(liquidity, 1)).toFixed(2)}`,
    `24h price change: ${change24h.toFixed(2)}%`,
    `Connected holders: ${Number(holderBehavior.connectedHolderPct || 0).toFixed(2)}%`,
    `New-wallet holders: ${Number(holderBehavior.newWalletHolderPct || 0).toFixed(2)}%`,
    `Order flow (24h): buys ${buys24h}, sells ${sells24h}`
  ];

  return {
    mint,
    status,
    confidence: Number(clamp((patternScore / 100) * 0.9 + 0.1, 0.1, 0.98).toFixed(2)),
    patternScore: Number(patternScore.toFixed(2)),
    token: {
      mint: String(snapshot.tokenAddress || mint),
      symbol: String(snapshot.tokenSymbol || "N/A"),
      name: String(snapshot.tokenName || "Unknown Token"),
      imageUrl: String(snapshot.imageUrl || ""),
      headerUrl: String(snapshot.headerUrl || "")
    },
    killSwitch: kill.data,
    holderBehavior,
    market: snapshot,
    tradePlan: {
      recommendation:
        status === "FAVORABLE"
          ? "Potential entry candidate if price respects support and risk is controlled"
          : status === "CAUTION"
            ? "Watchlist candidate; wait for confirmation near support"
            : "Avoid entry until risk profile improves",
      buyZone: { low: entryLow, high: entryHigh },
      support: [support1, support2],
      resistance: [resistance1, resistance2],
      stopLoss,
      invalidation: `Breakdown below ${stopLoss || "N/A"} with weak order flow`
    },
    sentiment: {
      label: sentimentLabel,
      score: Number(sentimentScore.toFixed(2)),
      orderFlow: {
        buys24h,
        sells24h,
        buyRatio: Number(orderFlow.toFixed(3))
      },
      summary:
        sentimentLabel === "Bullish"
          ? "Buy pressure and momentum currently favor upside continuation."
          : sentimentLabel === "Bearish"
            ? "Sell pressure and risk behavior currently dominate."
            : "Mixed flow; wait for cleaner confirmation."
    },
    miniChart,
    links: {
      dexscreener: `https://dexscreener.com/solana/${String(snapshot.pairAddress || "")}`,
      birdeye: `https://birdeye.so/token/${mint}?chain=solana`,
      solscan: `https://solscan.io/token/${mint}`
    },
    methodology: {
      version: "enigma_scanner_v1",
      formula:
        "pattern = 0.45*kill + 0.20*liquidity + 0.15*participation + 0.20*momentum - connected_penalty - new_wallet_penalty",
      components: {
        killScore: Number(killScore.toFixed(2)),
        liquidityScore: Number(liquidityScore.toFixed(2)),
        participationScore: Number(participationScore.toFixed(2)),
        momentumScore: Number(momentumScore.toFixed(2)),
        connectedPenalty: Number(connectedPenalty.toFixed(2)),
        newWalletPenalty: Number(newWalletPenalty.toFixed(2))
      },
      mapping: {
        favorable: "pattern >= 70 and kill-switch PASS",
        caution: "pattern 45-69 or mixed risk",
        highRisk: "kill-switch BLOCK or pattern < 45"
      }
    },
    reasons,
    disclaimer: "Scanner output is probabilistic risk analysis, not financial advice."
  };
}

export async function discoverNewSolanaMints(max = 25): Promise<DiscoveryCandidate[]> {
  const [profiles, boostsLatest, boostsTop] = await Promise.all([
    fetchDiscoverySource("https://api.dexscreener.com/token-profiles/latest/v1"),
    fetchDiscoverySource("https://api.dexscreener.com/token-boosts/latest/v1"),
    fetchDiscoverySource("https://api.dexscreener.com/token-boosts/top/v1")
  ]);

  const combined = [...profiles, ...boostsLatest, ...boostsTop];
  const seen = new Set<string>();
  const tokens: DiscoveryCandidate[] = [];

  for (const item of combined) {
    if (item.chainId !== "solana" || !item.tokenAddress) continue;
    const mint = String(item.tokenAddress);
    if (seen.has(mint)) continue;
    seen.add(mint);
    tokens.push({
      mint,
      iconUrl: item.icon || "",
      headerUrl: item.header || ""
    });
    if (tokens.length >= max) break;
  }

  return tokens;
}
