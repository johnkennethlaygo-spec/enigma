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
    priceChange?: { h24?: number };
    fdv?: number;
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
    priceChange24hPct: Number(best.priceChange?.h24 || 0),
    fdvUsd: Number(best.fdv || 0)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

  const reasons = [
    `Kill-switch: ${killVerdict} (${killScore}/100)`,
    `Pattern score: ${patternScore.toFixed(2)}/100`,
    `Liquidity: $${liquidity.toLocaleString()}`,
    `Participation (vol/liquidity): ${(volume / Math.max(liquidity, 1)).toFixed(2)}`,
    `24h price change: ${change24h.toFixed(2)}%`,
    `Connected holders: ${Number(holderBehavior.connectedHolderPct || 0).toFixed(2)}%`,
    `New-wallet holders: ${Number(holderBehavior.newWalletHolderPct || 0).toFixed(2)}%`
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
