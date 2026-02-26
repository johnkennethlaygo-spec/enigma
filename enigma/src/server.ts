import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnigmaContext } from "./agent/enigma.js";
import {
  authRequired,
  enforceQuota,
  generateNonce,
  hydrateUser,
  issueToken,
  type AuthedRequest,
  verifyWalletSignature
} from "./server/auth.js";
import {
  adjustUserManagedBalance,
  closeAutoTradePosition,
  createAutoTradePosition,
  createWithdrawalRequest,
  consumeNonce,
  getPremiumPaymentBySignature,
  getUserManagedBalance,
  getUserByWallet,
  getAutoTradeConfig,
  getAutoTradeExecutionConfig,
  getAutoTradePerformance,
  getDashboardStats,
  getWithdrawalRequestById,
  getWatchlist,
  incrementUsage,
  listPremiumPaymentsByUser,
  listAutoTradePositions,
  listWithdrawalRequests,
  putAutoTradeConfig,
  putAutoTradeExecutionConfig,
  putNonce,
  resolveForecast,
  savePremiumPayment,
  setUserManagedBalance,
  setUserPlanByWallet,
  saveAutoTradeRun,
  saveSignal,
  setWatchlist,
  updateWithdrawalRequestStatus,
  updateAutoTradePositionMark
} from "./server/db.js";
import { discoverNewSolanaMints, generateSignal } from "./server/signalEngine.js";
import { executeSolTransfer, executeUltraBuy, executeUltraSell } from "./server/jupiterExecutor.js";

function validateRuntimeConfig(): { mode: string; hasRpc: boolean } {
  const mode = String(process.env.NODE_ENV || "development");
  const hasRpc = Boolean(String(process.env.HELIUS_API_KEY || "").trim()) ||
    Boolean(String(process.env.SOLANA_RPC_URL || "").trim());

  if (!hasRpc && mode === "production") {
    throw new Error("Production requires HELIUS_API_KEY or SOLANA_RPC_URL.");
  }

  if (!hasRpc) {
    console.warn("[config] HELIUS_API_KEY/SOLANA_RPC_URL missing. RPC checks may fail.");
  }

  return { mode, hasRpc };
}

const runtimeConfig = validateRuntimeConfig();
const PREMIUM_TELEGRAM = String(process.env.ENIGMA_PREMIUM_TELEGRAM || "@FULSEN_SUPPORT").trim();
const ADMIN_TOKEN = String(process.env.ENIGMA_ADMIN_TOKEN || "").trim();
const PREMIUM_SOL_ADDRESS = String(
  process.env.ENIGMA_PREMIUM_SOL_ADDRESS || "ZEe2kStwjE8SNs61Vcrdmn63JHxrKAEswNg5Nex3sVe"
).trim();
const PREMIUM_TIER_LAMPORTS: Record<string, number> = {
  pro1: Number(process.env.ENIGMA_PRO1_LAMPORTS || 500000000),
  pro2: Number(process.env.ENIGMA_PRO2_LAMPORTS || 2500000000),
  pro3: Number(process.env.ENIGMA_PRO3_LAMPORTS || 5000000000),
  pro4: Number(process.env.ENIGMA_PRO4_LAMPORTS || 25000000000)
};
const app = express();
app.set("trust proxy", 1);
const startPort = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const sourceDir = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(sourceDir, "public");

app.use(express.json());
app.use(express.static(publicDir));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too many requests; slow down" }
});

app.use("/api", apiLimiter);

interface AutoTradeDecision {
  mint: string;
  decision: "BUY_CANDIDATE" | "SKIP";
  reasons: string[];
  signalId?: number;
  signalStatus?: string;
  patternScore?: number;
  confidence?: number;
  tradePlan?: Record<string, unknown>;
  entryPriceUsd?: number;
}

function premiumRequiredResponse() {
  return {
    error: "live execution is premium-only",
    premiumRequired: true,
    telegram: PREMIUM_TELEGRAM,
    note: "Contact Telegram to upgrade your account to PRO for real transactions."
  };
}

function requireAdminToken(req: express.Request, res: express.Response): boolean {
  if (!ADMIN_TOKEN) {
    res.status(503).json({ error: "admin token is not configured" });
    return false;
  }

  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token || token !== ADMIN_TOKEN) {
    res.status(401).json({ error: "invalid admin token" });
    return false;
  }

  return true;
}

