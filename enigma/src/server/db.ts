import { DatabaseSync } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

export interface UserRecord {
  id: number;
  wallet: string;
  plan: "free" | "pro";
  created_at: string;
  last_login_at: string;
}

export interface UsageRecord {
  signal_calls: number;
  chat_calls: number;
}

export interface AutoTradeConfigRecord {
  enabled: boolean;
  mode: "paper" | "live";
  minPatternScore: number;
  minConfidence: number;
  maxConnectedHolderPct: number;
  requireKillSwitchPass: boolean;
  maxPositionUsd: number;
  scanIntervalSec: number;
  updated_at: string;
}

export interface AutoTradeExecutionConfigRecord {
  enabled: boolean;
  mode: "paper" | "live";
  tradeAmountUsd: number;
  maxOpenPositions: number;
  tpPct: number;
  slPct: number;
  trailingStopPct: number;
  maxHoldMinutes: number;
  cooldownSec: number;
  pollIntervalSec: number;
  updated_at: string;
}

export interface AutoTradePositionRecord {
  id: number;
  userId: number;
  mint: string;
  status: "OPEN" | "CLOSED";
  mode: "paper" | "live";
  entrySignalId: number | null;
  entryPriceUsd: number;
  sizeUsd: number;
  qtyTokens: number;
  tpPct: number;
  slPct: number;
  trailingStopPct: number;
  maxHoldMinutes: number;
  highWaterPriceUsd: number;
  lastPriceUsd: number;
  opened_at: string;
  closed_at: string | null;
  closeReason: string | null;
  pnlPct: number | null;
}

export interface PremiumPaymentRecord {
  id: number;
  userId: number;
  wallet: string;
  tier: string;
  txSignature: string;
  lamports: number;
  status: "verified" | "rejected";
  note: string | null;
  created_at: string;
}

export interface UserBalanceRecord {
  userId: number;
  lamports: number;
  updated_at: string;
}

