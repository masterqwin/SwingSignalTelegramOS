import { Activity, Banknote, RadioTower, ShieldCheck } from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { SignalTable } from "@/components/signal-table";
import { getDashboardData } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const data = await getDashboardData();
  const reserve = data.config.startingCapitalThb - data.activeExposureThb;
  const reservePct = data.config.startingCapitalThb ? (reserve / data.config.startingCapitalThb) * 100 : 0;

  return (
    <main className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={RadioTower} label="สัญญาณทั้งหมด" value={data.stats.totalSignals} helper="บันทึกแบบ paper tracking" />
        <MetricCard icon={Activity} label="Entry Hit Rate" value={`${data.stats.entryHitRate.toFixed(1)}%`} helper={`${data.stats.entryHitCount} signals เข้าโซน`} />
        <MetricCard icon={ShieldCheck} label="Win Rate จำลอง" value={`${data.stats.winRate.toFixed(1)}%`} helper="นับจาก target plan ที่ปิดแล้ว" />
        <MetricCard icon={Banknote} label="เงินสำรอง" value={`${reservePct.toFixed(1)}%`} helper={`${reserve.toLocaleString("th-TH")} บาท`} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border border-line bg-paper p-5 shadow-soft">
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-xl font-bold">ภาพรวมสัญญาณ Active</h1>
              <p className="text-sm text-muted">ระบบแจ้งเตือนเท่านั้น ไม่มีการส่งคำสั่งซื้อขายอัตโนมัติ</p>
            </div>
            <div className="text-sm font-semibold text-blue">Gate.io Spot / USDT</div>
          </div>
          <SignalTable signals={data.activeSignals} compact />
        </div>

        <div className="rounded-lg border border-line bg-paper p-5 shadow-soft">
          <h2 className="text-lg font-bold">แผนเงินทุน</h2>
          <div className="mt-4 space-y-4 text-sm">
            <Row label="ทุนตั้งต้น" value={`${data.config.startingCapitalThb.toLocaleString("th-TH")} บาท`} />
            <Row label="ทุนแนะนำต่อไม้" value={`${data.config.defaultStakeThb.toLocaleString("th-TH")} บาท`} />
            <Row label="Active exposure" value={`${data.activeExposureThb.toLocaleString("th-TH")} บาท`} />
            <Row label="จำกัดสัญญาณ Active" value={`${data.activeSignals.length}/${data.config.maxActiveSignals}`} />
            <div className="h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-blue" style={{ width: `${Math.min(100, (data.activeExposureThb / data.config.startingCapitalThb) * 100)}%` }} />
            </div>
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-800">
              ระบบตั้งใจเก็บเงินสดสำรอง 40-50% และจะไม่สร้างสัญญาณใหม่เมื่อเกินจำนวน Active ที่กำหนด
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-paper p-5 shadow-soft">
        <h2 className="mb-4 text-lg font-bold">Lifecycle ล่าสุด</h2>
        <div className="space-y-3">
          {data.recentEvents.map((event) => (
            <div key={event.id} className="flex flex-col gap-1 border-b border-line pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="font-semibold">{event.event_type}</span>
                <span className="ml-2 text-muted">#{event.signal_id}</span>
              </div>
              <div className="text-sm text-muted">{new Date(event.created_at).toLocaleString("th-TH")}</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line pb-2">
      <span className="text-muted">{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}
