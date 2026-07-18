import { getSystemConfig } from "./config";
import { getDb } from "./db";
import { loadLocalEnv } from "./env";
import { calculatePortfolioHeat } from "./analytics";
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

const LINE = "━━━━━━━━━━━━━━";

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
  if (eventType === "SETUP_SIGNAL") return formatSetup(signal);
  if (eventType === "PROVIDER_MIGRATED") return formatProviderMigrated(signal);
  if (eventType === "PROVIDER_MIGRATION_REVIEW_REQUIRED" || eventType === "PROVIDER_UNAVAILABLE_REVIEW") return formatProviderReview(signal);
  if (eventType === "ENTRY_HIT" || eventType === "RECOVERY_ENTRY_HIT") return formatEntry(signal, currentPrice);
  if (eventType === "RECOVERY_SIGNAL") return formatRecovery(signal, currentPrice);
  if (eventType === "TARGET1_HIT" || eventType === "TARGET_HIT_1" || eventType === "PROFIT_PROTECTION_STARTED") return formatTarget1(signal, currentPrice);
  if (eventType === "TARGET2_HIT" || eventType === "TARGET_HIT_2" || eventType === "SIGNAL_CLOSED") return formatTarget2(signal, currentPrice);
  if (eventType === "CANCEL_SIGNAL" || eventType === "CANCELLED" || eventType === "ENTRY_RETRACE_CLOSED" || eventType === "TP2_TIMEOUT_CLOSED") return formatCancel(signal, currentPrice);
  if (eventType === "PRE_TP1_REVIEW_REQUIRED") return formatManualReview(signal, currentPrice);
  return formatGeneralNotice(signal, currentPrice);
}

function formatSetup(signal: SignalRow) {
  const heat = calculatePortfolioHeat();
  const avgEntry = entryAverage(signal);
  const stakeUsdt = signal.stake_thb / signal.usdthb_rate;
  const coinAmount = stakeUsdt / avgEntry;
  const expectedPct = expectedReturnPct(signal);
  const expectedUsdt = stakeUsdt * expectedPct / 100;
  const expectedThb = expectedUsdt * signal.usdthb_rate;
  return [
    `🟢 Swing Signal #${signal.signal_id}`,
    LINE,
    `เหรียญ: ${pair(signal)}`,
    `คะแนน: ${signal.score}/100`,
    `ความมั่นใจ: ${signal.confidence_pct || 0}%`,
    `คุณภาพสัญญาณ: ${signal.quality_label || "C"}`,
    `ความเสี่ยง: ${riskLabel(signal.risk_level)}`,
    `ภาพรวมตลาด: ${marketGuardLabel(signal.market_guard_status)}`,
    LINE,
    "💼 สถานะพอร์ต",
    `ใช้ทุนอยู่: ${heat.heatPct.toFixed(1)}%`,
    `เหลือสำรอง: ${formatThb(heat.reserveThb)} บาท`,
    `Slot: ${heat.activeSetupCount}/${heat.maxActiveSignals}`,
    LINE,
    "💰 ตั้ง Buy Limit",
    `${formatPrice(signal.entry_low)} - ${formatPrice(signal.entry_high)} USDT`,
    `≈ ${formatThb(signal.entry_low * signal.usdthb_rate)} - ${formatThb(signal.entry_high * signal.usdthb_rate)} บาท`,
    LINE,
    "💵 ทุนแนะนำ",
    `${formatThb(signal.stake_thb)} บาท`,
    `≈ ${formatUsdt(stakeUsdt)} USDT`,
    "เหตุผลทุน",
    signal.position_reason_th || positionReason(signal),
    LINE,
    "คาดว่าจะได้รับ",
    `≈ ${formatQuantity(coinAmount)} ${signal.symbol}`,
    LINE,
    "🎯 เป้าขาย",
    `ไม้ 1: ${formatPrice(signal.target1)} USDT | 50% | ≈ ${formatThb(signal.target1 * signal.usdthb_rate)} บาท`,
    `ไม้ 2: ${formatPrice(signal.target2)} USDT | 50% | ≈ ${formatThb(signal.target2 * signal.usdthb_rate)} บาท`,
    LINE,
    "กำไรคาดหวัง",
    `+${expectedPct.toFixed(1)}%`,
    `≈ ${formatThb(expectedThb)} บาท`,
    `≈ ${formatUsdt(expectedUsdt)} USDT`,
    LINE,
    "⏳ อายุสัญญาณ",
    `${getSystemConfig().signalExpiryDays} วัน`,
    `หมดอายุ: ${formatThaiDateTime(new Date(signal.expires_at))}`,
    LINE,
    "เหตุผล",
    reasons(signal),
    LINE,
    "คำสั่ง",
    "1. เปิด Binance",
    "2. ไปที่ Spot",
    `3. เลือก ${pair(signal)}`,
    "4. ตั้ง Buy Limit ตามโซนด้านบน",
    "5. เมื่อซื้อสำเร็จ ตั้ง Sell Limit ไม้ 1 ที่ 50% และไม้ 2 ที่ 50%"
  ].join("\n");
}

