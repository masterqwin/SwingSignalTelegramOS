"use client";

import { useState } from "react";
import type { SystemConfig } from "@/lib/types";

export function SettingsPanel({ config }: { config: SystemConfig }) {
  const [status, setStatus] = useState<string>("");

  async function testTelegram() {
    setStatus("กำลังส่งข้อความทดสอบ...");
    const response = await fetch("/api/telegram/test", { method: "POST" });
    const payload = await response.json();
    setStatus(payload.ok ? "ส่งข้อความทดสอบสำเร็จ" : `ส่งไม่สำเร็จ: ${payload.error}`);
  }

  const rows = [
    ["USDTHB_RATE", config.usdthbRate],
    ["SCAN_INTERVAL_MINUTES", config.scanIntervalMinutes],
    ["SIGNAL_EXPIRY_DAYS", config.signalExpiryDays],
    ["STARTING_CAPITAL_THB", config.startingCapitalThb],
    ["DEFAULT_STAKE_THB", config.defaultStakeThb],
    ["MAX_ACTIVE_SIGNALS", config.maxActiveSignals],
    ["MIN_QUOTE_VOLUME_USDT", config.minQuoteVolumeUsdt]
  ];

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_0.8fr]">
      <section className="rounded-lg border border-line p-4">
        <h2 className="font-bold">Environment Config</h2>
        <div className="mt-4 space-y-3">
          {rows.map(([key, value]) => (
            <div key={key} className="flex justify-between border-b border-line pb-2 text-sm">
              <span className="font-semibold text-muted">{key}</span>
              <span>{String(value)}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-lg border border-line p-4">
        <h2 className="font-bold">Telegram</h2>
        <p className="mt-2 text-sm text-muted">ใส่ `TELEGRAM_BOT_TOKEN` และ `TELEGRAM_CHAT_ID` ใน `.env.local` แล้วทดสอบการส่งข้อความ</p>
        <button onClick={testTelegram} className="mt-4 rounded-md bg-blue px-4 py-2 text-sm font-bold text-white hover:bg-blue/90">
          Test Telegram
        </button>
        {status && <p className="mt-3 text-sm font-semibold">{status}</p>}
      </section>
    </div>
  );
}