const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "FULSEN Enigma API",
    version: "1.0.0",
    description: "Trader risk-intelligence API for scan, watchlist, discovery, and holder behavior."
  },
  servers: [{ url: "/" }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT"
      }
    }
  },
  paths: {
    "/api/health": {
      get: {
        summary: "Health check",
        responses: { "200": { description: "Service health" } }
      }
    },
    "/api/auth/nonce": {
      post: {
        summary: "Create login nonce",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["wallet"], properties: { wallet: { type: "string" } } }
            }
          }
        },
        responses: { "200": { description: "Nonce created" } }
      }
    },
    "/api/auth/verify": {
      post: {
        summary: "Verify wallet signature and issue JWT",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["wallet", "nonce", "signature"],
                properties: { wallet: { type: "string" }, nonce: { type: "string" }, signature: { type: "string" } }
              }
            }
          }
        },
        responses: { "200": { description: "JWT and user profile" } }
      }
    },
    "/api/admin/users/plan": {
      post: {
        summary: "Admin plan update (free/pro) by wallet",
        parameters: [{ in: "header", name: "x-admin-token", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["wallet", "plan"],
                properties: {
                  wallet: { type: "string" },
                  plan: { type: "string", enum: ["free", "pro"] }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Updated user plan" } }
      }
    },
    "/api/admin/users/balance": {
      post: {
        summary: "Admin set user managed balance",
        parameters: [{ in: "header", name: "x-admin-token", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["wallet", "lamports"],
                properties: {
                  wallet: { type: "string" },
                  lamports: { type: "number" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Updated managed balance" } }
      }
    },
    "/api/admin/withdrawals": {
      get: {
        summary: "Admin list withdrawal requests",
        parameters: [
          { in: "header", name: "x-admin-token", required: true, schema: { type: "string" } },
          {
            in: "query",
            name: "status",
            required: false,
            schema: { type: "string", enum: ["pending", "approved", "rejected"] }
          },
          { in: "query", name: "limit", required: false, schema: { type: "number" } }
        ],
        responses: { "200": { description: "Withdrawal request list" } }
      }
    },
    "/api/admin/withdrawals/{id}/approve": {
      post: {
        summary: "Admin approve withdrawal request",
        parameters: [
          { in: "header", name: "x-admin-token", required: true, schema: { type: "string" } },
          { in: "path", name: "id", required: true, schema: { type: "number" } }
        ],
        responses: { "200": { description: "Approved withdrawal request" } }
      }
    },
    "/api/admin/withdrawals/{id}/reject": {
      post: {
        summary: "Admin reject withdrawal request",
        parameters: [
          { in: "header", name: "x-admin-token", required: true, schema: { type: "string" } },
          { in: "path", name: "id", required: true, schema: { type: "number" } }
        ],
        responses: { "200": { description: "Rejected withdrawal request" } }
      }
    },
    "/api/premium/info": {
      get: {
        summary: "Get premium payment address and tiers",
        responses: { "200": { description: "Premium payment instructions" } }
      }
    },
    "/api/premium/verify-payment": {
      post: {
        summary: "Verify on-chain premium payment and auto-upgrade to pro",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["tier", "txSignature"],
                properties: {
                  tier: { type: "string", enum: ["pro1", "pro2", "pro3", "pro4"] },
                  txSignature: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Verification result and plan update" } }
      }
    },
    "/api/profile/overview": {
      get: {
        summary: "Get profile overview (plan, stats, managed balance)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Profile overview" } }
      }
    },
    "/api/profile/history": {
      get: {
        summary: "Get profile history (payments, positions, withdrawals)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Profile history" } }
      }
    },
    "/api/withdrawals/me": {
      get: {
        summary: "Get current user withdrawals and managed balance",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "User withdrawals and balance" } }
      }
    },
    "/api/withdrawals/request": {
      post: {
        summary: "Submit withdrawal request",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["lamports"],
                properties: {
                  destinationWallet: { type: "string" },
                  lamports: { type: "number" },
                  note: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Withdrawal request created" } }
      }
    },
    "/api/watchlist": {
      get: {
        summary: "Get watchlist",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Watchlist mints" } }
      },
      put: {
        summary: "Set watchlist",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["mints"], properties: { mints: { type: "string" } } }
            }
          }
        },
        responses: { "200": { description: "Updated watchlist" } }
      }
    },
    "/api/signal": {
      post: {
        summary: "Scan single mint",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["mint"], properties: { mint: { type: "string" } } }
            }
          }
        },
        responses: { "200": { description: "Signal payload" } }
      }
    },
    "/api/watchlist/scan": {
      post: {
        summary: "Scan saved watchlist",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Batch signal payload" } }
      }
    },
    "/api/signals/stream": {
      post: {
        summary: "Scan custom mint set",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["mints"], properties: { mints: { type: "string" } } }
            }
          }
        },
        responses: { "200": { description: "Batch signal payload" } }
      }
    },
    "/api/discovery/suggest": {
      post: {
        summary: "Discovery candidates",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { type: "object", properties: { limit: { type: "number" } } }
            }
          }
        },
        responses: { "200": { description: "Discovery signals" } }
      }
    },
    "/api/token/holders": {
      get: {
        summary: "Holder behavior table",
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: "query", name: "mint", required: true, schema: { type: "string" } },
          { in: "query", name: "limit", required: false, schema: { type: "number" } }
        ],
        responses: { "200": { description: "Holder profiles and behavior" } }
      }
    },
    "/api/dashboard/stats": {
      get: {
        summary: "Dashboard stats",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Usage and performance stats" } }
      }
    },
    "/api/autotrade/config": {
      get: {
        summary: "Get autotrade policy config",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Autotrade config" } }
      },
      put: {
        summary: "Set autotrade policy config",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  enabled: { type: "boolean" },
                  mode: { type: "string", enum: ["paper", "live"] },
                  minPatternScore: { type: "number" },
                  minConfidence: { type: "number" },
                  maxConnectedHolderPct: { type: "number" },
                  requireKillSwitchPass: { type: "boolean" },
                  maxPositionUsd: { type: "number" },
                  scanIntervalSec: { type: "number" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Updated config" } }
      }
    },
    "/api/autotrade/run": {
      post: {
        summary: "Run autotrade policy against watchlist or provided mints",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { type: "object", properties: { mints: { type: "string" } } }
            }
          }
        },
        responses: { "200": { description: "Autotrade run decisions" } }
      }
    },
    "/api/autotrade/performance": {
      get: {
        summary: "Get persistent paper/live autotrade run analytics",
        security: [{ bearerAuth: [] }],
        parameters: [{ in: "query", name: "limit", required: false, schema: { type: "number" } }],
        responses: { "200": { description: "Autotrade performance summary and run history" } }
      }
    },
    "/api/autotrade/execution-config": {
      get: {
        summary: "Get autotrade execution engine config",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Execution config" } }
      },
      put: {
        summary: "Set autotrade execution engine config",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  enabled: { type: "boolean" },
                  mode: { type: "string", enum: ["paper", "live"] },
                  tradeAmountUsd: { type: "number" },
                  maxOpenPositions: { type: "number" },
                  tpPct: { type: "number" },
                  slPct: { type: "number" },
                  trailingStopPct: { type: "number" },
                  maxHoldMinutes: { type: "number" },
                  cooldownSec: { type: "number" },
                  pollIntervalSec: { type: "number" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Updated execution config" } }
      }
    },
    "/api/autotrade/positions": {
      get: {
        summary: "List autotrade positions",
        security: [{ bearerAuth: [] }],
        parameters: [{ in: "query", name: "status", required: false, schema: { type: "string" } }],
        responses: { "200": { description: "Current and historical positions" } }
      }
    },
    "/api/autotrade/engine/tick": {
      post: {
        summary: "Run one auto-execution engine tick (open and close positions)",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { type: "object", properties: { mints: { type: "string" } } }
            }
          }
        },
        responses: { "200": { description: "Engine actions and position updates" } }
      }
    }
  }
};

app.get("/api/openapi.json", (_req, res) => {
  res.json(openApiSpec);
});

function parseMintsCsv(input: string, max = 5): string[] {
  return Array.from(
    new Set(
      input
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).slice(0, max);
}

function isValidSolanaMint(mint: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint.trim());
}

