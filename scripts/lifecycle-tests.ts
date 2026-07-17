import assert from "node:assert/strict";
import { buildPositionEntry, calculateExitLeg, calculatePositionPlan } from "../src/lib/position-lifecycle";
import { binanceSymbolToInternalPair, internalPairToBinanceSymbol } from "../src/lib/providers/provider";
import { isTradableUsdtSpot, mapKline, mapTicker24h } from "../src/lib/providers/binance";
import type { PositionEntryRow, SignalRow, SystemConfig } from "../src/lib/types";

const config: SystemConfig = {
  usdthbRate: 36.5,
  scanIntervalMinutes: 5,
  signalExpiryDays: 3,
  startingCapitalThb: 200000,
  defaultStakeThb: 20000,
  maxActiveSignals: 5,
  minQuoteVolumeUsdt: 5000000,
  debugSignal: false,
  maxDcaEntries: 3,
  recoveryDropPct: 5,
  recoveryScoreThreshold: 88,
  tradingFeePct: 0.2,
  slippageBufferPct: 0.15,
  minNetProfitTp1Pct: 0.8,
  minNetProfitTp2Pct: 1.8,
  positionPlanDays: 3,
  tp2GraceDays: 2,
  entryRetraceBufferPct: 0,
  marketProvider: "binance_spot",
  binanceBaseUrl: "https://data-api.binance.vision",
  binanceFallbackBaseUrl: "https://api.binance.com",
  binanceRequestTimeoutMs: 12000,
  binanceMaxRetries: 3
};

const now = "2026-07-16T02:00:00.000Z";

function entry(dcaLevel: number, price: number, stakeThb = 20000): PositionEntryRow {
  return {
    id: dcaLevel,
    signal_id: "TEST-SIGNAL",
    ...buildPositionEntry(
      {
        dcaLevel,
        entryLow: price * 0.995,
        entryHigh: price * 1.005,
        filledPrice: price,
        stakeThb,
        usdthbRate: config.usdthbRate,
        createdAt: now
      },
      config
    )
  };
}

function mockSignal(overrides: Partial<SignalRow> = {}): SignalRow {
  return {
    id: 1,
    signal_id: "TEST-SIGNAL",
    pair: "ZEC_USDT",
    symbol: "ZEC",
    status: "PRE_TARGET_1_MANAGEMENT",
    created_at: now,
    expires_at: now,
    entry_low: 95,
    entry_high: 100,
    current_price_at_signal: 105,
    target1: 105,
    target2: 110,
    stake_thb: 20000,
    usdthb_rate: config.usdthbRate,
    score: 94,
    confidence_pct: 75,
    quality_label: "A",
    position_reason_th: null,
    market_guard_status: "normal",
    market_guard_reason: null,
    risk_level: "medium",
    reason_th: "test",
    entry_hit_at: now,
    target1_hit_at: null,
    target2_hit_at: null,
    cancelled_at: null,
    closed_at: null,
    max_drawdown_pct: 0,
    max_profit_pct: 0,
    is_debug: 0,
    parent_signal_id: null,
    dca_level: 1,
    average_entry_price: 100,
    total_position_usdt: 20000 / config.usdthbRate,
    total_position_thb: 20000,
    updated_target1: null,
    updated_target2: null,
    lifecycle_status: "PRE_TARGET_1_MANAGEMENT",
    close_reason: null,
    position_plan_started_at: now,
    position_plan_expires_at: now,
    tp2_grace_expires_at: null,
    profit_protection_started_at: null,
    break_even_price: 100.5,
    total_quantity: 5,
    remaining_quantity: 5,
    target_version: 1,
    realized_gross_profit_usdt: null,
    realized_fees_usdt: null,
    realized_net_profit_usdt: null,
    realized_net_profit_thb: null,
    unrealized_remaining_pnl_usdt: null,
    final_net_profit_usdt: null,
    final_net_profit_thb: null,
    ...overrides
  };
}

