import fs from "node:fs";
import path from "node:path";

let loaded = false;

export function loadLocalEnv() {
  if (loaded) return;
  loaded = true;

  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsAt = trimmed.indexOf("=");
    if (equalsAt < 1) continue;

    const key = trimmed.slice(0, equalsAt).trim();
    const rawValue = trimmed.slice(equalsAt + 1).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}