function validateMints(mints: string[]): string[] {
  return mints.filter((mint) => isValidSolanaMint(mint));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getEffectiveTradeAmountUsd(
  policy: ReturnType<typeof getAutoTradeConfig>,
  execCfg: ReturnType<typeof getAutoTradeExecutionConfig>
): number {
  const policyCap = Number(policy.maxPositionUsd || 0);
  const execAmount = Number(execCfg.tradeAmountUsd || 0);
  if (policyCap > 0 && execAmount > 0) {
    return Number(Math.min(policyCap, execAmount).toFixed(2));
  }
  if (policyCap > 0) return Number(policyCap.toFixed(2));
  return Number(Math.max(1, execAmount).toFixed(2));
}

function getEffectiveMode(
  policy: ReturnType<typeof getAutoTradeConfig>,
  execCfg: ReturnType<typeof getAutoTradeExecutionConfig>,
  userPlan: string
): { mode: "paper" | "live"; warnings: string[] } {
  const warnings: string[] = [];
  if (policy.mode !== execCfg.mode) {
    warnings.push(
      `mode mismatch: policy=${policy.mode}, execution=${execCfg.mode}; using paper until both match`
    );
  }

  if (execCfg.mode === "live" && userPlan !== "pro") {
    warnings.push("live mode requires premium plan");
  }

  if (policy.mode === "live" && execCfg.mode === "live" && userPlan === "pro") {
    return { mode: "live", warnings };
  }

  return { mode: "paper", warnings };
}

function buildAutoTradeDecision(input: {
  mint: string;
  signalId: number;
  signal: Record<string, unknown>;
  config: ReturnType<typeof getAutoTradeConfig>;
}): AutoTradeDecision {
  const status = String(input.signal.status || "CAUTION");
  const patternScore = Number(input.signal.patternScore || 0);
  const confidence = Number(input.signal.confidence || 0);
  const killSwitch = (input.signal.killSwitch as Record<string, unknown>) || {};
  const killVerdict = String(killSwitch.verdict || "BLOCK");
  const holderBehavior = (input.signal.holderBehavior as Record<string, unknown>) || {};
  const connectedPct = Number(holderBehavior.connectedHolderPct || 0);
  const reasons: string[] = [];

  if (status !== "FAVORABLE") reasons.push(`status=${status} (requires FAVORABLE)`);
  if (patternScore < input.config.minPatternScore) {
    reasons.push(`patternScore ${patternScore.toFixed(2)} < ${input.config.minPatternScore}`);
  }
  if (confidence < input.config.minConfidence) {
    reasons.push(`confidence ${confidence.toFixed(2)} < ${input.config.minConfidence}`);
  }
  if (connectedPct > input.config.maxConnectedHolderPct) {
    reasons.push(
      `connectedHolderPct ${connectedPct.toFixed(2)} > ${input.config.maxConnectedHolderPct}`
    );
  }
  if (input.config.requireKillSwitchPass && killVerdict !== "PASS") {
    reasons.push(`killSwitch verdict=${killVerdict} (requires PASS)`);
  }

  const decision: AutoTradeDecision = {
    mint: input.mint,
    decision: reasons.length === 0 ? "BUY_CANDIDATE" : "SKIP",
    reasons,
    signalId: input.signalId,
    signalStatus: status,
    patternScore: Number(patternScore.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
    tradePlan: (input.signal.tradePlan as Record<string, unknown>) || {}
  };

  if (decision.decision === "BUY_CANDIDATE") {
    decision.reasons.push("all policy gates passed");
  }

  return decision;
}

function projectDecisionPnlPct(patternScore: number, confidence: number): number {
  const edge = confidence * 0.7 + (patternScore / 100) * 0.3;
  return Number(((edge - 0.55) * 18).toFixed(2));
}

async function rpcCall(method: string, params: unknown[]): Promise<Record<string, unknown>> {
  const rpcUrl = String(process.env.SOLANA_RPC_URL || "").trim();
  if (!rpcUrl) {
    throw new Error("SOLANA_RPC_URL is required for premium payment verification");
  }

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || payload.error) {
    throw new Error(`RPC ${method} failed`);
  }
  return payload;
}

function extractTransferRecordsToAddress(
  tx: Record<string, unknown>,
  targetAddress: string
): Array<{ source: string; lamports: number }> {
  const txResult = (tx.result as Record<string, unknown>) || {};
  const transaction = (txResult.transaction as Record<string, unknown>) || {};
  const message = (transaction.message as Record<string, unknown>) || {};
  const instructions = Array.isArray(message.instructions) ? message.instructions : [];

  const transfers: Array<{ source: string; lamports: number }> = [];
  for (const raw of instructions) {
    const ix = (raw as Record<string, unknown>) || {};
    const parsed = (ix.parsed as Record<string, unknown>) || {};
    const ixType = String(parsed.type || "");
    if (ixType !== "transfer") continue;
    const info = (parsed.info as Record<string, unknown>) || {};
    const destination = String(info.destination || "");
    if (destination !== targetAddress) continue;
    transfers.push({
      source: String(info.source || ""),
      lamports: Number(info.lamports || 0)
    });
  }

  return transfers;
}

function minutesSince(ts: string): number {
  const opened = Date.parse(ts);
  if (!Number.isFinite(opened)) return 0;
  return (Date.now() - opened) / 60000;
}

async function evaluateAutoTradeDecisions(
  userId: number,
  mints: string[],
  config: ReturnType<typeof getAutoTradeConfig>
): Promise<Array<{ ok: boolean } & AutoTradeDecision>> {
  const generated = await Promise.allSettled(
    mints.map(async (mint) => {
      const built = await buildStoredSignal(userId, mint);
      const market = (built.signal.market as Record<string, unknown>) || {};
      return {
        ...buildAutoTradeDecision({ mint, signalId: built.signalId, signal: built.signal, config }),
        entryPriceUsd: Number(market.priceUsd || 0)
      };
    })
  );

  return generated.map((entry, idx) => {
    if (entry.status === "fulfilled") {
      return { ok: true, ...entry.value };
    }

    return {
      ok: false,
      mint: mints[idx],
      decision: "SKIP",
      reasons: [
        entry.reason instanceof Error ? entry.reason.message : "signal generation failed during autotrade run"
      ]
    };
  });
}

async function buildStoredSignal(userId: number, mint: string): Promise<{ signalId: number; signal: Record<string, unknown> }> {
  const context = await createEnigmaContext();
  const signal = await generateSignal(context, mint);

  const signalRecord = signal as Record<string, unknown>;
  const kill = signal.killSwitch as Record<string, unknown>;

  const signalId = saveSignal({
    userId,
    mint,
    action: String(signalRecord.status || "SCAN"),
    confidence: Number(signalRecord.confidence || 0),
    verdict: String(kill.verdict || ""),
    score: Number(kill.score || 0),
    reasoning: ((signalRecord.reasons as string[]) || []).join(" | "),
    snapshotJson: JSON.stringify(signal),
    source: String((signalRecord.market as Record<string, unknown>)?.source || "unknown")
  });

  return { signalId, signal };
}

async function buildBatchSignals(userId: number, mints: string[]) {
  const generated = await Promise.allSettled(
    mints.map(async (mint) => {
      return buildStoredSignal(userId, mint);
    })
  );

  return generated
    .map((entry, index) => {
      if (entry.status === "fulfilled") {
        return { mint: mints[index], ok: true, ...entry.value };
      }

      return {
        mint: mints[index],
        ok: false,
        error: entry.reason instanceof Error ? entry.reason.message : "signal generation failed"
      };
    })
    .sort((a, b) => {
      const aSignal = (a as Record<string, unknown>).signal as Record<string, unknown> | undefined;
      const bSignal = (b as Record<string, unknown>).signal as Record<string, unknown> | undefined;
      const aScore = Number((aSignal?.killSwitch as Record<string, unknown> | undefined)?.score || 0);
      const bScore = Number((bSignal?.killSwitch as Record<string, unknown> | undefined)?.score || 0);
      return bScore - aScore;
    });
}

app.post("/api/auth/nonce", (req, res) => {
  const wallet = String(req.body.wallet || "").trim();
  if (!wallet) {
    return res.status(400).json({ error: "wallet is required" });
  }

  const nonce = generateNonce();
  putNonce(wallet, nonce);
  return res.json({ nonce, message: `Enigma login nonce: ${nonce}` });
});

app.post("/api/auth/verify", (req, res) => {
  const wallet = String(req.body.wallet || "").trim();
  const nonce = String(req.body.nonce || "").trim();
  const signature = String(req.body.signature || "").trim();

  if (!wallet || !nonce || !signature) {
    return res.status(400).json({ error: "wallet, nonce, signature are required" });
  }

  const nonceOk = consumeNonce(wallet, nonce);
  if (!nonceOk) {
    return res.status(401).json({ error: "invalid or expired nonce" });
  }

  const signatureOk = verifyWalletSignature(wallet, nonce, signature);
  if (!signatureOk) {
    return res.status(401).json({ error: "invalid signature" });
  }

  const user = hydrateUser(wallet);
  const token = issueToken(user);
  return res.json({ token, user });
});

app.get("/api/premium/info", (_req, res) => {
  return res.json({
    paymentAddress: PREMIUM_SOL_ADDRESS,
    telegram: PREMIUM_TELEGRAM,
    tiers: {
      pro1: { lamports: PREMIUM_TIER_LAMPORTS.pro1, sol: PREMIUM_TIER_LAMPORTS.pro1 / 1_000_000_000 },
      pro2: { lamports: PREMIUM_TIER_LAMPORTS.pro2, sol: PREMIUM_TIER_LAMPORTS.pro2 / 1_000_000_000 },
      pro3: { lamports: PREMIUM_TIER_LAMPORTS.pro3, sol: PREMIUM_TIER_LAMPORTS.pro3 / 1_000_000_000 },
      pro4: { lamports: PREMIUM_TIER_LAMPORTS.pro4, sol: PREMIUM_TIER_LAMPORTS.pro4 / 1_000_000_000 }
    },
    note: "Send SOL to the payment address, then submit txSignature for verification."
  });
});

app.post("/api/premium/verify-payment", authRequired, async (req: AuthedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const tier = String(req.body.tier || "").trim().toLowerCase();
    const txSignature = String(req.body.txSignature || "").trim();
    if (!["pro1", "pro2", "pro3", "pro4"].includes(tier)) {
      return res.status(400).json({ error: "tier must be one of pro1/pro2/pro3/pro4" });
    }
    if (!txSignature) {
      return res.status(400).json({ error: "txSignature is required" });
    }

    const duplicate = getPremiumPaymentBySignature(txSignature);
    if (duplicate) {
      return res.status(409).json({
        error: "transaction already submitted",
        payment: duplicate
      });
    }

    const tx = await rpcCall("getTransaction", [txSignature, { encoding: "jsonParsed", commitment: "confirmed" }]);
    const transfers = extractTransferRecordsToAddress(tx, PREMIUM_SOL_ADDRESS);
    const requiredLamports = Number(PREMIUM_TIER_LAMPORTS[tier] || 0);

    const signerWallet = String(req.user.wallet || "");
    const paidByUserLamports = transfers
      .filter((entry) => entry.source === signerWallet)
      .reduce((sum, entry) => sum + Number(entry.lamports || 0), 0);
    const txResult = (tx.result as Record<string, unknown>) || {};
    const txBlockTime = Number(txResult.blockTime || 0);
    const txMeta = (txResult.meta as Record<string, unknown>) || {};
    const err = txMeta.err;

    if (err) {
      savePremiumPayment({
        userId: req.user.id,
        wallet: signerWallet,
        tier,
        txSignature,
        lamports: paidByUserLamports,
        status: "rejected",
        note: "transaction has on-chain error"
      });
      return res.status(400).json({ error: "transaction failed on-chain" });
    }

    if (paidByUserLamports < requiredLamports) {
      savePremiumPayment({
        userId: req.user.id,
        wallet: signerWallet,
        tier,
        txSignature,
        lamports: paidByUserLamports,
        status: "rejected",
        note: "insufficient payment amount"
      });
      return res.status(400).json({
        error: "insufficient payment",
        requiredLamports,
        paidLamports: paidByUserLamports
      });
    }

    const updated = setUserPlanByWallet(signerWallet, "pro");
    const payment = savePremiumPayment({
      userId: req.user.id,
      wallet: signerWallet,
      tier,
      txSignature,
      lamports: paidByUserLamports,
      status: "verified",
      note: `verified at blockTime ${txBlockTime || "unknown"}`
    });

    return res.json({
      ok: true,
      payment,
      user: {
        id: updated.id,
        wallet: updated.wallet,
        plan: updated.plan
      },
      note: "Payment verified. Re-login wallet to refresh JWT claims."
    });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

app.post("/api/admin/users/plan", (req, res) => {
  if (!requireAdminToken(req, res)) {
    return;
  }

  const wallet = String(req.body.wallet || "").trim();
  const plan = String(req.body.plan || "").trim().toLowerCase();
  if (!wallet) {
    return res.status(400).json({ error: "wallet is required" });
  }
  if (plan !== "free" && plan !== "pro") {
    return res.status(400).json({ error: "plan must be free or pro" });
  }

  try {
    const user = getUserByWallet(wallet);
    if (!user) {
      return res.status(404).json({ error: "user not found; user must login first" });
    }

    const updated = setUserPlanByWallet(wallet, plan as "free" | "pro");
    return res.json({
      ok: true,
      user: {
        id: updated.id,
        wallet: updated.wallet,
        plan: updated.plan
      },
      note: `Plan updated to ${updated.plan}. User should re-login to refresh JWT claims.`
    });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

app.post("/api/admin/users/balance", (req, res) => {
  if (!requireAdminToken(req, res)) {
    return;
  }

  const wallet = String(req.body.wallet || "").trim();
  const lamports = Number(req.body.lamports ?? -1);
  if (!wallet) {
    return res.status(400).json({ error: "wallet is required" });
  }
  if (!Number.isFinite(lamports) || lamports < 0) {
    return res.status(400).json({ error: "lamports must be a non-negative number" });
  }

  const user = getUserByWallet(wallet);
  if (!user) {
    return res.status(404).json({ error: "user not found; user must login first" });
  }

  const balance = setUserManagedBalance(user.id, lamports);
  return res.json({ ok: true, user, balance });
});

app.get("/api/admin/withdrawals", (req, res) => {
  if (!requireAdminToken(req, res)) {
    return;
  }

  const statusRaw = String(req.query.status || "").toLowerCase();
  const status =
    statusRaw === "pending" || statusRaw === "approved" || statusRaw === "rejected"
      ? (statusRaw as "pending" | "approved" | "rejected")
      : undefined;
  const limit = Math.max(10, Math.min(300, Number(req.query.limit || 100)));
  const requests = listWithdrawalRequests({ status, limit });
  return res.json({ requests });
});

app.post("/api/admin/withdrawals/:id/approve", async (req, res) => {
  if (!requireAdminToken(req, res)) {
    return;
  }

  const requestId = Number(req.params.id || 0);
  if (!requestId) {
    return res.status(400).json({ error: "valid request id is required" });
  }

  const request = getWithdrawalRequestById(requestId);
  if (!request) {
    return res.status(404).json({ error: "withdrawal request not found" });
  }
  if (request.status !== "pending") {
    return res.status(400).json({ error: `request already ${request.status}` });
  }
  if (process.env.ENIGMA_EXECUTION_ENABLED !== "1") {
    return res.status(400).json({
      error: "withdrawal transfers require ENIGMA_EXECUTION_ENABLED=1",
      hint: "set execution enabled and trader key before approving payouts"
    });
  }

  try {
    const payout = await executeSolTransfer({
      destinationWallet: request.destinationWallet,
      lamports: request.lamports
    });
    const updated = updateWithdrawalRequestStatus({
      requestId,
      status: "approved",
      payoutSignature: String(payout.signature || ""),
      note: String(req.body.note || "").trim() || "approved and transferred"
    });
    return res.json({ ok: true, request: updated, payout });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

app.post("/api/admin/withdrawals/:id/reject", (req, res) => {
  if (!requireAdminToken(req, res)) {
    return;
  }

  const requestId = Number(req.params.id || 0);
  if (!requestId) {
    return res.status(400).json({ error: "valid request id is required" });
  }

  const request = getWithdrawalRequestById(requestId);
  if (!request) {
    return res.status(404).json({ error: "withdrawal request not found" });
  }
  if (request.status !== "pending") {
    return res.status(400).json({ error: `request already ${request.status}` });
  }

  adjustUserManagedBalance(request.userId, request.lamports);
  const updated = updateWithdrawalRequestStatus({
    requestId,
    status: "rejected",
    note: String(req.body.note || "").trim() || "rejected by admin"
  });
  return res.json({ ok: true, request: updated });
});

app.get("/api/profile/overview", authRequired, enforceQuota("chat_calls"), (req: AuthedRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const usage = incrementUsage(req.user.id, "chat_calls");
  const stats = getDashboardStats(req.user.id);
  const balance = getUserManagedBalance(req.user.id);
  const openPositions = listAutoTradePositions(req.user.id, "OPEN");
  return res.json({ user: req.user, stats, balance, openPositionsCount: openPositions.length, usage });
});

app.get("/api/profile/history", authRequired, enforceQuota("chat_calls"), (req: AuthedRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const usage = incrementUsage(req.user.id, "chat_calls");
  const payments = listPremiumPaymentsByUser(req.user.id).slice(0, 50);
  const positions = listAutoTradePositions(req.user.id).slice(0, 100);
  const withdrawals = listWithdrawalRequests({ userId: req.user.id, limit: 100 });
  return res.json({ user: req.user, payments, positions, withdrawals, usage });
});

app.get("/api/withdrawals/me", authRequired, enforceQuota("chat_calls"), (req: AuthedRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const usage = incrementUsage(req.user.id, "chat_calls");
  const balance = getUserManagedBalance(req.user.id);
  const requests = listWithdrawalRequests({ userId: req.user.id, limit: 100 });
  return res.json({ balance, requests, usage });
});

app.post("/api/withdrawals/request", authRequired, enforceQuota("chat_calls"), (req: AuthedRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const destinationWallet = String(req.body.destinationWallet || req.user.wallet || "").trim();
  const lamports = Number(req.body.lamports || 0);
  if (!destinationWallet || !isValidSolanaMint(destinationWallet)) {
    return res.status(400).json({ error: "valid destination wallet is required" });
  }
  if (!Number.isFinite(lamports) || lamports <= 0) {
    return res.status(400).json({ error: "lamports must be a positive number" });
  }

  const currentBalance = getUserManagedBalance(req.user.id);
  if (Number(currentBalance.lamports || 0) < Math.floor(lamports)) {
    return res.status(400).json({ error: "insufficient managed balance for withdrawal request" });
  }

  adjustUserManagedBalance(req.user.id, -Math.floor(lamports));
  const request = createWithdrawalRequest({
    userId: req.user.id,
    userWallet: req.user.wallet,
    destinationWallet,
    lamports: Math.floor(lamports),
    note: String(req.body.note || "").trim() || undefined
  });
  const usage = incrementUsage(req.user.id, "chat_calls");
  return res.json({
    ok: true,
    request,
    balance: getUserManagedBalance(req.user.id),
    usage,
    note: "Withdrawal request submitted. Admin approval required."
  });
});

app.get("/api/auth/me", authRequired, (req: AuthedRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const stats = getDashboardStats(req.user.id);
  return res.json({ user: req.user, stats });
});

app.get("/api/health", async (_req, res) => {
  const context = await createEnigmaContext();
  const helius = await context.tools.onchain.rpcHealth();

  res.json({
    ok: true,
    app: "Enigma",
    role: "Solana signal scanner",
    boundaries: ["No trade execution", "Probabilistic signals"],
    helius
  });
});

app.get("/api/watchlist", authRequired, (req: AuthedRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  return res.json({ mints: getWatchlist(req.user.id) });
});

function upsertWatchlist(req: AuthedRequest, res: express.Response) {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const mints = parseMintsCsv(String(req.body.mints || ""), 5);
  const validMints = validateMints(mints);
  if (validMints.length === 0) {
    res.status(400).json({ error: "at least 1 valid Solana mint is required" });
    return;
  }

  setWatchlist(req.user.id, validMints);
  res.json({ mints: validMints });
}

app.put("/api/watchlist", authRequired, upsertWatchlist);
app.post("/api/watchlist", authRequired, upsertWatchlist);

app.post("/api/watchlist/add", authRequired, (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const mint = String(req.body.mint || "").trim();
  if (!mint || !isValidSolanaMint(mint)) {
    res.status(400).json({ error: "valid mint is required" });
    return;
  }

  const current = getWatchlist(req.user.id);
  const next = Array.from(new Set([...current, mint])).slice(0, 5);
  setWatchlist(req.user.id, next);
  res.json({ mints: next });
});

app.post(
  "/api/signal",
  authRequired,
  enforceQuota("signal_calls"),
  async (req: AuthedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "unauthorized" });
      }

      const mint = String(req.body.mint || "").trim();
      if (!mint || !isValidSolanaMint(mint)) {
        return res.status(400).json({ error: "valid mint is required" });
      }

      const output = await buildStoredSignal(req.user.id, mint);
      const usage = incrementUsage(req.user.id, "signal_calls");
      return res.json({ ...output, usage });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  }
);

app.post(
  "/api/watchlist/scan",
  authRequired,
  enforceQuota("signal_calls"),
  async (req: AuthedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "unauthorized" });
      }

      const stored = getWatchlist(req.user.id);
      if (stored.length === 0) {
        return res.status(400).json({ error: "watchlist is empty" });
      }

      const items = await buildBatchSignals(req.user.id, stored);
      const usage = incrementUsage(req.user.id, "signal_calls");
      return res.json({ ts: new Date().toISOString(), items, usage, watchlist: stored });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  }
);

app.post(
  "/api/discovery/suggest",
  authRequired,
  enforceQuota("signal_calls"),
  async (req: AuthedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "unauthorized" });
      }

      const limit = Math.min(10, Math.max(3, Number(req.body.limit || 5)));
      const candidates = await discoverNewSolanaMints(30);
      if (candidates.length === 0) {
        return res.status(200).json({ items: [], note: "no candidates from discovery source" });
      }

      const context = await createEnigmaContext();
      const evaluated = await Promise.allSettled(
        candidates.slice(0, 20).map(async (candidate) => {
          const signal = await generateSignal(context, candidate.mint);
          return { candidate, signal };
        })
      );

      const items = evaluated
        .filter(
          (
            entry
          ): entry is PromiseFulfilledResult<{ candidate: { mint: string; iconUrl?: string; headerUrl?: string }; signal: Record<string, unknown> }> =>
            entry.status === "fulfilled"
        )
        .map((entry) => entry.value)
        .map(({ candidate, signal }) => {
          const market = (signal.market as Record<string, unknown>) || {};
          const token = (signal.token as Record<string, unknown>) || {};
          return {
            mint: candidate.mint,
            signal: {
              ...signal,
              token: {
                ...token,
                imageUrl: String(token.imageUrl || candidate.iconUrl || ""),
                headerUrl: String(token.headerUrl || candidate.headerUrl || "")
              }
            },
            forecastScore: Number(signal.forecastScore || 0),
            liquidityUsd: Number(market.liquidityUsd || 0)
          };
        })
        .filter((item) => item.liquidityUsd >= 10000)
        .sort((a, b) => b.forecastScore - a.forecastScore)
        .slice(0, limit);

      const usage = incrementUsage(req.user.id, "signal_calls");
      return res.json({
        ts: new Date().toISOString(),
        items,
        usage,
        note: "Discovery suggestions are probabilistic and may include high-risk tokens"
      });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  }
);

