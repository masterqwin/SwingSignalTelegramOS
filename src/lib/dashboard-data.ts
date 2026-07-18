import { getSystemConfig } from "./config";
import { getDb, initSchema } from "./db";
import { calculateStats } from "./stats";
import { calculatePortfolioHeat, getCoinQualityGrade } from "./analytics";
import { summarizeClosedSignalResults } from "./result-classifier";
import type { SignalEventRow, SignalRow, SignalStatus } from "./types";

export async function getDashboardData() {
  initSchema();
  const config = getSystemConfig();
  const activeSignals = getSignalsByStatus([
    "SETUP",
    "ENTRY_HIT",
    "PRE_TARGET_1_MANAGEMENT",
    "TARGET1_HIT",
    "PROFIT_PROTECTION",
    "RECOVERY_SIGNAL",
    "RECOVERY_ENTRY_HIT",
    "PRE_TP1_REVIEW_REQUIRED",
    "HOLD",
    "NO_MORE_DCA"
  ]);
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
      `SELECT * FROM signals WHERE is_debug = 0 ORDER BY symbol ASC, created_at DESC`
    )
    .all() as SignalRow[];
  const bySymbol = new Map<string, SignalRow[]>();
  for (const row of rows) bySymbol.set(row.symbol, [...(bySymbol.get(row.symbol) || []), row]);
  return [...bySymbol.entries()].map(([symbol, signals]) => {
    const total = signals.length;
    const entryHits = signals.filter((row) => row.entry_hit_at).length;
    const target1Hits = signals.filter((row) => row.target1_hit_at).length;
    const target2Hits = signals.filter((row) => row.target2_hit_at).length;
    const cancelled = signals.filter((row) => row.status === "CANCELLED").length;
    const resultStats = summarizeClosedSignalResults(signals);
    const avgReturnPct = total ? signals.reduce((sum, row) => sum + ((row.target2 - row.entry_high) / row.entry_high) * 100, 0) / total : 0;
    const entryTimeRows = signals.filter((row) => row.entry_hit_at);
    const targetTimeRows = signals.filter((row) => row.target1_hit_at);
    const cancelRate = total ? (cancelled / total) * 100 : 0;
    return {
      symbol,
      total,
      entryHits,
      target1Hits,
      target2Hits,
      cancelled,
      avgReturnPct,
      avgTimeToEntryHours: average(entryTimeRows.map((row) => hoursBetween(row.created_at, row.entry_hit_at!))),
      avgTimeToTargetHours: average(targetTimeRows.map((row) => hoursBetween(row.entry_hit_at || row.created_at, row.target1_hit_at!))),
      entryHitRate: pct(entryHits, total),
      target1HitRate: pct(target1Hits, total),
      target2HitRate: pct(target2Hits, total),
      cancelRate,
      winRate: resultStats.winRate,
      winCount: resultStats.winCount,
      lossCount: resultStats.lossCount,
      breakevenCount: resultStats.breakevenCount,
      unknownResultCount: resultStats.unknownResultCount,
      qualityGrade: getCoinQualityGrade({ total, winRate: resultStats.winRate, cancelRate, avgReturnPct })
    };
  }).sort((a, b) => b.winRate - a.winRate || b.target2Hits - a.target2Hits || b.total - a.total);
}

function getScoreBuckets() {
  const signals = getDb().prepare("SELECT * FROM signals WHERE is_debug = 0").all() as SignalRow[];
  return [
    makeBucket("85-89", signals.filter((s) => s.score >= 85 && s.score <= 89)),
    makeBucket("90-94", signals.filter((s) => s.score >= 90 && s.score <= 94)),
    makeBucket("95-100", signals.filter((s) => s.score >= 95))
  ];
}

function makeBucket(label: string, rows: SignalRow[]) {
  const entryHits = rows.filter((row) => row.entry_hit_at).length;
  const resultStats = summarizeClosedSignalResults(rows);
  const avgReturn = rows.length ? rows.reduce((sum, row) => sum + ((row.target2 - row.entry_high) / row.entry_high) * 100, 0) / rows.length : 0;
  return {
    label,
    count: rows.length,
    entryHitRate: pct(entryHits, rows.length),
    winRate: resultStats.winRate,
    winCount: resultStats.winCount,
    lossCount: resultStats.lossCount,
    breakevenCount: resultStats.breakevenCount,
    unknownResultCount: resultStats.unknownResultCount,
    avgReturnPct: avgReturn
  };
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
