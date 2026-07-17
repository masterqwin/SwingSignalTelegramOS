import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
  const tempDb = path.join(os.tmpdir(), `swingsignal-monthly-uat-${Date.now()}.sqlite`);
  process.env.DATABASE_PATH = tempDb;
  const { initSchema, getDb } = await import("../src/lib/db");
  const { buildMonthlyReport } = await import("./monthly-report");
  initSchema();
  const db = getDb();
  db.prepare("INSERT INTO signals (signal_id,pair,symbol,status,created_at,expires_at,entry_low,entry_high,current_price_at_signal,target1,target2,stake_thb,usdthb_rate,score,confidence_pct,quality_label,risk_level,reason_th,is_debug) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("UAT-1","BTC_USDT","BTC","CLOSED","2026-06-02T00:00:00.000Z","2026-06-05T00:00:00.000Z",100,101,102,106,110,20000,36.5,90,75,"A","medium","uat",0);
  const report = buildMonthlyReport(new Date("2026-06-01T00:00:00.000Z"));
  assert.ok(report.message.includes("New signals: 1"));
  assert.ok(report.message.includes("Provider: Binance Spot"));
  console.log("[monthly-report:uat] PASS");
  try { fs.unlinkSync(tempDb); } catch {}
}
main().catch((error) => { console.error(error); process.exit(1); });
