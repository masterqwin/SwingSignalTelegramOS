import { getSystemConfig } from "../config";
import type { Candle, MarketTicker } from "../types";
import { binanceSpotProvider } from "./binance";
import { gateioSpotProvider } from "./gateio";

export interface ExchangeSymbolInfo {
  symbol: string;
  pair: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  spotAllowed: boolean;
}

export interface ProviderStats {
  provider: string;
  baseUrl: string;
  exchangeSymbols: number;
  usdtSpotSymbols: number;
  tickersLoaded: number;
  candlesLoaded: number;
  currentPricesLoaded: number;
  fallbackUsed: boolean;
  rateLimitRetries: number;
  errors: number;
}

export interface MarketProvider {
  id: string;
  displayName: string;
  getExchangeInfo(): Promise<ExchangeSymbolInfo[]>;
  getTickers(): Promise<MarketTicker[]>;
  getCandles(pair: string, limit?: number, interval?: string): Promise<Candle[]>;
  getCurrentPrices(pairs?: string[]): Promise<Map<string, number>>;
  getMarketGuardData(): Promise<MarketTicker[]>;
  getTradablePairs(): Promise<Set<string>>;
  getStats(): ProviderStats;
}

export function getMarketProvider(): MarketProvider {
  const provider = getSystemConfig().marketProvider;
  if (provider === "gateio_spot") return gateioSpotProvider;
  return binanceSpotProvider;
}

export function internalPairToBinanceSymbol(pair: string) {
  return pair.replace("/", "_").replace("_", "").toUpperCase();
}

export function binanceSymbolToInternalPair(symbol: string, baseAsset?: string, quoteAsset?: string) {
  if (baseAsset && quoteAsset) return `${baseAsset}_${quoteAsset}`;
  if (symbol.endsWith("USDT")) return `${symbol.slice(0, -4)}_USDT`;
  return symbol;
}

export function displayPair(pair: string) {
  return pair.replace("_", "/");
}
