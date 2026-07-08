import fs from "node:fs";
import path from "node:path";
import { getSystemConfig } from "../src/lib/config";
import { getDb, initSchema } from "../src/lib/db";

initSchema();
const config = getSystemConfig();
const allowlistPath = path.join(process.cwd(), "data", "coin-allowlist.json");
const symbols = JSON.parse(fs.readFileSync(allowlistPath, "utf8")) as string[];
const now = new Date().toISOString();
const db = getDb();

const insertCoin = db.prepare(
  `INSERT INTO coin_universe (symbol, pair, enabled, min_quote_volume_usdt, last_seen_at)
   VALUES (?, ?, 1, ?, ?)
   ON CONFLICT(symbol) DO UPDATE SET pair = excluded.pair, min_quote_volume_usdt = excluded.min_quote_volume_usdt`
);

for (const symbol of symbols) {
  insertCoin.run(symbol, `${symbol}_USDT`, config.minQuoteVolumeUsdt, now);
}

const insertConfig = db.prepare("INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at");
for (const [key, value] of Object.entries(config)) {
  insertConfig.run(key, String(value), now);
}

console.log(`Seeded ${symbols.length} coin universe rows.`);
