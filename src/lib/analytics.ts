import { getSystemConfig } from "./config";
import { getDb } from "./db";
import type { MarketGuardResult, PortfolioHeat, SignalRow } from "./types";

const ACTIVE_STATUSES = ["SETUP", "ENTRY_HIT", "PRE_TARGET_1_MANAGEMENT", "TARGET1_HIT", "PROFIT_PROTECTION", "PRE_TP1_REVIEW_REQUIRED", "HOLD", "NO_MORE_DCA"];

export function calculateConfidencePct(input: {
  score: number;
  volumeRatio: number;
  distanceToSupportPct: number;
  rewardRiskRatio: number;
  rangePct: number;
  changePct: number;
  historicalQualityGrade?: string;
  marketGuard?: MarketGuardResult;
}) {
  let confidence = 35;
  confidence += input.volumeRatio >= 1.4 ? 15 : input.volumeRatio >= 1.1 ? 11 : input.volumeRatio >= 0.9 ? 6 : 0;
  confidence += input.distanceToSupportPct >= 3 && input.distanceToSupportPct <= 7 ? 14 : input.distanceToSupportPct >= 2 && input.distanceToSupportPct <= 10 ? 9 : 3;
  confidence += input.rewardRiskRatio >= 2.2 ? 14 : input.rewardRiskRatio >= 1.6 ? 10 : input.rewardRiskRatio >= 1.2 ? 5 : 0;
  confidence += input.rangePct >= 6 && input.rangePct <= 18 ? 10 : input.rangePct >= 4 && input.rangePct <= 24 ? 6 : 2;
  confidence += input.changePct >= 4 && input.changePct <= 10 ? 10 : input.changePct >= 2.5 && input.changePct <= 14 ? 6 : 2;
  confidence += input.score >= 95 ? 8 : input.score >= 90 ? 5 : 2;
  confidence += gradeBonus(input.historicalQualityGrade);
  confidence += input.marketGuard?.confidenceAdjustment ?? 0;
  return clamp(Math.round(confidence), 0, 99);
}

export function getSignalQualityLabel(score: number, confidencePct: number) {
  if (score >= 95 && confidencePct >= 75) return "A+";
  if (score >= 90 && confidencePct >= 70) return "A";
  if (score >= 85 && confidencePct >= 65) return "B";
  return "C";
}

export function isTradableQuality(label: string) {
  return label === "A+" || label === "A" || label === "B";
}

export function calculateRecommendedStake(score: number, confidencePct: number, activeExposureThb = 0) {
  const config = getSystemConfig();
  let stake = 0;
  let reason = "คะแนนผ่านขั้นต่ำ แต่คุณภาพยังควรระวัง";

  if (score >= 95) {
    stake = 25000;
    reason = "คะแนนสูงมาก + ความมั่นใจผ่านเกณฑ์";
  } else if (score >= 90) {
    stake = 20000;
    reason = "คะแนนสูง + ความมั่นใจผ่านเกณฑ์";
  } else if (score >= 85) {
    stake = 10000;
    reason = "คะแนนผ่านเกณฑ์เริ่มต้น ใช้ทุนเล็กลง";
  }

  if (confidencePct < 65) {
    stake *= 0.75;
    reason = `${reason} + ลดทุน 25% เพราะความมั่นใจต่ำกว่า 65%`;
  }

  const maxExposure = config.defaultStakeThb * config.maxActiveSignals;
  const remainingBySlots = Math.max(0, maxExposure - activeExposureThb);
  const remainingByCapital = Math.max(0, config.startingCapitalThb - activeExposureThb);
  const cappedStake = Math.max(0, Math.min(stake, remainingBySlots, remainingByCapital));

  if (cappedStake < stake) {
    reason = `${reason} + จำกัดตามกฎ exposure รวมของพอร์ต`;
  }

  return {
    stakeThb: Math.round(cappedStake),
    reasonTh: reason
  };
}

export function calculatePortfolioHeat(signals?: SignalRow[]): PortfolioHeat {
  const config = getSystemConfig();
  const activeSignals =
    signals ??
    (getDb()
      .prepare(`SELECT * FROM signals WHERE is_debug = 0 AND status IN (${ACTIVE_STATUSES.map(() => "?").join(",")})`)
      .all(...ACTIVE_STATUSES) as SignalRow[]);
  const realSignals = activeSignals.filter((signal) => !signal.is_debug);
  const activeExposureThb = realSignals.reduce((sum, signal) => sum + (signal.total_position_thb || signal.stake_thb), 0);
  const recoveryExposureThb = realSignals.reduce((sum, signal) => {
    const total = signal.total_position_thb || signal.stake_thb;
    return sum + Math.max(0, total - signal.stake_thb);
  }, 0);
  const reserveThb = Math.max(0, config.startingCapitalThb - activeExposureThb);
  const activeCoinCount = new Set(realSignals.map((signal) => signal.symbol)).size;

  return {
    startingCapitalThb: config.startingCapitalThb,
    activeExposureThb,
    reserveThb,
    reservePct: pct(reserveThb, config.startingCapitalThb),
    recoveryExposureThb,
    activeSetupCount: realSignals.length,
    activeCoinCount,
    maxActiveSignals: config.maxActiveSignals,
    heatPct: pct(activeExposureThb, config.startingCapitalThb)
  };
}

export function getHistoricalCoinQualityGrade(symbol: string) {
  const row = getDb()
    .prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN target1_hit_at IS NOT NULL THEN 1 ELSE 0 END) as target1Hits,
        SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled
      FROM signals WHERE is_debug = 0 AND symbol = ?`
    )
    .get(symbol) as { total: number; target1Hits: number; cancelled: number };

  if (!row.total || row.total < 3) return "B";
  const winRate = pct(row.target1Hits, row.total);
  const cancelRate = pct(row.cancelled, row.total);
  if (winRate >= 55 && cancelRate <= 20) return "A";
  if (winRate >= 40 && cancelRate <= 35) return "B";
  if (winRate >= 25) return "C";
  return "D";
}

export function getCoinQualityGrade(metrics: { total: number; winRate: number; cancelRate: number; avgReturnPct: number }) {
  if (metrics.total < 3) return "B";
  if (metrics.winRate >= 55 && metrics.cancelRate <= 20 && metrics.avgReturnPct >= 4) return "A";
  if (metrics.winRate >= 40 && metrics.cancelRate <= 35) return "B";
  if (metrics.winRate >= 25) return "C";
  return "D";
}

function gradeBonus(grade = "B") {
  if (grade === "A") return 4;
  if (grade === "B") return 2;
  if (grade === "C") return 0;
  return -4;
}

function pct(value: number, total: number) {
  return total > 0 ? (value / total) * 100 : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
