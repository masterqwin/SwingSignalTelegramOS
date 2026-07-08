import type { SystemConfig } from "./types";
import { loadLocalEnv } from "./env";

function num(name: string, fallback: number) {
  loadLocalEnv();
  const value = process.env[name];
  const parsed = value ? Number(value) : fallback;
  return Number.isFinite(parsed) ? parsed : fallback;
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
    recoveryScoreThreshold: num("RECOVERY_SCORE_THRESHOLD", 88)
  };
}

export function getDatabasePath() {
  loadLocalEnv();
  return process.env.DATABASE_PATH || "./data/swing_signal.sqlite";
}
