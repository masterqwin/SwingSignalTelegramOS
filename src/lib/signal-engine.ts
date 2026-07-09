import { getSystemConfig } from "./config";
import { getDb } from "./db";
import { fetchCandles, tickerPrice, tickerQuoteVolume } from "./gateio";
import {
  calculateConfidencePct,
  calculateRecommendedStake,
  getHistoricalCoinQualityGrade,
  getSignalQualityLabel,
  isTradableQuality
} from "./analytics";
import type { Candle, GateTicker, MarketGuardResult, RecoveryPlan, SignalCandidate, SignalRow } from "./types";

const ACTIVE_STATUSES = ["SETUP", "ENTRY_HIT", "TARGET1_HIT", "HOLD", "NO_MORE_DCA"];

export async function buildCandidate(
  ticker: GateTicker,
  options: { minScore?: number; debugMode?: boolean; marketGuard?: MarketGuardResult; activeExposureThb?: number } = {}
): Promise<SignalCandidate | null> {
  const config = getSystemConfig();
  const minScore = options.minScore ?? 85;
  const debugMode = options.debugMode ?? false;
  const currentPrice = tickerPrice(ticker);
  const quoteVolume = tickerQuoteVolume(ticker);
  const changePct = Number(ticker.change_percentage);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;
  if (!debugMode && quoteVolume < config.minQuoteVolumeUsdt) return null;
  if (!debugMode && (!Number.isFinite(changePct) || changePct < 2 || changePct > 18)) return null;

  const candles = await fetchCandles(ticker.currency_pair);
  if (candles.length < 40) return null;

  const recent = candles.slice(-48);
  const support = Math.min(...recent.slice(-24).map((c) => c.low));
  const resistance = Math.max(...recent.slice(-24).map((c) => c.high));
  const avgVolume = average(recent.slice(0, -6).map((c) => c.volume));
  const recentVolume = average(recent.slice(-6).map((c) => c.volume));
  const rangePct = ((resistance - support) / currentPrice) * 100;
  const distanceToSupportPct = ((currentPrice - support) / currentPrice) * 100;

  const volumeScore = recentVolume >= avgVolume * 1.4 ? 18 : recentVolume >= avgVolume * 1.1 ? 14 : recentVolume >= avgVolume * 0.9 ? 8 : 0;
  const trendScore = changePct >= 4 && changePct <= 10 ? 20 : changePct >= 2.5 && changePct <= 14 ? 14 : 6;
  const rangeScore = rangePct >= 6 && rangePct <= 18 ? 18 : rangePct >= 4 && rangePct <= 24 ? 12 : 5;
  const pullbackScore = distanceToSupportPct >= 3 && distanceToSupportPct <= 7 ? 22 : distanceToSupportPct >= 2 && distanceToSupportPct <= 10 ? 14 : 6;
  const closeStructureScore = closesAboveSupport(recent, support) ? 14 : 0;
  const exceptional =
    recentVolume >= avgVolume * 1.6 &&
    changePct >= 5 &&
    changePct <= 9 &&
    rangePct >= 7 &&
    rangePct <= 16 &&
    distanceToSupportPct >= 3.5 &&
    distanceToSupportPct <= 6 &&
    closesAboveSupport(recent, support);

  const rawScore = 18 + trendScore + rangeScore + pullbackScore + volumeScore + closeStructureScore;
  const score = Math.min(exceptional ? 97 : 94, rawScore);
  if (score < minScore) return null;

  const supportEntryHigh = support * 1.012;
  const entryHigh = roundPrice(debugMode && supportEntryHigh >= currentPrice ? currentPrice * 0.99 : supportEntryHigh);
  const entryLow = roundPrice(debugMode && supportEntryHigh >= currentPrice ? currentPrice * 0.975 : support * 0.996);
  if (!debugMode && entryHigh >= currentPrice) return null;

  const target1 = roundPrice(entryHigh * 1.045);
  const target2 = roundPrice(entryHigh * 1.082);
  const stopProxy = entryLow * 0.965;
  const rewardRiskRatio = (target1 - entryHigh) / Math.max(entryHigh - stopProxy, entryHigh * 0.001);
  const historicalQualityGrade = getHistoricalCoinQualityGrade(ticker.currency_pair.replace("_USDT", ""));
  const confidencePct = calculateConfidencePct({
    score,
    volumeRatio: recentVolume / Math.max(avgVolume, 1),
    distanceToSupportPct,
    rewardRiskRatio,
    rangePct,
    changePct,
    historicalQualityGrade,
    marketGuard: options.marketGuard
  });
  const qualityLabel = getSignalQualityLabel(score, confidencePct);
  if (!debugMode && !isTradableQuality(qualityLabel)) return null;
  const position = calculateRecommendedStake(score, confidencePct, options.activeExposureThb ?? 0);
  if (!debugMode && position.stakeThb <= 0) return null;
  return {
    pair: ticker.currency_pair,
    symbol: ticker.currency_pair.replace("_USDT", ""),
    entryLow,
    entryHigh,
    currentPrice: roundPrice(currentPrice),
    target1,
    target2,
    score,
    confidencePct,
    qualityLabel,
    recommendedStakeThb: position.stakeThb || config.defaultStakeThb,
    positionReasonTh: position.reasonTh,
    marketGuardStatus: options.marketGuard?.status ?? "normal",
    marketGuardReason: options.marketGuard?.reason ?? "market_guard=normal",
    riskLevel: score >= 92 ? "ต่ำ-ปานกลาง" : "ปานกลาง",
    reasonTh: "ย่อใกล้แนวรับ + Volume ผ่านเกณฑ์ + มีโอกาสเด้งในกรอบ + Reward คุ้มความเสี่ยง"
  };
}

