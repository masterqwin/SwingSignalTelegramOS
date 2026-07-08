import { getSystemConfig } from "./config";
import { getDb } from "./db";
import { fetchCandles, tickerPrice, tickerQuoteVolume } from "./gateio";
import type { Candle, GateTicker, SignalCandidate, SignalRow } from "./types";

const ACTIVE_STATUSES = ["SETUP", "ENTRY_HIT", "TARGET1_HIT", "HOLD", "NO_MORE_DCA"];

export async function buildCandidate(ticker: GateTicker): Promise<SignalCandidate | null> {
  const config = getSystemConfig();
  const currentPrice = tickerPrice(ticker);
  const quoteVolume = tickerQuoteVolume(ticker);
  const changePct = Number(ticker.change_percentage);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || quoteVolume < config.minQuoteVolumeUsdt) return null;
  if (!Number.isFinite(changePct) || changePct < 2 || changePct > 18) return null;

  const candles = await fetchCandles(ticker.currency_pair);
  if (candles.length < 40) return null;

  const recent = candles.slice(-48);
  const support = Math.min(...recent.slice(-24).map((c) => c.low));
  const resistance = Math.max(...recent.slice(-24).map((c) => c.high));
  const avgVolume = average(recent.slice(0, -6).map((c) => c.volume));
  const recentVolume = average(recent.slice(-6).map((c) => c.volume));
  const rangePct = ((resistance - support) / currentPrice) * 100;
  const distanceToSupportPct = ((currentPrice - support) / currentPrice) * 100;
  const volumeScore = recentVolume >= avgVolume * 1.05 ? 18 : recentVolume >= avgVolume * 0.85 ? 10 : 0;
  const trendScore = changePct >= 3 && changePct <= 12 ? 22 : 12;
  const rangeScore = rangePct >= 4 && rangePct <= 22 ? 20 : 8;
  const pullbackScore = distanceToSupportPct >= 2 && distanceToSupportPct <= 9 ? 25 : 10;
  const closeStructureScore = closesAboveSupport(recent, support) ? 15 : 0;
  const score = Math.min(100, trendScore + rangeScore + pullbackScore + volumeScore + closeStructureScore);
  if (score < 85) return null;

  const entryHigh = roundPrice(support * 1.012);
  const entryLow = roundPrice(support * 0.996);
  if (entryHigh >= currentPrice) return null;

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
    reasonTh: "ย่อใกล้แนวรับ + Volume ดี + มีโอกาสเด้งในกรอบ"
  };
}

export function hasActiveSignal(pair: string) {
  const row = getDb()
    .prepare(`SELECT id FROM signals WHERE pair = ? AND status IN (${ACTIVE_STATUSES.map(() => "?").join(",")}) LIMIT 1`)
    .get(pair, ...ACTIVE_STATUSES);
  return Boolean(row);
}

export function canCreateMoreSignals() {
  const config = getSystemConfig();
  const row = getDb()
    .prepare(`SELECT COUNT(*) as count FROM signals WHERE status IN (${ACTIVE_STATUSES.map(() => "?").join(",")})`)
    .get(...ACTIVE_STATUSES) as { count: number };
  return row.count < config.maxActiveSignals;
}

export function createSignal(candidate: SignalCandidate) {
  const config = getSystemConfig();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.signalExpiryDays * 24 * 60 * 60 * 1000);
  const signalId = `${candidate.symbol}-${now.getTime().toString(36).toUpperCase()}`;
  getDb()
    .prepare(
      `INSERT INTO signals (
        signal_id, pair, symbol, status, created_at, expires_at, entry_low, entry_high,
        current_price_at_signal, target1, target2, stake_thb, usdthb_rate, score, risk_level, reason_th
      ) VALUES (?, ?, ?, 'SETUP', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      candidate.reasonTh
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

  let event: string | null = null;
  if (signal.status === "SETUP" && now > new Date(signal.expires_at) && currentPrice > signal.entry_high) {
    updates.push("status = 'CANCELLED'", "cancelled_at = ?");
    values.push(now.toISOString());
    event = "CANCEL_SIGNAL";
  } else if (signal.status === "SETUP" && currentPrice >= signal.entry_low && currentPrice <= signal.entry_high) {
    updates.push("status = 'ENTRY_HIT'", "entry_hit_at = ?");
    values.push(now.toISOString());
    event = "ENTRY_HIT";
  } else if (signal.status === "ENTRY_HIT" && currentPrice >= signal.target1) {
    updates.push("status = 'TARGET1_HIT'", "target1_hit_at = ?");
    values.push(now.toISOString());
    event = "TARGET_HIT_1";
  } else if (signal.status === "TARGET1_HIT" && currentPrice >= signal.target2) {
    updates.push("status = 'CLOSED'", "target2_hit_at = ?", "closed_at = ?");
    values.push(now.toISOString(), now.toISOString());
    event = "SIGNAL_CLOSED";
  }

  values.push(signal.signal_id);
  getDb().prepare(`UPDATE signals SET ${updates.join(", ")} WHERE signal_id = ?`).run(...values);
  return event;
}

export function getOpenSignals() {
  return getDb()
    .prepare(`SELECT * FROM signals WHERE status IN (${ACTIVE_STATUSES.map(() => "?").join(",")}) ORDER BY created_at DESC`)
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