export interface WithdrawalRequestRecord {
  id: number;
  userId: number;
  userWallet: string;
  destinationWallet: string;
  lamports: number;
  status: "pending" | "approved" | "rejected";
  payoutSignature: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

const dbPath = resolve(process.cwd(), process.env.ENIGMA_DB_PATH || "./enigma_data.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_nonces (
  wallet TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_daily (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  signal_calls INTEGER NOT NULL DEFAULT 0,
  chat_calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  mint TEXT NOT NULL,
  action TEXT NOT NULL,
  confidence REAL NOT NULL,
  entry_low REAL,
  entry_high REAL,
  stop_loss REAL,
  take_profit_1 REAL,
  take_profit_2 REAL,
  verdict TEXT,
  score INTEGER,
  reasoning TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS forecasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  signal_id INTEGER NOT NULL,
  won INTEGER,
  pnl_pct REAL,
  note TEXT,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS watchlists (
  user_id INTEGER PRIMARY KEY,
  mints_csv TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS autotrade_configs (
  user_id INTEGER PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'paper',
  min_pattern_score REAL NOT NULL DEFAULT 72,
  min_confidence REAL NOT NULL DEFAULT 0.75,
  max_connected_holder_pct REAL NOT NULL DEFAULT 22,
  require_kill_switch_pass INTEGER NOT NULL DEFAULT 1,
  max_position_usd REAL NOT NULL DEFAULT 50,
  scan_interval_sec INTEGER NOT NULL DEFAULT 30,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS autotrade_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  scanned_count INTEGER NOT NULL,
  buy_candidates INTEGER NOT NULL,
  skipped_count INTEGER NOT NULL,
  simulated_exposure_usd REAL NOT NULL,
  expected_pnl_pct REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS autotrade_execution_configs (
  user_id INTEGER PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'paper',
  trade_amount_usd REAL NOT NULL DEFAULT 25,
  max_open_positions INTEGER NOT NULL DEFAULT 3,
  tp_pct REAL NOT NULL DEFAULT 8,
  sl_pct REAL NOT NULL DEFAULT 4,
  trailing_stop_pct REAL NOT NULL DEFAULT 3,
  max_hold_minutes INTEGER NOT NULL DEFAULT 120,
  cooldown_sec INTEGER NOT NULL DEFAULT 30,
  poll_interval_sec INTEGER NOT NULL DEFAULT 15,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS autotrade_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  mint TEXT NOT NULL,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  entry_signal_id INTEGER,
  entry_price_usd REAL NOT NULL,
  size_usd REAL NOT NULL,
  qty_tokens REAL NOT NULL,
  tp_pct REAL NOT NULL,
  sl_pct REAL NOT NULL,
  trailing_stop_pct REAL NOT NULL,
  max_hold_minutes INTEGER NOT NULL,
  high_water_price_usd REAL NOT NULL,
  last_price_usd REAL NOT NULL,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  close_reason TEXT,
  pnl_pct REAL
);

CREATE TABLE IF NOT EXISTS premium_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  wallet TEXT NOT NULL,
  tier TEXT NOT NULL,
  tx_signature TEXT NOT NULL UNIQUE,
  lamports INTEGER NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_managed_balances (
  user_id INTEGER PRIMARY KEY,
  lamports INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  user_wallet TEXT NOT NULL,
  destination_wallet TEXT NOT NULL,
  lamports INTEGER NOT NULL,
  status TEXT NOT NULL,
  payout_signature TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

export function getUserByWallet(wallet: string): UserRecord | null {
  const row = db
    .prepare("SELECT id, wallet, plan, created_at, last_login_at FROM users WHERE wallet = ?")
    .get(wallet) as UserRecord | undefined;
  return row || null;
}

export function getUserById(userId: number): UserRecord | null {
  const row = db
    .prepare("SELECT id, wallet, plan, created_at, last_login_at FROM users WHERE id = ?")
    .get(userId) as UserRecord | undefined;
  return row || null;
}

export function createOrTouchUser(wallet: string): UserRecord {
  const now = new Date().toISOString();
  const existing = getUserByWallet(wallet);
  if (!existing) {
    db.prepare(
      "INSERT INTO users (wallet, plan, created_at, last_login_at) VALUES (?, 'free', ?, ?)"
    ).run(wallet, now, now);
  } else {
    db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now, existing.id);
  }

  const user = getUserByWallet(wallet);
  if (!user) {
    throw new Error("Failed to create user");
  }

  return user;
}

export function setUserPlanByWallet(wallet: string, plan: "free" | "pro"): UserRecord {
  const current = getUserByWallet(wallet);
  if (!current) {
    throw new Error("wallet user not found");
  }

  db.prepare("UPDATE users SET plan = ? WHERE wallet = ?").run(plan, wallet);
  const updated = getUserByWallet(wallet);
  if (!updated) {
    throw new Error("failed to update user plan");
  }
  return updated;
}

export function savePremiumPayment(input: {
  userId: number;
  wallet: string;
  tier: string;
  txSignature: string;
  lamports: number;
  status: "verified" | "rejected";
  note?: string;
}): PremiumPaymentRecord {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO premium_payments (
        user_id, wallet, tier, tx_signature, lamports, status, note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.userId,
      input.wallet,
      input.tier,
      input.txSignature,
      input.lamports,
      input.status,
      input.note || null,
      now
    );

  const row = db
    .prepare(
      `SELECT id, user_id, wallet, tier, tx_signature, lamports, status, note, created_at
       FROM premium_payments WHERE id = ?`
    )
    .get(Number(result.lastInsertRowid)) as Record<string, unknown> | undefined;

  if (!row) {
    throw new Error("failed to save premium payment");
  }

  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    wallet: String(row.wallet || ""),
    tier: String(row.tier || ""),
    txSignature: String(row.tx_signature || ""),
    lamports: Number(row.lamports || 0),
    status: String(row.status || "rejected") === "verified" ? "verified" : "rejected",
    note: row.note ? String(row.note) : null,
    created_at: String(row.created_at || "")
  };
}

export function getPremiumPaymentBySignature(signature: string): PremiumPaymentRecord | null {
  const row = db
    .prepare(
      `SELECT id, user_id, wallet, tier, tx_signature, lamports, status, note, created_at
       FROM premium_payments WHERE tx_signature = ?`
    )
    .get(signature) as Record<string, unknown> | undefined;

  if (!row) return null;
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    wallet: String(row.wallet || ""),
    tier: String(row.tier || ""),
    txSignature: String(row.tx_signature || ""),
    lamports: Number(row.lamports || 0),
    status: String(row.status || "rejected") === "verified" ? "verified" : "rejected",
    note: row.note ? String(row.note) : null,
    created_at: String(row.created_at || "")
  };
}

export function listPremiumPaymentsByUser(userId: number): PremiumPaymentRecord[] {
  const rows = db
    .prepare(
      `SELECT id, user_id, wallet, tier, tx_signature, lamports, status, note, created_at
       FROM premium_payments
       WHERE user_id = ?
       ORDER BY id DESC`
    )
    .all(userId) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: Number(row.id),
    userId: Number(row.user_id),
    wallet: String(row.wallet || ""),
    tier: String(row.tier || ""),
    txSignature: String(row.tx_signature || ""),
    lamports: Number(row.lamports || 0),
    status: String(row.status || "rejected") === "verified" ? "verified" : "rejected",
    note: row.note ? String(row.note) : null,
    created_at: String(row.created_at || "")
  }));
}

