import { getSystemConfig } from "./config";
import { getDb } from "./db";
import { loadLocalEnv } from "./env";
import { calculatePortfolioHeat } from "./analytics";
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
  const portfolioHeat = calculatePortfolioHeat();
  const marketGuardLabel = formatMarketGuardLabel(signal.market_guard_status || "normal");

  if (eventType === "SETUP_SIGNAL") {
    return [
      `🟢 Swing Signal #${signal.signal_id}`,
      ...debugLines,
      "━━━━━━━━━━━━━━",
      `เหรียญ: ${signal.symbol}/USDT`,
      `คะแนน: ${signal.score}/100`,
      `ความมั่นใจ: ${signal.confidence_pct || 0}%`,
      `คุณภาพสัญญาณ: ${signal.quality_label || "C"}`,
      `ความเสี่ยง: ${signal.risk_level}`,
      `ภาพรวมตลาด: ${marketGuardLabel}`,
      "",
      "สถานะพอร์ต:",
      `ใช้ทุนอยู่: ${portfolioHeat.heatPct.toFixed(1)}%`,
      `เหลือสำรอง: ${formatThb(portfolioHeat.reserveThb)} บาท`,
      `Slot: ${portfolioHeat.activeSetupCount}/${portfolioHeat.maxActiveSignals}`,
      "",
      "💰 ตั้ง Buy Limit",
      `${formatPrice(signal.entry_low)} - ${formatPrice(signal.entry_high)} USDT`,
      `≈ ${formatThb(entryLowThb)} - ${formatThb(entryHighThb)} บาท`,
      "",
      "💵 ทุนแนะนำ",
      `${formatThb(signal.stake_thb)} บาท ≈ ${formatUsdt(stakeUsdt)} USDT`,
      `เหตุผลทุน: ${signal.position_reason_th || "ใช้ทุนตามคุณภาพสัญญาณ"}`,
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
      "ถือว่าจำลองขาย 50% ของจำนวนรวมแล้ว",
      `กำไรสุทธิส่วน TARGET 1 โดยประมาณ: ${formatUsdt(signal.realized_net_profit_usdt || expectedProfitUsdt * 0.5)} USDT`,
      "เริ่ม Profit Protection: หลังจากนี้ระบบจะไม่ส่ง Recovery เพิ่มสำหรับสัญญาณนี้"
    ].join("\n");
  }

  if (eventType === "PROFIT_PROTECTION_STARTED") {
    return [
      `🟣 PROFIT PROTECTION STARTED #${signal.signal_id}`,
      ...debugLines,
      `เหรียญ: ${signal.symbol}/USDT`,
      "TARGET 1 สำเร็จแล้ว และเข้าสู่โหมดรักษากำไร",
      `Average Entry: ${formatPrice(signal.average_entry_price || entryAverage)} USDT`,
      `TARGET 2: ${formatPrice(signal.target2)} USDT`,
      `หมดเวลา TP2 grace: ${signal.tp2_grace_expires_at ? formatThaiDateTime(new Date(signal.tp2_grace_expires_at)) : `${config.tp2GraceDays} วัน`}`,
      "",
      "คำสั่ง:",
      "ถือส่วนที่เหลือ 50% ตาม TARGET 2",
      "ถ้าราคาย้อนกลับถึง Average Entry ระบบจะแจ้งปิดส่วนที่เหลือ"
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

  if (eventType === "RECOVERY_SIGNAL") {
    const dcaLevel = signal.dca_level || 2;
    const previousLevel = Math.max(1, dcaLevel - 1);
    const averageEntryPrice = signal.average_entry_price || entryAverage;
    const totalPositionUsdt = signal.total_position_usdt || stakeUsdt;
    const totalPositionThb = signal.total_position_thb || signal.stake_thb;
    const totalQuantity = signal.total_quantity || totalPositionUsdt / averageEntryPrice;
    const recoveryQuantity = stakeUsdt / currentPrice;
    const recoveryEntryPrice = currentPrice;
    const latestPlan = getLatestTargetPlan(signal.signal_id);
    return [
      `🟡 RECOVERY SIGNAL #${signal.signal_id}`,
      ...debugLines,
      `เหรียญ: ${signal.symbol}/USDT`,
      `ระดับการช้อน: ไม้ ${dcaLevel} จากสูงสุด ${config.maxDcaEntries} ไม้`,
      "สถานะ: TARGET 1 ยังไม่สำเร็จ และราคาเข้าสู่โซน Recovery",
      "",
      "━━━━━━━━━━━━━━",
      "ไม้เดิม:",
      `ไม้ ${previousLevel}: ราคาเข้า ${formatPrice(signal.current_price_at_signal)} USDT`,
      `ทุนเดิม: ${formatUsdt(Math.max(0, totalPositionUsdt - stakeUsdt))} USDT / ${formatThb(Math.max(0, totalPositionThb - signal.stake_thb))} บาท`,
      "",
      "━━━━━━━━━━━━━━",
      "ไม้ Recovery ใหม่",
      "ตั้ง Buy Limit:",
      `${formatPrice(signal.entry_low)} - ${formatPrice(recoveryEntryPrice)} USDT`,
      `≈ ${formatThb(signal.entry_low * signal.usdthb_rate)} - ${formatThb(recoveryEntryPrice * signal.usdthb_rate)} บาท`,
      "",
      "ทุนแนะนำ:",
      `${formatUsdt(stakeUsdt)} USDT`,
      `≈ ${formatThb(signal.stake_thb)} บาท`,
      "",
      "คาดว่าจะได้รับ:",
      `≈ ${formatCoinQty(recoveryQuantity)} ${signal.symbol}`,
      "",
      "━━━━━━━━━━━━━━",
      "หลัง Recovery ถูก Fill",
      `ต้นทุนรวม: ${formatUsdt(totalPositionUsdt)} USDT / ${formatThb(totalPositionThb)} บาท`,
      `จำนวนเหรียญรวม: ${formatCoinQty(totalQuantity)} ${signal.symbol}`,
      "Average Entry ใหม่:",
      `${formatPrice(averageEntryPrice)} USDT`,
      `≈ ${formatThb(averageEntryPrice * signal.usdthb_rate)} บาท`,
      `Break-even หลัง fee: ${formatPrice(signal.break_even_price || averageEntryPrice)} USDT`,
      "",
      "━━━━━━━━━━━━━━",
      "เป้าขายใหม่",
      `TARGET 1: ${formatPrice(signal.updated_target1 || signal.target1)} USDT ขาย 50%`,
      `TARGET 2: ${formatPrice(signal.updated_target2 || signal.target2)} USDT ขาย 50%`,
      "Expected Net Profit:",
      `TARGET 1: ${formatUsdt(latestPlan?.expected_net_tp1 ?? 0)} USDT / ${formatThb((latestPlan?.expected_net_tp1 ?? 0) * signal.usdthb_rate)} บาท`,
      `เต็มแผน: ${formatUsdt(latestPlan?.expected_net_full ?? 0)} USDT / ${formatThb((latestPlan?.expected_net_full ?? 0) * signal.usdthb_rate)} บาท`,
      "",
      "อายุแผนใหม่:",
      `${config.positionPlanDays} วันนับจาก Recovery Entry Hit`,
      "",
      "ตัวเลขกำไรเป็นค่าประมาณหลัง fee/slippage และขึ้นกับการ Fill จริง",
      "",
      "คำสั่ง:",
      "1. ตั้ง Buy Limit ตาม Recovery Zone",
      "2. เมื่อซื้อสำเร็จ ให้ยกเลิก Sell Limit เดิม",
      "3. ใช้ Target 1 และ Target 2 ใหม่เท่านั้น",
      "4. ระบบจะติดตามด้วย Signal ID เดิม"
    ].join("\n");
  }

  if (eventType === "ENTRY_RETRACE_CLOSED") {
    return [
      `🟠 PROFIT PROTECTION CLOSE #${signal.signal_id}`,
      ...debugLines,
      `เหรียญ: ${signal.symbol}/USDT`,
      "TARGET 1: สำเร็จแล้ว",
      "สถานะ: ราคาย้อนกลับถึง Average Entry",
      "",
      `Average Entry: ${formatPrice(signal.average_entry_price || entryAverage)} USDT`,
      `ราคาปัจจุบัน: ${formatPrice(currentPrice)} USDT`,
      "",
      "คำสั่ง:",
      "ปิดส่วนที่เหลือ 50% และยกเลิก TARGET 2 เดิม",
      "",
      "เหตุผล:",
      "รักษากำไรจาก TARGET 1 และไม่ปล่อยให้ส่วนที่เหลือกลับเป็นขาดทุนมากขึ้น",
      "",
      "ผลจำลอง:",
      `กำไรจาก TARGET 1: ${formatUsdt(signal.realized_net_profit_usdt || 0)} USDT`,
      `ผลส่วนที่เหลือ: ${formatUsdt(signal.unrealized_remaining_pnl_usdt || 0)} USDT`,
      `กำไรสุทธิรวมโดยประมาณ: ${formatUsdt(signal.final_net_profit_usdt || 0)} USDT / ${formatThb(signal.final_net_profit_thb || 0)} บาท`,
      "",
      "Close reason: ENTRY_RETRACE_CLOSED"
    ].join("\n");
  }

  if (eventType === "TP2_TIMEOUT_CLOSED") {
    return [
      `⏰ TARGET 2 TIMEOUT CLOSE #${signal.signal_id}`,
      ...debugLines,
      `เหรียญ: ${signal.symbol}/USDT`,
      "TARGET 1: สำเร็จแล้ว",
      `TARGET 2: ไม่สำเร็จภายใน ${config.tp2GraceDays} วัน`,
      "",
      "คำสั่ง:",
      "ปิดส่วนที่เหลือ 50% และยกเลิก TARGET 2 เดิม",
      "",
      `ราคาปัจจุบัน: ${formatPrice(currentPrice)} USDT`,
      `กำไรสุทธิรวมโดยประมาณ: ${formatUsdt(signal.final_net_profit_usdt || 0)} USDT / ${formatThb(signal.final_net_profit_thb || 0)} บาท`,
      "",
      "Close reason: TP2_TIMEOUT_CLOSED"
    ].join("\n");
  }

  if (eventType === "PRE_TP1_REVIEW_REQUIRED") {
    const startedAt = signal.position_plan_started_at || signal.entry_hit_at || signal.created_at;
    const elapsedHours = (Date.now() - new Date(startedAt).getTime()) / 36e5;
    return [
      `⚠️ POSITION REVIEW REQUIRED #${signal.signal_id}`,
      ...debugLines,
      `เหรียญ: ${signal.symbol}/USDT`,
      `สถานะ: เข้าโซนซื้อแล้ว แต่ยังไม่ถึง TARGET 1 ภายใน ${config.positionPlanDays} วัน`,
      "",
      `Average Entry: ${formatPrice(signal.average_entry_price || entryAverage)} USDT`,
      `ราคาปัจจุบัน: ${formatPrice(currentPrice)} USDT`,
      `DCA Level: ${signal.dca_level || 1}`,
      `Target 1: ${formatPrice(signal.target1)} USDT`,
      `เวลาที่เกินแผน: ${elapsedHours.toFixed(1)} ชั่วโมง`,
      "",
      "ระบบตรวจแล้ว:",
      "- Recovery ยังไม่ผ่าน / ครบจำนวน / ไม่เหมาะสม",
      "- แผนยังไม่ถึงกำไรไม้แรก",
      "",
      "คำสั่ง:",
      "ทบทวนสถานะใน Gate.io",
      "ระบบจะยังติดตาม แต่จะไม่สร้าง Recovery มั่ว"
    ].join("\n");
  }

  if (eventType === "SIGNAL_CLOSED") {
    return [
      `✅ SIGNAL CLOSED #${signal.signal_id}`,
      ...debugLines,
      `เหรียญ: ${signal.symbol}/USDT`,
      `สถานะ: ปิดแผนจำลองแล้ว`,
      `Close reason: ${signal.close_reason || "SIGNAL_CLOSED"}`,
      `Final net: ${formatUsdt(signal.final_net_profit_usdt || 0)} USDT / ${formatThb(signal.final_net_profit_thb || 0)} บาท`
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

function formatMarketGuardLabel(status: string) {
  if (status === "risk_off") return "Risk-Off";
  if (status === "caution") return "ระวัง";
  return "ปกติ";
}

function getLatestTargetPlan(signalId: string) {
  return getDb()
    .prepare("SELECT * FROM target_plan_history WHERE signal_id = ? ORDER BY target_version DESC LIMIT 1")
    .get(signalId) as { expected_net_tp1: number; expected_net_full: number } | undefined;
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
