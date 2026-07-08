import { getSystemConfig } from "../src/lib/config";
import { getDb, initSchema } from "../src/lib/db";
import { fetchSpotTickers, tickerPrice } from "../src/lib/gateio";
import {
  buildCandidate,
  applyRecoveryPlan,
  canCreateMoreSignals,
  createSignal,
  buildRecoveryPlan,
  getActiveSignalCount,
  getOpenSignals,
  hasActiveSignal,
  recordSnapshot,
  updateSignalLifecycle
} from "../src/lib/signal-engine";
import { persistStats } from "../src/lib/stats";
import { recordAndSendEvent } from "../src/lib/telegram";
import type { GateTicker, SignalCandidate, SignalRow } from "../src/lib/types";

initSchema();
const config = getSystemConfig();

async function scanOnce() {
  console.log(`[scanner] ${new Date().toISOString()} scan started`);
  const universe = getDb().prepare("SELECT pair FROM coin_universe WHERE enabled = 1").all() as Array<{ pair: string }>;
  const allowed = new Set(universe.map((row) => row.pair));
  const allTickers = await fetchSpotTickers();
  const allTickerPairs = new Set(allTickers.map((ticker) => ticker.currency_pair));
  const tickers = allTickers.filter((ticker) => allowed.has(ticker.currency_pair));
  const tickerByPair = new Map<string, GateTicker>(tickers.map((ticker) => [ticker.currency_pair, ticker]));
  const missingPairs = universe.map((row) => row.pair).filter((pair) => !allTickerPairs.has(pair));

  let skipped = missingPairs.length;
  let duplicateSkipped = 0;
  let capacitySkipped = 0;
  let signalsCreated = 0;
  let telegramSent = false;
  const candidates: SignalCandidate[] = [];

  for (const pair of missingPairs) {
    console.log(`[scanner] skip ${pair} reason=not_available_on_gateio_spot`);
  }

  for (const ticker of tickers) recordSnapshot(ticker);

  for (const signal of getOpenSignals()) {
    const ticker = tickerByPair.get(signal.pair);
    if (!ticker) {
      console.log(`[scanner] skip lifecycle #${signal.signal_id} ${signal.pair} reason=pair_not_available_on_gateio_spot`);
      continue;
    }

    const currentPrice = tickerPrice(ticker);
    const events = updateSignalLifecycle(signal, currentPrice);
    let currentSignal = signal;
    if (events.length) {
      const updated = getDb().prepare("SELECT * FROM signals WHERE signal_id = ?").get(signal.signal_id) as SignalRow;
      currentSignal = updated;
      for (const event of events) {
        const telegram = await recordAndSendEvent(updated, event, currentPrice);
        telegramSent = telegramSent || telegram.ok;
        if (!telegram.ok) console.log(`[scanner] telegram_failed event=${event} #${signal.signal_id} error=${telegram.error}`);
        console.log(`[scanner] lifecycle ${event} #${signal.signal_id}`);
      }
    }

    const recoveryPlan = buildRecoveryPlan(currentSignal, ticker);
    if (recoveryPlan) {
      const recovered = applyRecoveryPlan(currentSignal, recoveryPlan);
      const telegram = await recordAndSendEvent(recovered, "RECOVERY_SIGNAL", recoveryPlan.recoveryEntryPrice);
      telegramSent = telegramSent || telegram.ok;
      if (!telegram.ok) console.log(`[scanner] telegram_failed event=RECOVERY_SIGNAL #${signal.signal_id} error=${telegram.error}`);
      console.log(`[scanner] recovery #${signal.signal_id} ${signal.pair} dca_level=${recoveryPlan.dcaLevel} score=${recoveryPlan.score}`);
    }
  }

  for (const ticker of tickers) {
    if (!config.debugSignal && !canCreateMoreSignals()) {
      capacitySkipped += 1;
      continue;
    }

    if (hasActiveSignal(ticker.currency_pair)) {
      duplicateSkipped += 1;
      console.log(`[scanner] skip ${ticker.currency_pair} reason=active_signal_exists`);
      continue;
    }

    const candidate = await buildCandidate(ticker, { minScore: config.debugSignal ? 0 : 85, debugMode: config.debugSignal });
    if (!candidate) {
      skipped += 1;
      continue;
    }
    candidates.push(candidate);
  }

  candidates.sort((a, b) => b.score - a.score);
  const topCandidate = candidates[0];
  const selected = config.debugSignal ? topCandidate : candidates.find((candidate) => candidate.score >= 85);

  if (selected && (config.debugSignal || canCreateMoreSignals())) {
    const signal = createSignal(selected, { isDebug: config.debugSignal });
    const telegram = await recordAndSendEvent(signal, "SETUP_SIGNAL", selected.currentPrice);
    telegramSent = telegramSent || telegram.ok;
    if (!telegram.ok) console.log(`[scanner] telegram_failed event=SETUP_SIGNAL #${signal.signal_id} error=${telegram.error}`);
    signalsCreated += 1;
    console.log(`[scanner] setup #${signal.signal_id} ${signal.pair} score=${signal.score} debug=${Boolean(signal.is_debug)}`);
  } else if (selected && !canCreateMoreSignals()) {
    capacitySkipped += 1;
  }

  const stats = persistStats();
  console.log(`[scanner] universe=${universe.length}`);
  console.log(`[scanner] scanned=${tickers.length}`);
  console.log(`[scanner] skipped=${skipped} duplicate_skipped=${duplicateSkipped} capacity_skipped=${capacitySkipped}`);
  console.log(`[scanner] candidates=${candidates.length}`);
  console.log(`[scanner] top_candidate=${topCandidate ? `${topCandidate.pair} score=${topCandidate.score}` : "none"}`);
  console.log(`[scanner] signals_created=${signalsCreated}`);
  console.log(`[scanner] debug_signal=${config.debugSignal}`);
  console.log(`[scanner] telegram_sent=${telegramSent}`);
  console.log(`[scanner] active_signals=${getActiveSignalCount()}`);
  console.log(`[scanner] scan finished total_signals=${stats.totalSignals} entryHitRate=${stats.entryHitRate.toFixed(1)}%`);
}

async function main() {
  await scanOnce();
  if (process.argv.includes("--once")) return;
  setInterval(() => {
    scanOnce().catch((error) => console.error("[scanner] scan failed", error));
  }, config.scanIntervalMinutes * 60 * 1000);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