export function getUserManagedBalance(userId: number): UserBalanceRecord {
  const row = db
    .prepare("SELECT user_id, lamports, updated_at FROM user_managed_balances WHERE user_id = ?")
    .get(userId) as { user_id: number; lamports: number; updated_at: string } | undefined;

  if (!row) {
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO user_managed_balances (user_id, lamports, updated_at) VALUES (?, 0, ?)"
    ).run(userId, now);
    return { userId, lamports: 0, updated_at: now };
  }

  return {
    userId: Number(row.user_id),
    lamports: Number(row.lamports || 0),
    updated_at: String(row.updated_at || "")
  };
}

export function setUserManagedBalance(userId: number, lamports: number): UserBalanceRecord {
  const safeLamports = Math.max(0, Math.floor(Number(lamports || 0)));
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO user_managed_balances (user_id, lamports, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET lamports = excluded.lamports, updated_at = excluded.updated_at`
  ).run(userId, safeLamports, now);
  return getUserManagedBalance(userId);
}

export function adjustUserManagedBalance(userId: number, deltaLamports: number): UserBalanceRecord {
  const current = getUserManagedBalance(userId);
  const next = Math.max(0, Number(current.lamports || 0) + Math.floor(Number(deltaLamports || 0)));
  return setUserManagedBalance(userId, next);
}

export function createWithdrawalRequest(input: {
  userId: number;
  userWallet: string;
  destinationWallet: string;
  lamports: number;
  note?: string;
}): WithdrawalRequestRecord {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO withdrawal_requests (
        user_id, user_wallet, destination_wallet, lamports, status, payout_signature, note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', NULL, ?, ?, ?)`
    )
    .run(
      input.userId,
      input.userWallet,
      input.destinationWallet,
      Math.max(0, Math.floor(Number(input.lamports || 0))),
      input.note || null,
      now,
      now
    );

  const created = getWithdrawalRequestById(Number(result.lastInsertRowid));
  if (!created) {
    throw new Error("failed to create withdrawal request");
  }
  return created;
}

export function getWithdrawalRequestById(requestId: number): WithdrawalRequestRecord | null {
  const row = db
    .prepare(
      `SELECT id, user_id, user_wallet, destination_wallet, lamports, status, payout_signature, note, created_at, updated_at
       FROM withdrawal_requests
       WHERE id = ?`
    )
    .get(requestId) as Record<string, unknown> | undefined;

  if (!row) return null;
  const statusRaw = String(row.status || "pending");
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    userWallet: String(row.user_wallet || ""),
    destinationWallet: String(row.destination_wallet || ""),
    lamports: Number(row.lamports || 0),
    status: statusRaw === "approved" ? "approved" : statusRaw === "rejected" ? "rejected" : "pending",
    payoutSignature: row.payout_signature ? String(row.payout_signature) : null,
    note: row.note ? String(row.note) : null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || "")
  };
}

