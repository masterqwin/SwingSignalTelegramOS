import fs from "node:fs";
import path from "node:path";
import { getDatabasePath } from "./config";

type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...values: unknown[]): unknown;
    all(...values: unknown[]): unknown[];
    run(...values: unknown[]): unknown;
  };
};

let db: SqliteDatabase | undefined;

export function getDb() {
  if (!db) {
    const dbPath = path.resolve(process.cwd(), getDatabasePath());
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (filename: string) => SqliteDatabase };
    db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
  }
  return db;
}

export function initSchema() {
  const database = getDb();
  database.exec(`
    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_id TEXT NOT NULL UNIQUE,
      pair TEXT NOT NULL,
      symbol TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      entry_low REAL NOT NULL,
      entry_high REAL NOT NULL,
      current_price_at_signal REAL NOT NULL,
      target1 REAL NOT NULL,
      target2 REAL NOT NULL,
      stake_thb REAL NOT NULL,
      usdthb_rate REAL NOT NULL,
      score INTEGER NOT NULL,
      risk_level TEXT NOT NULL,
      reason_th TEXT NOT NULL,
      entry_hit_at TEXT,
      target1_hit_at TEXT,
      target2_hit_at TEXT,
      cancelled_at TEXT,
      closed_at TEXT,
      max_drawdown_pct REAL DEFAULT 0,
      max_profit_pct REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS signal_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message_th TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS coin_universe (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL UNIQUE,
      pair TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1,
      min_quote_volume_usdt REAL NOT NULL DEFAULT 5000000,
      last_seen_at TEXT
    );

    CREATE TABLE IF NOT EXISTS price_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pair TEXT NOT NULL,
      symbol TEXT NOT NULL,
      price REAL NOT NULL,
      quote_volume_usdt REAL NOT NULL,
      change_pct_24h REAL NOT NULL,
      captured_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS performance_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      calculated_at TEXT NOT NULL,
      total_signals INTEGER NOT NULL,
      entry_hit_rate REAL NOT NULL,
      cancelled_count INTEGER NOT NULL,
      target1_hit_count INTEGER NOT NULL,
      target2_hit_count INTEGER NOT NULL,
      win_rate REAL NOT NULL,
      avg_expected_return REAL NOT NULL,
      avg_time_to_entry_hours REAL NOT NULL,
      avg_time_to_target_hours REAL NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
    CREATE INDEX IF NOT EXISTS idx_signals_pair_status ON signals(pair, status);
    CREATE INDEX IF NOT EXISTS idx_events_signal ON signal_events(signal_id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_pair ON price_snapshots(pair, captured_at);
  `);
}
