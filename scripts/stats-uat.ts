import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { classifyClosedSignalResult, summarizeClosedSignalResults } from "../src/lib/result-classifier";
import type { SignalRow } from "../src/lib/types";

const now = "2026-07-01T00:00:00.000Z";

function signal(overrides: Partial<SignalRow>): SignalRow {
  return {
    id: 1,
    signal_id: "UAT",
    pair: "BTC_USDT",
    symbol: "BTC",
    status: "CLOSED",
    created_at: now,
    expires_at: now,
    entry_low: 100,
    entry_high: 101,
    current_price_at_signal: 100,
    target1: 105,
    target2: 110,
    stake_thb: 20000,
    usdthb_rate: 36.5,
    score: 90,
    confidence_pct: 75,
    quality_label: "A",
    position_reason_th: null,
    market_guard_status: "normal",
    market_guard_reason: null,
    risk_level: "medium",
    reason_th: "uat",
    entry_hit_at: now,
    target1_hit_at: null,
    target2_hit_at: null,
    cancelled_at: null,
    closed_at: now,
    max_drawdown_pct: 0,
    max_profit_pct: 0,
    is_debug: 0,
    parent_signal_id: null,
    dca_level: 1,
    average_entry_price: null,
    total_position_usdt: null,
    total_position_thb: null,
    updated_target1: null,
    updated_target2: null,
    lifecycle_status: null,
    close_reason: "FULL_TARGET_CLOSED",
    position_plan_started_at: null,
    position_plan_expires_at: null,
    tp2_grace_expires_at: null,
    profit_protection_started_at: null,
    break_even_price: null,
    total_quantity: null,
    remaining_quantity: null,
    target_version: 1,
    realized_gross_profit_usdt: null,
    realized_fees_usdt: null,
    realized_net_profit_usdt: null,
    realized_net_profit_thb: null,
    unrealized_remaining_pnl_usdt: null,
    final_net_profit_usdt: 0,
    final_net_profit_thb: null,
    market_provider: "binance_spot",
    provider_version: "uat",
    source_symbol: "BTCUSDT",
    provider_migrated_at: null,
    migration_reference_price: null,
    migration_new_price: null,
    migration_price_diff_pct: null,
    provider_migration_status: "PROVIDER_MIGRATED",
    ...overrides
  };
}

