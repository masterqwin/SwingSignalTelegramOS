import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const tempDb = path.join("run", `swingsignal-telegram-uat-${Date.now()}.sqlite`);
  process.env.DATABASE_PATH = tempDb;
  process.env.TELEGRAM_BOT_TOKEN = "";
  process.env.TELEGRAM_CHAT_ID = "";
  const { initSchema } = await import("../src/lib/db");
  const { sendTelegramMessage } = await import("../src/lib/telegram");
  initSchema();
  const missing = await sendTelegramMessage("test");
  assert.equal(missing.ok, false, "missing config should fail safely");
  assert.equal(missing.category, "missing_config", "missing config should be categorized");
  console.log("[telegram:uat] missing_config PASS");
  try { fs.unlinkSync(tempDb); } catch {}
}
main().catch((error) => { console.error(error); process.exit(1); });