export function listWithdrawalRequests(options?: {
  userId?: number;
  status?: "pending" | "approved" | "rejected";
  limit?: number;
}): WithdrawalRequestRecord[] {
  const limit = Math.max(10, Math.min(300, Number(options?.limit || 100)));
  const userId = options?.userId;
  const status = options?.status;
  let rows: Array<Record<string, unknown>> = [];

  if (userId && status) {
    rows = db
      .prepare(
        `SELECT id, user_id, user_wallet, destination_wallet, lamports, status, payout_signature, note, created_at, updated_at
         FROM withdrawal_requests
         WHERE user_id = ? AND status = ?
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(userId, status, limit) as Array<Record<string, unknown>>;
  } else if (userId) {
    rows = db
      .prepare(
        `SELECT id, user_id, user_wallet, destination_wallet, lamports, status, payout_signature, note, created_at, updated_at
         FROM withdrawal_requests
         WHERE user_id = ?
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(userId, limit) as Array<Record<string, unknown>>;
  } else if (status) {
    rows = db
      .prepare(
        `SELECT id, user_id, user_wallet, destination_wallet, lamports, status, payout_signature, note, created_at, updated_at
         FROM withdrawal_requests
         WHERE status = ?
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(status, limit) as Array<Record<string, unknown>>;
  } else {
    rows = db
      .prepare(
        `SELECT id, user_id, user_wallet, destination_wallet, lamports, status, payout_signature, note, created_at, updated_at
         FROM withdrawal_requests
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(limit) as Array<Record<string, unknown>>;
  }

  return rows.map((row) => {
    const statusRaw = String(row.status || "pending");
    return {
      id: Number(row.id),
      userId: Number(row.user_id),
      userWallet: String(row.user_wallet || ""),
      destinationWallet: String(row.destination_wallet || ""),
      lamports: Number(row.lamports || 0),
      status: statusRaw === "approved" ? "approved" : statusRaw === "rejected" ? "rejected" : "pending",
      payoutSignature: row.payout_signature ? String(row.payout_signature) : null,
      note: row.note ? String(row.note) : null,
      created_at: String(row.created_at || ""),
      updated_at: String(row.updated_at || "")
    };
  });
}

export function updateWithdrawalRequestStatus(input: {
  requestId: number;
  status: "approved" | "rejected";
  payoutSignature?: string;
  note?: string;
}): WithdrawalRequestRecord | null {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE withdrawal_requests
     SET status = ?, payout_signature = ?, note = COALESCE(?, note), updated_at = ?
     WHERE id = ? AND status = 'pending'`
  ).run(input.status, input.payoutSignature || null, input.note || null, now, input.requestId);

  return getWithdrawalRequestById(input.requestId);
}

export function putNonce(wallet: string, nonce: string, ttlMs = 5 * 60 * 1000): void {
  const now = new Date().toISOString();
  const expiresAt = Date.now() + ttlMs;
  db.prepare(
    "INSERT INTO auth_nonces (wallet, nonce, expires_at, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(wallet) DO UPDATE SET nonce = excluded.nonce, expires_at = excluded.expires_at, created_at = excluded.created_at"
  ).run(wallet, nonce, expiresAt, now);
}

export function consumeNonce(wallet: string, nonce: string): boolean {
  const row = db
    .prepare("SELECT wallet, nonce, expires_at FROM auth_nonces WHERE wallet = ?")
    .get(wallet) as { nonce: string; expires_at: number } | undefined;

  if (!row) return false;

  const valid = row.nonce === nonce && row.expires_at > Date.now();
  if (valid) {
    db.prepare("DELETE FROM auth_nonces WHERE wallet = ?").run(wallet);
  }

  return valid;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getUsage(userId: number): UsageRecord {
  const day = todayKey();
  const row = db
    .prepare("SELECT signal_calls, chat_calls FROM usage_daily WHERE user_id = ? AND day = ?")
    .get(userId, day) as UsageRecord | undefined;
  return row || { signal_calls: 0, chat_calls: 0 };
}

export function incrementUsage(userId: number, field: "signal_calls" | "chat_calls"): UsageRecord {
  const day = todayKey();
  db.prepare(
    "INSERT INTO usage_daily (user_id, day, signal_calls, chat_calls) VALUES (?, ?, 0, 0) ON CONFLICT(user_id, day) DO NOTHING"
  ).run(userId, day);

  db.prepare(`UPDATE usage_daily SET ${field} = ${field} + 1 WHERE user_id = ? AND day = ?`).run(
    userId,
    day
  );

  return getUsage(userId);
}

export function saveSignal(input: {
  userId: number;
  mint: string;
  action: string;
  confidence: number;
  entryLow?: number;
  entryHigh?: number;
  stopLoss?: number;
  takeProfit1?: number;
  takeProfit2?: number;
  verdict?: string;
  score?: number;
  reasoning: string;
  snapshotJson: string;
  source: string;
}): number {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO signals (
        user_id, mint, action, confidence, entry_low, entry_high, stop_loss, take_profit_1, take_profit_2,
        verdict, score, reasoning, snapshot_json, source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.userId,
      input.mint,
      input.action,
      input.confidence,
      input.entryLow ?? null,
      input.entryHigh ?? null,
      input.stopLoss ?? null,
      input.takeProfit1 ?? null,
      input.takeProfit2 ?? null,
      input.verdict ?? null,
      input.score ?? null,
      input.reasoning,
      input.snapshotJson,
      input.source,
      now
    );

  return Number(result.lastInsertRowid);
}

export function resolveForecast(input: {
  userId: number;
  signalId: number;
  won: boolean;
  pnlPct: number;
  note?: string;
}): void {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO forecasts (user_id, signal_id, won, pnl_pct, note, resolved_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(input.userId, input.signalId, input.won ? 1 : 0, input.pnlPct, input.note || null, now);
}

export function setWatchlist(userId: number, mints: string[]): void {
  const now = new Date().toISOString();
  const deduped = Array.from(new Set(mints.map((value) => value.trim()).filter(Boolean))).slice(0, 5);
  if (deduped.length === 0) {
    throw new Error("watchlist must contain at least one mint");
  }

  db.prepare(
    "INSERT INTO watchlists (user_id, mints_csv, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET mints_csv = excluded.mints_csv, updated_at = excluded.updated_at"
  ).run(userId, deduped.join(","), now);
}

export function getWatchlist(userId: number): string[] {
  const row = db
    .prepare("SELECT mints_csv FROM watchlists WHERE user_id = ?")
    .get(userId) as { mints_csv: string } | undefined;
  if (!row?.mints_csv) {
    return [];
  }

  return row.mints_csv
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 5);
}

export function getDashboardStats(userId: number): Record<string, unknown> {
  const usage = getUsage(userId);

  const signalStats = db
    .prepare(
      "SELECT COUNT(*) as total_signals, AVG(confidence) as avg_confidence FROM signals WHERE user_id = ?"
    )
    .get(userId) as { total_signals: number; avg_confidence: number | null };

  const forecastStats = db
    .prepare(
      "SELECT COUNT(*) as total, SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) as wins, AVG(pnl_pct) as avg_pnl FROM forecasts WHERE user_id = ?"
    )
    .get(userId) as { total: number; wins: number | null; avg_pnl: number | null };

  const lastSignals = db
    .prepare(
      "SELECT id, mint, action, confidence, verdict, score, created_at FROM signals WHERE user_id = ? ORDER BY id DESC LIMIT 8"
    )
    .all(userId) as Array<Record<string, unknown>>;

  const wins = Number(forecastStats.wins || 0);
  const total = Number(forecastStats.total || 0);
  const losses = total - wins;
  const watchlist = getWatchlist(userId);

  return {
    usageToday: usage,
    watchlist,
    totals: {
      signals: Number(signalStats.total_signals || 0),
      forecasts: total,
      wins,
      losses,
      winRatePct: total ? Number(((wins / total) * 100).toFixed(2)) : 0,
      avgPnlPct: Number((forecastStats.avg_pnl || 0).toFixed?.(2) || 0)
    },
    quality: {
      avgSignalConfidence: Number((signalStats.avg_confidence || 0).toFixed?.(2) || 0),
      snipes: wins
    },
    recentSignals: lastSignals
  };
}

export function getAutoTradeConfig(userId: number): AutoTradeConfigRecord {
  const row = db
    .prepare(
      `SELECT enabled, mode, min_pattern_score, min_confidence, max_connected_holder_pct,
              require_kill_switch_pass, max_position_usd, scan_interval_sec, updated_at
       FROM autotrade_configs WHERE user_id = ?`
    )
    .get(userId) as
    | {
        enabled: number;
        mode: string;
        min_pattern_score: number;
        min_confidence: number;
        max_connected_holder_pct: number;
        require_kill_switch_pass: number;
        max_position_usd: number;
        scan_interval_sec: number;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO autotrade_configs (
        user_id, enabled, mode, min_pattern_score, min_confidence,
        max_connected_holder_pct, require_kill_switch_pass, max_position_usd, scan_interval_sec, updated_at
      ) VALUES (?, 0, 'paper', 72, 0.75, 22, 1, 50, 30, ?)`
    ).run(userId, now);

    return {
      enabled: false,
      mode: "paper",
      minPatternScore: 72,
      minConfidence: 0.75,
      maxConnectedHolderPct: 22,
      requireKillSwitchPass: true,
      maxPositionUsd: 50,
      scanIntervalSec: 30,
      updated_at: now
    };
  }

  return {
    enabled: Boolean(row.enabled),
    mode: row.mode === "live" ? "live" : "paper",
    minPatternScore: Number(row.min_pattern_score || 72),
    minConfidence: Number(row.min_confidence || 0.75),
    maxConnectedHolderPct: Number(row.max_connected_holder_pct || 22),
    requireKillSwitchPass: Boolean(row.require_kill_switch_pass),
    maxPositionUsd: Number(row.max_position_usd || 50),
    scanIntervalSec: Number(row.scan_interval_sec || 30),
    updated_at: row.updated_at
  };
}

