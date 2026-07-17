import { getSystemConfig } from "./config";
import { getDb } from "./db";
import { internalPairToBinanceSymbol } from "./providers/provider";
import type { MarketTicker, SignalRow } from "./types";

export interface ProviderMigrationResult {
  signal: SignalRow;
  eventType: "PROVIDER_MIGRATED" | "PROVIDER_MIGRATION_REVIEW_REQUIRED" | "PROVIDER_UNAVAILABLE_REVIEW" | null;
  diffPct: number | null;
}

export function migrateSignalProvider(signal: SignalRow, ticker: MarketTicker | undefined): ProviderMigrationResult {
  if (signal.is_debug) return { signal, eventType: null, diffPct: null };
  if (signal.market_provider === "binance_spot" && signal.provider_migration_status === "PROVIDER_MIGRATED") return { signal, eventType: null, diffPct: signal.migration_price_diff_pct ?? null };
  if (signal.provider_migrated_at) return { signal, eventType: null, diffPct: signal.migration_price_diff_pct ?? null };
  if (signal.provider_migration_status === "PROVIDER_MIGRATION_REVIEW_REQUIRED" || signal.provider_migration_status === "PROVIDER_UNAVAILABLE_REVIEW") {
    return { signal, eventType: null, diffPct: signal.migration_price_diff_pct ?? null };
  }

  const now = new Date().toISOString();
  const reference = referencePrice(signal);
  if (!ticker) {
    update(signal.signal_id, {
      market_provider: signal.market_provider || "gateio_spot",
      provider_version: signal.provider_version || "gateio_spot_legacy",
      source_symbol: internalPairToBinanceSymbol(signal.pair),
      provider_migration_status: "PROVIDER_UNAVAILABLE_REVIEW",
      migration_reference_price: reference
    });
    return { signal: byId(signal.signal_id), eventType: "PROVIDER_UNAVAILABLE_REVIEW", diffPct: null };
  }
  const price = Number(ticker.last);
  const diffPct = Math.abs((price - reference) / reference) * 100;
  const status = diffPct <= getSystemConfig().maxProviderMigrationPriceDiffPct ? "PROVIDER_MIGRATED" : "PROVIDER_MIGRATION_REVIEW_REQUIRED";
  update(signal.signal_id, {
    market_provider: status === "PROVIDER_MIGRATED" ? "binance_spot" : signal.market_provider || "gateio_spot",
    provider_version: status === "PROVIDER_MIGRATED" ? "binance_spot_v1" : signal.provider_version || "gateio_spot_legacy",
    source_symbol: internalPairToBinanceSymbol(signal.pair),
    provider_migrated_at: now,
    migration_reference_price: reference,
    migration_new_price: price,
    migration_price_diff_pct: diffPct,
    provider_migration_status: status
  });
  return { signal: byId(signal.signal_id), eventType: status as ProviderMigrationResult["eventType"], diffPct };
}

function referencePrice(signal: SignalRow) {
  return signal.average_entry_price || signal.current_price_at_signal || (signal.entry_low + signal.entry_high) / 2;
}

function byId(signalId: string) {
  return getDb().prepare("SELECT * FROM signals WHERE signal_id = ?").get(signalId) as SignalRow;
}

function update(signalId: string, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  getDb().prepare(`UPDATE signals SET ${keys.map((key) => `${key} = ?`).join(", ")} WHERE signal_id = ?`).run(...keys.map((key) => fields[key]), signalId);
}
