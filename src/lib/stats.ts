import { getDb } from "./db";
import { summarizeClosedSignalResults } from "./result-classifier";
import type { SignalRow } from "./types";

export function calculateStats() {
  const signals = getDb().prepare("SELECT * FROM signals WHERE is_debug = 0").all() as SignalRow[];
  const totalSignals = signals.length;
  const entryHitCount = signals.filter((s) => s.entry_hit_at).length;
  const cancelledCount = signals.filter((s) => s.status === "CANCELLED").length;
  const target1HitCount = signals.filter((s) => s.target1_hit_at).length;
  const target2HitCount = signals.filter((s) => s.target2_hit_at).length;
  const resultStats = summarizeClosedSignalResults(signals);
  const fullTargetClosedCount = signals.filter((s) => s.close_reason === "FULL_TARGET_CLOSED").length;
  const entryRetraceClosedCount = signals.filter((s) => s.close_reason === "ENTRY_RETRACE_CLOSED").length;
  const tp2TimeoutClosedCount = signals.filter((s) => s.close_reason === "TP2_TIMEOUT_CLOSED").length;
  const preTp1ReviewRequiredCount = signals.filter((s) => s.status === "PRE_TP1_REVIEW_REQUIRED").length;
  const profitClosed = signals.filter((s) => s.final_net_profit_usdt !== null && s.final_net_profit_usdt !== undefined);
  const avgExpectedReturnPct = average(signals.map((s) => ((s.target2 - s.entry_high) / s.entry_high) * 100));
  const avgTimeToEntryHours = average(signals.filter((s) => s.entry_hit_at).map((s) => hoursBetween(s.created_at, s.entry_hit_at!)));
  const avgTimeToTargetHours = average(signals.filter((s) => s.target1_hit_at).map((s) => hoursBetween(s.entry_hit_at || s.created_at, s.target1_hit_at!)));
  const avgTarget1NetProfitUsdt = average(signals.filter((s) => s.realized_net_profit_usdt !== null && s.realized_net_profit_usdt !== undefined).map((s) => s.realized_net_profit_usdt || 0));
  const avgFinalNetProfitUsdt = average(profitClosed.map((s) => s.final_net_profit_usdt || 0));
  const avgEntryToTarget1Hours = average(signals.filter((s) => s.entry_hit_at && s.target1_hit_at).map((s) => hoursBetween(s.entry_hit_at!, s.target1_hit_at!)));
  const avgTarget1ToCloseHours = average(signals.filter((s) => s.target1_hit_at && s.closed_at).map((s) => hoursBetween(s.target1_hit_at!, s.closed_at!)));

  return {
    totalSignals,
    entryHitCount,
    cancelledCount,
    target1HitCount,
    target2HitCount,
    entryHitRate: pct(entryHitCount, totalSignals),
    closedCount: resultStats.closedCount,
    winCount: resultStats.winCount,
    lossCount: resultStats.lossCount,
    breakevenCount: resultStats.breakevenCount,
    unknownResultCount: resultStats.unknownResultCount,
    winRateDenominator: resultStats.winRateDenominator,
    winRate: resultStats.winRate,
    decisiveWinRate: resultStats.decisiveWinRate,
    paperNetPnlUsdt: resultStats.paperNetPnlUsdt,
    avgExpectedReturnPct,
    avgTimeToEntryHours,
    avgTimeToTargetHours,
    fullTargetClosedCount,
    fullTargetClosedRate: pct(fullTargetClosedCount, resultStats.winRateDenominator),
    entryRetraceClosedCount,
    entryRetraceClosedRate: pct(entryRetraceClosedCount, resultStats.winRateDenominator),
    tp2TimeoutClosedCount,
    tp2TimeoutClosedRate: pct(tp2TimeoutClosedCount, resultStats.winRateDenominator),
    preTp1ReviewRequiredCount,
    avgTarget1NetProfitUsdt,
    avgFinalNetProfitUsdt,
    avgEntryToTarget1Hours,
    avgTarget1ToCloseHours,
    recoveryLevel1Count: signals.filter((s) => (s.dca_level || 1) === 1).length,
    recoveryLevel2Count: signals.filter((s) => (s.dca_level || 1) === 2).length,
    recoveryLevel3Count: signals.filter((s) => (s.dca_level || 1) >= 3).length
  };
}

export function persistStats() {
  const stats = calculateStats();
  getDb()
    .prepare(
      `INSERT INTO performance_stats (
        calculated_at, total_signals, entry_hit_rate, cancelled_count, target1_hit_count,
        target2_hit_count, win_rate, avg_expected_return, avg_time_to_entry_hours, avg_time_to_target_hours
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      new Date().toISOString(),
      stats.totalSignals,
      stats.entryHitRate,
      stats.cancelledCount,
      stats.target1HitCount,
      stats.target2HitCount,
      stats.winRate,
      stats.avgExpectedReturnPct,
      stats.avgTimeToEntryHours,
      stats.avgTimeToTargetHours
    );
  return stats;
}

function pct(value: number, total: number) {
  return total > 0 ? (value / total) * 100 : 0;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function hoursBetween(a: string, b: string) {
  return (new Date(b).getTime() - new Date(a).getTime()) / 36e5;
}