app.post(
  "/api/signals/stream",
  authRequired,
  enforceQuota("signal_calls"),
  async (req: AuthedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "unauthorized" });
      }

      const mints = parseMintsCsv(String(req.body.mints || ""), 5);
      const validMints = validateMints(mints);
      if (validMints.length === 0) {
        return res.status(400).json({ error: "at least one valid mint is required" });
      }

      const items = await buildBatchSignals(req.user.id, validMints);
      const usage = incrementUsage(req.user.id, "signal_calls");
      return res.json({ ts: new Date().toISOString(), items, usage, watchlist: validMints });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  }
);

app.post("/api/forecast/resolve", authRequired, (req: AuthedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const signalId = Number(req.body.signalId || 0);
    const won = Boolean(req.body.won);
    const pnlPct = Number(req.body.pnlPct || 0);
    const note = String(req.body.note || "").trim() || undefined;

    if (!signalId || !Number.isFinite(signalId)) {
      return res.status(400).json({ error: "signalId is required" });
    }

    resolveForecast({ userId: req.user.id, signalId, won, pnlPct, note });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

app.get(
  "/api/token/holders",
  authRequired,
  enforceQuota("signal_calls"),
  async (req: AuthedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "unauthorized" });
      }

      const mint = String(req.query.mint || "").trim();
      const limit = Math.min(50, Math.max(8, Number(req.query.limit || 40)));
      if (!mint || !isValidSolanaMint(mint)) {
        return res.status(400).json({ error: "valid mint is required" });
      }

      const context = await createEnigmaContext();
      const risk = await context.tools.onchain.riskSignals(mint, { holderLimit: limit });
      const usage = incrementUsage(req.user.id, "signal_calls");

      return res.json({
        mint,
        holderProfiles: (risk.holderProfiles as Array<Record<string, unknown>>) || [],
        holderBehavior: (risk.holderBehavior as Record<string, unknown>) || {},
        usage
      });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  }
);

