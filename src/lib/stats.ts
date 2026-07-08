import { getDb } from "./db";
import type { SignalRow } from "./types";

export function calculateStats() {
  const signals = getDb().prepare("SELECT * FROM signals").all() as SignalRow[];
  const totalSignals = signals.length;
  const entryHitCount = signals.filter((s) => s.entry_hit_at).length;
  const cancelledCount = signals.filter((s) => s.status === "CANCELLED").length;
  const target1HitCount = signals.filter((s) => s.target1_hit_at).length;
  const target2HitCount = signals.filter((s) => s.target2_hit_at).length;
  const closed = signals.filter((s) => s.status === "CLOSED" || s.status === "CANCELLED");
  const wins = closed.filter((s) => s.target1_hit_at).length;
  const avgExpectedReturnPct = average(signals.map((s) => ((s.target2 - s.entry_high) / s.entry_high) * 100));
  const avgTimeToEntryHours = average(signals.filter((s) => s.entry_hit_at).map((s) => hoursBetween(s.created_at, s.entry_hit_at!)));
  const avgTimeToTargetHours = average(signals.filter((s) => s.target1_hit_at).map((s) => hoursBetween(s.entry_hit_at || s.created_at, s.target1_hit_at!)));

  return {
    totalSignals,
    entryHitCount,
    cancelledCount,
    target1HitCount,
    target2HitCount,
    entryHitRate: pct(entryHitCount, totalSignals),
    winRate: pct(wins, closed.length),
    avgExpectedReturnPct,
    avgTimeToEntryHours,
    avgTimeToTargetHours
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
