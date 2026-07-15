import { getDashboardData } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

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
    ["Avg Time To Target", `${data.stats.avgTimeToTargetHours.toFixed(1)} ชม.`],
    ["FULL_TARGET_CLOSED", `${data.stats.fullTargetClosedCount} (${data.stats.fullTargetClosedRate.toFixed(1)}%)`],
    ["ENTRY_RETRACE_CLOSED", `${data.stats.entryRetraceClosedCount} (${data.stats.entryRetraceClosedRate.toFixed(1)}%)`],
    ["TP2_TIMEOUT_CLOSED", `${data.stats.tp2TimeoutClosedCount} (${data.stats.tp2TimeoutClosedRate.toFixed(1)}%)`],
    ["PRE_TP1_REVIEW_REQUIRED", data.stats.preTp1ReviewRequiredCount],
    ["Avg Target 1 Net", `${data.stats.avgTarget1NetProfitUsdt.toFixed(2)} USDT`],
    ["Avg Final Net", `${data.stats.avgFinalNetProfitUsdt.toFixed(2)} USDT`],
    ["Entry → Target 1", `${data.stats.avgEntryToTarget1Hours.toFixed(1)} ชม.`],
    ["Target 1 → Close", `${data.stats.avgTarget1ToCloseHours.toFixed(1)} ชม.`],
    ["DCA Level 1/2/3", `${data.stats.recoveryLevel1Count}/${data.stats.recoveryLevel2Count}/${data.stats.recoveryLevel3Count}`]
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
        <h2 className="text-lg font-bold">Performance by Score Band</h2>
        <div className="mt-5 table-scroll">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="text-xs uppercase text-muted">
              <tr className="border-b border-line">
                <th className="py-3">Score Band</th>
                <th>Total Signals</th>
                <th>Entry Hit Rate</th>
                <th>Win Rate</th>
                <th>Avg Return</th>
              </tr>
            </thead>
            <tbody>
              {data.scoreBuckets.map((bucket) => (
                <tr key={bucket.label} className="border-b border-line last:border-0">
                  <td className="py-3 font-bold">{bucket.label}</td>
                  <td>{bucket.count}</td>
                  <td>{bucket.entryHitRate.toFixed(1)}%</td>
                  <td>{bucket.winRate.toFixed(1)}%</td>
                  <td>{bucket.avgReturnPct.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
