import { getSystemConfig } from "./config";
import { getDb, initSchema } from "./db";
import { calculateStats } from "./stats";
import { calculatePortfolioHeat, getCoinQualityGrade } from "./analytics";
import type { SignalEventRow, SignalRow, SignalStatus } from "./types";

export async function getDashboardData() {
  initSchema();
  const config = getSystemConfig();
  const activeSignals = getSignalsByStatus(["SETUP", "ENTRY_HIT", "TARGET1_HIT", "HOLD", "NO_MORE_DCA"]);
  const activeExposureThb = activeSignals
    .filter((signal) => !signal.is_debug)
    .reduce((sum, signal) => sum + (signal.total_position_thb || signal.stake_thb), 0);
  const portfolioHeat = calculatePortfolioHeat(activeSignals);
  return {
    config,
    activeSignals,
    activeExposureThb,
    portfolioHeat,
    stats: calculateStats(),
    recentEvents: getDb().prepare("SELECT * FROM signal_events ORDER BY created_at DESC LIMIT 8").all() as SignalEventRow[],
    scoreBuckets: getScoreBuckets()
  };
}

export function getSignalsByStatus(statuses: SignalStatus[]) {
  initSchema();
  return getDb()
    .prepare(`SELECT * FROM signals WHERE status IN (${statuses.map(() => "?").join(",")}) ORDER BY created_at DESC LIMIT 200`)
    .all(...statuses) as SignalRow[];
}

export function getCoinRanking() {
  initSchema();
  const rows = getDb()
    .prepare(
      `SELECT symbol,
        COUNT(*) as total,
        SUM(CASE WHEN entry_hit_at IS NOT NULL THEN 1 ELSE 0 END) as entryHits,
        SUM(CASE WHEN target1_hit_at IS NOT NULL THEN 1 ELSE 0 END) as target1Hits,
        SUM(CASE WHEN target2_hit_at IS NOT NULL THEN 1 ELSE 0 END) as target2Hits,
        SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled,
        AVG(((target2 - entry_high) / entry_high) * 100) as avgReturnPct,
        AVG(CASE WHEN entry_hit_at IS NOT NULL THEN (julianday(entry_hit_at) - julianday(created_at)) * 24 END) as avgTimeToEntryHours,
        AVG(CASE WHEN target1_hit_at IS NOT NULL THEN (julianday(target1_hit_at) - julianday(COALESCE(entry_hit_at, created_at))) * 24 END) as avgTimeToTargetHours
      FROM signals WHERE is_debug = 0 GROUP BY symbol ORDER BY target2Hits DESC, target1Hits DESC, total DESC`
    )
    .all() as Array<{
      symbol: string;
      total: number;
      entryHits: number;
      target1Hits: number;
      target2Hits: number;
      cancelled: number;
      avgReturnPct: number | null;
      avgTimeToEntryHours: number | null;
      avgTimeToTargetHours: number | null;
    }>;
  return rows.map((row) => {
    const entryHitRate = row.total ? (row.entryHits / row.total) * 100 : 0;
    const target1HitRate = row.total ? (row.target1Hits / row.total) * 100 : 0;
    const target2HitRate = row.total ? (row.target2Hits / row.total) * 100 : 0;
    const cancelRate = row.total ? (row.cancelled / row.total) * 100 : 0;
    const winRate = target1HitRate;
    const avgReturnPct = row.avgReturnPct ?? 0;
    return {
      ...row,
      avgReturnPct,
      avgTimeToEntryHours: row.avgTimeToEntryHours ?? 0,
      avgTimeToTargetHours: row.avgTimeToTargetHours ?? 0,
      entryHitRate,
      target1HitRate,
      target2HitRate,
      cancelRate,
      winRate,
      qualityGrade: getCoinQualityGrade({ total: row.total, winRate, cancelRate, avgReturnPct })
    };
  });
}

function getScoreBuckets() {
  const signals = getDb().prepare("SELECT score, entry_hit_at, target1_hit_at, target2, entry_high FROM signals WHERE is_debug = 0").all() as Array<{
    score: number;
    entry_hit_at: string | null;
    target1_hit_at: string | null;
    target2: number;
    entry_high: number;
  }>;
  return [
    makeBucket("85-89", signals.filter((s) => s.score >= 85 && s.score <= 89)),
    makeBucket("90-94", signals.filter((s) => s.score >= 90 && s.score <= 94)),
    makeBucket("95-100", signals.filter((s) => s.score >= 95))
  ];
}

function makeBucket(label: string, rows: Array<{ entry_hit_at: string | null; target1_hit_at: string | null; target2: number; entry_high: number }>) {
  const entryHits = rows.filter((row) => row.entry_hit_at).length;
  const wins = rows.filter((row) => row.target1_hit_at).length;
  const avgReturn = rows.length ? rows.reduce((sum, row) => sum + ((row.target2 - row.entry_high) / row.entry_high) * 100, 0) / rows.length : 0;
  return {
    label,
    count: rows.length,
    entryHitRate: rows.length ? (entryHits / rows.length) * 100 : 0,
    winRate: rows.length ? (wins / rows.length) * 100 : 0,
    avgReturnPct: avgReturn
  };
}