function formatEntry(signal: SignalRow, currentPrice: number) {
  const avg = signal.average_entry_price || entryAverage(signal);
  const qty = signal.total_quantity || (signal.stake_thb / signal.usdthb_rate / avg);
  const expectedUsdt = Math.max(0, (signal.target2 - avg) * qty);
  return [
    "🟢 เข้าโซนซื้อแล้ว",
    LINE,
    `เหรียญ: ${pair(signal)}`,
    `ราคาปัจจุบัน: ${formatPrice(currentPrice)} USDT`,
    `Average Entry: ${formatPrice(avg)} USDT`,
    `Target หลัก: ${formatPrice(signal.updated_target2 || signal.target2)} USDT`,
    `จำนวนเหรียญ: ≈ ${formatQuantity(qty)} ${signal.symbol}`,
    `กำไรคาดหวัง: ≈ ${formatUsdt(expectedUsdt)} USDT | ≈ ${formatThb(expectedUsdt * signal.usdthb_rate)} บาท`,
    LINE,
    "คำสั่ง",
    "1. ตรวจสอบว่า Buy Limit ถูก Fill แล้ว",
    "2. ถ้า Fill แล้ว ตั้ง Sell Limit ตามแผน",
    "3. ไม้ 1 ขาย 50% และไม้ 2 ขาย 50%"
  ].join("\n");
}

function formatRecovery(signal: SignalRow, currentPrice: number) {
  const avg = signal.average_entry_price || entryAverage(signal);
  const extraThb = signal.stake_thb;
  const totalThb = signal.total_position_thb || signal.stake_thb;
  const qty = signal.total_quantity || (totalThb / signal.usdthb_rate / avg);
  const target = signal.updated_target2 || signal.target2;
  const expectedUsdt = Math.max(0, (target - avg) * qty);
  return [
    "🟡 แจ้งเตือนช้อนเพิ่ม",
    LINE,
    `เหรียญ: ${pair(signal)}`,
    `ราคาปัจจุบัน: ${formatPrice(currentPrice)} USDT`,
    "เหตุผล: ราคาอ่อนตัวถึงโซนช้อนเพิ่มตามแผน และยังไม่หลุดกรอบบริหารความเสี่ยง",
    `Average ใหม่: ${formatPrice(avg)} USDT`,
    `Target ใหม่: ${formatPrice(signal.updated_target1 || signal.target1)} / ${formatPrice(target)} USDT`,
    `เงินเพิ่ม: ${formatThb(extraThb)} บาท`,
    `จำนวนเหรียญรวม: ≈ ${formatQuantity(qty)} ${signal.symbol}`,
    `กำไรใหม่: ≈ ${formatUsdt(expectedUsdt)} USDT | ≈ ${formatThb(expectedUsdt * signal.usdthb_rate)} บาท`,
    LINE,
    "คำสั่ง",
    "1. ยกเลิก Sell Limit เดิม",
    "2. ตั้ง Buy Limit ช้อนเพิ่มตามแผน",
    "3. หลังซื้อสำเร็จ ตั้ง Sell Limit ใหม่ตาม Target ใหม่"
  ].join("\n");
}