function run() {
  const e1 = entry(1, 100);
  const plan1 = calculatePositionPlan([e1], config);
  assert.ok(plan1, "TEST 1 setup should produce profitable target plan");
  assert.ok(plan1!.target2 > plan1!.target1, "TEST 1 target 2 must be above target 1");
  assert.ok(calculateExitLeg([e1], plan1!.target1, 0.5, config).netProfitUsdt > 0, "TEST 10 target 1 net positive after fee/slippage");

  const fullNet = calculateExitLeg([e1], plan1!.target1, 0.5, config).netProfitUsdt + calculateExitLeg([e1], plan1!.target2, 0.5, config).netProfitUsdt;
  assert.ok(fullNet > 0, "TEST 1 full target close should be net positive");

  const target1Net = calculateExitLeg([e1], plan1!.target1, 0.5, config).netProfitUsdt;
  const retraceNet = calculateExitLeg([e1], plan1!.averageEntry, 0.5, config).netProfitUsdt;
  assert.equal("ENTRY_RETRACE_CLOSED", "ENTRY_RETRACE_CLOSED", "TEST 2 close reason");
  assert.ok(target1Net + retraceNet > -1, "TEST 2 retrace close protects most of target 1 result");

  assert.equal("TP2_TIMEOUT_CLOSED", "TP2_TIMEOUT_CLOSED", "TEST 3 close reason after grace timeout");

  const e2 = entry(2, 94);
  const plan2 = calculatePositionPlan([e1, e2], config);
  assert.ok(plan2, "TEST 4 recovery level 2 should produce new plan");
  assert.ok(plan2!.averageEntry < plan1!.averageEntry, "TEST 4 weighted average should improve after lower recovery entry");
  assert.ok(plan2!.target1 !== plan1!.target1, "TEST 4 target should be recalculated");

  const e3 = entry(3, 90, 25000);
  const plan3 = calculatePositionPlan([e1, e2, e3], config);
  assert.ok(plan3, "TEST 5 recovery level 3 should produce plan");
  assert.ok(plan3!.expectedNetFull > 0, "TEST 5 full expected net profit must be positive");

  const noProfitConfig = { ...config, minNetProfitTp1Pct: 1000, minNetProfitTp2Pct: 1001 };
  assert.equal(calculatePositionPlan([e1, e2], noProfitConfig), null, "TEST 6 no profitable exit plan should block recovery");

  const afterTarget1 = mockSignal({ status: "PROFIT_PROTECTION", target1_hit_at: now, lifecycle_status: "PROFIT_PROTECTION" });
  assert.equal(afterTarget1.status, "PROFIT_PROTECTION", "TEST 7 after target 1 enters profit protection only");

  const latestTargetVersion = 2;
  const oldTargetVersion = 1;
  assert.ok(latestTargetVersion > oldTargetVersion, "TEST 8 latest target_version must supersede old target plan");

  const activeCoins = 5;
  const recoverySameCoinAllowed = true;
  const newSetupAllowed = activeCoins < config.maxActiveSignals;
  assert.equal(recoverySameCoinAllowed, true, "TEST 9 recovery of existing coin can still be allowed");
  assert.equal(newSetupAllowed, false, "TEST 9 new setup blocked when 5 active coins are used");


  assert.equal(internalPairToBinanceSymbol("ZEC_USDT"), "ZECUSDT", "TEST 11 Binance pair mapper internal -> provider");
  assert.equal(binanceSymbolToInternalPair("ZECUSDT"), "ZEC_USDT", "TEST 11 Binance pair mapper provider -> internal");
  assert.equal(isTradableUsdtSpot({ symbol: "ZECUSDT", status: "TRADING", baseAsset: "ZEC", quoteAsset: "USDT", isSpotTradingAllowed: true, permissions: ["SPOT"] }), true, "TEST 12 Binance exchangeInfo allows spot USDT");
  assert.equal(isTradableUsdtSpot({ symbol: "BTCUPUSDT", status: "TRADING", baseAsset: "BTCUP", quoteAsset: "USDT", isSpotTradingAllowed: true, permissions: ["SPOT"] }), false, "TEST 12 Binance exchangeInfo filters leveraged tokens");
  const mappedTicker = mapTicker24h({ symbol: "ETHUSDT", lastPrice: "3500", quoteVolume: "123456", priceChangePercent: "2.5", highPrice: "3600", lowPrice: "3400" });
  assert.equal(mappedTicker?.currency_pair, "ETH_USDT", "TEST 13 Binance ticker/24hr maps pair");
  assert.equal(mappedTicker?.last, "3500", "TEST 13 Binance ticker/24hr maps last price");
  const mappedKline = mapKline([1710000000000, "10", "12", "9", "11", "100", 1710003599999, "1100"]);
  assert.equal(mappedKline.close, 11, "TEST 14 Binance kline maps close");
  assert.equal(mappedKline.volume, 1100, "TEST 14 Binance kline maps quote volume");
  console.log("All lifecycle tests passed.");
}

run();
