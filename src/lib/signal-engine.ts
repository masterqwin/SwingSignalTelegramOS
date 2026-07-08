import { getSystemConfig } from "./config";
import { getDb } from "./db";
import { fetchCandles, tickerPrice, tickerQuoteVolume } from "./gateio";
import type { Candle, GateTicker, SignalCandidate, SignalRow } from "./types";

const ACTIVE_STATUSES = ["SETUP", "ENTRY_HIT", "TARGET1_HIT", "HOLD", "NO_MORE_DCA"];

export async function buildCandidate(ticker: GateTicker, options: { minScore?: number; debugMode?: boolean } = {}): Promise<SignalCandidate | null> {
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
  return {
    pair: ticker.currency_pair,
    symbol: ticker.currency_pair.replace("_USDT", ""),
    entryLow,
    entryHigh,
    currentPrice: roundPrice(currentPrice),
    target1,
    target2,
    score,
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
        current_price_at_signal, target1, target2, stake_thb, usdthb_rate, score, risk_level, reason_th, is_debug
      ) VALUES (?, ?, ?, 'SETUP', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      config.defaultStakeThb,
      config.usdthbRate,
      candidate.score,
      candidate.riskLevel,
      candidate.reasonTh,
      options.isDebug ? 1 : 0
    );
  return getSignalById(signalId);
}

export function getSignalById(signalId: string) {
  return getDb().prepare("SELECT * FROM signals WHERE signal_id = ?").get(signalId) as SignalRow;
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