async function main() {
  assert.equal(classifyClosedSignalResult(signal({ final_net_profit_usdt: 10 })), "WIN");
  assert.equal(classifyClosedSignalResult(signal({ final_net_profit_usdt: -10 })), "LOSS");
  assert.equal(classifyClosedSignalResult(signal({ final_net_profit_usdt: 0 })), "BREAKEVEN");
  assert.equal(classifyClosedSignalResult(signal({ final_net_profit_usdt: 0.005 })), "BREAKEVEN");
  assert.equal(classifyClosedSignalResult(signal({ final_net_profit_usdt: -0.005 })), "BREAKEVEN");
  assert.equal(classifyClosedSignalResult(signal({ target1_hit_at: now, final_net_profit_usdt: -5 })), "LOSS");
  assert.equal(classifyClosedSignalResult(signal({ target1_hit_at: now, final_net_profit_usdt: null })), "UNKNOWN");
  assert.equal(classifyClosedSignalResult(signal({ status: "ENTRY_HIT", closed_at: null, close_reason: null, final_net_profit_usdt: 20 })), null);
  assert.equal(classifyClosedSignalResult(signal({ final_net_profit_usdt: null, realized_net_profit_usdt: null })), "UNKNOWN");

  const summary = summarizeClosedSignalResults([
    signal({ signal_id: "W1", final_net_profit_usdt: 10 }),
    signal({ signal_id: "W2", final_net_profit_usdt: 1 }),
    signal({ signal_id: "L1", final_net_profit_usdt: -1 }),
    signal({ signal_id: "B1", final_net_profit_usdt: 0 }),
    signal({ signal_id: "U1", final_net_profit_usdt: null }),
    signal({ signal_id: "U2", final_net_profit_usdt: null }),
    signal({ signal_id: "U3", final_net_profit_usdt: null })
  ]);
  assert.equal(summary.winCount, 2);
  assert.equal(summary.lossCount, 1);
  assert.equal(summary.breakevenCount, 1);
  assert.equal(summary.unknownResultCount, 3);
  assert.equal(summary.winRateDenominator, 4);
  assert.equal(summary.winRate, 50);

  const tempDb = path.join("run", `swingsignal-stats-uat-${Date.now()}.sqlite`);
  process.env.DATABASE_PATH = tempDb;
  const { initSchema, getDb } = await import("../src/lib/db");
  const { calculateStats } = await import("../src/lib/stats");
  const { buildMonthlyReport } = await import("./monthly-report");
  initSchema();
  const db = getDb();
  const insert = db.prepare(`INSERT INTO signals (
    signal_id,pair,symbol,status,created_at,expires_at,entry_low,entry_high,current_price_at_signal,target1,target2,
    stake_thb,usdthb_rate,score,confidence_pct,quality_label,risk_level,reason_th,is_debug,closed_at,target1_hit_at,final_net_profit_usdt,close_reason
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run("W1","BTC_USDT","BTC","CLOSED","2026-06-02T00:00:00.000Z","2026-06-05T00:00:00.000Z",100,101,102,106,110,20000,36.5,90,75,"A","medium","uat",0,now,null,10,"FULL_TARGET_CLOSED");
  insert.run("L1","ETH_USDT","ETH","CLOSED","2026-06-03T00:00:00.000Z","2026-06-05T00:00:00.000Z",100,101,102,106,110,20000,36.5,90,75,"A","medium","uat",0,now,now,-5,"TP2_TIMEOUT_CLOSED");
  insert.run("B1","SOL_USDT","SOL","CLOSED","2026-06-04T00:00:00.000Z","2026-06-05T00:00:00.000Z",100,101,102,106,110,20000,36.5,90,75,"A","medium","uat",0,now,now,0,"FULL_TARGET_CLOSED");
  insert.run("U1","XRP_USDT","XRP","CLOSED","2026-06-05T00:00:00.000Z","2026-06-05T00:00:00.000Z",100,101,102,106,110,20000,36.5,90,75,"A","medium","uat",0,now,now,null,"FULL_TARGET_CLOSED");
  insert.run("OPEN","BNB_USDT","BNB","ENTRY_HIT","2026-06-06T00:00:00.000Z","2026-06-07T00:00:00.000Z",100,101,102,106,110,20000,36.5,90,75,"A","medium","uat",0,null,null,99,null);
  const stats = calculateStats();
  const report = buildMonthlyReport(new Date("2026-06-01T00:00:00.000Z"));
  assert.equal(stats.winCount, report.resultStats.winCount);
  assert.equal(stats.lossCount, report.resultStats.lossCount);
  assert.equal(stats.breakevenCount, report.resultStats.breakevenCount);
  assert.equal(stats.unknownResultCount, report.resultStats.unknownResultCount);
  assert.equal(stats.winRate, report.resultStats.winRate);
  assert.match(report.message, /[\u0E00-\u0E7F]/, "monthly report should keep Thai text");
  assert.ok(report.message.includes("\u0E0A\u0E19\u0E30: 1"));
  assert.ok(report.message.includes("\u0E41\u0E1E\u0E49: 1"));
  assert.ok(report.message.includes("\u0E40\u0E2A\u0E21\u0E2D\u0E15\u0E31\u0E27: 1"));
  assert.ok(report.message.includes("\u0E22\u0E31\u0E07\u0E2A\u0E23\u0E38\u0E1B\u0E1C\u0E25\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49: 1"));
  try { fs.unlinkSync(tempDb); } catch {}
  console.log("[stats:uat] PASS");
}

main().catch((error) => { console.error(error); process.exit(1); });
