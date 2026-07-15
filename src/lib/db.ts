import fs from "node:fs";
import path from "node:path";
import { getDatabasePath, getSystemConfig } from "./config";

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
      updated_target2 REAL,
      lifecycle_status TEXT,
      close_reason TEXT,
      position_plan_started_at TEXT,
      position_plan_expires_at TEXT,
      tp2_grace_expires_at TEXT,
      profit_protection_started_at TEXT,
      break_even_price REAL,
      total_quantity REAL,
      remaining_quantity REAL,
      target_version INTEGER NOT NULL DEFAULT 1,
      realized_gross_profit_usdt REAL,
      realized_fees_usdt REAL,
      realized_net_profit_usdt REAL,
      realized_net_profit_thb REAL,
      unrealized_remaining_pnl_usdt REAL,
      final_net_profit_usdt REAL,
      final_net_profit_thb REAL
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

    CREATE TABLE IF NOT EXISTS position_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_id TEXT NOT NULL,
      dca_level INTEGER NOT NULL,
      entry_low REAL NOT NULL,
      entry_high REAL NOT NULL,
      filled_price REAL,
      stake_usdt REAL NOT NULL,
      stake_thb REAL NOT NULL,
      quantity REAL NOT NULL,
      fee_usdt REAL NOT NULL,
      entry_hit_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS target_plan_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_id TEXT NOT NULL,
      target_version INTEGER NOT NULL,
      average_entry REAL NOT NULL,
      break_even REAL NOT NULL,
      target1 REAL NOT NULL,
      target2 REAL NOT NULL,
      expected_net_tp1 REAL NOT NULL,
      expected_net_full REAL NOT NULL,
      created_at TEXT NOT NULL,
      replaced_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
    CREATE INDEX IF NOT EXISTS idx_signals_pair_status ON signals(pair, status);
    CREATE INDEX IF NOT EXISTS idx_events_signal ON signal_events(signal_id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_pair ON price_snapshots(pair, captured_at);
    CREATE INDEX IF NOT EXISTS idx_recovery_parent ON recovery_entries(parent_signal_id);
    CREATE INDEX IF NOT EXISTS idx_position_entries_signal ON position_entries(signal_id);
    CREATE INDEX IF NOT EXISTS idx_target_plan_signal ON target_plan_history(signal_id, target_version);
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
  ensureColumn(database, "signals", "lifecycle_status", "TEXT");
  ensureColumn(database, "signals", "close_reason", "TEXT");
  ensureColumn(database, "signals", "position_plan_started_at", "TEXT");
  ensureColumn(database, "signals", "position_plan_expires_at", "TEXT");
  ensureColumn(database, "signals", "tp2_grace_expires_at", "TEXT");
  ensureColumn(database, "signals", "profit_protection_started_at", "TEXT");
  ensureColumn(database, "signals", "break_even_price", "REAL");
  ensureColumn(database, "signals", "total_quantity", "REAL");
  ensureColumn(database, "signals", "remaining_quantity", "REAL");
  ensureColumn(database, "signals", "target_version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(database, "signals", "realized_gross_profit_usdt", "REAL");
  ensureColumn(database, "signals", "realized_fees_usdt", "REAL");
  ensureColumn(database, "signals", "realized_net_profit_usdt", "REAL");
  ensureColumn(database, "signals", "realized_net_profit_thb", "REAL");
  ensureColumn(database, "signals", "unrealized_remaining_pnl_usdt", "REAL");
  ensureColumn(database, "signals", "final_net_profit_usdt", "REAL");
  ensureColumn(database, "signals", "final_net_profit_thb", "REAL");
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
  const missingLifecycle = database.prepare("SELECT COUNT(*) as count FROM signals WHERE lifecycle_status IS NULL").get() as { count: number };
  if (missingLifecycle.count > 0) {
    database.exec("UPDATE signals SET lifecycle_status = status WHERE lifecycle_status IS NULL;");
  }
  backfillLegacyPositions(database);
}

function ensureColumn(database: SqliteDatabase, table: string, column: string, definition: string) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

function backfillLegacyPositions(database: SqliteDatabase) {
  const config = getSystemConfig();
  const rows = database
    .prepare(
      `SELECT signal_id, dca_level, entry_low, entry_high, average_entry_price, stake_thb, usdthb_rate, entry_hit_at, created_at
       FROM signals
       WHERE entry_hit_at IS NOT NULL
         AND signal_id NOT IN (SELECT DISTINCT signal_id FROM position_entries)`
    )
    .all() as Array<{
    signal_id: string;
    dca_level: number;
    entry_low: number;
    entry_high: number;
    average_entry_price: number | null;
    stake_thb: number;
    usdthb_rate: number;
    entry_hit_at: string | null;
    created_at: string;
  }>;
  for (const row of rows) {
    const filledPrice = row.average_entry_price || (row.entry_low + row.entry_high) / 2;
    const stakeUsdt = row.stake_thb / row.usdthb_rate;
    const quantity = stakeUsdt / filledPrice;
    const feeUsdt = stakeUsdt * (config.tradingFeePct / 100);
    const entryAt = row.entry_hit_at || row.created_at;
    database
      .prepare(
        `INSERT INTO position_entries (
          signal_id, dca_level, entry_low, entry_high, filled_price, stake_usdt, stake_thb,
          quantity, fee_usdt, entry_hit_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(row.signal_id, row.dca_level || 1, row.entry_low, row.entry_high, filledPrice, stakeUsdt, row.stake_thb, quantity, feeUsdt, entryAt, entryAt);
  }
}
