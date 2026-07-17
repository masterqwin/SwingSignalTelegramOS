import type { SystemConfig } from "./types";
import { loadLocalEnv } from "./env";

function num(name: string, fallback: number) {
  loadLocalEnv();
  const value = process.env[name];
  const parsed = value ? Number(value) : fallback;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(name: string, fallback: string) {
  loadLocalEnv();
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function bool(name: string, fallback: boolean) {
  loadLocalEnv();
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function getSystemConfig(): SystemConfig {
  loadLocalEnv();
  return {
    usdthbRate: num("USDTHB_RATE", 36.5),
    scanIntervalMinutes: num("SCAN_INTERVAL_MINUTES", 5),
    signalExpiryDays: num("SIGNAL_EXPIRY_DAYS", 3),
    startingCapitalThb: num("STARTING_CAPITAL_THB", 200000),
    defaultStakeThb: num("DEFAULT_STAKE_THB", 20000),
    maxActiveSignals: num("MAX_ACTIVE_SIGNALS", 5),
    minQuoteVolumeUsdt: num("MIN_QUOTE_VOLUME_USDT", 5000000),
    debugSignal: bool("DEBUG_SIGNAL", false),
    maxDcaEntries: num("MAX_DCA_ENTRIES", 3),
    recoveryDropPct: num("RECOVERY_DROP_PCT", 5),
    recoveryScoreThreshold: num("RECOVERY_SCORE_THRESHOLD", 88),
    tradingFeePct: num("TRADING_FEE_PCT", 0.2),
    slippageBufferPct: num("SLIPPAGE_BUFFER_PCT", 0.15),
    minNetProfitTp1Pct: num("MIN_NET_PROFIT_TP1_PCT", 0.8),
    minNetProfitTp2Pct: num("MIN_NET_PROFIT_TP2_PCT", 1.8),
    positionPlanDays: num("POSITION_PLAN_DAYS", 3),
    tp2GraceDays: num("TP2_GRACE_DAYS", 2),
    entryRetraceBufferPct: num("ENTRY_RETRACE_BUFFER_PCT", 0),
    marketProvider: str("MARKET_PROVIDER", "binance_spot"),
    binanceBaseUrl: str("BINANCE_BASE_URL", "https://data-api.binance.vision"),
    binanceFallbackBaseUrl: str("BINANCE_FALLBACK_BASE_URL", "https://api.binance.com"),
    binanceRequestTimeoutMs: num("BINANCE_REQUEST_TIMEOUT_MS", 12000),
    binanceMaxRetries: num("BINANCE_MAX_RETRIES", 3)
  };
}

export function getDatabasePath() {
  loadLocalEnv();
  return process.env.DATABASE_PATH || "./data/swing_signal.sqlite";
}