app.get("/api/dashboard/stats", authRequired, enforceQuota("chat_calls"), (req: AuthedRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const usage = incrementUsage(req.user.id, "chat_calls");
  const stats = getDashboardStats(req.user.id);
  return res.json({ stats, usage });
});

app.get("/api/autotrade/config", authRequired, (req: AuthedRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  return res.json({ config: getAutoTradeConfig(req.user.id) });
});

app.put("/api/autotrade/config", authRequired, (req: AuthedRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const current = getAutoTradeConfig(req.user.id);
  const modeInput = String(req.body.mode || current.mode).toLowerCase();
  const mode: "paper" | "live" = modeInput === "live" ? "live" : "paper";
  if (mode === "live" && req.user.plan !== "pro") {
    return res.status(403).json(premiumRequiredResponse());
  }

  const next = putAutoTradeConfig(req.user.id, {
    enabled: typeof req.body.enabled === "boolean" ? Boolean(req.body.enabled) : current.enabled,
    mode,
    minPatternScore: clampNumber(
      Number(req.body.minPatternScore ?? current.minPatternScore),
      40,
      95
    ),
    minConfidence: clampNumber(Number(req.body.minConfidence ?? current.minConfidence), 0.1, 0.99),
    maxConnectedHolderPct: clampNumber(
      Number(req.body.maxConnectedHolderPct ?? current.maxConnectedHolderPct),
      1,
      80
    ),
    requireKillSwitchPass:
      typeof req.body.requireKillSwitchPass === "boolean"
        ? Boolean(req.body.requireKillSwitchPass)
        : current.requireKillSwitchPass,
    maxPositionUsd: clampNumber(Number(req.body.maxPositionUsd ?? current.maxPositionUsd), 1, 50000),
    scanIntervalSec: clampNumber(Number(req.body.scanIntervalSec ?? current.scanIntervalSec), 10, 3600)
  });

  return res.json({
    config: next,
    note:
      "Auto-trade policy updated. Use /api/autotrade/engine/tick for managed position open/close execution."
  });
});

