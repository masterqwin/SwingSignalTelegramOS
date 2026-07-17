import { initSchema } from "../src/lib/db";
import { getMarketProvider } from "../src/lib/providers/provider";
import { sendTelegramMessage } from "../src/lib/telegram";

async function main() {
  initSchema();
  const message = [
    "SwingSignal Telegram Test",
    `Provider: ${getMarketProvider().displayName}`,
    "Scanner: Connected",
    `Thai time: ${new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}`
  ].join("\n");
  const result = await sendTelegramMessage(message);
  console.log(`[telegram:test] PASS=${result.ok} category=${result.category || "ok"} status=${result.httpStatus || "none"}`);
  if (!result.ok) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exit(1); });