function formatTarget1(signal: SignalRow, currentPrice: number) {
  const qty = signal.total_quantity || signal.stake_thb / signal.usdthb_rate / entryAverage(signal);
  const netUsdt = signal.realized_net_profit_usdt || Math.max(0, (signal.target1 - entryAverage(signal)) * qty * 0.5);
  return [
    "🟣 ขายไม้แรกสำเร็จ",
    LINE,
    `เหรียญ: ${pair(signal)}`,
    `ราคาปัจจุบัน: ${formatPrice(currentPrice)} USDT`,
    "ขายแล้ว: 50%",
    "เหลือถือ: 50%",
    `กำไรที่ล็อกได้: ≈ ${formatUsdt(netUsdt)} USDT | ≈ ${formatThb((signal.realized_net_profit_thb || netUsdt * signal.usdthb_rate))} บาท`,
    LINE,
    "สถานะ",
    "ระบบเข้าสู่โหมดรักษากำไร",
    "ตั้งไม้ที่เหลือไว้ตามแผน และติดตามต่อจนปิดแผน"
  ].join("\n");
}

function formatTarget2(signal: SignalRow, currentPrice: number) {
  const qty = signal.total_quantity || signal.stake_thb / signal.usdthb_rate / entryAverage(signal);
  const netUsdt = signal.final_net_profit_usdt ?? signal.realized_net_profit_usdt ?? Math.max(0, (signal.target2 - entryAverage(signal)) * qty);
  const netThb = signal.final_net_profit_thb ?? signal.realized_net_profit_thb ?? netUsdt * signal.usdthb_rate;
  const pct = signal.total_position_usdt ? netUsdt / signal.total_position_usdt * 100 : expectedReturnPct(signal);
  return [
    "🏁 ปิดแผนสำเร็จ",
    LINE,
    `เหรียญ: ${pair(signal)}`,
    `ราคาปัจจุบัน: ${formatPrice(currentPrice)} USDT`,
    `กำไรสุทธิ: ${netUsdt >= 0 ? "+" : ""}${formatUsdt(netUsdt)} USDT`,
    `เปอร์เซ็นต์: ${netUsdt >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
    `คิดเป็นบาท: ${netThb >= 0 ? "+" : ""}${formatThb(netThb)} บาท`,
    `จำนวนวันที่ถือ: ${heldDays(signal)} วัน`,
    LINE,
    "สถานะ",
    "แผนนี้จบแล้ว รอสัญญาณใหม่จากระบบ"
  ].join("\n");
}

function formatCancel(signal: SignalRow, currentPrice: number) {
  return [
    "🔴 ยกเลิกสัญญาณ",
    LINE,
    `เหรียญ: ${pair(signal)}`,
    `ราคาปัจจุบัน: ${formatPrice(currentPrice)} USDT`,
    `เหตุผล: ${cancelReason(signal)}`,
    LINE,
    "คำสั่ง",
    "1. ยกเลิก Buy Limit ที่ยังไม่ Fill",
    "2. ไม่ต้องไล่ราคา",
    "3. รอสัญญาณใหม่จากระบบ"
  ].join("\n");
}

function formatProviderMigrated(signal: SignalRow) {
  return [
    "ℹ️ ระบบอัปเดตข้อมูลตลาด",
    LINE,
    `เหรียญ: ${pair(signal)}`,
    "ระบบย้ายการติดตาม",
    "จาก Gate.io",
    "ไปเป็น Binance Spot",
    `ราคาต่าง: ${formatPct(signal.migration_price_diff_pct)}`,
    LINE,
    "สถานะ",
    "แผนเดิมยังใช้ได้",
    "ไม่ต้องตั้ง Order ใหม่"
  ].join("\n");
}

function formatProviderReview(signal: SignalRow) {
  return [
    "⚠️ ตรวจสอบด้วยตนเอง",
    LINE,
    `เหรียญ: ${pair(signal)}`,
    "ราคาระหว่าง Gate.io และ Binance ต่างกัน",
    `${formatPct(signal.migration_price_diff_pct)}`,
    "ระบบจึงยังไม่ใช้ราคาใหม่ เพื่อป้องกันการแจ้งผิด",
    LINE,
    "คำสั่ง",
    "1. เปิด Binance Spot",
    `2. ตรวจสอบ ${pair(signal)}`,
    "3. เทียบ Order เดิมก่อนตัดสินใจ"
  ].join("\n");
}

function formatManualReview(signal: SignalRow, currentPrice: number) {
  return [
    "⚠️ ตรวจสอบแผน",
    LINE,
    `เหรียญ: ${pair(signal)}`,
    `ราคาปัจจุบัน: ${formatPrice(currentPrice)} USDT`,
    "ราคาใกล้จุดที่ต้องบริหารไม้ขาย",
    LINE,
    "คำสั่ง",
    "เปิด Binance Spot และตรวจสอบ Sell Limit ก่อนดำเนินการต่อ"
  ].join("\n");
}

function formatGeneralNotice(signal: SignalRow, currentPrice: number) {
  return [
    "ℹ️ แจ้งเตือนสถานะ",
    LINE,
    `เหรียญ: ${pair(signal)}`,
    `ราคาปัจจุบัน: ${formatPrice(currentPrice)} USDT`,
    `โซนซื้อ: ${formatPrice(signal.entry_low)} - ${formatPrice(signal.entry_high)} USDT`,
    `เป้าขาย: ${formatPrice(signal.target1)} / ${formatPrice(signal.target2)} USDT`,
    LINE,
    "คำสั่ง",
    "เปิด Binance Spot และตรวจสอบแผนด้วยตนเอง"
  ].join("\n");
}

function pair(signal: SignalRow) { return `${signal.symbol}/USDT`; }
function entryAverage(signal: SignalRow) { return (signal.entry_low + signal.entry_high) / 2; }
function expectedReturnPct(signal: SignalRow) { return Math.max(0, ((signal.target2 - entryAverage(signal)) / entryAverage(signal)) * 100); }
function positionReason(signal: SignalRow) {
  if (signal.score >= 95 && signal.confidence_pct >= 65) return "คะแนนสูง + ความมั่นใจผ่านเกณฑ์";
  if (signal.confidence_pct < 65) return "ลดทุนเพราะความมั่นใจต่ำกว่าเกณฑ์";
  return "ใช้ทุนตามคุณภาพสัญญาณ";
}
function reasons(signal: SignalRow) {
  const text = signal.reason_th?.trim();
  if (text) return text;
  return ["✅ ย่อใกล้แนวรับ", "✅ Volume ผ่านเกณฑ์", "✅ มีโอกาสเด้งในกรอบ", "✅ Reward คุ้มความเสี่ยง"].join("\n");
}
function marketGuardLabel(status?: string | null) {
  if (status === "risk_off") return "Risk-Off";
  if (status === "caution") return "ระวัง";
  return "ปกติ";
}
function riskLabel(value?: string | null) {
  if (value === "high") return "สูง";
  if (value === "low") return "ต่ำ";
  if (value === "medium") return "กลาง";
  return value || "กลาง";
}
function cancelReason(signal: SignalRow) {
  if (signal.close_reason === "ENTRY_RETRACE_CLOSED") return "ราคาเด้งออกจากโซนซื้อก่อนเข้าแผน";
  if (signal.close_reason === "TP2_TIMEOUT_CLOSED") return "ถือเกินเวลาที่ระบบกำหนด";
  if (new Date(signal.expires_at).getTime() < Date.now() && !signal.entry_hit_at) return "หมดอายุและยังไม่เข้าโซนซื้อ";
  return "แผนไม่เข้าเงื่อนไขต่อ";
}
function heldDays(signal: SignalRow) {
  const start = signal.entry_hit_at || signal.created_at;
  const end = signal.closed_at || signal.target2_hit_at || new Date().toISOString();
  return Math.max(0, Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86400000));
}
function formatPct(value?: number | null) { return value == null ? "ไม่พบข้อมูล" : `${value.toFixed(2)}%`; }

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

function stripHtml(text: string) { return text.replace(/<[^>]*>/g, ""); }
function maskChatId(chatId: string) {
  if (chatId.length <= 4) return "***";
  return `${chatId.slice(0, 2)}***${chatId.slice(-2)}`;
}
function formatPrice(value: number) {
  if (value >= 100) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}
function formatQuantity(value: number) { return value.toLocaleString("en-US", { maximumFractionDigits: value >= 10 ? 2 : 6 }); }
function formatThb(value: number) { return value.toLocaleString("th-TH", { maximumFractionDigits: 0 }); }
function formatUsdt(value: number) { return value.toLocaleString("en-US", { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2 }); }
function formatThaiDateTime(date: Date) {
  return date.toLocaleString("th-TH", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" });
}
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }