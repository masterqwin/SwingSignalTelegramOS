import type { Candle, MarketTicker } from "../types";
import type { ExchangeSymbolInfo, MarketProvider, ProviderStats } from "./provider";

const BASE_URL = "https://api.gateio.ws/api/v4";
let stats: ProviderStats = {
  provider: "gateio_spot",
  baseUrl: BASE_URL,
  exchangeSymbols: 0,
  usdtSpotSymbols: 0,
  tickersLoaded: 0,
  candlesLoaded: 0,
  currentPricesLoaded: 0,
  fallbackUsed: false,
  rateLimitRetries: 0,
  errors: 0
};

export const gateioSpotProvider: MarketProvider = {
  id: "gateio_spot",
  displayName: "Gate.io Spot",
  getExchangeInfo,
  getTickers,
  getCandles,
  getCurrentPrices,
  getMarketGuardData,
  getTradablePairs,
  getStats: () => ({ ...stats })
};

export async function getExchangeInfo(): Promise<ExchangeSymbolInfo[]> {
  const tickers = await getTickers();
  const rows = tickers.map((ticker) => ({
    symbol: ticker.currency_pair.replace("_", ""),
    pair: ticker.currency_pair,
    baseAsset: ticker.currency_pair.replace("_USDT", ""),
    quoteAsset: "USDT",
    status: "TRADING",
    spotAllowed: true
  }));
  stats.exchangeSymbols = rows.length;
  stats.usdtSpotSymbols = rows.length;
  return rows;
}

export async function getTickers(): Promise<MarketTicker[]> {
  const response = await fetch(`${BASE_URL}/spot/tickers`, { cache: "no-store" });
  if (!response.ok) {
    stats.errors += 1;
    throw new Error(`Gate.io tickers failed: ${response.status}`);
  }
  const tickers = (await response.json()) as MarketTicker[];
  stats.tickersLoaded = tickers.length;
  return tickers;
}

export async function getCandles(pair: string, limit = 80, interval = "1h"): Promise<Candle[]> {
  const url = `${BASE_URL}/spot/candlesticks?currency_pair=${pair}&interval=${interval}&limit=${limit}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    stats.errors += 1;
    throw new Error(`Gate.io candles failed for ${pair}: ${response.status}`);
  }
  const raw = (await response.json()) as string[][];
  const candles = raw
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
  stats.candlesLoaded += candles.length;
  return candles;
}

export async function getCurrentPrices(pairs?: string[]): Promise<Map<string, number>> {
  const tickers = await getTickers();
  const allowed = pairs ? new Set(pairs) : undefined;
  const prices = new Map<string, number>();
  for (const ticker of tickers) {
    if (allowed && !allowed.has(ticker.currency_pair)) continue;
    const price = Number(ticker.last);
    if (Number.isFinite(price) && price > 0) prices.set(ticker.currency_pair, price);
  }
  stats.currentPricesLoaded = prices.size;
  return prices;
}

export async function getTradablePairs() {
  const exchange = await getExchangeInfo();
  return new Set(exchange.map((item) => item.pair));
}

export async function getMarketGuardData() {
  const tickers = await getTickers();
  return tickers.filter((ticker) => ticker.currency_pair === "BTC_USDT" || ticker.currency_pair === "ETH_USDT");
}
