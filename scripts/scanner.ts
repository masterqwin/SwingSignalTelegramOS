import { getSystemConfig } from "../src/lib/config";
import { getDb, initSchema } from "../src/lib/db";
import { fetchSpotTickers, tickerPrice } from "../src/lib/gateio";
import { buildCandidate, canCreateMoreSignals, createSignal, getOpenSignals, hasActiveSignal, recordSnapshot, updateSignalLifecycle } from "../src/lib/signal-engine";
import { persistStats } from "../src/lib/stats";
import { recordAndSendEvent } from "../src/lib/telegram";
import type { GateTicker, SignalRow } from "../src/lib/types";

initSchema();
const config = getSystemConfig();

async function scanOnce() {
  console.log(`[scanner] ${new Date().toISOString()} scan started`);
  const universe = getDb().prepare("SELECT pair FROM coin_universe WHERE enabled = 1").all() as Array<{ pair: string }>;
  const allowed = new Set(universe.map((row) => row.pair));
  const tickers = (await fetchSpotTickers()).filter((ticker) => allowed.has(ticker.currency_pair));
  const tickerByPair = new Map<string, GateTicker>(tickers.map((ticker) => [ticker.currency_pair, ticker]));

  for (const ticker of tickers) recordSnapshot(ticker);

  for (const signal of getOpenSignals()) {
    const ticker = tickerByPair.get(signal.pair);
    if (!ticker) continue;
    const currentPrice = tickerPrice(ticker);
    const event = updateSignalLifecycle(signal, currentPrice);
    if (event) {
      const updated = getDb().prepare("SELECT * FROM signals WHERE signal_id = ?").get(signal.signal_id) as SignalRow;
      await recordAndSendEvent(updated, event, currentPrice);
      console.log(`[scanner] lifecycle ${event} #${signal.signal_id}`);
    }
  }

  for (const ticker of tickers) {
    if (!canCreateMoreSignals()) break;
    if (hasActiveSignal(ticker.currency_pair)) continue;
    const candidate = await buildCandidate(ticker);
    if (!candidate) continue;
    const signal = createSignal(candidate);
    await recordAndSendEvent(signal, "SETUP_SIGNAL", candidate.currentPrice);
    console.log(`[scanner] setup #${signal.signal_id} ${signal.pair} score=${signal.score}`);
  }

  const stats = persistStats();
  console.log(`[scanner] scan finished total=${stats.totalSignals} entryHitRate=${stats.entryHitRate.toFixed(1)}%`);
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
