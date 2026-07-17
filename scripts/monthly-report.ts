import { calculatePortfolioHeat } from "../src/lib/analytics";
import { initSchema, getDb } from "../src/lib/db";
import { sendTelegramMessage } from "../src/lib/telegram";

function previousMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
}
function monthKey(date: Date) {
  return date.toISOString().slice(0, 7);
}
function nextMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

export function buildMonthlyReport(date = previousMonth()) {
  initSchema();
  const db = getDb();
  const start = date.toISOString();
  const end = nextMonth(date).toISOString();
  const rows = db.prepare("SELECT * FROM signals WHERE is_debug = 0 AND created_at >= ? AND created_at < ?").all(start, end) as any[];
  const closed = rows.filter((row) => row.closed_at || ["CLOSED","CANCELLED","ENTRY_RETRACE_CLOSED","TP2_TIMEOUT_CLOSED"].includes(row.status));
  const entryHits = rows.filter((row) => row.entry_hit_at).length;
  const tp1 = rows.filter((row) => row.target1_hit_at).length;
  const tp2 = rows.filter((row) => row.target2_hit_at).length;
  const wins = closed.filter((row) => (row.final_net_profit_usdt || row.realized_net_profit_usdt || 0) > 0).length;
  const losses = closed.filter((row) => (row.final_net_profit_usdt || row.realized_net_profit_usdt || 0) <= 0).length;
  const pnlUsdt = closed.reduce((sum, row) => sum + (row.final_net_profit_usdt || row.realized_net_profit_usdt || 0), 0);
  const usdthb = rows[0]?.usdthb_rate || 36.5;
  const heat = calculatePortfolioHeat();
  const topCoin = top(rows.map((row) => row.symbol));
  const sampleLine = rows.length < 5 ? "Data sample is still limited; avoid strategy changes from this month alone." : "Rule-based analytics have enough samples for a basic monthly read.";
  const msg = [
    `SwingSignal Monthly Report ${monthKey(date)}`,
    "",
    "Results",
    `New signals: ${rows.length}`,
    `Entry hit: ${entryHits} (${pct(entryHits, rows.length).toFixed(1)}%)`,
    `Closed: ${closed.length}`,
    `Win: ${wins} | Loss: ${losses}`,
    `Win Rate: ${pct(wins, Math.max(1, wins + losses)).toFixed(1)}%`,
    `Paper net P&L: ${pnlUsdt >= 0 ? "+" : ""}${pnlUsdt.toFixed(2)} USDT (~${(pnlUsdt * usdthb).toLocaleString("th-TH", { maximumFractionDigits: 0 })} THB)`,
    "",
    "Operation",
    `TP1 success: ${pct(tp1, rows.length).toFixed(1)}%`,
    `TP2 success: ${pct(tp2, rows.length).toFixed(1)}%`,
    `Recovery used: ${rows.filter((row) => row.dca_level > 1).length}`,
    `Timeout/Cancel: ${rows.filter((row) => row.status === "CANCELLED" || row.close_reason === "TP2_TIMEOUT_CLOSED").length}`,
    "",
    "Best",
    `Top coin: ${topCoin || "N/A"}`,
    `Best score band: ${bestBand(rows)}`,
    `Best quality: ${top(rows.map((row) => row.quality_label).filter(Boolean)) || "N/A"}`,
    "",
    "Portfolio",
    `Active: ${heat.activeSetupCount}/${heat.maxActiveSignals}`,
    `Active exposure: ${heat.activeExposureThb.toLocaleString("th-TH", { maximumFractionDigits: 0 })} THB`,
    `Reserve: ${heat.reserveThb.toLocaleString("th-TH", { maximumFractionDigits: 0 })} THB`,
    `Portfolio Heat: ${heat.heatPct.toFixed(1)}%`,
    "",
    "System",
    "Provider: Binance Spot",
    `Telegram pending: ${pendingCount()}`,
    "",
    `Summary: ${sampleLine}`
  ].join("\n");
  return { reportMonth: monthKey(date), message: msg, rows: rows.length };
}

async function main() {
  const preview = process.argv.includes("--preview");
  const force = process.argv.includes("--force");
  const report = buildMonthlyReport();
  if (preview) {
    console.log(report.message);
    return;
  }
  const db = getDb();
  const existing = db.prepare("SELECT id FROM monthly_reports WHERE report_month = ?").get(report.reportMonth);
  if (existing && !force) {
    console.log(`[monthly-report] already_sent_or_recorded month=${report.reportMonth}`);
    return;
  }
  const result = await sendTelegramMessage(report.message);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO monthly_reports (report_month, message_th, status, sent_at, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(report_month) DO UPDATE SET message_th = excluded.message_th, status = excluded.status, sent_at = excluded.sent_at`)
    .run(report.reportMonth, report.message, result.ok ? "SENT" : "FAILED", result.ok ? now : null, now);
  console.log(`[monthly-report] month=${report.reportMonth} sent=${result.ok}`);
  if (!result.ok) process.exitCode = 1;
}

function pct(value: number, total: number) { return total > 0 ? (value / total) * 100 : 0; }
function pendingCount() {
  const row = getDb().prepare("SELECT COUNT(*) as count FROM notification_deliveries WHERE status != 'SENT'").get() as { count: number };
  return row.count;
}
function top(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}
function bestBand(rows: any[]) {
  const bands = [["85-89", 85, 89], ["90-94", 90, 94], ["95-100", 95, 100]] as const;
  return bands.map(([label, min, max]) => {
    const bandRows = rows.filter((row) => row.score >= min && row.score <= max);
    const wins = bandRows.filter((row) => row.target1_hit_at).length;
    return { label, rate: pct(wins, bandRows.length) };
  }).sort((a, b) => b.rate - a.rate)[0]?.label || "N/A";
}
if (process.argv[1]?.endsWith("monthly-report.ts")) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
