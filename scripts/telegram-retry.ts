import { initSchema } from "../src/lib/db";
import { retryPendingNotifications } from "../src/lib/telegram";

async function main() {
  initSchema();
  const results = await retryPendingNotifications(20);
  for (const item of results) console.log(`[telegram:retry] ${item.key} sent=${item.result.ok} category=${item.result.category || "ok"}`);
  console.log(`[telegram:retry] processed=${results.length}`);
}
main().catch((error) => { console.error(error); process.exit(1); });
