import { getSystemConfig } from "./config";
import { getDb } from "./db";
import { loadLocalEnv } from "./env";
import { calculatePortfolioHeat } from "./analytics";
import { getMarketProvider } from "./providers/provider";
import type { NotificationDeliveryRow, SignalRow } from "./types";

export type TelegramCategory = "missing_config" | "unauthorized" | "chat_not_found" | "blocked" | "rate_limited" | "invalid_html" | "network" | "unknown";

export interface TelegramSendResult {
  ok: boolean;
  error?: string;
  category?: TelegramCategory;
  httpStatus?: number;
  attempts: number;
  sentAt?: string;
}

export function getTelegramConfigStatus() {
  loadLocalEnv();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  return {
    configuredToken: Boolean(token),
    configuredChatId: Boolean(chatId),
    chatIdHint: chatId ? maskChatId(chatId) : "missing"
  };
}

export async function sendTelegramMessage(text: string, options: { allowPlainTextFallback?: boolean } = {}): Promise<TelegramSendResult> {
  loadLocalEnv();
  const config = getSystemConfig();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  console.log(`[telegram] configured_token=${Boolean(token)}`);
  console.log(`[telegram] configured_chat_id=${Boolean(chatId)}`);
  if (!token || !chatId) {
    return { ok: false, error: "Telegram config missing", category: "missing_config", attempts: 0 };
  }

  let last: TelegramSendResult = { ok: false, category: "unknown", attempts: 0 };
  for (let attempt = 1; attempt <= config.telegramMaxRetries; attempt += 1) {
    console.log(`[telegram] attempt=${attempt}`);
    const result = await sendOnce(token, chatId, text, "HTML", config.telegramTimeoutMs);
    last = { ...result, attempts: attempt };
    console.log(`[telegram] http_status=${result.httpStatus ?? "none"}`);
    console.log(`[telegram] sent=${result.ok}`);
    if (result.ok) return last;
    if (result.category === "invalid_html" && options.allowPlainTextFallback !== false) {
      const plain = await sendOnce(token, chatId, stripHtml(text), undefined, config.telegramTimeoutMs);
      last = { ...plain, attempts: attempt };
      console.log(`[telegram] plain_text_fallback_sent=${plain.ok}`);
      if (plain.ok) return last;
    }
    if (!["network", "rate_limited", "unknown"].includes(result.category || "")) break;
    if (attempt < config.telegramMaxRetries) await sleep(result.category === "rate_limited" ? retryAfterMs(result.error) : attempt * 1000);
  }
  return last;
}

export async function recordAndSendEvent(signal: SignalRow, eventType: string, currentPrice?: number) {
  const eventName = signal.is_debug ? `[DEBUG] ${eventType}` : eventType;
  const idempotencyKey = `${signal.signal_id}:${eventName}`;
  const message = formatSignalMessage(signal, eventType, currentPrice);
  const db = getDb();
  const existing = db.prepare("SELECT * FROM notification_deliveries WHERE idempotency_key = ?").get(idempotencyKey) as NotificationDeliveryRow | undefined;
  if (existing?.status === "SENT") return { ok: true, attempts: existing.attempts, sentAt: existing.sent_at || undefined };
  const now = new Date().toISOString();
  const eventExists = db.prepare("SELECT id FROM signal_events WHERE signal_id = ? AND event_type = ? LIMIT 1").get(signal.signal_id, eventName);
  if (!eventExists) {
    db.prepare("INSERT INTO signal_events (signal_id, event_type, message_th, created_at) VALUES (?, ?, ?, ?)").run(signal.signal_id, eventName, message, now);
  }
  db.prepare(`INSERT INTO notification_deliveries (
      idempotency_key, signal_id, event_type, message_th, status, attempts, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'PENDING', 0, ?, ?)
    ON CONFLICT(idempotency_key) DO UPDATE SET message_th = excluded.message_th, updated_at = excluded.updated_at
  `).run(idempotencyKey, signal.signal_id, eventName, message, now, now);
  return sendDelivery(idempotencyKey);
}

