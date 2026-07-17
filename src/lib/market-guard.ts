import { getMarketProvider } from "./providers/provider";
import type { MarketGuardResult, MarketTicker } from "./types";

export async function evaluateMarketGuard(tickers: MarketTicker[]): Promise<MarketGuardResult> {
  const btc = tickers.find((ticker) => ticker.currency_pair === "BTC_USDT");
  const eth = tickers.find((ticker) => ticker.currency_pair === "ETH_USDT");
  if (!btc || !eth) {
    return {
      status: "caution",
      labelTh: "ระวัง",
      reason: "market_guard=caution market_guard_provider=binance_spot reason=btc_or_eth_ticker_missing",
      confidenceAdjustment: -5,
      blockNewSetups: false
    };
  }

  const btcChange = Number(btc.change_percentage) || 0;
  const ethChange = Number(eth.change_percentage) || 0;
  const [btcVolumeRisk, ethVolumeRisk] = await Promise.all([hasVolumeRisk("BTC_USDT", btc), hasVolumeRisk("ETH_USDT", eth)]);
  const bothWeak = btcChange <= -4 && ethChange <= -4;
  const severeWeakness = btcChange <= -7 || ethChange <= -8;
  const volumeRisk = btcVolumeRisk || ethVolumeRisk;

  if ((bothWeak && volumeRisk) || severeWeakness) {
    return {
      status: "risk_off",
      labelTh: "Risk-Off",
      reason: `market_guard=risk_off market_guard_provider=${getMarketProvider().id} btc24h=${btcChange.toFixed(1)}% eth24h=${ethChange.toFixed(1)}% volume_risk=${volumeRisk}`,
      confidenceAdjustment: -18,
      blockNewSetups: true
    };
  }

  if (btcChange <= -3 || ethChange <= -3 || volumeRisk) {
    return {
      status: "caution",
      labelTh: "ระวัง",
      reason: `market_guard=caution market_guard_provider=${getMarketProvider().id} btc24h=${btcChange.toFixed(1)}% eth24h=${ethChange.toFixed(1)}% volume_risk=${volumeRisk}`,
      confidenceAdjustment: -8,
      blockNewSetups: false
    };
  }

  return {
    status: "normal",
    labelTh: "ปกติ",
    reason: `market_guard=normal market_guard_provider=${getMarketProvider().id} btc24h=${btcChange.toFixed(1)}% eth24h=${ethChange.toFixed(1)}% volume_risk=false`,
    confidenceAdjustment: 0,
    blockNewSetups: false
  };
}

async function hasVolumeRisk(pair: string, ticker: MarketTicker) {
  try {
    const candles = await getMarketProvider().getCandles(pair, 36, "1h");
    const previous = candles.slice(0, -6);
    const recent = candles.slice(-6);
    if (!previous.length || !recent.length) return false;
    const avgPreviousVolume = average(previous.map((candle) => candle.volume));
    const avgRecentVolume = average(recent.map((candle) => candle.volume));
    const changePct = Number(ticker.change_percentage) || 0;
    return changePct < 0 && avgRecentVolume >= avgPreviousVolume * 1.35;
  } catch (error) {
    console.log(`[market_guard] volume_check_failed pair=${pair} error=${String(error)}`);
    return false;
  }
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}
