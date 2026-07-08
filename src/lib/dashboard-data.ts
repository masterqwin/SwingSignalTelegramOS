import { getSystemConfig } from "./config";
import { getDb, initSchema } from "./db";
import { calculateStats } from "./stats";
import type { SignalEventRow, SignalRow, SignalStatus } from "./types";

export async function getDashboardData() {
  initSchema();
  const config = getSystemConfig();
  const activeSignals = getSignalsByStatus(["SETUP", "ENTRY_HIT", "TARGET1_HIT", "HOLD", "NO_MORE_DCA"]);
  const activeExposureThb = activeSignals.reduce((sum, signal) => sum + signal.stake_thb, 0);
  return {
    config,
    activeSignals,
    activeExposureThb,
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
        AVG(((target2 - entry_high) / entry_high) * 100) as avgReturnPct
      FROM signals GROUP BY symbol ORDER BY target2Hits DESC, target1Hits DESC, total DESC`
    )
    .all() as Array<{ symbol: string; total: number; entryHits: number; target1Hits: number; target2Hits: number; avgReturnPct: number }>;
  return rows.map((row) => ({ ...row, winRate: row.total ? (row.target1Hits / row.total) * 100 : 0 }));
}

function getScoreBuckets() {
  const signals = getDb().prepare("SELECT score, target1_hit_at FROM signals").all() as Array<{ score: number; target1_hit_at: string | null }>;
  return [
    makeBucket("85-89", signals.filter((s) => s.score >= 85 && s.score <= 89)),
    makeBucket("90-94", signals.filter((s) => s.score >= 90 && s.score <= 94)),
    makeBucket("95-100", signals.filter((s) => s.score >= 95))
  ];
}

function makeBucket(label: string, rows: Array<{ target1_hit_at: string | null }>) {
  const wins = rows.filter((row) => row.target1_hit_at).length;
  return { label, count: rows.length, winRate: rows.length ? (wins / rows.length) * 100 : 0 };
}
