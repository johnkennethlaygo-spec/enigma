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
  consumeNonce,
  getDashboardStats,
  getWatchlist,
  incrementUsage,
  putNonce,
  resolveForecast,
  saveSignal,
  setWatchlist
} from "./server/db.js";
import { discoverNewSolanaMints, generateSignal } from "./server/signalEngine.js";

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
  if (mints.length === 0) {
    res.status(400).json({ error: "at least 1 mint is required" });
    return;
  }

  setWatchlist(req.user.id, mints);
  res.json({ mints });
}

app.put("/api/watchlist", authRequired, upsertWatchlist);
app.post("/api/watchlist", authRequired, upsertWatchlist);

app.post("/api/watchlist/add", authRequired, (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const mint = String(req.body.mint || "").trim();
  if (!mint) {
    res.status(400).json({ error: "mint is required" });
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
      if (!mint) {
        return res.status(400).json({ error: "mint is required" });
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
      if (mints.length === 0) {
        return res.status(400).json({ error: "mints is required" });
      }

      const items = await buildBatchSignals(req.user.id, mints);
      const usage = incrementUsage(req.user.id, "signal_calls");
      return res.json({ ts: new Date().toISOString(), items, usage, watchlist: mints });
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

app.get("/api/dashboard/stats", authRequired, enforceQuota("chat_calls"), (req: AuthedRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const usage = incrementUsage(req.user.id, "chat_calls");
  const stats = getDashboardStats(req.user.id);
  return res.json({ stats, usage });
});

app.get("*", (_req, res) => {
  res.sendFile(resolve(publicDir, "index.html"));
});

function startServer(port: number, retriesLeft = 10): void {
  const server = app.listen(port, host, () => {
    console.log(`Enigma web running at http://localhost:${port}`);
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