export async function sendDelivery(idempotencyKey: string) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM notification_deliveries WHERE idempotency_key = ?").get(idempotencyKey) as NotificationDeliveryRow | undefined;
  if (!row) return { ok: false, error: "delivery_not_found", category: "unknown", attempts: 0 };
  if (row.status === "SENT") return { ok: true, attempts: row.attempts, sentAt: row.sent_at || undefined };
  console.log(`[telegram] event=${row.event_type}`);
  console.log(`[telegram] signal_id=${row.signal_id}`);
  const result = await sendTelegramMessage(row.message_th, { allowPlainTextFallback: true });
  const now = new Date().toISOString();
  const attempts = row.attempts + Math.max(result.attempts, 1);
  const status = result.ok ? "SENT" : attempts >= getSystemConfig().telegramMaxRetries ? "DEAD_LETTER" : "RETRY_PENDING";
  db.prepare(`UPDATE notification_deliveries SET status = ?, attempts = ?, last_error = ?, error_category = ?,
      telegram_http_status = ?, sent_at = ?, updated_at = ? WHERE idempotency_key = ?`)
    .run(status, attempts, result.error || null, result.category || null, result.httpStatus || null, result.ok ? now : row.sent_at, now, idempotencyKey);
  return result;
}

export async function retryPendingNotifications(limit = 10) {
  const rows = getDb().prepare(`SELECT * FROM notification_deliveries
    WHERE status IN ('PENDING','FAILED','RETRY_PENDING') ORDER BY created_at ASC LIMIT ?`).all(limit) as NotificationDeliveryRow[];
  const results = [];
  for (const row of rows) results.push({ key: row.idempotency_key, result: await sendDelivery(row.idempotency_key) });
  return results;
}

export function formatSignalMessage(signal: SignalRow, eventType: string, currentPrice = signal.current_price_at_signal) {
  const config = getSystemConfig();
  const provider = providerLabel(signal);
  const pair = `${signal.symbol}/USDT`;
  const entryAverage = (signal.entry_low + signal.entry_high) / 2;
  const stakeUsdt = signal.stake_thb / signal.usdthb_rate;
  const portfolioHeat = calculatePortfolioHeat();
  const base = [
    `Exchange: ${provider}`,
    `Pair: ${pair}`,
    `Signal: #${signal.signal_id}`,
    `Score: ${signal.score}/100 | Confidence: ${signal.confidence_pct || 0}% | Quality: ${signal.quality_label || "C"}`
  ];
  if (eventType === "SETUP_SIGNAL") {
    return [
      `Swing Signal SETUP #${signal.signal_id}`,
      ...base,
      `Market Guard: ${signal.market_guard_status || "normal"}`,
      `Portfolio Heat: ${portfolioHeat.heatPct.toFixed(1)}% | Slot: ${portfolioHeat.activeSetupCount}/${portfolioHeat.maxActiveSignals}`,
      `Buy Limit: ${formatPrice(signal.entry_low)} - ${formatPrice(signal.entry_high)} USDT`,
      `Recommended Stake: ${formatThb(signal.stake_thb)} THB ~= ${formatUsdt(stakeUsdt)} USDT`,
      `Target 1: ${formatPrice(signal.target1)} USDT (50%)`,
      `Target 2: ${formatPrice(signal.target2)} USDT (50%)`,
      `Expires: ${formatThaiDateTime(new Date(signal.expires_at))}`,
      "Action:",
      `1. Open Binance`,
      `2. Go to Spot`,
      `3. Select ${pair}`,
      `4. Place Buy Limit in the setup zone. After fill, place Sell Limits by the plan.`
    ].join("\n");
  }
  if (eventType === "PROVIDER_MIGRATED" || eventType === "PROVIDER_MIGRATION_REVIEW_REQUIRED" || eventType === "PROVIDER_UNAVAILABLE_REVIEW") {
    return [
      `Provider Migration Notice #${signal.signal_id}`,
      ...base,
      `Status: ${signal.provider_migration_status || eventType}`,
      `Reference: ${formatPrice(signal.migration_reference_price || entryAverage)} USDT`,
      `Binance: ${signal.migration_new_price ? formatPrice(signal.migration_new_price) : "N/A"} USDT`,
      `Diff: ${signal.migration_price_diff_pct == null ? "N/A" : signal.migration_price_diff_pct.toFixed(2) + "%"}`,
      "Action: review manually if status is not PROVIDER_MIGRATED."
    ].join("\n");
  }
  const action = eventType === "CANCEL_SIGNAL" ? "Cancel any related Binance Spot limit order manually." : "Open Binance Spot and review the plan manually.";
  return [
    `SwingSignal ${eventType} #${signal.signal_id}`,
    ...base,
    `Current Price: ${formatPrice(currentPrice)} USDT`,
    `Entry: ${formatPrice(signal.entry_low)} - ${formatPrice(signal.entry_high)} USDT`,
    `Target 1: ${formatPrice(signal.target1)} USDT`,
    `Target 2: ${formatPrice(signal.target2)} USDT`,
    `Action: ${action}`
  ].join("\n");
}

