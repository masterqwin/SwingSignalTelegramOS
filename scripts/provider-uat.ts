import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
  const tempDb = path.join(os.tmpdir(), `swingsignal-provider-uat-${Date.now()}.sqlite`);
  process.env.DATABASE_PATH = tempDb;
  const { initSchema } = await import("../src/lib/db");
  const { getMarketProvider } = await import("../src/lib/providers/provider");
  initSchema();
  const provider = getMarketProvider();
  const tickers = await provider.getTickers();
  const guard = await provider.getMarketGuardData();
  const candles = await provider.getCandles("BTC_USDT", 5, "1h");
  const prices = await provider.getCurrentPrices(["BTC_USDT", "ETH_USDT"]);
  console.log(`[provider:uat] provider=${provider.id}`);
  console.log(`[provider:uat] tickers=${tickers.length}`);
  console.log(`[provider:uat] guard_pairs=${guard.map((item) => item.currency_pair).join(",")}`);
  console.log(`[provider:uat] candles=${candles.length}`);
  console.log(`[provider:uat] prices=${prices.size}`);
  try { fs.unlinkSync(tempDb); } catch {}
  if (!tickers.length || !candles.length || !prices.size) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exit(1); });