export function putAutoTradeConfig(
  userId: number,
  input: {
    enabled: boolean;
    mode: "paper" | "live";
    minPatternScore: number;
    minConfidence: number;
    maxConnectedHolderPct: number;
    requireKillSwitchPass: boolean;
    maxPositionUsd: number;
    scanIntervalSec: number;
  }
): AutoTradeConfigRecord {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO autotrade_configs (
      user_id, enabled, mode, min_pattern_score, min_confidence, max_connected_holder_pct,
      require_kill_switch_pass, max_position_usd, scan_interval_sec, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      enabled = excluded.enabled,
      mode = excluded.mode,
      min_pattern_score = excluded.min_pattern_score,
      min_confidence = excluded.min_confidence,
      max_connected_holder_pct = excluded.max_connected_holder_pct,
      require_kill_switch_pass = excluded.require_kill_switch_pass,
      max_position_usd = excluded.max_position_usd,
      scan_interval_sec = excluded.scan_interval_sec,
      updated_at = excluded.updated_at`
  ).run(
    userId,
    input.enabled ? 1 : 0,
    input.mode,
    input.minPatternScore,
    input.minConfidence,
    input.maxConnectedHolderPct,
    input.requireKillSwitchPass ? 1 : 0,
    input.maxPositionUsd,
    input.scanIntervalSec,
    now
  );

  return getAutoTradeConfig(userId);
}

export function saveAutoTradeRun(input: {
  userId: number;
  mode: "paper" | "live";
  scannedCount: number;
  buyCandidates: number;
  skippedCount: number;
  simulatedExposureUsd: number;
  expectedPnlPct: number;
}): number {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO autotrade_runs (
        user_id, mode, scanned_count, buy_candidates, skipped_count,
        simulated_exposure_usd, expected_pnl_pct, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.userId,
      input.mode,
      input.scannedCount,
      input.buyCandidates,
      input.skippedCount,
      input.simulatedExposureUsd,
      input.expectedPnlPct,
      now
    );

  return Number(result.lastInsertRowid);
}

export function getAutoTradePerformance(userId: number, limit = 30): Record<string, unknown> {
  const safeLimit = Math.max(5, Math.min(100, Number(limit || 30)));
  const recentRuns = db
    .prepare(
      `SELECT id, mode, scanned_count, buy_candidates, skipped_count, simulated_exposure_usd, expected_pnl_pct, created_at
       FROM autotrade_runs
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(userId, safeLimit) as Array<{
    id: number;
    mode: string;
    scanned_count: number;
    buy_candidates: number;
    skipped_count: number;
    simulated_exposure_usd: number;
    expected_pnl_pct: number;
    created_at: string;
  }>;

  const totals = db
    .prepare(
      `SELECT
        COUNT(*) as runs,
        SUM(scanned_count) as scanned,
        SUM(buy_candidates) as buy_candidates,
        SUM(skipped_count) as skipped,
        SUM(simulated_exposure_usd) as total_exposure_usd,
        AVG(expected_pnl_pct) as avg_expected_pnl_pct
       FROM autotrade_runs
       WHERE user_id = ?`
    )
    .get(userId) as {
    runs: number;
    scanned: number | null;
    buy_candidates: number | null;
    skipped: number | null;
    total_exposure_usd: number | null;
    avg_expected_pnl_pct: number | null;
  };

  const runs = Number(totals.runs || 0);
  const buyCandidates = Number(totals.buy_candidates || 0);
  const scanned = Number(totals.scanned || 0);
  return {
    totals: {
      runs,
      scanned,
      buyCandidates,
      skipped: Number(totals.skipped || 0),
      acceptanceRatePct: scanned ? Number(((buyCandidates / scanned) * 100).toFixed(2)) : 0,
      totalExposureUsd: Number((totals.total_exposure_usd || 0).toFixed(2)),
      avgExpectedPnlPct: Number((totals.avg_expected_pnl_pct || 0).toFixed(2))
    },
    recentRuns: recentRuns.map((row) => ({
      id: row.id,
      mode: row.mode === "live" ? "live" : "paper",
      scannedCount: row.scanned_count,
      buyCandidates: row.buy_candidates,
      skippedCount: row.skipped_count,
      simulatedExposureUsd: Number(row.simulated_exposure_usd.toFixed(2)),
      expectedPnlPct: Number(row.expected_pnl_pct.toFixed(2)),
      created_at: row.created_at
    }))
  };
}

export function getAutoTradeExecutionConfig(userId: number): AutoTradeExecutionConfigRecord {
  const row = db
    .prepare(
      `SELECT enabled, mode, trade_amount_usd, max_open_positions, tp_pct, sl_pct, trailing_stop_pct,
              max_hold_minutes, cooldown_sec, poll_interval_sec, updated_at
       FROM autotrade_execution_configs WHERE user_id = ?`
    )
    .get(userId) as
    | {
        enabled: number;
        mode: string;
        trade_amount_usd: number;
        max_open_positions: number;
        tp_pct: number;
        sl_pct: number;
        trailing_stop_pct: number;
        max_hold_minutes: number;
        cooldown_sec: number;
        poll_interval_sec: number;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO autotrade_execution_configs (
        user_id, enabled, mode, trade_amount_usd, max_open_positions, tp_pct, sl_pct, trailing_stop_pct,
        max_hold_minutes, cooldown_sec, poll_interval_sec, updated_at
      ) VALUES (?, 0, 'paper', 25, 3, 8, 4, 3, 120, 30, 15, ?)`
    ).run(userId, now);

    return {
      enabled: false,
      mode: "paper",
      tradeAmountUsd: 25,
      maxOpenPositions: 3,
      tpPct: 8,
      slPct: 4,
      trailingStopPct: 3,
      maxHoldMinutes: 120,
      cooldownSec: 30,
      pollIntervalSec: 15,
      updated_at: now
    };
  }

  return {
    enabled: Boolean(row.enabled),
    mode: row.mode === "live" ? "live" : "paper",
    tradeAmountUsd: Number(row.trade_amount_usd || 25),
    maxOpenPositions: Number(row.max_open_positions || 3),
    tpPct: Number(row.tp_pct || 8),
    slPct: Number(row.sl_pct || 4),
    trailingStopPct: Number(row.trailing_stop_pct || 3),
    maxHoldMinutes: Number(row.max_hold_minutes || 120),
    cooldownSec: Number(row.cooldown_sec || 30),
    pollIntervalSec: Number(row.poll_interval_sec || 15),
    updated_at: row.updated_at
  };
}

export function putAutoTradeExecutionConfig(
  userId: number,
  input: {
    enabled: boolean;
    mode: "paper" | "live";
    tradeAmountUsd: number;
    maxOpenPositions: number;
    tpPct: number;
    slPct: number;
    trailingStopPct: number;
    maxHoldMinutes: number;
    cooldownSec: number;
    pollIntervalSec: number;
  }
): AutoTradeExecutionConfigRecord {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO autotrade_execution_configs (
      user_id, enabled, mode, trade_amount_usd, max_open_positions, tp_pct, sl_pct, trailing_stop_pct,
      max_hold_minutes, cooldown_sec, poll_interval_sec, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      enabled = excluded.enabled,
      mode = excluded.mode,
      trade_amount_usd = excluded.trade_amount_usd,
      max_open_positions = excluded.max_open_positions,
      tp_pct = excluded.tp_pct,
      sl_pct = excluded.sl_pct,
      trailing_stop_pct = excluded.trailing_stop_pct,
      max_hold_minutes = excluded.max_hold_minutes,
      cooldown_sec = excluded.cooldown_sec,
      poll_interval_sec = excluded.poll_interval_sec,
      updated_at = excluded.updated_at`
  ).run(
    userId,
    input.enabled ? 1 : 0,
    input.mode,
    input.tradeAmountUsd,
    input.maxOpenPositions,
    input.tpPct,
    input.slPct,
    input.trailingStopPct,
    input.maxHoldMinutes,
    input.cooldownSec,
    input.pollIntervalSec,
    now
  );

  return getAutoTradeExecutionConfig(userId);
}

export function listAutoTradePositions(userId: number, status?: "OPEN" | "CLOSED"): AutoTradePositionRecord[] {
  const rows = status
    ? db
        .prepare(
          `SELECT id, user_id, mint, status, mode, entry_signal_id, entry_price_usd, size_usd, qty_tokens, tp_pct, sl_pct,
                  trailing_stop_pct, max_hold_minutes, high_water_price_usd, last_price_usd, opened_at, closed_at, close_reason, pnl_pct
           FROM autotrade_positions
           WHERE user_id = ? AND status = ?
           ORDER BY id DESC`
        )
        .all(userId, status)
    : db
        .prepare(
          `SELECT id, user_id, mint, status, mode, entry_signal_id, entry_price_usd, size_usd, qty_tokens, tp_pct, sl_pct,
                  trailing_stop_pct, max_hold_minutes, high_water_price_usd, last_price_usd, opened_at, closed_at, close_reason, pnl_pct
           FROM autotrade_positions
           WHERE user_id = ?
           ORDER BY id DESC`
        )
        .all(userId);

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    userId: Number(row.user_id),
    mint: String(row.mint || ""),
    status: String(row.status || "OPEN") === "CLOSED" ? "CLOSED" : "OPEN",
    mode: String(row.mode || "paper") === "live" ? "live" : "paper",
    entrySignalId: row.entry_signal_id === null ? null : Number(row.entry_signal_id),
    entryPriceUsd: Number(row.entry_price_usd || 0),
    sizeUsd: Number(row.size_usd || 0),
    qtyTokens: Number(row.qty_tokens || 0),
    tpPct: Number(row.tp_pct || 0),
    slPct: Number(row.sl_pct || 0),
    trailingStopPct: Number(row.trailing_stop_pct || 0),
    maxHoldMinutes: Number(row.max_hold_minutes || 0),
    highWaterPriceUsd: Number(row.high_water_price_usd || 0),
    lastPriceUsd: Number(row.last_price_usd || 0),
    opened_at: String(row.opened_at || ""),
    closed_at: row.closed_at ? String(row.closed_at) : null,
    closeReason: row.close_reason ? String(row.close_reason) : null,
    pnlPct: row.pnl_pct === null ? null : Number(row.pnl_pct)
  }));
}