function providerLabel(signal: SignalRow) {
  if (signal.provider_migration_status && signal.provider_migration_status !== "PROVIDER_MIGRATED") return "Migration Review";
  if (signal.market_provider === "gateio_spot") return "Legacy Gate.io";
  return getMarketProvider().displayName;
}

async function sendOnce(token: string, chatId: string, text: string, parseMode: string | undefined, timeoutMs: number): Promise<TelegramSendResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body: Record<string, unknown> = { chat_id: chatId, text, disable_web_page_preview: true };
    if (parseMode) body.parse_mode = parseMode;
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const responseText = await response.text().catch(() => "");
    if (response.ok) return { ok: true, attempts: 1, httpStatus: response.status, sentAt: new Date().toISOString() };
    return { ok: false, attempts: 1, httpStatus: response.status, error: safeTelegramError(response.status, responseText), category: classify(response.status, responseText) };
  } catch (error) {
    return { ok: false, attempts: 1, error: String(error), category: "network" };
  } finally {
    clearTimeout(timer);
  }
}

function classify(status: number, body: string): TelegramCategory {
  const lower = body.toLowerCase();
  if (status === 401) return "unauthorized";
  if (status === 403) return "blocked";
  if (status === 400 && lower.includes("chat not found")) return "chat_not_found";
  if (status === 400 && (lower.includes("parse") || lower.includes("entity"))) return "invalid_html";
  if (status === 429) return "rate_limited";
  return "unknown";
}

function safeTelegramError(status: number, body: string) {
  return `HTTP ${status} ${body.replace(/\d{6,}:[A-Za-z0-9_-]+/g, "[redacted-token]").slice(0, 500)}`.trim();
}

function retryAfterMs(error?: string) {
  const match = error?.match(/retry after (\d+)/i);
  return match ? Number(match[1]) * 1000 : 2000;
}

function stripHtml(text: string) {
  return text.replace(/<[^>]*>/g, "");
}

function maskChatId(chatId: string) {
  if (chatId.length <= 4) return "***";
  return `${chatId.slice(0, 2)}***${chatId.slice(-2)}`;
}

function formatPrice(value: number) {
  if (value >= 100) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}
function formatThb(value: number) { return value.toLocaleString("th-TH", { maximumFractionDigits: 0 }); }
function formatUsdt(value: number) { return value.toLocaleString("en-US", { maximumFractionDigits: value >= 100 ? 0 : 1 }); }
function formatThaiDateTime(date: Date) {
  return date.toLocaleString("th-TH", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" });
}
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