app.post(
  "/api/autotrade/run",
  authRequired,
  enforceQuota("signal_calls"),
  async (req: AuthedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "unauthorized" });
      }

      const config = getAutoTradeConfig(req.user.id);
      const execCfg = getAutoTradeExecutionConfig(req.user.id);
      if (!config.enabled) {
        return res.status(400).json({ error: "autotrade is disabled", config });
      }

      const configured = getWatchlist(req.user.id);
      const reqMints = parseMintsCsv(String(req.body.mints || ""), 5);
      const mints = validateMints(reqMints.length ? reqMints : configured);
      if (mints.length === 0) {
        return res.status(400).json({ error: "at least one valid mint is required" });
      }

      const decisions = await evaluateAutoTradeDecisions(req.user.id, mints, config);

      const usage = incrementUsage(req.user.id, "signal_calls");
      const candidates = decisions.filter((item) => item.ok && item.decision === "BUY_CANDIDATE");
      const effectiveTradeAmountUsd = getEffectiveTradeAmountUsd(config, execCfg);
      const modeState = getEffectiveMode(config, execCfg, req.user.plan);
      const expectedPnlValues = candidates.map((item) =>
        projectDecisionPnlPct(Number(item.patternScore || 0), Number(item.confidence || 0))
      );
      const avgExpectedPnlPct = expectedPnlValues.length
        ? Number(
            (
              expectedPnlValues.reduce((sum, value) => sum + value, 0) / expectedPnlValues.length
            ).toFixed(2)
          )
        : 0;
      const simulatedExposureUsd = Number((candidates.length * effectiveTradeAmountUsd).toFixed(2));
      const runId = saveAutoTradeRun({
        userId: req.user.id,
        mode: modeState.mode,
        scannedCount: mints.length,
        buyCandidates: candidates.length,
        skippedCount: decisions.length - candidates.length,
        simulatedExposureUsd,
        expectedPnlPct: avgExpectedPnlPct
      });

      const modeNote =
        modeState.mode === "paper"
          ? "paper mode: no orders are executed"
          : "live mode policy pass: route candidate orders into your Jupiter execution worker";

      return res.json({
        ts: new Date().toISOString(),
        mode: modeState.mode,
        warnings: modeState.warnings,
        config,
        executionConfig: execCfg,
        scanned: mints.length,
        decisions,
        summary: {
          buyCandidates: candidates.length,
          skipped: decisions.length - candidates.length,
          maxPositionUsd: config.maxPositionUsd,
          effectiveTradeAmountUsd,
          simulatedExposureUsd,
          avgExpectedPnlPct
        },
        execution: {
          ready: modeState.mode === "live",
          note: modeNote
        },
        runId,
        usage
      });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  }
);

