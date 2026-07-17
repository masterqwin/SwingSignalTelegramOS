import { getMarketProvider } from "./providers/provider";
import type { MarketTicker } from "./types";

export async function fetchSpotTickers(): Promise<MarketTicker[]> {
  return getMarketProvider().getTickers();
}

export async function fetchCandles(pair: string, limit = 80, interval = "1h") {
  return getMarketProvider().getCandles(pair, limit, interval);
}

export function tickerPrice(ticker: MarketTicker) {
  return Number(ticker.last);
}

export function tickerQuoteVolume(ticker: MarketTicker) {
  return Number(ticker.quote_volume);
}
