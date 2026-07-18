import { calculatePortfolioHeat } from "../src/lib/analytics";
import { initSchema, getDb } from "../src/lib/db";
import { summarizeClosedSignalResults } from "../src/lib/result-classifier";
import { sendTelegramMessage } from "../src/lib/telegram";

const LINE = "━━━━━━━━━━━━━━";

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
  const entryHits = rows.filter((row) => row.entry_hit_at).length;
  const tp1 = rows.filter((row) => row.target1_hit_at).length;
  const tp2 = rows.filter((row) => row.target2_hit_at).length;
  const recovery = rows.filter((row) => row.dca_level > 1 || row.parent_signal_id).length;
  const recoverySuccess = rows.filter((row) => (row.dca_level > 1 || row.parent_signal_id) && (row.final_net_profit_usdt || 0) > 0).length;
  const cancel = rows.filter((row) => row.status === "CANCELLED" || row.close_reason === "CANCELLED").length;
  const timeout = rows.filter((row) => row.close_reason === "TP2_TIMEOUT_CLOSED" || row.status === "TP2_TIMEOUT_CLOSED").length;
  const resultStats = summarizeClosedSignalResults(rows);
  const usdthb = rows[0]?.usdthb_rate || 36.5;
  const heat = calculatePortfolioHeat();
  const topCoin = top(rows.map((row) => row.symbol));
  const summaryLine = resultStats.winRateDenominator === 0
    ? "ยังไม่มีสัญญาณปิดที่คำนวณผลลัพธ์ได้ ใช้รายงานนี้เพื่อดูจำนวนงานของระบบเท่านั้น"
    : "Win Rate คำนวณจากกำไรสุทธิสุดท้ายของสัญญาณที่ปิดแล้วเท่านั้น";
  const msg = [
    "📊 รายงานประจำเดือน",
    monthKey(date),
    LINE,
    "📈 ผลงาน",
    `• สัญญาณใหม่: ${rows.length}`,
    `• เข้าโซนซื้อ: ${entryHits} (${pct(entryHits, rows.length).toFixed(1)}%)`,
    `• ปิดรอบแล้ว: ${resultStats.closedCount}`,
    `• ชนะ: ${resultStats.winCount}`,
    `• แพ้: ${resultStats.lossCount}`,
    `• เสมอตัว: ${resultStats.breakevenCount}`,
    `• ยังสรุปผลไม่ได้: ${resultStats.unknownResultCount}`,
    `• Win Rate: ${resultStats.winRate.toFixed(1)}%`,
    LINE,
    "⚙️ การทำงานของแผน",
    `• TP1 สำเร็จ: ${pct(tp1, rows.length).toFixed(1)}%`,
    `• TP2 สำเร็จ: ${pct(tp2, rows.length).toFixed(1)}%`,
    `• Recovery ใช้: ${recovery} ครั้ง`,
    `• Recovery สำเร็จ: ${pct(recoverySuccess, recovery).toFixed(1)}%`,
    `• Cancel: ${cancel}`,
    `• Timeout: ${timeout}`,
    LINE,
    "💰 ผลตอบแทนจำลอง",
    `• กำไรสุทธิรวม: ${resultStats.paperNetPnlUsdt >= 0 ? "+" : ""}${resultStats.paperNetPnlUsdt.toFixed(2)} USDT`,
    `• ประมาณ: ${resultStats.paperNetPnlUsdt >= 0 ? "+" : ""}${(resultStats.paperNetPnlUsdt * usdthb).toLocaleString("th-TH", { maximumFractionDigits: 0 })} บาท`,
    "ทุกอย่างเป็น Paper Tracking ไม่ใช่กำไรเงินจริง",
    LINE,
    "🏆 ผลงานดีที่สุด",
    `เหรียญ: ${topCoin || "N/A"}`,
    `คะแนน: ${bestBand(rows)}`,
    `คุณภาพ: ${top(rows.map((row) => row.quality_label).filter(Boolean)) || "N/A"}`,
    LINE,
    "💼 พอร์ต",
    `Active: ${heat.activeSetupCount}/${heat.maxActiveSignals}`,
    `Heat: ${heat.heatPct.toFixed(1)}%`,
    `เงินสำรอง: ${heat.reserveThb.toLocaleString("th-TH", { maximumFractionDigits: 0 })} บาท`,
    LINE,
    "🤖 ระบบ",
    "Binance Spot",
    "Scanner: พร้อมทำงาน",
    `Telegram: รอส่ง ${pendingCount()} รายการ`,
    "Database: พร้อมใช้งาน",
    LINE,
    "สรุป",
    summaryLine
  ].join("\n");
  return { reportMonth: monthKey(date), message: msg, rows: rows.length, resultStats };
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
    const resultStats = summarizeClosedSignalResults(bandRows);
    return { label, rate: resultStats.winRate };
  }).sort((a, b) => b.rate - a.rate)[0]?.label || "N/A";
}
if (process.argv[1]?.endsWith("monthly-report.ts")) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
