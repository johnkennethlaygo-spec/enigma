interface RpcResult<T> {
  result?: T;
  error?: { code: number; message: string };
}

interface TokenLargestAccount {
  amount: string;
  address: string;
  uiAmountString?: string;
}

interface HolderNode {
  tokenAccount: string;
  owner: string;
  amountRaw: number;
  amountUi: number;
  walletAgeDays: number | null;
  recentSignatures: string[];
}

type RpcCaller = <T>(method: string, params: unknown[]) => Promise<T>;

const DEFAULT_RPC_TIMEOUT_MS = Number(process.env.ENIGMA_RPC_TIMEOUT_MS || 12_000);
const DEFAULT_RPC_ATTEMPTS = Math.max(1, Number(process.env.ENIGMA_RPC_RETRY_ATTEMPTS || 3));
const DEFAULT_CACHE_TTL_MS = Math.max(5_000, Number(process.env.ENIGMA_ONCHAIN_CACHE_TTL_SEC || 60) * 1000);
const FAILURE_CACHE_TTL_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function buildRpcUrls(primaryRpcUrl?: string): string[] {
  const configuredFallbacks = String(process.env.SOLANA_RPC_FALLBACK_URLS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const urls = unique([
    primaryRpcUrl || "",
    ...configuredFallbacks,
    "https://api.mainnet-beta.solana.com"
  ]);

  return urls;
}

function isRetryableRpcError(error: unknown): boolean {
  const message = String((error as Error)?.message || "");
  if (/RPC HTTP (429|408|500|502|503|504)/.test(message)) return true;
  if (/RPC error -32005/.test(message)) return true;
  if (/timeout|aborted|network/i.test(message)) return true;
  return false;
}

async function rpcCallOnce<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_RPC_TIMEOUT_MS);

  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal
    });

    if (!res.ok) {
      throw new Error(`RPC HTTP ${res.status}`);
    }

    const json = (await res.json()) as RpcResult<T>;
    if (json.error) {
      throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
    }
    if (json.result === undefined) {
      throw new Error("RPC missing result");
    }

    return json.result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`RPC call failed (${method}) at ${rpcUrl}: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function createRpcCaller(primaryRpcUrl?: string): { call: RpcCaller; urls: string[] } {
  const urls = buildRpcUrls(primaryRpcUrl);

  const call: RpcCaller = async <T>(method: string, params: unknown[]): Promise<T> => {
    if (urls.length === 0) {
      throw new Error("No RPC URL configured");
    }

    let lastError: Error | null = null;

    for (const rpcUrl of urls) {
      for (let attempt = 0; attempt < DEFAULT_RPC_ATTEMPTS; attempt += 1) {
        try {
          return await rpcCallOnce<T>(rpcUrl, method, params);
        } catch (error) {
          const casted = error as Error;
          lastError = casted;
          const retryable = isRetryableRpcError(casted);
          const hasMoreAttempts = attempt < DEFAULT_RPC_ATTEMPTS - 1;
          if (!retryable || !hasMoreAttempts) break;

          const backoffMs = 250 * 2 ** attempt + Math.floor(Math.random() * 120);
          await sleep(backoffMs);
        }
      }
    }

    throw new Error(
      `All RPC endpoints failed for ${method}${lastError ? `: ${lastError.message}` : ""}`
    );
  };

  return { call, urls };
}

function pct(part: number, total: number): number {
  if (!total) return 0;
  return (part / total) * 100;
}

function signaturesOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  return b.some((sig) => set.has(sig));
}

function connectedGroups(holders: HolderNode[]): HolderNode[][] {
  const visited = new Set<number>();
  const groups: HolderNode[][] = [];

  for (let i = 0; i < holders.length; i += 1) {
    if (visited.has(i)) continue;
    const queue = [i];
    visited.add(i);
    const group: HolderNode[] = [];

    while (queue.length > 0) {
      const idx = queue.shift() as number;
      const current = holders[idx];
      group.push(current);

      for (let j = 0; j < holders.length; j += 1) {
        if (visited.has(j)) continue;
        if (signaturesOverlap(current.recentSignatures, holders[j].recentSignatures)) {
          visited.add(j);
          queue.push(j);
        }
      }
    }

    groups.push(group);
  }

  return groups;
}

function avg(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null);
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

async function loadOwners(callRpc: RpcCaller, tokenAccounts: string[]): Promise<Record<string, string>> {
  if (tokenAccounts.length === 0) return {};

  const response = await callRpc<{
    value: Array<
      | {
          data?: {
            parsed?: {
              info?: { owner?: string };
            };
          };
        }
      | null
    >;
  }>("getMultipleAccounts", [tokenAccounts, { encoding: "jsonParsed" }]);

  const output: Record<string, string> = {};
  response.value.forEach((value, index) => {
    const owner = value?.data?.parsed?.info?.owner;
    if (owner) {
      output[tokenAccounts[index]] = owner;
    }
  });
  return output;
}

async function walletAgeDays(callRpc: RpcCaller, owner: string): Promise<number | null> {
  try {
    const signatures = await callRpc<Array<{ signature: string; blockTime?: number | null }>>(
      "getSignaturesForAddress",
      [owner, { limit: 25 }]
    );

    const times = signatures
      .map((sig) => sig.blockTime || null)
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);

    if (times.length === 0) return null;

    const oldest = times[0] * 1000;
    return Math.max(0, (Date.now() - oldest) / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

async function tokenAccountRecentSignatures(
  callRpc: RpcCaller,
  tokenAccount: string
): Promise<string[]> {
  try {
    const signatures = await callRpc<Array<{ signature: string }>>("getSignaturesForAddress", [
      tokenAccount,
      { limit: 20 }
    ]);
    return signatures.map((sig) => sig.signature).filter(Boolean);
  } catch {
    return [];
  }
}

export function createOnchainTool(rpcUrl?: string) {
  const rpc = createRpcCaller(rpcUrl);
  const primaryRpc = rpc.urls[0];
  const riskCache = new Map<string, { expiresAt: number; data: Record<string, unknown> }>();

  return {
    async riskSignals(mint: string): Promise<Record<string, unknown>> {
      if (!primaryRpc) {
        return {
          mint,
          concentrationRisk: "unknown",
          suspiciousPatterns: [],
          note: "Missing SOLANA_RPC_URL/HELIUS_API_KEY; returning placeholder signals."
        };
      }

      const cacheKey = mint.trim();
      const now = Date.now();
      const cached = riskCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        return cached.data;
      }

      try {
        const [largestAccounts, supply, mintAccountInfo] = await Promise.all([
          rpc.call<{ value: TokenLargestAccount[] }>("getTokenLargestAccounts", [mint]),
          rpc.call<{ value: { amount: string; decimals: number; uiAmount: number | null } }>(
            "getTokenSupply",
            [mint]
          ),
          rpc.call<{
            value: {
              data?: {
                parsed?: {
                  info?: {
                    mintAuthority?: string | null;
                    freezeAuthority?: string | null;
                  };
                };
              };
            } | null;
          }>("getAccountInfo", [mint, { encoding: "jsonParsed" }])
        ]);

        const mintInfo = mintAccountInfo.value?.data?.parsed?.info;
        const mintAuthority = mintInfo?.mintAuthority || null;
        const freezeAuthority = mintInfo?.freezeAuthority || null;
        const hasMintAuthority = Boolean(mintAuthority);
        const hasFreezeAuthority = Boolean(freezeAuthority);

        const riskFlags: string[] = [];
        if (hasMintAuthority) riskFlags.push("Mint authority is active (token supply can potentially expand)");
        if (hasFreezeAuthority)
          riskFlags.push("Freeze authority is active (accounts can potentially be frozen)");

        const totalSupply = Number(supply.value.amount || 0);
        const top3 = largestAccounts.value.slice(0, 3);
        const topRaw = top3.reduce((sum, holder) => sum + Number(holder.amount || 0), 0);
        const top3Pct = pct(topRaw, totalSupply);

        let concentrationRisk = "low";
        if (top3Pct >= 50) concentrationRisk = "high";
        else if (top3Pct >= 25) concentrationRisk = "medium";
        if (top3Pct >= 50) riskFlags.push("Top-3 holder concentration is elevated");

        const analyzed = largestAccounts.value.slice(0, 8);
        const tokenAccounts = analyzed.map((holder) => holder.address);
        const ownersByTokenAccount = await loadOwners(rpc.call, tokenAccounts);

        const holderNodes: HolderNode[] = await Promise.all(
          analyzed.map(async (holder) => {
            const owner = ownersByTokenAccount[holder.address] || holder.address;
            const signatures = await tokenAccountRecentSignatures(rpc.call, holder.address);
            const age = await walletAgeDays(rpc.call, owner);
            return {
              tokenAccount: holder.address,
              owner,
              amountRaw: Number(holder.amount || 0),
              amountUi: Number(holder.uiAmountString || 0),
              walletAgeDays: age,
              recentSignatures: signatures
            };
          })
        );

        const freshHolders = holderNodes.filter(
          (holder) => holder.walletAgeDays !== null && holder.walletAgeDays <= 14
        );
        const freshRaw = freshHolders.reduce((sum, holder) => sum + holder.amountRaw, 0);

        const groups = connectedGroups(holderNodes).filter((group) => group.length >= 2);
        const connectedAccounts = groups.flat();
        const connectedRaw = connectedAccounts.reduce((sum, holder) => sum + holder.amountRaw, 0);

        const holderBehavior = {
          analyzedTopAccounts: holderNodes.length,
          avgWalletAgeDays: avg(holderNodes.map((holder) => holder.walletAgeDays)),
          newWalletCount: freshHolders.length,
          newWalletHolderPct: Number(pct(freshRaw, totalSupply).toFixed(2)),
          connectedGroupCount: groups.length,
          connectedHolderPct: Number(pct(connectedRaw, totalSupply).toFixed(2)),
          connectedGroups: groups.map((group, idx) => ({
            id: idx + 1,
            holderCount: group.length,
            holdPct: Number(
              pct(
                group.reduce((sum, holder) => sum + holder.amountRaw, 0),
                totalSupply
              ).toFixed(2)
            ),
            owners: group.map((holder) => holder.owner)
          }))
        };

        if (holderBehavior.newWalletHolderPct >= 20) {
          riskFlags.push("High share held by recently observed wallets");
        }
        if (holderBehavior.connectedHolderPct >= 25) {
          riskFlags.push("Connected holder cluster controls significant supply");
        }

        const result = {
          mint,
          concentrationRisk,
          suspiciousPatterns: riskFlags,
          top3HolderSharePct: Number(top3Pct.toFixed(2)),
          totalSupplyRaw: totalSupply,
          hasMintAuthority,
          hasFreezeAuthority,
          mintAuthority,
          freezeAuthority,
          holderBehavior,
          sampleTopHolders: largestAccounts.value.slice(0, 8)
        };

        riskCache.set(cacheKey, { expiresAt: now + DEFAULT_CACHE_TTL_MS, data: result });
        return result;
      } catch (error) {
        const fallback = {
          mint,
          concentrationRisk: "unknown",
          suspiciousPatterns: [],
          note: `Risk check failed: ${(error as Error).message}`
        };
        riskCache.set(cacheKey, { expiresAt: now + FAILURE_CACHE_TTL_MS, data: fallback });
        return fallback;
      }
    },

    async killSwitchScore(mint: string): Promise<Record<string, unknown>> {
      const risk = await this.riskSignals(mint);

      if (risk.concentrationRisk === "unknown") {
        return {
          mint,
          score: 0,
          verdict: "BLOCK",
          reasons: ["Unable to complete on-chain checks"],
          uncertainty: "high",
          risk
        };
      }

      const top3Pct = Number(risk.top3HolderSharePct || 0);
      const hasMintAuthority = Boolean(risk.hasMintAuthority);
      const hasFreezeAuthority = Boolean(risk.hasFreezeAuthority);
      const holderBehavior = (risk.holderBehavior as Record<string, unknown>) || {};
      const connectedPct = Number(holderBehavior.connectedHolderPct || 0);
      const newWalletPct = Number(holderBehavior.newWalletHolderPct || 0);

      const reasons: string[] = [];
      let score = 100;

      if (top3Pct >= 60) {
        score -= 40;
        reasons.push("Top-3 holders control >=60% supply");
      } else if (top3Pct >= 35) {
        score -= 20;
        reasons.push("Top-3 holders control >=35% supply");
      } else if (top3Pct >= 20) {
        score -= 10;
        reasons.push("Top-3 holder concentration is non-trivial");
      } else {
        reasons.push("Holder concentration appears relatively distributed");
      }

      if (connectedPct >= 35) {
        score -= 20;
        reasons.push("Connected holder cluster >=35% of supply");
      } else if (connectedPct >= 20) {
        score -= 12;
        reasons.push("Connected holder cluster >=20% of supply");
      }

      if (newWalletPct >= 25) {
        score -= 15;
        reasons.push("Large share held by recently observed wallets");
      } else if (newWalletPct >= 12) {
        score -= 8;
        reasons.push("Notable share held by new wallets");
      }

      if (hasMintAuthority) {
        score -= 25;
        reasons.push("Mint authority is enabled");
      } else {
        reasons.push("Mint authority appears revoked");
      }

      if (hasFreezeAuthority) {
        score -= 20;
        reasons.push("Freeze authority is enabled");
      } else {
        reasons.push("Freeze authority appears revoked");
      }

      score = Math.max(0, Math.min(100, score));

      let verdict = "PASS";
      if (score < 50) verdict = "BLOCK";
      else if (score < 75) verdict = "CAUTION";

      return {
        mint,
        score,
        verdict,
        reasons,
        uncertainty: "medium",
        risk
      };
    },

    async rpcHealth(): Promise<Record<string, unknown>> {
      if (!primaryRpc) {
        return { ok: false, message: "Missing SOLANA_RPC_URL/HELIUS_API_KEY" };
      }

      try {
        const version = await rpc.call<{ "solana-core": string }>("getVersion", []);
        return {
          ok: true,
          version,
          rpc: primaryRpc,
          fallbackCount: Math.max(0, rpc.urls.length - 1)
        };
      } catch (error) {
        return { ok: false, message: (error as Error).message, rpc: primaryRpc };
      }
    }
  };
}