app.get("/api/autotrade/performance", authRequired, enforceQuota("chat_calls"), (req: AuthedRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const limit = Math.max(5, Math.min(100, Number(req.query.limit || 30)));
  const usage = incrementUsage(req.user.id, "chat_calls");
  const performance = getAutoTradePerformance(req.user.id, limit);
  return res.json({ performance, usage });
});

app.get("/api/autotrade/execution-config", authRequired, (req: AuthedRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  return res.json({ config: getAutoTradeExecutionConfig(req.user.id) });
});

app.put("/api/autotrade/execution-config", authRequired, (req: AuthedRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const current = getAutoTradeExecutionConfig(req.user.id);
  const modeInput = String(req.body.mode || current.mode).toLowerCase();
  const mode: "paper" | "live" = modeInput === "live" ? "live" : "paper";
  if (mode === "live" && req.user.plan !== "pro") {
    return res.status(403).json(premiumRequiredResponse());
  }

  const next = putAutoTradeExecutionConfig(req.user.id, {
    enabled: typeof req.body.enabled === "boolean" ? Boolean(req.body.enabled) : current.enabled,
    mode,
    tradeAmountUsd: clampNumber(Number(req.body.tradeAmountUsd ?? current.tradeAmountUsd), 1, 50000),
    maxOpenPositions: clampNumber(Number(req.body.maxOpenPositions ?? current.maxOpenPositions), 1, 50),
    tpPct: clampNumber(Number(req.body.tpPct ?? current.tpPct), 0.2, 200),
    slPct: clampNumber(Number(req.body.slPct ?? current.slPct), 0.2, 99),
    trailingStopPct: clampNumber(
      Number(req.body.trailingStopPct ?? current.trailingStopPct),
      0.1,
      99
    ),
    maxHoldMinutes: clampNumber(Number(req.body.maxHoldMinutes ?? current.maxHoldMinutes), 1, 10080),
    cooldownSec: clampNumber(Number(req.body.cooldownSec ?? current.cooldownSec), 0, 86400),
    pollIntervalSec: clampNumber(Number(req.body.pollIntervalSec ?? current.pollIntervalSec), 5, 3600)
  });

  return res.json({
    config: next,
    note:
      "Execution config updated. For real on-chain live execution, connect dedicated signer + router worker."
  });
});

app.get("/api/autotrade/positions", authRequired, enforceQuota("chat_calls"), (req: AuthedRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const statusRaw = String(req.query.status || "").toUpperCase();
  const status = statusRaw === "OPEN" || statusRaw === "CLOSED" ? statusRaw : undefined;
  const usage = incrementUsage(req.user.id, "chat_calls");
  const positions = listAutoTradePositions(req.user.id, status as "OPEN" | "CLOSED" | undefined);
  return res.json({ positions, usage });
});

