import { getDb } from "./db";
import type { SignalRow } from "./types";

export async function sendTelegramMessage(text: string): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { ok: false, error: "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID" };

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true })
  });
  if (!response.ok) return { ok: false, error: `Telegram failed: ${response.status}` };
  return { ok: true };
}

export async function recordAndSendEvent(signal: SignalRow, eventType: string, currentPrice?: number) {
  const message = formatSignalMessage(signal, eventType, currentPrice);
  getDb()
    .prepare("INSERT INTO signal_events (signal_id, event_type, message_th, created_at) VALUES (?, ?, ?, ?)")
    .run(signal.signal_id, eventType, message, new Date().toISOString());
  return sendTelegramMessage(message);
}

export function formatSignalMessage(signal: SignalRow, eventType: string, currentPrice = signal.current_price_at_signal) {
  const thbLow = signal.entry_low * signal.usdthb_rate;
  const thbHigh = signal.entry_high * signal.usdthb_rate;
  const expectedUsdt = signal.target2 - signal.entry_high;
  const expectedThb = expectedUsdt * signal.usdthb_rate;

  if (eventType === "SETUP_SIGNAL") {
    return [
      `🟡 SETUP SIGNAL #${signal.signal_id}`,
      `เหรียญ: ${signal.symbol}/USDT`,
      "แผน: ตั้ง Buy Limit",
      `โซนตั้งซื้อ: ${signal.entry_low}-${signal.entry_high} USDT`,
      `ราคาไทยประมาณ: ${thbLow.toLocaleString("th-TH", { maximumFractionDigits: 0 })}-${thbHigh.toLocaleString("th-TH", { maximumFractionDigits: 0 })} บาท`,
      `ทุนแนะนำ: ${signal.stake_thb.toLocaleString("th-TH")} บาท`,
      `ขายไม้ 1: ${signal.target1} USDT จำนวน 50%`,
      `ขายไม้ 2: ${signal.target2} USDT จำนวน 50%`,
      `กำไรคาดหวัง: ${expectedUsdt.toFixed(4)} USDT / ${expectedThb.toLocaleString("th-TH", { maximumFractionDigits: 0 })} บาท`,
      `คะแนนสัญญาณ: ${signal.score}/100`,
      `ความเสี่ยง: ${signal.risk_level}`,
      "หมดอายุ: อีก 3 วัน",
      `เหตุผล: ${signal.reason_th}`
    ].join("\n");
  }

  if (eventType === "ENTRY_HIT") {
    return [
      `🟢 ENTRY HIT #${signal.signal_id}`,
      `เหรียญ: ${signal.symbol}/USDT`,
      "ราคาลงถึงโซนตั้งซื้อแล้ว",
      `โซนตั้งซื้อเดิม: ${signal.entry_low}-${signal.entry_high} USDT`,
      `ราคาปัจจุบัน Gate.io: ${currentPrice} USDT`,
      "คำสั่ง: ตรวจสอบว่า Buy Limit ถูก Fill หรือยัง",
      "ถ้า Fill แล้ว ให้ตั้งขายตามแผน:",
      `ขายไม้ 1: ${signal.target1} USDT จำนวน 50%`,
      `ขายไม้ 2: ${signal.target2} USDT จำนวน 50%`
    ].join("\n");
  }

  if (eventType === "CANCEL_SIGNAL") {
    return [
      `🔴 CANCEL SIGNAL #${signal.signal_id}`,
      `เหรียญ: ${signal.symbol}/USDT`,
      "สถานะ: สัญญาณหมดอายุแล้ว",
      "เหตุผล: ราคาไม่ลงถึงโซนตั้งซื้อภายใน 3 วัน",
      "คำสั่ง: ยกเลิก Buy Limit ใน Gate.io และรอสัญญาณใหม่"
    ].join("\n");
  }

  if (eventType === "TARGET_HIT_1") {
    return [
      `🔵 TARGET HIT #${signal.signal_id}`,
      `เหรียญ: ${signal.symbol}/USDT`,
      `ราคาแตะขายไม้ 1: ${signal.target1} USDT`,
      "แผน: บันทึกผลจำลอง 50% และถือไม้ที่เหลือตาม Target 2"
    ].join("\n");
  }

  return [
    `✅ SIGNAL CLOSED #${signal.signal_id}`,
    `เหรียญ: ${signal.symbol}/USDT`,
    `สถานะ: ปิดแผนจำลองแล้ว`,
    `Target 2: ${signal.target2} USDT`
  ].join("\n");
}