export function createAutoTradePosition(input: {
  userId: number;
  mint: string;
  mode: "paper" | "live";
  entrySignalId?: number | null;
  entryPriceUsd: number;
  sizeUsd: number;
  qtyTokens: number;
  tpPct: number;
  slPct: number;
  trailingStopPct: number;
  maxHoldMinutes: number;
}): AutoTradePositionRecord {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO autotrade_positions (
        user_id, mint, status, mode, entry_signal_id, entry_price_usd, size_usd, qty_tokens, tp_pct, sl_pct,
        trailing_stop_pct, max_hold_minutes, high_water_price_usd, last_price_usd, opened_at
      ) VALUES (?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.userId,
      input.mint,
      input.mode,
      input.entrySignalId ?? null,
      input.entryPriceUsd,
      input.sizeUsd,
      input.qtyTokens,
      input.tpPct,
      input.slPct,
      input.trailingStopPct,
      input.maxHoldMinutes,
      input.entryPriceUsd,
      input.entryPriceUsd,
      now
    );

  const id = Number(result.lastInsertRowid);
  const position = listAutoTradePositions(input.userId).find((item) => item.id === id);
  if (!position) {
    throw new Error("failed to create autotrade position");
  }
  return position;
}

export function updateAutoTradePositionMark(
  userId: number,
  positionId: number,
  markPriceUsd: number
): AutoTradePositionRecord | null {
  const open = db
    .prepare(
      `SELECT id, high_water_price_usd
       FROM autotrade_positions
       WHERE id = ? AND user_id = ? AND status = 'OPEN'`
    )
    .get(positionId, userId) as { id: number; high_water_price_usd: number } | undefined;
  if (!open) return null;

  const nextHighWater = Math.max(Number(open.high_water_price_usd || 0), markPriceUsd);
  db.prepare(
    `UPDATE autotrade_positions
     SET high_water_price_usd = ?, last_price_usd = ?
     WHERE id = ? AND user_id = ?`
  ).run(nextHighWater, markPriceUsd, positionId, userId);

  return listAutoTradePositions(userId).find((item) => item.id === positionId) || null;
}

export function closeAutoTradePosition(input: {
  userId: number;
  positionId: number;
  markPriceUsd: number;
  closeReason: string;
}): AutoTradePositionRecord | null {
  const open = db
    .prepare(
      `SELECT entry_price_usd
       FROM autotrade_positions
       WHERE id = ? AND user_id = ? AND status = 'OPEN'`
    )
    .get(input.positionId, input.userId) as { entry_price_usd: number } | undefined;
  if (!open) return null;

  const entry = Number(open.entry_price_usd || 0);
  const pnlPct = entry > 0 ? ((input.markPriceUsd - entry) / entry) * 100 : 0;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE autotrade_positions
     SET status = 'CLOSED', last_price_usd = ?, closed_at = ?, close_reason = ?, pnl_pct = ?
     WHERE id = ? AND user_id = ?`
  ).run(input.markPriceUsd, now, input.closeReason, pnlPct, input.positionId, input.userId);

  return listAutoTradePositions(input.userId).find((item) => item.id === input.positionId) || null;
}
