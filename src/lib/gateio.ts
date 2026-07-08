import type { Candle, GateTicker } from "./types";

const BASE_URL = "https://api.gateio.ws/api/v4";

export async function fetchSpotTickers(): Promise<GateTicker[]> {
  const response = await fetch(`${BASE_URL}/spot/tickers`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Gate.io tickers failed: ${response.status}`);
  return response.json();
}

export async function fetchCandles(pair: string, limit = 80, interval = "1h"): Promise<Candle[]> {
  const url = `${BASE_URL}/spot/candlesticks?currency_pair=${pair}&interval=${interval}&limit=${limit}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Gate.io candles failed for ${pair}: ${response.status}`);
  const raw = (await response.json()) as string[][];
  return raw
    .map((item) => ({
      timestamp: Number(item[0]),
      volume: Number(item[1]),
      close: Number(item[2]),
      high: Number(item[3]),
      low: Number(item[4]),
      open: Number(item[5])
    }))
    .filter((candle) => Number.isFinite(candle.close) && candle.close > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function tickerPrice(ticker: GateTicker) {
  return Number(ticker.last);
}

export function tickerQuoteVolume(ticker: GateTicker) {
  return Number(ticker.quote_volume);
}
