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
`);

export function getUserByWallet(wallet: string): UserRecord | null {
  const row = db
    .prepare("SELECT id, wallet, plan, created_at, last_login_at FROM users WHERE wallet = ?")
    .get(wallet) as UserRecord | undefined;
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
