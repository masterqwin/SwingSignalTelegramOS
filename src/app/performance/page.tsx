import { getDashboardData } from "@/lib/dashboard-data";

export default async function PerformancePage() {
  const data = await getDashboardData();
  const rows = [
    ["Total Signals", data.stats.totalSignals],
    ["Entry Hit Count", data.stats.entryHitCount],
    ["Cancelled", data.stats.cancelledCount],
    ["Target 1 Hit", data.stats.target1HitCount],
    ["Target 2 Hit", data.stats.target2HitCount],
    ["Entry Hit Rate", `${data.stats.entryHitRate.toFixed(2)}%`],
    ["Win Rate", `${data.stats.winRate.toFixed(2)}%`],
    ["Avg Expected Return", `${data.stats.avgExpectedReturnPct.toFixed(2)}%`],
    ["Avg Time To Entry", `${data.stats.avgTimeToEntryHours.toFixed(1)} ชม.`],
    ["Avg Time To Target", `${data.stats.avgTimeToTargetHours.toFixed(1)} ชม.`]
  ];

  return (
    <main className="grid gap-5 xl:grid-cols-[0.75fr_1.25fr]">
      <section className="rounded-lg border border-line bg-paper p-5 shadow-soft">
        <h1 className="text-xl font-bold">Performance</h1>
        <div className="mt-4 space-y-3">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between border-b border-line pb-2 text-sm">
              <span className="text-muted">{label}</span>
              <span className="font-bold">{value}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-lg border border-line bg-paper p-5 shadow-soft">
        <h2 className="text-lg font-bold">Score vs Outcome</h2>
        <div className="mt-5 space-y-3">
          {data.scoreBuckets.map((bucket) => (
            <div key={bucket.label}>
              <div className="mb-1 flex justify-between text-sm">
                <span>{bucket.label}</span>
                <span className="text-muted">{bucket.winRate.toFixed(1)}% win / {bucket.count} signals</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-good" style={{ width: `${Math.min(100, bucket.winRate)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
