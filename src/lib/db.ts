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
    db.exec("PRAGMA busy_timeout = 5000;");
    try {
      db.exec("PRAGMA journal_mode = DELETE;");
    } catch (error) {
      console.warn("[db] could not switch SQLite journal mode to DELETE", error);
    }
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
      confidence_pct INTEGER NOT NULL DEFAULT 0,
      quality_label TEXT NOT NULL DEFAULT 'C',
      position_reason_th TEXT,
      market_guard_status TEXT,
      market_guard_reason TEXT,
      risk_level TEXT NOT NULL,
      reason_th TEXT NOT NULL,
      entry_hit_at TEXT,
      target1_hit_at TEXT,
      target2_hit_at TEXT,
      cancelled_at TEXT,
      closed_at TEXT,
      max_drawdown_pct REAL DEFAULT 0,
      max_profit_pct REAL DEFAULT 0,
      is_debug INTEGER NOT NULL DEFAULT 0,
      parent_signal_id TEXT,
      dca_level INTEGER NOT NULL DEFAULT 1,
      average_entry_price REAL,
      total_position_usdt REAL,
      total_position_thb REAL,
      updated_target1 REAL,
      updated_target2 REAL
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

    CREATE TABLE IF NOT EXISTS recovery_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_signal_id TEXT NOT NULL,
      recovery_signal_id TEXT NOT NULL UNIQUE,
      pair TEXT NOT NULL,
      symbol TEXT NOT NULL,
      created_at TEXT NOT NULL,
      dca_level INTEGER NOT NULL,
      recovery_entry_price REAL NOT NULL,
      previous_entry_price REAL NOT NULL,
      previous_position_usdt REAL NOT NULL,
      new_stake_usdt REAL NOT NULL,
      new_stake_thb REAL NOT NULL,
      average_entry_price REAL NOT NULL,
      total_position_usdt REAL NOT NULL,
      total_position_thb REAL NOT NULL,
      updated_target1 REAL NOT NULL,
      updated_target2 REAL NOT NULL,
      score INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
    CREATE INDEX IF NOT EXISTS idx_signals_pair_status ON signals(pair, status);
    CREATE INDEX IF NOT EXISTS idx_events_signal ON signal_events(signal_id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_pair ON price_snapshots(pair, captured_at);
    CREATE INDEX IF NOT EXISTS idx_recovery_parent ON recovery_entries(parent_signal_id);
  `);
  ensureColumn(database, "signals", "is_debug", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "signals", "parent_signal_id", "TEXT");
  ensureColumn(database, "signals", "dca_level", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(database, "signals", "average_entry_price", "REAL");
  ensureColumn(database, "signals", "total_position_usdt", "REAL");
  ensureColumn(database, "signals", "total_position_thb", "REAL");
  ensureColumn(database, "signals", "updated_target1", "REAL");
  ensureColumn(database, "signals", "updated_target2", "REAL");
  ensureColumn(database, "signals", "confidence_pct", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "signals", "quality_label", "TEXT NOT NULL DEFAULT 'C'");
  ensureColumn(database, "signals", "position_reason_th", "TEXT");
  ensureColumn(database, "signals", "market_guard_status", "TEXT");
  ensureColumn(database, "signals", "market_guard_reason", "TEXT");
  const legacyRows = database.prepare("SELECT COUNT(*) as count FROM signals WHERE confidence_pct = 0 AND quality_label = 'C'").get() as { count: number };
  if (legacyRows.count > 0) {
    database.exec(`
      UPDATE signals
      SET
        confidence_pct = CASE
          WHEN score >= 95 THEN 78
          WHEN score >= 90 THEN 72
          WHEN score >= 85 THEN 66
          ELSE 60
        END,
        quality_label = CASE
          WHEN score >= 95 THEN 'A+'
          WHEN score >= 90 THEN 'A'
          WHEN score >= 85 THEN 'B'
          ELSE 'C'
        END,
        position_reason_th = COALESCE(position_reason_th, 'ข้อมูลเดิมก่อนมี dynamic sizing ใช้ทุนตามแผนเดิม'),
        market_guard_status = COALESCE(market_guard_status, 'normal'),
        market_guard_reason = COALESCE(market_guard_reason, 'market_guard=normal legacy_backfill')
      WHERE confidence_pct = 0 AND quality_label = 'C';
    `);
  }
}

function ensureColumn(database: SqliteDatabase, table: string, column: string, definition: string) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}
