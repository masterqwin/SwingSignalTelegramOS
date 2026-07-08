import type { SystemConfig } from "./types";

function num(name: string, fallback: number) {
  const value = process.env[name];
  const parsed = value ? Number(value) : fallback;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getSystemConfig(): SystemConfig {
  return {
    usdthbRate: num("USDTHB_RATE", 36.5),
    scanIntervalMinutes: num("SCAN_INTERVAL_MINUTES", 5),
    signalExpiryDays: num("SIGNAL_EXPIRY_DAYS", 3),
    startingCapitalThb: num("STARTING_CAPITAL_THB", 200000),
    defaultStakeThb: num("DEFAULT_STAKE_THB", 20000),
    maxActiveSignals: num("MAX_ACTIVE_SIGNALS", 5),
    minQuoteVolumeUsdt: num("MIN_QUOTE_VOLUME_USDT", 5000000)
  };
}

export function getDatabasePath() {
  return process.env.DATABASE_PATH || "./data/swing_signal.sqlite";
}
