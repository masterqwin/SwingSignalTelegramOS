import { initSchema } from "../src/lib/db";
import { getMarketProvider } from "../src/lib/providers/provider";
import { sendTelegramMessage } from "../src/lib/telegram";

async function main() {
  initSchema();
  const message = [
    "✅ ทดสอบ Telegram",
    "━━━━━━━━━━━━━━",
    "ตลาด",
    getMarketProvider().displayName,
    "Scanner",
    "เชื่อมต่อแล้ว",
    "เวลาไทย",
    new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }),
    "━━━━━━━━━━━━━━",
    "สถานะ",
    "ข้อความทดสอบพร้อมใช้งาน"
  ].join("\n");
  const result = await sendTelegramMessage(message);
  console.log(`[telegram:test] PASS=${result.ok} category=${result.category || "ok"} status=${result.httpStatus || "none"}`);
  if (!result.ok && result.category === "missing_config") {
    console.log("[telegram:test] SKIP=missing_config ใช้ตรวจรูปแบบข้อความแล้ว แต่ไม่ได้ส่งจริงเพราะยังไม่มี TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID");
    return;
  }
  if (!result.ok) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exit(1); });