app.post(
  "/api/autotrade/engine/tick",
  authRequired,
  enforceQuota("signal_calls"),
  async (req: AuthedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "unauthorized" });
      }

      const policy = getAutoTradeConfig(req.user.id);
      const execCfg = getAutoTradeExecutionConfig(req.user.id);
      if (!execCfg.enabled) {
        return res.status(400).json({ error: "execution engine is disabled", config: execCfg });
      }

      const liveEnabled = process.env.ENIGMA_EXECUTION_ENABLED === "1";
      if ((execCfg.mode === "live" || policy.mode === "live") && req.user.plan !== "pro") {
        return res.status(403).json(premiumRequiredResponse());
      }
      const modeState = getEffectiveMode(policy, execCfg, req.user.plan);
      const executionMode: "paper" | "live" =
        modeState.mode === "live" && liveEnabled ? "live" : "paper";
      const modeWarnings = modeState.warnings.slice();
      if (modeState.mode === "live" && !liveEnabled) {
        modeWarnings.push(
          "live mode requested but ENIGMA_EXECUTION_ENABLED!=1, downgraded to paper simulation"
        );
      }
      const effectiveTradeAmountUsd = getEffectiveTradeAmountUsd(policy, execCfg);

      const configured = getWatchlist(req.user.id);
      const reqMints = parseMintsCsv(String(req.body.mints || ""), 5);
      const mints = validateMints(reqMints.length ? reqMints : configured);
      if (mints.length === 0) {
        return res.status(400).json({ error: "at least one valid mint is required" });
      }

      const actions: Array<Record<string, unknown>> = [];
      const openBefore = listAutoTradePositions(req.user.id, "OPEN");
      let openPositions = openBefore.slice();

      for (const position of openPositions) {
        const built = await buildStoredSignal(req.user.id, position.mint);
        const market = (built.signal.market as Record<string, unknown>) || {};
        const markPrice = Number(market.priceUsd || 0);
        if (!Number.isFinite(markPrice) || markPrice <= 0) {
          continue;
        }

        const marked = updateAutoTradePositionMark(req.user.id, position.id, markPrice) || position;
        const entry = Number(marked.entryPriceUsd || 0);
        const highWater = Number(marked.highWaterPriceUsd || markPrice);
        const elapsedMinutes = minutesSince(marked.opened_at);
        const tpPrice = entry * (1 + Number(marked.tpPct || 0) / 100);
        const slPrice = entry * (1 - Number(marked.slPct || 0) / 100);
        const trailingFloor = highWater * (1 - Number(marked.trailingStopPct || 0) / 100);
        let closeReason = "";

        if (markPrice <= slPrice) closeReason = "SL_HIT";
        else if (markPrice >= tpPrice) closeReason = "TP_HIT";
        else if (markPrice <= trailingFloor && highWater > entry) closeReason = "TRAILING_STOP";
        else if (elapsedMinutes >= Number(marked.maxHoldMinutes || 0)) closeReason = "MAX_HOLD_TIME";

        if (closeReason) {
          if (executionMode === "live") {
            try {
              const sellResponse = await executeUltraSell({ mint: marked.mint });
              actions.push({
                type: "LIVE_SELL",
                positionId: marked.id,
                mint: marked.mint,
                signature: String((sellResponse.execution as Record<string, unknown>)?.signature || ""),
                status: String((sellResponse.execution as Record<string, unknown>)?.status || "UNKNOWN")
              });
            } catch (error) {
              actions.push({
                type: "ERROR",
                positionId: marked.id,
                mint: marked.mint,
                reason: `live sell failed: ${(error as Error).message}`
              });
              continue;
            }
          }

          const closed = closeAutoTradePosition({
            userId: req.user.id,
            positionId: marked.id,
            markPriceUsd: markPrice,
            closeReason
          });
          if (closed) {
            actions.push({
              type: "CLOSE",
              positionId: closed.id,
              mint: closed.mint,
              reason: closeReason,
              pnlPct: Number((closed.pnlPct || 0).toFixed(2)),
              mode: executionMode
            });
          }
        }
      }

      openPositions = listAutoTradePositions(req.user.id, "OPEN");
      const openMintSet = new Set(openPositions.map((item) => item.mint));
      const capacity = Math.max(0, Number(execCfg.maxOpenPositions || 0) - openPositions.length);
      let decisions: Array<{ ok: boolean } & AutoTradeDecision> = [];

      if (capacity > 0 && policy.enabled) {
        decisions = await evaluateAutoTradeDecisions(
          req.user.id,
          mints.filter((mint) => !openMintSet.has(mint)),
          policy
        );

        const lastOpenedAt = openPositions.length
          ? Math.max(...openPositions.map((item) => Date.parse(item.opened_at) || 0))
          : 0;
        const cooldownReady = Date.now() - lastOpenedAt >= Number(execCfg.cooldownSec || 0) * 1000;

        if (cooldownReady) {
          const buyCandidates = decisions
            .filter((item) => item.ok && item.decision === "BUY_CANDIDATE")
            .slice(0, capacity);

          for (const candidate of buyCandidates) {
            const entryPrice = Number(candidate.entryPriceUsd || 0);
            if (!Number.isFinite(entryPrice) || entryPrice <= 0) continue;
            if (executionMode === "live") {
              try {
                const buyResponse = await executeUltraBuy({
                  outputMint: candidate.mint,
                  amountUsd: effectiveTradeAmountUsd
                });
                actions.push({
                  type: "LIVE_BUY",
                  mint: candidate.mint,
                  signature: String((buyResponse.execution as Record<string, unknown>)?.signature || ""),
                  status: String((buyResponse.execution as Record<string, unknown>)?.status || "UNKNOWN")
                });
              } catch (error) {
                actions.push({
                  type: "ERROR",
                  mint: candidate.mint,
                  reason: `live buy failed: ${(error as Error).message}`
                });
                continue;
              }
            }

            const qty = Number((effectiveTradeAmountUsd / entryPrice).toFixed(8));
            const created = createAutoTradePosition({
              userId: req.user.id,
              mint: candidate.mint,
              mode: executionMode,
              entrySignalId: candidate.signalId || null,
              entryPriceUsd: entryPrice,
              sizeUsd: effectiveTradeAmountUsd,
              qtyTokens: qty,
              tpPct: Number(execCfg.tpPct || 0),
              slPct: Number(execCfg.slPct || 0),
              trailingStopPct: Number(execCfg.trailingStopPct || 0),
              maxHoldMinutes: Number(execCfg.maxHoldMinutes || 0)
            });

            actions.push({
              type: "OPEN",
              positionId: created.id,
              mint: created.mint,
              entryPriceUsd: created.entryPriceUsd,
              sizeUsd: created.sizeUsd,
              qtyTokens: created.qtyTokens,
              mode: executionMode,
              note:
                executionMode === "paper"
                  ? "paper simulated order opened"
                  : "live slot opened (connect signer/router worker for on-chain submits)"
            });
          }
        } else {
          actions.push({
            type: "INFO",
            note: `cooldown active (${execCfg.cooldownSec}s), no new positions opened`
          });
        }
      }

      const usage = incrementUsage(req.user.id, "signal_calls");
      const openAfter = listAutoTradePositions(req.user.id, "OPEN");
      const closedRecent = listAutoTradePositions(req.user.id, "CLOSED").slice(0, 10);

      return res.json({
        ts: new Date().toISOString(),
        mode: executionMode,
        warnings: modeWarnings,
        policy,
        executionConfig: execCfg,
        effectiveTradeAmountUsd,
        scanned: mints.length,
        decisions,
        actions,
        positions: {
          openCount: openAfter.length,
          open: openAfter,
          recentlyClosed: closedRecent
        },
        usage
      });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  }
);

app.get("*", (_req, res) => {
  res.sendFile(resolve(publicDir, "index.html"));
});

function startServer(port: number, retriesLeft = 10): void {
  const server = app.listen(port, host, () => {
    console.log(`Enigma web running at http://localhost:${port}`);
    console.log(
      `[config] mode=${runtimeConfig.mode} rpc=${runtimeConfig.hasRpc ? "configured" : "missing"}`
    );
    if (process.env.CODESPACE_NAME) {
      const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || "app.github.dev";
      console.log(`Codespaces URL: https://${process.env.CODESPACE_NAME}-${port}.${domain}`);
    }
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE" && retriesLeft > 0) {
      console.warn(`Port ${port} is busy. Trying ${port + 1}...`);
      startServer(port + 1, retriesLeft - 1);
      return;
    }

    if (error.code === "EADDRINUSE") {
      console.error(`No available port from ${startPort} to ${port}. Set PORT in .env and retry.`);
      process.exit(1);
    }

    console.error(error);
    process.exit(1);
  });
}

startServer(startPort);
