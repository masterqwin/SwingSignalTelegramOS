import { getSystemConfig } from "./config";
import type { MarketTicker, SignalRow } from "./types";

const STABLE_BASES = new Set(["USDT", "USDC", "FDUSD", "TUSD", "BUSD", "DAI", "EUR", "TRY", "BRL", "GBP", "AUD"]);
const LEVERAGED_SUFFIXES = ["UP", "DOWN", "BULL", "BEAR"];

export function selectUniverseTickers(input: {
  allTickers: MarketTicker[];
  allowlistPairs: Set<string>;
  activeSignals: SignalRow[];
}) {
  const config = getSystemConfig();
  const activePairs = new Set(input.activeSignals.map((signal) => signal.pair));
  const filtered = input.allTickers.filter((ticker) => isCandidatePair(ticker.currency_pair));
  const liquidityPassed = filtered.filter((ticker) => Number(ticker.quote_volume) >= config.min24hQuoteVolumeUsdt);
  const ranked = liquidityPassed
    .filter((ticker) => input.allowlistPairs.size === 0 || input.allowlistPairs.has(ticker.currency_pair))
    .sort((a, b) => Number(b.quote_volume) - Number(a.quote_volume));
  const selectedPairs = new Set(ranked.slice(0, config.universeMaxPairs).map((ticker) => ticker.currency_pair));
  for (const pair of activePairs) selectedPairs.add(pair);
  const selected = input.allTickers.filter((ticker) => selectedPairs.has(ticker.currency_pair));
  const excludedStable = input.allTickers.filter((ticker) => STABLE_BASES.has(base(ticker.currency_pair))).length;
  const excludedLeveraged = input.allTickers.filter((ticker) => LEVERAGED_SUFFIXES.some((suffix) => base(ticker.currency_pair).endsWith(suffix))).length;
  return {
    tickers: selected,
    candidatePairs: selectedPairs,
    activePairs,
    logs: {
      providerPairs: input.allTickers.length,
      tradingUsdtPairs: filtered.length,
      liquidityPassed: liquidityPassed.length,
      selectedCandidates: selectedPairs.size,
      activePairsForced: [...activePairs].filter((pair) => selectedPairs.has(pair)).length,
      excludedStable,
      excludedLeveraged
    }
  };
}

function isCandidatePair(pair: string) {
  const asset = base(pair);
  if (!pair.endsWith("_USDT")) return false;
  if (STABLE_BASES.has(asset)) return false;
  if (LEVERAGED_SUFFIXES.some((suffix) => asset.endsWith(suffix))) return false;
  return true;
}

function base(pair: string) {
  return pair.replace("_USDT", "");
}
