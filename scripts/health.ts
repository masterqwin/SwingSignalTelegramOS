import { calculatePortfolioHeat } from "../src/lib/analytics";
import { getDb, initSchema } from "../src/lib/db";
import { getMarketProvider } from "../src/lib/providers/provider";
import { evaluateMarketGuard } from "../src/lib/market-guard";
import { calculateStats } from "../src/lib/stats";
import { sendTelegramMessage } from "../src/lib/telegram";

async function main() {
  initSchema();
  const stats = calculateStats();
  const heat = calculatePortfolioHeat();
  const latestSnapshot = getDb().prepare("SELECT captured_at FROM price_snapshots ORDER BY captured_at DESC LIMIT 1").get() as
    | { captured_at: string }
    | undefined;

  const provider = getMarketProvider();
  let providerOk = false;
  let marketGuardLabel = "unknown";
  let marketGuardStatus = "unknown";
  try {
    const tickers = await fetchSpotTickersWithRetry();
    providerOk = tickers.length > 0;
    const marketGuard = await evaluateMarketGuard(tickers);
    marketGuardStatus = marketGuard.status;
    marketGuardLabel = marketGuard.labelTh;
  } catch (error) {
    console.log(`[health] market_provider_failed provider=${provider.id} error=${String(error)}`);
  }

  const message = [
    "✅ SwingSignal OS Health",
    `สแกนล่าสุด: ${latestSnapshot ? formatThaiDateTime(new Date(latestSnapshot.captured_at)) : "ยังไม่มีข้อมูล"}`,
    `Active Signals: ${heat.activeSetupCount}`,
    `Portfolio Heat: ${heat.heatPct.toFixed(1)}%`,
    `Reserve: ${formatThb(heat.reserveThb)} บาท (${heat.reservePct.toFixed(1)}%)`,
    `Entry Hit Rate: ${stats.entryHitRate.toFixed(1)}%`,
    `Win Rate: ${stats.winRate.toFixed(1)}%`,
    `Market Guard: ${marketGuardLabel} (${marketGuardStatus})`,
    "Telegram: OK",
    `Market Data Provider: ${provider.displayName}`,
    `Binance API: ${providerOk ? "OK" : "FAIL"}`,
    `Pending Telegram: ${telegramCounts().pending}`,
    `Failed Telegram: ${telegramCounts().failed}`,
    `Last successful notification: ${telegramCounts().lastSent || "none"}`,
    "Database: OK"
  ].join("\n");

  const telegram = await sendTelegramMessage(message);
  if (!telegram.ok) {
    console.log(`[health] telegram_failed error=${telegram.error}`);
    console.log(message.replace("Telegram: OK", "Telegram: FAIL"));
    return;
  }

  console.log(message);
}

function telegramCounts() {
  const pending = getDb().prepare("SELECT COUNT(*) as count FROM notification_deliveries WHERE status IN ('PENDING','RETRY_PENDING')").get() as { count: number };
  const failed = getDb().prepare("SELECT COUNT(*) as count FROM notification_deliveries WHERE status IN ('FAILED','DEAD_LETTER')").get() as { count: number };
  const last = getDb().prepare("SELECT sent_at FROM notification_deliveries WHERE status = 'SENT' ORDER BY sent_at DESC LIMIT 1").get() as { sent_at: string } | undefined;
  return { pending: pending.count, failed: failed.count, lastSent: last?.sent_at ? formatThaiDateTime(new Date(last.sent_at)) : null };
}

function formatThb(value: number) {
  return value.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

async function fetchSpotTickersWithRetry() {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await getMarketProvider().getTickers();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError;
}

function formatThaiDateTime(date: Date) {
  return date.toLocaleString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Bangkok"
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
