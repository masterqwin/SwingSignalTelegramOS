import { calculatePortfolioHeat } from "../src/lib/analytics";
import { getDb, initSchema } from "../src/lib/db";
import { getMarketProvider } from "../src/lib/providers/provider";
import { evaluateMarketGuard } from "../src/lib/market-guard";
import { sendTelegramMessage } from "../src/lib/telegram";

const LINE = "━━━━━━━━━━━━━━";

async function main() {
  initSchema();
  const heat = calculatePortfolioHeat();
  const latestSnapshot = getDb().prepare("SELECT captured_at FROM price_snapshots ORDER BY captured_at DESC LIMIT 1").get() as
    | { captured_at: string }
    | undefined;

  let marketGuardLabel = "ไม่พบข้อมูล";
  let providerOk = false;
  try {
    const tickers = await fetchSpotTickersWithRetry();
    providerOk = tickers.length > 0;
    const marketGuard = await evaluateMarketGuard(tickers);
    marketGuardLabel = marketGuard.labelTh;
  } catch (error) {
    console.log(`[health] market_provider_failed provider=${getMarketProvider().id} error=${String(error)}`);
  }

  const counts = telegramCounts();
  const message = buildHealthMessage({
    latestScan: latestSnapshot ? formatThaiDateTime(new Date(latestSnapshot.captured_at)) : "ยังไม่มีข้อมูล",
    active: heat.activeSetupCount,
    max: heat.maxActiveSignals,
    heatPct: heat.heatPct,
    reserveThb: heat.reserveThb,
    marketGuard: marketGuardLabel,
    providerOk,
    pending: counts.pending,
    failed: counts.failed
  });

  const telegram = await sendTelegramMessage(message);
  if (!telegram.ok) {
    console.log(`[health] telegram_failed category=${telegram.category || "unknown"} error=${telegram.error}`);
    console.log(message.replace("Telegram\n✅", "Telegram\n⚠️"));
    return;
  }

  console.log(message);
}

export function buildHealthMessage(input: {
  latestScan: string;
  active: number;
  max: number;
  heatPct: number;
  reserveThb: number;
  marketGuard: string;
  providerOk: boolean;
  pending: number;
  failed: number;
}) {
  return [
    "✅ ระบบทำงานปกติ",
    LINE,
    "เวลาสแกนล่าสุด",
    input.latestScan,
    LINE,
    "💼 พอร์ต",
    "Active",
    `${input.active}/${input.max}`,
    "Portfolio Heat",
    `${input.heatPct.toFixed(1)}%`,
    "เงินสำรอง",
    formatThb(input.reserveThb),
    "บาท",
    LINE,
    "📈 ตลาด",
    "Provider",
    "Binance Spot",
    "Market Guard",
    input.marketGuard,
    LINE,
    "📡 ระบบ",
    "Scanner",
    input.providerOk ? "✅" : "⚠️",
    "Telegram",
    "✅",
    "Database",
    "✅",
    "Pending",
    String(input.pending),
    "Failed",
    String(input.failed),
    LINE,
    "สถานะ",
    input.providerOk ? "ระบบพร้อมทำงาน" : "ระบบทำงานได้ แต่ควรตรวจสอบข้อมูลตลาด"
  ].join("\n");
}

function telegramCounts() {
  const pending = getDb().prepare("SELECT COUNT(*) as count FROM notification_deliveries WHERE status IN ('PENDING','RETRY_PENDING')").get() as { count: number };
  const failed = getDb().prepare("SELECT COUNT(*) as count FROM notification_deliveries WHERE status IN ('FAILED','DEAD_LETTER')").get() as { count: number };
  return { pending: pending.count, failed: failed.count };
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