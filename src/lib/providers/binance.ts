import { getSystemConfig } from "../config";
import type { Candle, MarketTicker } from "../types";
import { binanceSymbolToInternalPair, internalPairToBinanceSymbol, type ExchangeSymbolInfo, type MarketProvider, type ProviderStats } from "./provider";

type BinanceExchangeSymbol = {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  isSpotTradingAllowed?: boolean;
  permissions?: string[];
};

type BinanceTicker24h = {
  symbol: string;
  lastPrice: string;
  quoteVolume: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
};

type BinancePrice = { symbol: string; price: string };

const STABLE_OR_FIAT_BASES = new Set(["USDT", "USDC", "FDUSD", "TUSD", "BUSD", "DAI", "EUR", "TRY", "BRL", "GBP", "AUD"]);
const LEVERAGED_SUFFIXES = ["UP", "DOWN", "BULL", "BEAR"];

let exchangeCache: ExchangeSymbolInfo[] | undefined;
let stats = createStats();

export const binanceSpotProvider: MarketProvider = {
  id: "binance_spot",
  displayName: "Binance Spot",
  getExchangeInfo,
  getTickers,
  getCandles,
  getCurrentPrices,
  getMarketGuardData,
  getTradablePairs,
  getStats: () => ({ ...stats })
};

export async function getExchangeInfo(): Promise<ExchangeSymbolInfo[]> {
  if (exchangeCache) return exchangeCache;
  const payload = (await requestJson("/api/v3/exchangeInfo")) as { symbols?: BinanceExchangeSymbol[] };
  const symbols = payload.symbols ?? [];
  stats.exchangeSymbols = symbols.length;
  exchangeCache = symbols.filter(isTradableUsdtSpot).map((symbol) => ({
    symbol: symbol.symbol,
    pair: binanceSymbolToInternalPair(symbol.symbol, symbol.baseAsset, symbol.quoteAsset),
    baseAsset: symbol.baseAsset,
    quoteAsset: symbol.quoteAsset,
    status: symbol.status,
    spotAllowed: symbol.isSpotTradingAllowed !== false
  }));
  stats.usdtSpotSymbols = exchangeCache.length;
  return exchangeCache;
}

export async function getTickers(): Promise<MarketTicker[]> {
  const exchange = await getExchangeInfo();
  const allowed = new Set(exchange.map((item) => item.pair));
  const raw = (await requestJson("/api/v3/ticker/24hr")) as BinanceTicker24h[];
  const mapped = raw
    .map(mapTicker24h)
    .filter((ticker): ticker is MarketTicker => ticker !== null && allowed.has(ticker.currency_pair));
  stats.tickersLoaded = mapped.length;
  return mapped;
}

export async function getCandles(pair: string, limit = 80, interval = "1h"): Promise<Candle[]> {
  const params = new URLSearchParams({ symbol: internalPairToBinanceSymbol(pair), interval, limit: String(limit) });
  const raw = (await requestJson(`/api/v3/klines?${params.toString()}`)) as unknown[][];
  const candles = raw.map(mapKline).filter((candle) => Number.isFinite(candle.close) && candle.close > 0).sort((a, b) => a.timestamp - b.timestamp);
  stats.candlesLoaded += candles.length;
  return candles;
}

export async function getCurrentPrices(pairs?: string[]): Promise<Map<string, number>> {
  const raw = (await requestJson("/api/v3/ticker/price")) as BinancePrice[];
  const allowed = pairs ? new Set(pairs) : undefined;
  const prices = new Map<string, number>();
  for (const item of raw) {
    const pair = binanceSymbolToInternalPair(item.symbol);
    if (allowed && !allowed.has(pair)) continue;
    const price = Number(item.price);
    if (Number.isFinite(price) && price > 0) prices.set(pair, price);
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

export function mapTicker24h(item: BinanceTicker24h): MarketTicker | null {
  const pair = binanceSymbolToInternalPair(item.symbol);
  if (!pair.endsWith("_USDT")) return null;
  return {
    currency_pair: pair,
    provider_symbol: item.symbol,
    last: item.lastPrice,
    quote_volume: item.quoteVolume,
    change_percentage: item.priceChangePercent,
    high_24h: item.highPrice,
    low_24h: item.lowPrice
  };
}

export function mapKline(item: unknown[]): Candle {
  return {
    timestamp: Number(item[0]),
    open: Number(item[1]),
    high: Number(item[2]),
    low: Number(item[3]),
    close: Number(item[4]),
    volume: Number(item[7] ?? item[5])
  };
}

export function isTradableUsdtSpot(symbol: BinanceExchangeSymbol) {
  if (symbol.status !== "TRADING") return false;
  if (symbol.quoteAsset !== "USDT") return false;
  if (symbol.isSpotTradingAllowed === false) return false;
  if (symbol.permissions?.length && !symbol.permissions.includes("SPOT")) return false;
  if (STABLE_OR_FIAT_BASES.has(symbol.baseAsset)) return false;
  if (LEVERAGED_SUFFIXES.some((suffix) => symbol.baseAsset.endsWith(suffix))) return false;
  return true;
}

async function requestJson(path: string): Promise<unknown> {
  const config = getSystemConfig();
  const baseUrls = [config.binanceBaseUrl, config.binanceFallbackBaseUrl].filter(Boolean);
  let lastError: unknown;
  for (const [baseIndex, baseUrl] of baseUrls.entries()) {
    for (let attempt = 1; attempt <= config.binanceMaxRetries; attempt += 1) {
      try {
        const response = await fetchWithTimeout(`${baseUrl}${path}`, config.binanceRequestTimeoutMs);
        stats.baseUrl = baseUrl;
        if (baseIndex > 0) stats.fallbackUsed = true;
        if (response.status === 429 || response.status >= 500) {
          if (response.status === 429) stats.rateLimitRetries += 1;
          if (attempt < config.binanceMaxRetries) {
            await sleep(retryDelayMs(response, attempt));
            continue;
          }
        }
        if (!response.ok) throw new Error(`Binance Spot request failed ${path}: HTTP ${response.status}`);
        return response.json();
      } catch (error) {
        lastError = error;
        stats.errors += 1;
        if (attempt < config.binanceMaxRetries) await sleep(attempt * 500);
      }
    }
  }
  throw lastError;
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function retryDelayMs(response: Response, attempt: number) {
  const retryAfter = Number(response.headers.get("retry-after") || 0);
  return Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : attempt * 750;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createStats(): ProviderStats {
  const config = getSystemConfig();
  return {
    provider: "binance_spot",
    baseUrl: config.binanceBaseUrl,
    exchangeSymbols: 0,
    usdtSpotSymbols: 0,
    tickersLoaded: 0,
    candlesLoaded: 0,
    currentPricesLoaded: 0,
    fallbackUsed: false,
    rateLimitRetries: 0,
    errors: 0
  };
}
