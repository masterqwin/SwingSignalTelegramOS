import { getSystemConfig } from "./config";
import { getDb } from "./db";
import { fetchCandles, tickerPrice, tickerQuoteVolume } from "./gateio";
import {
  addDays,
  buildPositionEntry,
  calculateExitLeg,
  calculatePositionPlan,
  calculateRemainingClose,
  makeTargetPlanRow,
  roundPrice as roundLifecyclePrice
} from "./position-lifecycle";
import {
  calculateConfidencePct,
  calculateRecommendedStake,
  getHistoricalCoinQualityGrade,
  getSignalQualityLabel,
  isTradableQuality
} from "./analytics";
import type { Candle, GateTicker, MarketGuardResult, PositionEntryRow, RecoveryPlan, SignalCandidate, SignalRow } from "./types";

const ACTIVE_STATUSES = [
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
];

export interface LifecycleUpdateResult {
  events: string[];
  backfilledEntryHit: number;
  backfilledTarget1Hit: number;
  fromStatus: string;
  toStatus: string;
  closeReason: string | null;
}

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
        quality_label, position_reason_th, market_guard_status, market_guard_reason, risk_level, reason_th, is_debug,
        lifecycle_status, target_version
      ) VALUES (?, ?, ?, 'SETUP', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SETUP', 1)`
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

export function buildRecoveryPlan(signal: SignalRow, ticker: GateTicker, options: { marketGuard?: MarketGuardResult; activeExposureThb?: number } = {}): RecoveryPlan | null {
  const config = getSystemConfig();
  if (config.debugSignal) return null;
  if (signal.status !== "ENTRY_HIT" && signal.status !== "PRE_TARGET_1_MANAGEMENT") return null;
  if (signal.is_debug) return null;
  if (signal.target1_hit_at) return null;
  if (signal.market_guard_status === "risk_off" || options.marketGuard?.status === "risk_off") return null;

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

  const entries = ensurePositionEntries(signal, currentPrice);
  const previousPositionUsdt = entries.reduce((sum, entry) => sum + entry.stake_usdt, 0) || signal.stake_thb / signal.usdthb_rate;
  const newStakeThb = signal.stake_thb;
  const activeExposureThb = options.activeExposureThb ?? 0;
  const maxPortfolioExposureThb = Math.min(config.startingCapitalThb, config.defaultStakeThb * config.maxActiveSignals);
  if (activeExposureThb + newStakeThb > maxPortfolioExposureThb) {
    console.log(`[recovery] skip #${signal.signal_id} reason=portfolio_heat_limit`);
    return null;
  }
  const now = new Date().toISOString();
  const newEntry = buildPositionEntry(
    {
      dcaLevel: currentDcaLevel + 1,
      entryLow: roundPrice(currentPrice * 0.995),
      entryHigh: roundPrice(currentPrice * 1.005),
      filledPrice: currentPrice,
      stakeThb: newStakeThb,
      usdthbRate: signal.usdthb_rate,
      createdAt: now
    },
    config
  );
  const nextEntries = [...entries, { ...newEntry, id: 0, signal_id: signal.signal_id }];
  const targetPlan = calculatePositionPlan(nextEntries, config);
  if (!targetPlan) {
    console.log(`[recovery] skip #${signal.signal_id} reason=no_profitable_exit_plan`);
    return null;
  }
  const newStakeUsdt = newEntry.stake_usdt;
  const totalPositionUsdt = nextEntries.reduce((sum, entry) => sum + entry.stake_usdt, 0);
  const totalPositionThb = totalPositionUsdt * signal.usdthb_rate;
  const dropScore = currentPrice <= previousEntryPrice * (1 - config.recoveryDropPct / 100) ? 30 : 0;
  const volumeScore = quoteVolume >= config.minQuoteVolumeUsdt * 1.5 ? 25 : 20;
  const structureScore = changePct > -8 ? 25 : 15;
  const dcaRoomScore = currentDcaLevel + 1 <= config.maxDcaEntries ? 20 : 0;
  const score = Math.min(100, dropScore + volumeScore + structureScore + dcaRoomScore);
  if (score < config.recoveryScoreThreshold) return null;

  return {
    parentSignalId: signal.signal_id,
    dcaLevel: currentDcaLevel + 1,
    recoveryEntryLow: newEntry.entry_low,
    recoveryEntryHigh: newEntry.entry_high,
    recoveryEntryPrice: roundPrice(currentPrice),
    previousEntryPrice,
    previousPositionUsdt,
    newStakeUsdt,
    newStakeThb,
    newQuantity: newEntry.quantity,
    newFeeUsdt: newEntry.fee_usdt,
    totalQuantity: targetPlan.totalQuantity,
    totalCostUsdt: targetPlan.totalCostUsdt,
    averageEntryPrice: targetPlan.averageEntry,
    breakEvenPrice: targetPlan.breakEven,
    totalPositionUsdt,
    totalPositionThb,
    updatedTarget1: targetPlan.target1,
    updatedTarget2: targetPlan.target2,
    expectedNetTp1Usdt: targetPlan.expectedNetTp1,
    expectedNetFullUsdt: targetPlan.expectedNetFull,
    targetVersion: (signal.target_version || 1) + 1,
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
      `INSERT INTO position_entries (
        signal_id, dca_level, entry_low, entry_high, filled_price, stake_usdt, stake_thb,
        quantity, fee_usdt, entry_hit_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      signal.signal_id,
      plan.dcaLevel,
      plan.recoveryEntryLow,
      plan.recoveryEntryHigh,
      plan.recoveryEntryPrice,
      plan.newStakeUsdt,
      plan.newStakeThb,
      plan.newQuantity,
      plan.newFeeUsdt,
      now,
      now
    );

  getDb().prepare("UPDATE target_plan_history SET replaced_at = ? WHERE signal_id = ? AND replaced_at IS NULL").run(now, signal.signal_id);
  getDb()
    .prepare(
      `INSERT INTO target_plan_history (
        signal_id, target_version, average_entry, break_even, target1, target2,
        expected_net_tp1, expected_net_full, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(signal.signal_id, plan.targetVersion, plan.averageEntryPrice, plan.breakEvenPrice, plan.updatedTarget1, plan.updatedTarget2, plan.expectedNetTp1Usdt, plan.expectedNetFullUsdt, now);

  getDb()
    .prepare("INSERT INTO signal_events (signal_id, event_type, message_th, created_at) VALUES (?, ?, ?, ?)")
    .run(
      signal.signal_id,
      "TARGET_PLAN_UPDATED",
      `Target plan updated to v${plan.targetVersion}: avg=${plan.averageEntryPrice}, break_even=${plan.breakEvenPrice}, tp1=${plan.updatedTarget1}, tp2=${plan.updatedTarget2}`,
      now
    );

  getDb()
    .prepare(
      `UPDATE signals SET
        parent_signal_id = ?,
        dca_level = ?,
        status = 'PRE_TARGET_1_MANAGEMENT',
        lifecycle_status = 'PRE_TARGET_1_MANAGEMENT',
        average_entry_price = ?,
        break_even_price = ?,
        total_quantity = ?,
        remaining_quantity = ?,
        total_position_usdt = ?,
        total_position_thb = ?,
        updated_target1 = ?,
        updated_target2 = ?,
        target1 = ?,
        target2 = ?,
        target_version = ?,
        position_plan_started_at = ?,
        position_plan_expires_at = ?
      WHERE signal_id = ?`
    )
    .run(
      signal.signal_id,
      plan.dcaLevel,
      plan.averageEntryPrice,
      plan.breakEvenPrice,
      plan.totalQuantity,
      plan.totalQuantity,
      plan.totalPositionUsdt,
      plan.totalPositionThb,
      plan.updatedTarget1,
      plan.updatedTarget2,
      plan.updatedTarget1,
      plan.updatedTarget2,
      plan.targetVersion,
      now,
      addDays(new Date(now), getSystemConfig().positionPlanDays).toISOString(),
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

export function updateSignalLifecycle(signal: SignalRow, currentPrice: number): LifecycleUpdateResult {
  const config = getSystemConfig();
  const now = new Date();
  const fromStatus = signal.status;
  const normalized = normalizeLegacyLifecycle(signal, currentPrice, now, config);
  signal = normalized.signal;
  const updates: string[] = [];
  const values: unknown[] = [];
  const maxProfitPct = Math.max(signal.max_profit_pct, ((currentPrice - signal.entry_high) / signal.entry_high) * 100);
  const maxDrawdownPct = Math.min(signal.max_drawdown_pct, ((currentPrice - signal.entry_high) / signal.entry_high) * 100);
  updates.push("max_profit_pct = ?", "max_drawdown_pct = ?");
  values.push(maxProfitPct, maxDrawdownPct);

  const events: string[] = [];
  if (signal.status === "SETUP" && now >= new Date(signal.expires_at)) {
    updates.push("status = 'CANCELLED'", "lifecycle_status = 'CANCELLED'", "close_reason = 'CANCELLED'", "cancelled_at = ?");
    values.push(now.toISOString());
    events.push("CANCEL_SIGNAL");
  } else if (signal.status === "SETUP" && currentPrice >= signal.entry_low && currentPrice <= signal.entry_high) {
    const nowIso = now.toISOString();
    const entry = buildPositionEntry(
      {
        dcaLevel: 1,
        entryLow: signal.entry_low,
        entryHigh: signal.entry_high,
        filledPrice: currentPrice,
        stakeThb: signal.stake_thb,
        usdthbRate: signal.usdthb_rate,
        createdAt: nowIso
      },
      config
    );
    const plan = calculatePositionPlan([entry], config);
    if (!plan) {
      console.log(`[lifecycle] skip entry #${signal.signal_id} reason=no_profitable_exit_plan`);
      return makeLifecycleResult(events, normalized, fromStatus, signal);
    }
    insertPositionEntry(signal.signal_id, entry);
    insertTargetPlan(signal, plan, 1, nowIso);
    updates.push(
      "status = 'PRE_TARGET_1_MANAGEMENT'",
      "lifecycle_status = 'PRE_TARGET_1_MANAGEMENT'",
      "entry_hit_at = ?",
      "position_plan_started_at = ?",
      "position_plan_expires_at = ?",
      "average_entry_price = ?",
      "break_even_price = ?",
      "total_quantity = ?",
      "remaining_quantity = ?",
      "total_position_usdt = ?",
      "total_position_thb = ?",
      "target1 = ?",
      "target2 = ?",
      "updated_target1 = ?",
      "updated_target2 = ?",
      "target_version = 1"
    );
    values.push(
      nowIso,
      nowIso,
      addDays(now, config.positionPlanDays).toISOString(),
      plan.averageEntry,
      plan.breakEven,
      plan.totalQuantity,
      plan.totalQuantity,
      plan.totalCostUsdt,
      plan.totalStakeThb,
      plan.target1,
      plan.target2,
      plan.target1,
      plan.target2
    );
    events.push("ENTRY_HIT");
  } else if ((signal.status === "ENTRY_HIT" || signal.status === "PRE_TARGET_1_MANAGEMENT") && currentPrice >= signal.target1) {
    const entries = ensurePositionEntries(signal, currentPrice);
    const target1Leg = calculateExitLeg(entries, signal.target1, 0.5, config);
    updates.push(
      "status = 'PROFIT_PROTECTION'",
      "lifecycle_status = 'PROFIT_PROTECTION'",
      "target1_hit_at = ?",
      "profit_protection_started_at = ?",
      "tp2_grace_expires_at = ?",
      "remaining_quantity = ?",
      "realized_gross_profit_usdt = ?",
      "realized_fees_usdt = ?",
      "realized_net_profit_usdt = ?",
      "realized_net_profit_thb = ?"
    );
    const totalQuantity = signal.total_quantity || entries.reduce((sum, entry) => sum + entry.quantity, 0);
    values.push(now.toISOString(), now.toISOString(), addDays(now, config.tp2GraceDays).toISOString(), totalQuantity * 0.5, target1Leg.grossProfitUsdt, target1Leg.feesUsdt, target1Leg.netProfitUsdt, target1Leg.netProfitUsdt * signal.usdthb_rate);
    events.push("TARGET_HIT_1", "PROFIT_PROTECTION_STARTED");
  } else if ((signal.status === "ENTRY_HIT" || signal.status === "PRE_TARGET_1_MANAGEMENT") && signal.position_plan_expires_at && now >= new Date(signal.position_plan_expires_at)) {
    updates.push("status = 'PRE_TP1_REVIEW_REQUIRED'", "lifecycle_status = 'PRE_TP1_REVIEW_REQUIRED'");
    events.push("PRE_TP1_REVIEW_REQUIRED");
  } else if (signal.status === "PROFIT_PROTECTION" && currentPrice >= signal.target2) {
    const entries = ensurePositionEntries(signal, currentPrice);
    const target2Leg = calculateRemainingClose(signal, entries, signal.target2, config);
    const finalNet = (signal.realized_net_profit_usdt || 0) + target2Leg.netProfitUsdt;
    updates.push(
      "status = 'CLOSED'",
      "lifecycle_status = 'CLOSED'",
      "close_reason = 'FULL_TARGET_CLOSED'",
      "target2_hit_at = ?",
      "closed_at = ?",
      "remaining_quantity = 0",
      "realized_gross_profit_usdt = ?",
      "realized_fees_usdt = ?",
      "realized_net_profit_usdt = ?",
      "realized_net_profit_thb = ?",
      "final_net_profit_usdt = ?",
      "final_net_profit_thb = ?"
    );
    const gross = (signal.realized_gross_profit_usdt || 0) + target2Leg.grossProfitUsdt;
    const fees = (signal.realized_fees_usdt || 0) + target2Leg.feesUsdt;
    values.push(now.toISOString(), now.toISOString(), gross, fees, finalNet, finalNet * signal.usdthb_rate, finalNet, finalNet * signal.usdthb_rate);
    events.push("TARGET_HIT_2", "SIGNAL_CLOSED");
  } else if (signal.status === "PROFIT_PROTECTION" && currentPrice <= protectedEntryThreshold(signal, config)) {
    const entries = ensurePositionEntries(signal, currentPrice);
    const remainingLeg = calculateRemainingClose(signal, entries, currentPrice, config);
    const finalNet = (signal.realized_net_profit_usdt || 0) + remainingLeg.netProfitUsdt;
    updates.push(
      "status = 'ENTRY_RETRACE_CLOSED'",
      "lifecycle_status = 'ENTRY_RETRACE_CLOSED'",
      "close_reason = 'ENTRY_RETRACE_CLOSED'",
      "closed_at = ?",
      "remaining_quantity = 0",
      "unrealized_remaining_pnl_usdt = ?",
      "final_net_profit_usdt = ?",
      "final_net_profit_thb = ?"
    );
    values.push(now.toISOString(), remainingLeg.netProfitUsdt, finalNet, finalNet * signal.usdthb_rate);
    events.push("ENTRY_RETRACE_CLOSED", "SIGNAL_CLOSED");
  } else if (signal.status === "PROFIT_PROTECTION" && signal.tp2_grace_expires_at && now >= new Date(signal.tp2_grace_expires_at)) {
    const entries = ensurePositionEntries(signal, currentPrice);
    const remainingLeg = calculateRemainingClose(signal, entries, currentPrice, config);
    const finalNet = (signal.realized_net_profit_usdt || 0) + remainingLeg.netProfitUsdt;
    updates.push(
      "status = 'TP2_TIMEOUT_CLOSED'",
      "lifecycle_status = 'TP2_TIMEOUT_CLOSED'",
      "close_reason = 'TP2_TIMEOUT_CLOSED'",
      "closed_at = ?",
      "remaining_quantity = 0",
      "unrealized_remaining_pnl_usdt = ?",
      "final_net_profit_usdt = ?",
      "final_net_profit_thb = ?"
    );
    values.push(now.toISOString(), remainingLeg.netProfitUsdt, finalNet, finalNet * signal.usdthb_rate);
    events.push("TP2_TIMEOUT_CLOSED", "SIGNAL_CLOSED");
  }

  values.push(signal.signal_id);
  getDb().prepare(`UPDATE signals SET ${updates.join(", ")} WHERE signal_id = ?`).run(...values);
  const updated = getSignalById(signal.signal_id);
  return makeLifecycleResult(events, normalized, fromStatus, updated);
}

export function getOpenSignals() {
  return getDb()
    .prepare(`SELECT * FROM signals WHERE is_debug = 0 AND status IN (${ACTIVE_STATUSES.map(() => "?").join(",")}) ORDER BY created_at DESC`)
    .all(...ACTIVE_STATUSES) as SignalRow[];
}

export function getPositionEntries(signalId: string) {
  return getDb().prepare("SELECT * FROM position_entries WHERE signal_id = ? ORDER BY dca_level ASC, id ASC").all(signalId) as PositionEntryRow[];
}

function normalizeLegacyLifecycle(signal: SignalRow, currentPrice: number, now: Date, config = getSystemConfig()) {
  let backfilledEntryHit = 0;
  let backfilledTarget1Hit = 0;

  if (signal.status === "ENTRY_HIT" && signal.entry_hit_at) {
    const entries = ensurePositionEntries(signal, currentPrice);
    const totalQuantity = signal.total_quantity || entries.reduce((sum, entry) => sum + entry.quantity, 0);
    const totalPositionUsdt = signal.total_position_usdt || entries.reduce((sum, entry) => sum + entry.stake_usdt, 0);
    const totalPositionThb = signal.total_position_thb || entries.reduce((sum, entry) => sum + entry.stake_thb, 0);
    const averageEntry = signal.average_entry_price || weightedAverage(entries) || (signal.entry_low + signal.entry_high) / 2;
    const breakEven = signal.break_even_price || averageEntry * (1 + (config.tradingFeePct * 2 + config.slippageBufferPct) / 100);
    const startedAt = signal.position_plan_started_at || signal.entry_hit_at;
    const expiresAt = signal.position_plan_expires_at || addDays(new Date(startedAt), config.positionPlanDays).toISOString();
    getDb()
      .prepare(
        `UPDATE signals SET
          status = 'PRE_TARGET_1_MANAGEMENT',
          lifecycle_status = 'PRE_TARGET_1_MANAGEMENT',
          position_plan_started_at = ?,
          position_plan_expires_at = ?,
          average_entry_price = COALESCE(average_entry_price, ?),
          break_even_price = COALESCE(break_even_price, ?),
          total_quantity = COALESCE(total_quantity, ?),
          remaining_quantity = COALESCE(remaining_quantity, ?),
          total_position_usdt = COALESCE(total_position_usdt, ?),
          total_position_thb = COALESCE(total_position_thb, ?)
        WHERE signal_id = ?`
      )
      .run(startedAt, expiresAt, averageEntry, breakEven, totalQuantity, totalQuantity, totalPositionUsdt, totalPositionThb, signal.signal_id);
    backfilledEntryHit = 1;
    signal = getSignalById(signal.signal_id);
    console.log(`[lifecycle] signal=${signal.signal_id} from=ENTRY_HIT to=PRE_TARGET_1_MANAGEMENT backfill=true`);
  }

  if (signal.status === "TARGET1_HIT" && signal.target1_hit_at) {
    const entries = ensurePositionEntries(signal, currentPrice);
    const totalQuantity = signal.total_quantity || entries.reduce((sum, entry) => sum + entry.quantity, 0);
    const remainingQuantity = signal.remaining_quantity || totalQuantity * 0.5;
    const averageEntry = signal.average_entry_price || weightedAverage(entries) || (signal.entry_low + signal.entry_high) / 2;
    const breakEven = signal.break_even_price || averageEntry * (1 + (config.tradingFeePct * 2 + config.slippageBufferPct) / 100);
    const target1Leg = calculateExitLeg(entries, signal.target1, 0.5, config);
    const startedAt = signal.profit_protection_started_at || signal.target1_hit_at;
    const graceExpiresAt = signal.tp2_grace_expires_at || addDays(new Date(startedAt), config.tp2GraceDays).toISOString();
    getDb()
      .prepare(
        `UPDATE signals SET
          status = 'PROFIT_PROTECTION',
          lifecycle_status = 'PROFIT_PROTECTION',
          profit_protection_started_at = ?,
          tp2_grace_expires_at = ?,
          average_entry_price = COALESCE(average_entry_price, ?),
          break_even_price = COALESCE(break_even_price, ?),
          total_quantity = COALESCE(total_quantity, ?),
          remaining_quantity = COALESCE(remaining_quantity, ?),
          realized_gross_profit_usdt = COALESCE(realized_gross_profit_usdt, ?),
          realized_fees_usdt = COALESCE(realized_fees_usdt, ?),
          realized_net_profit_usdt = COALESCE(realized_net_profit_usdt, ?),
          realized_net_profit_thb = COALESCE(realized_net_profit_thb, ?)
        WHERE signal_id = ?`
      )
      .run(
        startedAt,
        graceExpiresAt,
        averageEntry,
        breakEven,
        totalQuantity,
        remainingQuantity,
        target1Leg.grossProfitUsdt,
        target1Leg.feesUsdt,
        target1Leg.netProfitUsdt,
        target1Leg.netProfitUsdt * signal.usdthb_rate,
        signal.signal_id
      );
    backfilledTarget1Hit = 1;
    signal = getSignalById(signal.signal_id);
    console.log(`[lifecycle] signal=${signal.signal_id} from=TARGET1_HIT to=PROFIT_PROTECTION backfill=true`);
  }

  return { signal, backfilledEntryHit, backfilledTarget1Hit };
}

function ensurePositionEntries(signal: SignalRow, currentPrice: number) {
  const existing = getPositionEntries(signal.signal_id);
  if (existing.length) return existing;
  const entryAt = signal.entry_hit_at || new Date().toISOString();
  const entry = buildPositionEntry(
    {
      dcaLevel: signal.dca_level || 1,
      entryLow: signal.entry_low,
      entryHigh: signal.entry_high,
      filledPrice: signal.average_entry_price || (signal.entry_low + signal.entry_high) / 2 || currentPrice,
      stakeThb: signal.stake_thb,
      usdthbRate: signal.usdthb_rate,
      createdAt: entryAt
    },
    getSystemConfig()
  );
  insertPositionEntry(signal.signal_id, entry);
  return getPositionEntries(signal.signal_id);
}

function makeLifecycleResult(
  events: string[],
  normalized: { backfilledEntryHit: number; backfilledTarget1Hit: number },
  fromStatus: string,
  updated: SignalRow
): LifecycleUpdateResult {
  return {
    events,
    backfilledEntryHit: normalized.backfilledEntryHit,
    backfilledTarget1Hit: normalized.backfilledTarget1Hit,
    fromStatus,
    toStatus: updated.status,
    closeReason: updated.close_reason
  };
}

function weightedAverage(entries: PositionEntryRow[]) {
  const quantity = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  if (!quantity) return 0;
  return entries.reduce((sum, entry) => sum + (entry.filled_price || 0) * entry.quantity, 0) / quantity;
}

function insertPositionEntry(signalId: string, entry: Omit<PositionEntryRow, "id" | "signal_id">) {
  getDb()
    .prepare(
      `INSERT INTO position_entries (
        signal_id, dca_level, entry_low, entry_high, filled_price, stake_usdt, stake_thb,
        quantity, fee_usdt, entry_hit_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(signalId, entry.dca_level, entry.entry_low, entry.entry_high, entry.filled_price, entry.stake_usdt, entry.stake_thb, entry.quantity, entry.fee_usdt, entry.entry_hit_at, entry.created_at);
}

function insertTargetPlan(signal: SignalRow, plan: NonNullable<ReturnType<typeof calculatePositionPlan>>, targetVersion: number, now: string) {
  const row = makeTargetPlanRow(signal, plan, targetVersion, now);
  getDb()
    .prepare(
      `INSERT INTO target_plan_history (
        signal_id, target_version, average_entry, break_even, target1, target2,
        expected_net_tp1, expected_net_full, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(signal.signal_id, row.target_version, row.average_entry, row.break_even, row.target1, row.target2, row.expected_net_tp1, row.expected_net_full, row.created_at);
}

function protectedEntryThreshold(signal: SignalRow, config = getSystemConfig()) {
  const averageEntry = signal.average_entry_price || (signal.entry_low + signal.entry_high) / 2;
  return averageEntry * (1 + config.entryRetraceBufferPct / 100);
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function closesAboveSupport(candles: Candle[], support: number) {
  return candles.slice(-12).filter((candle) => candle.close > support).length >= 9;
}

function roundPrice(value: number) {
  return roundLifecyclePrice(value);
}
