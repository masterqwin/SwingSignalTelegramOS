import { NextResponse } from "next/server";
import { sendTelegramMessage } from "@/lib/telegram";

export async function POST() {
  const result = await sendTelegramMessage("ทดสอบ Telegram จาก SwingSignalTelegramOS\nระบบพร้อมส่งสัญญาณแบบ paper tracking");
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