export function hasActiveSignal(pair: string) {
  const row = getDb()
    .prepare(`SELECT id FROM signals WHERE pair = ? AND is_debug = 0 AND status IN (${ACTIVE_STATUSES.map(() => "?").join(",")}) LIMIT 1`)
    .get(pair, ...ACTIVE_STATUSES);
  return Boolean(row);
}

export function canCreateMoreSignals() {
  const config = getSystemConfig();
  return getActiveSignalCount() < config.maxActiveSignals;
}

export function getActiveSignalCount() {
  const row = getDb()
    .prepare(`SELECT COUNT(*) as count FROM signals WHERE is_debug = 0 AND status IN (${ACTIVE_STATUSES.map(() => "?").join(",")})`)
    .get(...ACTIVE_STATUSES) as { count: number };
  return row.count;
}

export function createSignal(candidate: SignalCandidate, options: { isDebug?: boolean } = {}) {
  const config = getSystemConfig();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.signalExpiryDays * 24 * 60 * 60 * 1000);
  const suffix = now.getTime().toString(36).toUpperCase();
  const signalId = `${options.isDebug ? "DEBUG-" : ""}${candidate.symbol}-${suffix}`;
  getDb()
    .prepare(
      `INSERT INTO signals (
        signal_id, pair, symbol, status, created_at, expires_at, entry_low, entry_high,
        current_price_at_signal, target1, target2, stake_thb, usdthb_rate, score, confidence_pct,
        quality_label, position_reason_th, market_guard_status, market_guard_reason, risk_level, reason_th, is_debug
      ) VALUES (?, ?, ?, 'SETUP', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      signalId,
      candidate.pair,
      candidate.symbol,
      now.toISOString(),
      expiresAt.toISOString(),
      candidate.entryLow,
      candidate.entryHigh,
      candidate.currentPrice,
      candidate.target1,
      candidate.target2,
      candidate.recommendedStakeThb,
      config.usdthbRate,
      candidate.score,
      candidate.confidencePct,
      candidate.qualityLabel,
      candidate.positionReasonTh,
      candidate.marketGuardStatus,
      candidate.marketGuardReason,
      candidate.riskLevel,
      candidate.reasonTh,
      options.isDebug ? 1 : 0
    );
  return getSignalById(signalId);
}

export function getSignalById(signalId: string) {
  return getDb().prepare("SELECT * FROM signals WHERE signal_id = ?").get(signalId) as SignalRow;
}

export function buildRecoveryPlan(signal: SignalRow, ticker: GateTicker): RecoveryPlan | null {
  const config = getSystemConfig();
  if (config.debugSignal) return null;
  if (signal.status !== "ENTRY_HIT") return null;
  if (signal.is_debug) return null;

  const currentPrice = tickerPrice(ticker);
  const quoteVolume = tickerQuoteVolume(ticker);
  const changePct = Number(ticker.change_percentage) || 0;
  const currentDcaLevel = signal.dca_level || 1;
  if (currentDcaLevel >= config.maxDcaEntries) return null;
  if (quoteVolume < config.minQuoteVolumeUsdt) return null;
  if (changePct < -12) return null;

  const previousEntryPrice = signal.average_entry_price || (signal.entry_low + signal.entry_high) / 2;
  const recoveryZone = previousEntryPrice * (1 - config.recoveryDropPct / 100);
  if (currentPrice > recoveryZone) return null;

  const previousPositionUsdt = signal.total_position_usdt || signal.stake_thb / signal.usdthb_rate;
  const newStakeThb = signal.stake_thb;
  const newStakeUsdt = newStakeThb / signal.usdthb_rate;
  const totalPositionUsdt = previousPositionUsdt + newStakeUsdt;
  const totalPositionThb = totalPositionUsdt * signal.usdthb_rate;
  const averageEntryPrice = ((previousEntryPrice * previousPositionUsdt) + (currentPrice * newStakeUsdt)) / totalPositionUsdt;
  const updatedTarget1 = roundPrice(averageEntryPrice * 1.045);
  const updatedTarget2 = roundPrice(averageEntryPrice * 1.082);
  const dropScore = currentPrice <= previousEntryPrice * (1 - config.recoveryDropPct / 100) ? 30 : 0;
  const volumeScore = quoteVolume >= config.minQuoteVolumeUsdt * 1.5 ? 25 : 20;
  const structureScore = changePct > -8 ? 25 : 15;
  const dcaRoomScore = currentDcaLevel + 1 <= config.maxDcaEntries ? 20 : 0;
  const score = Math.min(100, dropScore + volumeScore + structureScore + dcaRoomScore);
  if (score < config.recoveryScoreThreshold) return null;

  return {
    parentSignalId: signal.signal_id,
    dcaLevel: currentDcaLevel + 1,
    recoveryEntryPrice: roundPrice(currentPrice),
    previousEntryPrice,
    previousPositionUsdt,
    newStakeUsdt,
    newStakeThb,
    averageEntryPrice: roundPrice(averageEntryPrice),
    totalPositionUsdt,
    totalPositionThb,
    updatedTarget1,
    updatedTarget2,
    score
  };
}

export function applyRecoveryPlan(signal: SignalRow, plan: RecoveryPlan) {
  const now = new Date().toISOString();
  const recoverySignalId = `${signal.signal_id}-DCA${plan.dcaLevel}`;
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO recovery_entries (
        parent_signal_id, recovery_signal_id, pair, symbol, created_at, dca_level,
        recovery_entry_price, previous_entry_price, previous_position_usdt, new_stake_usdt,
        new_stake_thb, average_entry_price, total_position_usdt, total_position_thb,
        updated_target1, updated_target2, score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      signal.signal_id,
      recoverySignalId,
      signal.pair,
      signal.symbol,
      now,
      plan.dcaLevel,
      plan.recoveryEntryPrice,
      plan.previousEntryPrice,
      plan.previousPositionUsdt,
      plan.newStakeUsdt,
      plan.newStakeThb,
      plan.averageEntryPrice,
      plan.totalPositionUsdt,
      plan.totalPositionThb,
      plan.updatedTarget1,
      plan.updatedTarget2,
      plan.score
    );

  getDb()
    .prepare(
      `UPDATE signals SET
        parent_signal_id = ?,
        dca_level = ?,
        average_entry_price = ?,
        total_position_usdt = ?,
        total_position_thb = ?,
        updated_target1 = ?,
        updated_target2 = ?,
        target1 = ?,
        target2 = ?
      WHERE signal_id = ?`
    )
    .run(
      signal.signal_id,
      plan.dcaLevel,
      plan.averageEntryPrice,
      plan.totalPositionUsdt,
      plan.totalPositionThb,
      plan.updatedTarget1,
      plan.updatedTarget2,
      plan.updatedTarget1,
      plan.updatedTarget2,
      signal.signal_id
    );

  return getSignalById(signal.signal_id);
}

export function recordSnapshot(ticker: GateTicker) {
  getDb()
    .prepare("INSERT INTO price_snapshots (pair, symbol, price, quote_volume_usdt, change_pct_24h, captured_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(
      ticker.currency_pair,
      ticker.currency_pair.replace("_USDT", ""),
      tickerPrice(ticker),
      tickerQuoteVolume(ticker),
      Number(ticker.change_percentage) || 0,
      new Date().toISOString()
    );
}

export function updateSignalLifecycle(signal: SignalRow, currentPrice: number) {
  const now = new Date();
  const updates: string[] = [];
  const values: unknown[] = [];
  const maxProfitPct = Math.max(signal.max_profit_pct, ((currentPrice - signal.entry_high) / signal.entry_high) * 100);
  const maxDrawdownPct = Math.min(signal.max_drawdown_pct, ((currentPrice - signal.entry_high) / signal.entry_high) * 100);
  updates.push("max_profit_pct = ?", "max_drawdown_pct = ?");
  values.push(maxProfitPct, maxDrawdownPct);

  const events: string[] = [];
  if (signal.status === "SETUP" && now >= new Date(signal.expires_at)) {
    updates.push("status = 'CANCELLED'", "cancelled_at = ?");
    values.push(now.toISOString());
    events.push("CANCEL_SIGNAL");
  } else if (signal.status === "SETUP" && currentPrice >= signal.entry_low && currentPrice <= signal.entry_high) {
    updates.push("status = 'ENTRY_HIT'", "entry_hit_at = ?");
    values.push(now.toISOString());
    events.push("ENTRY_HIT");
  } else if (signal.status === "ENTRY_HIT" && currentPrice >= signal.target2) {
    updates.push("status = 'CLOSED'", "target1_hit_at = COALESCE(target1_hit_at, ?)", "target2_hit_at = ?", "closed_at = ?");
    values.push(now.toISOString(), now.toISOString(), now.toISOString());
    events.push("TARGET_HIT_1", "TARGET_HIT_2", "SIGNAL_CLOSED");
  } else if (signal.status === "ENTRY_HIT" && currentPrice >= signal.target1) {
    updates.push("status = 'TARGET1_HIT'", "target1_hit_at = ?");
    values.push(now.toISOString());
    events.push("TARGET_HIT_1");
  } else if (signal.status === "TARGET1_HIT" && currentPrice >= signal.target2) {
    updates.push("status = 'CLOSED'", "target2_hit_at = ?", "closed_at = ?");
    values.push(now.toISOString(), now.toISOString());
    events.push("TARGET_HIT_2", "SIGNAL_CLOSED");
  }

  values.push(signal.signal_id);
  getDb().prepare(`UPDATE signals SET ${updates.join(", ")} WHERE signal_id = ?`).run(...values);
  return events;
}

export function getOpenSignals() {
  return getDb()
    .prepare(`SELECT * FROM signals WHERE is_debug = 0 AND status IN (${ACTIVE_STATUSES.map(() => "?").join(",")}) ORDER BY created_at DESC`)
    .all(...ACTIVE_STATUSES) as SignalRow[];
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function closesAboveSupport(candles: Candle[], support: number) {
  return candles.slice(-12).filter((candle) => candle.close > support).length >= 9;
}

function roundPrice(value: number) {
  if (value >= 100) return Number(value.toFixed(2));
  if (value >= 1) return Number(value.toFixed(4));
  return Number(value.toFixed(6));
}
