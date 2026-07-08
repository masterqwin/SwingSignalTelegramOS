import { getSystemConfig } from "./config";
import { getDb } from "./db";
import { loadLocalEnv } from "./env";
import type { SignalRow } from "./types";

export async function sendTelegramMessage(text: string): Promise<{ ok: boolean; error?: string }> {
  loadLocalEnv();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return {
      ok: false,
      error: "กรุณาใส่ TELEGRAM_BOT_TOKEN และ TELEGRAM_CHAT_ID ในไฟล์ .env.local ก่อนทดสอบ Telegram"
    };
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, error: `Telegram ส่งไม่สำเร็จ: HTTP ${response.status} ${body}`.trim() };
  }
  return { ok: true };
}

export async function recordAndSendEvent(signal: SignalRow, eventType: string, currentPrice?: number) {
  const eventName = signal.is_debug ? `[DEBUG] ${eventType}` : eventType;
  const message = formatSignalMessage(signal, eventType, currentPrice);
  getDb()
    .prepare("INSERT INTO signal_events (signal_id, event_type, message_th, created_at) VALUES (?, ?, ?, ?)")
    .run(signal.signal_id, eventName, message, new Date().toISOString());
  return sendTelegramMessage(message);
}

export function formatSignalMessage(signal: SignalRow, eventType: string, currentPrice = signal.current_price_at_signal) {
  const config = getSystemConfig();
  const debugLines = signal.is_debug ? ["[DEBUG]", ""] : [];
  const entryAverage = (signal.entry_low + signal.entry_high) / 2;
  const stakeUsdt = signal.stake_thb / signal.usdthb_rate;
  const estimatedCoinQty = stakeUsdt / entryAverage;
  const planAverageTarget = (signal.target1 + signal.target2) / 2;
  const expectedReturnPct = ((planAverageTarget - entryAverage) / entryAverage) * 100;
  const expectedProfitUsdt = stakeUsdt * (expectedReturnPct / 100);
  const expectedProfitThb = expectedProfitUsdt * signal.usdthb_rate;
  const expiresAt = new Date(signal.expires_at);

  const entryLowThb = signal.entry_low * signal.usdthb_rate;
  const entryHighThb = signal.entry_high * signal.usdthb_rate;
  const target1Thb = signal.target1 * signal.usdthb_rate;
  const target2Thb = signal.target2 * signal.usdthb_rate;
  const currentThb = currentPrice * signal.usdthb_rate;

  if (eventType === "SETUP_SIGNAL") {
    return [
      `🟢 Swing Signal #${signal.signal_id}`,
      ...debugLines,
      "━━━━━━━━━━━━━━",
      `เหรียญ: ${signal.symbol}/USDT`,
      `คะแนน: ${signal.score}/100`,
      `ความเสี่ยง: ${signal.risk_level}`,
      "",
      "💰 ตั้ง Buy Limit",
      `${formatPrice(signal.entry_low)} - ${formatPrice(signal.entry_high)} USDT`,
      `≈ ${formatThb(entryLowThb)} - ${formatThb(entryHighThb)} บาท`,
      "",
      "💵 ทุนแนะนำ",
      `${formatThb(signal.stake_thb)} บาท`,
      `≈ ${formatUsdt(stakeUsdt)} USDT`,
      "",
      "คาดว่าจะได้รับ",
      `≈ ${formatCoinQty(estimatedCoinQty)} ${signal.symbol}`,
      "",
      "🎯 เป้าขาย",
      `ไม้ 1: ${formatPrice(signal.target1)} USDT จำนวน 50% (≈ ${formatThb(target1Thb)} บาท)`,
      `ไม้ 2: ${formatPrice(signal.target2)} USDT จำนวน 50% (≈ ${formatThb(target2Thb)} บาท)`,
      "",
      "กำไรคาดหวัง",
      `+${expectedReturnPct.toFixed(1)}%`,
      `≈ ${formatThb(expectedProfitThb)} บาท`,
      `≈ ${formatUsdt(expectedProfitUsdt)} USDT`,
      "",
      "⏳ อายุสัญญาณ",
      `${config.signalExpiryDays} วัน`,
      `หมดอายุ: ${formatThaiDateTime(expiresAt)}`,
      "",
      "เหตุผล:",
      "✅ ย่อใกล้แนวรับ",
      "✅ Volume ผ่านเกณฑ์",
      "✅ มีโอกาสเด้งในกรอบ",
      "✅ Reward คุ้มความเสี่ยง",
      "",
      "คำสั่ง:",
      "1. ตั้ง Buy Limit ตามโซนด้านบน",
      `2. ใช้ทุนประมาณ ${formatUsdt(stakeUsdt)} USDT`,
      "3. เมื่อซื้อสำเร็จ ให้ตั้งขาย:",
      `   - ${formatPrice(signal.target1)} USDT จำนวน 50%`,
      `   - ${formatPrice(signal.target2)} USDT จำนวน 50%`,
      `4. ถ้าไม่ถึงโซนซื้อภายใน ${config.signalExpiryDays} วัน ระบบจะแจ้ง CANCEL SIGNAL`
    ].join("\n");
  }

  if (eventType === "ENTRY_HIT") {
    return [
      `🟢 ENTRY HIT #${signal.signal_id}`,
      ...debugLines,
      `เหรียญ: ${signal.symbol}/USDT`,
      "ราคาลงถึงโซนตั้งซื้อแล้ว",
      "",
      `โซนตั้งซื้อเดิม: ${formatPrice(signal.entry_low)} - ${formatPrice(signal.entry_high)} USDT`,
      `ราคาปัจจุบัน Gate.io: ${formatPrice(currentPrice)} USDT`,
      `ราคาไทยประมาณ: ≈ ${formatThb(currentThb)} บาท`,
      "",
      "💵 ทุนแนะนำ",
      `${formatThb(signal.stake_thb)} บาท`,
      `≈ ${formatUsdt(stakeUsdt)} USDT`,
      "",
      "คาดว่าจะได้รับ",
      `≈ ${formatCoinQty(estimatedCoinQty)} ${signal.symbol}`,
      "",
      "คำสั่ง:",
      "ตรวจสอบใน Gate.io ว่า Buy Limit ถูก Fill หรือยัง",
      "ถ้า Fill แล้ว ให้ตั้งขายตามแผน:",
      "",
      `ขายไม้ 1: ${formatPrice(signal.target1)} USDT จำนวน 50% (≈ ${formatThb(target1Thb)} บาท)`,
      `ขายไม้ 2: ${formatPrice(signal.target2)} USDT จำนวน 50% (≈ ${formatThb(target2Thb)} บาท)`
    ].join("\n");
  }

  if (eventType === "TARGET_HIT_1") {
    return [
      `🟣 TARGET 1 HIT #${signal.signal_id}`,
      ...debugLines,
      `เหรียญ: ${signal.symbol}/USDT`,
      `ราคาแตะเป้าขายไม้ 1 แล้ว: ${formatPrice(signal.target1)} USDT (≈ ${formatThb(target1Thb)} บาท)`,
      "ตรวจสอบว่า Sell Limit ไม้ 1 ถูกขายหรือยัง"
    ].join("\n");
  }

  if (eventType === "TARGET_HIT_2") {
    return [
      `🏁 TARGET 2 HIT #${signal.signal_id}`,
      ...debugLines,
      `เหรียญ: ${signal.symbol}/USDT`,
      `ราคาแตะเป้าขายไม้ 2 แล้ว: ${formatPrice(signal.target2)} USDT (≈ ${formatThb(target2Thb)} บาท)`,
      "สัญญาณนี้เข้าแผนปิดรอบ"
    ].join("\n");
  }

  if (eventType === "CANCEL_SIGNAL") {
    return [
      `🔴 CANCEL SIGNAL #${signal.signal_id}`,
      ...debugLines,
      `เหรียญ: ${signal.symbol}/USDT`,
      "สถานะ: สัญญาณหมดอายุแล้ว",
      `เหตุผล: ราคาไม่ลงถึงโซนตั้งซื้อภายใน ${config.signalExpiryDays} วัน`,
      "คำสั่ง:",
      "ยกเลิก Buy Limit ใน Gate.io",
      "รอสัญญาณใหม่จากระบบ"
    ].join("\n");
  }

  if (eventType === "SIGNAL_CLOSED") {
    return [
      `✅ SIGNAL CLOSED #${signal.signal_id}`,
      ...debugLines,
      `เหรียญ: ${signal.symbol}/USDT`,
      "สถานะ: ปิดแผนจำลองแล้ว"
    ].join("\n");
  }

  return [
    `RECOVERY SIGNAL #${signal.signal_id}`,
    ...debugLines,
    `เหรียญ: ${signal.symbol}/USDT`,
    "สถานะ: V1 ยังไม่เปิดส่ง recovery อัตโนมัติ",
    "ระบบบันทึก placeholder/log เท่านั้น และไม่ส่งสัญญาณ recovery แบบเดาสุ่ม"
  ].join("\n");
}

function formatPrice(value: number) {
  if (value >= 100) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

function formatThb(value: number) {
  return value.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

function formatUsdt(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: value >= 100 ? 0 : 1 });
}

function formatCoinQty(value: number) {
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (value >= 1) return value.toLocaleString("en-US", { maximumFractionDigits: 3 });
  return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function formatThaiDateTime(date: Date) {
  return date.toLocaleString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Bangkok"
  });
}
