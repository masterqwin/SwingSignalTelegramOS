import { getSystemConfig } from "../src/lib/config";
import { getDb, initSchema } from "../src/lib/db";
import { fetchSpotTickers, tickerPrice } from "../src/lib/gateio";
import { calculatePortfolioHeat } from "../src/lib/analytics";
import { evaluateMarketGuard } from "../src/lib/market-guard";
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
  const marketGuard = await evaluateMarketGuard(allTickers);
  console.log(`[scanner] ${marketGuard.reason}`);
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
  const lifecycleStats = {
    activeLoaded: 0,
    checked: 0,
    backfilledEntryHit: 0,
    backfilledTarget1Hit: 0,
    setupCancelled: 0,
    recoveryCreated: 0,
    preTp1ReviewRequired: 0,
    profitProtectionStarted: 0,
    entryRetraceClosed: 0,
    tp2TimeoutClosed: 0,
    fullTargetClosed: 0,
    errors: 0,
    slotsBefore: 0,
    slotsAfter: 0
  };

  for (const pair of missingPairs) {
    console.log(`[scanner] skip ${pair} reason=not_available_on_gateio_spot`);
  }

  for (const ticker of tickers) recordSnapshot(ticker);

  const openSignals = getOpenSignals();
  lifecycleStats.activeLoaded = openSignals.length;
  lifecycleStats.slotsBefore = getActiveSignalCount();

  for (const signal of openSignals) {
    lifecycleStats.checked += 1;
    const ticker = tickerByPair.get(signal.pair);
    if (!ticker) {
      console.log(`[scanner] skip lifecycle #${signal.signal_id} ${signal.pair} reason=pair_not_available_on_gateio_spot`);
      continue;
    }

    const currentPrice = tickerPrice(ticker);
    const lifecycle = updateSignalLifecycle(signal, currentPrice);
    lifecycleStats.backfilledEntryHit += lifecycle.backfilledEntryHit;
    lifecycleStats.backfilledTarget1Hit += lifecycle.backfilledTarget1Hit;
    if (lifecycle.fromStatus !== lifecycle.toStatus) {
      console.log(`[lifecycle] signal=${signal.signal_id} from=${lifecycle.fromStatus} to=${lifecycle.toStatus}`);
    }
    if (lifecycle.closeReason) {
      console.log(`[lifecycle] signal=${signal.signal_id} close_reason=${lifecycle.closeReason}`);
    }
    const events = lifecycle.events;
    let currentSignal = signal;
    if (events.length) {
      const updated = getDb().prepare("SELECT * FROM signals WHERE signal_id = ?").get(signal.signal_id) as SignalRow;
      currentSignal = updated;
      for (const event of events) {
        if (event === "CANCEL_SIGNAL") lifecycleStats.setupCancelled += 1;
        if (event === "PRE_TP1_REVIEW_REQUIRED") lifecycleStats.preTp1ReviewRequired += 1;
        if (event === "PROFIT_PROTECTION_STARTED") lifecycleStats.profitProtectionStarted += 1;
        if (event === "ENTRY_RETRACE_CLOSED") lifecycleStats.entryRetraceClosed += 1;
        if (event === "TP2_TIMEOUT_CLOSED") lifecycleStats.tp2TimeoutClosed += 1;
        if (event === "TARGET_HIT_2") lifecycleStats.fullTargetClosed += 1;
        const telegram = await recordAndSendEvent(updated, event, currentPrice);
        telegramSent = telegramSent || telegram.ok;
        if (!telegram.ok) console.log(`[scanner] telegram_failed event=${event} #${signal.signal_id} error=${telegram.error}`);
        console.log(`[scanner] lifecycle ${event} #${signal.signal_id}`);
      }
    }

    const recoveryPlan = buildRecoveryPlan(currentSignal, ticker, {
      marketGuard,
      activeExposureThb: calculatePortfolioHeat().activeExposureThb
    });
    if (recoveryPlan) {
      const recovered = applyRecoveryPlan(currentSignal, recoveryPlan);
      const telegram = await recordAndSendEvent(recovered, "RECOVERY_SIGNAL", recoveryPlan.recoveryEntryPrice);
      telegramSent = telegramSent || telegram.ok;
      if (!telegram.ok) console.log(`[scanner] telegram_failed event=RECOVERY_SIGNAL #${signal.signal_id} error=${telegram.error}`);
      lifecycleStats.recoveryCreated += 1;
      console.log(`[scanner] recovery #${signal.signal_id} ${signal.pair} dca_level=${recoveryPlan.dcaLevel} score=${recoveryPlan.score}`);
    }
  }
  lifecycleStats.slotsAfter = getActiveSignalCount();
  console.log(`[lifecycle] active_loaded=${lifecycleStats.activeLoaded}`);
  console.log(`[lifecycle] checked=${lifecycleStats.checked}`);
  console.log(`[lifecycle] backfilled_entry_hit=${lifecycleStats.backfilledEntryHit}`);
  console.log(`[lifecycle] backfilled_target1_hit=${lifecycleStats.backfilledTarget1Hit}`);
  console.log(`[lifecycle] setup_cancelled=${lifecycleStats.setupCancelled}`);
  console.log(`[lifecycle] recovery_created=${lifecycleStats.recoveryCreated}`);
  console.log(`[lifecycle] pre_tp1_review_required=${lifecycleStats.preTp1ReviewRequired}`);
  console.log(`[lifecycle] profit_protection_started=${lifecycleStats.profitProtectionStarted}`);
  console.log(`[lifecycle] entry_retrace_closed=${lifecycleStats.entryRetraceClosed}`);
  console.log(`[lifecycle] tp2_timeout_closed=${lifecycleStats.tp2TimeoutClosed}`);
  console.log(`[lifecycle] full_target_closed=${lifecycleStats.fullTargetClosed}`);
  console.log(`[lifecycle] slots_before=${lifecycleStats.slotsBefore}`);
  console.log(`[lifecycle] slots_after=${lifecycleStats.slotsAfter}`);
  console.log(`[lifecycle] errors=${lifecycleStats.errors}`);

  const portfolioHeat = calculatePortfolioHeat();

  for (const ticker of tickers) {
    if (!config.debugSignal && marketGuard.blockNewSetups) {
      skipped += 1;
      continue;
    }

    if (!config.debugSignal && !canCreateMoreSignals()) {
      capacitySkipped += 1;
      continue;
    }

    if (hasActiveSignal(ticker.currency_pair)) {
      duplicateSkipped += 1;
      console.log(`[scanner] skip ${ticker.currency_pair} reason=active_signal_exists`);
      continue;
    }

    const candidate = await buildCandidate(ticker, {
      minScore: config.debugSignal ? 0 : 85,
      debugMode: config.debugSignal,
      marketGuard,
      activeExposureThb: portfolioHeat.activeExposureThb
    });
    if (!candidate) {
      skipped += 1;
      continue;
    }
    candidates.push(candidate);
  }

  candidates.sort((a, b) => b.score - a.score);
  const topCandidate = candidates[0];
  const selected = config.debugSignal ? topCandidate : candidates.find((candidate) => candidate.score >= 85 && candidate.qualityLabel !== "C");

  if (selected && (config.debugSignal || canCreateMoreSignals())) {
    const signal = createSignal(selected, { isDebug: config.debugSignal });
    const telegram = await recordAndSendEvent(signal, "SETUP_SIGNAL", selected.currentPrice);
    telegramSent = telegramSent || telegram.ok;
    if (!telegram.ok) console.log(`[scanner] telegram_failed event=SETUP_SIGNAL #${signal.signal_id} error=${telegram.error}`);
    signalsCreated += 1;
    console.log(
      `[scanner] setup #${signal.signal_id} ${signal.pair} score=${signal.score} confidence=${signal.confidence_pct}% quality=${signal.quality_label} market_guard=${signal.market_guard_status} debug=${Boolean(signal.is_debug)}`
    );
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
  console.log(`[scanner] market_guard=${marketGuard.status}`);
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
