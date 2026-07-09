import { getCoinRanking } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export default async function CoinRankingPage() {
  const ranking = await getCoinRanking();
  return (
    <main className="rounded-lg border border-line bg-paper p-5 shadow-soft">
      <h1 className="text-xl font-bold">Coin Ranking</h1>
      <p className="mb-4 mt-1 text-sm text-muted">เหรียญที่ทำผลงานดีที่สุดและแย่ที่สุดจาก paper tracking</p>
      <div className="table-scroll">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="text-xs uppercase text-muted">
            <tr className="border-b border-line">
              <th className="py-3">Coin</th>
              <th>Grade</th>
              <th>Signals</th>
              <th>Entry Hit</th>
              <th>Target 1</th>
              <th>Target 2</th>
              <th>Cancel</th>
              <th>Win Rate</th>
              <th>Avg Return</th>
              <th>Avg Entry Time</th>
              <th>Avg Target Time</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((row) => (
              <tr key={row.symbol} className="border-b border-line last:border-0">
                <td className="py-3 font-bold">{row.symbol}/USDT</td>
                <td>
                  <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{row.qualityGrade}</span>
                </td>
                <td>{row.total}</td>
                <td>{row.entryHitRate.toFixed(1)}%</td>
                <td>{row.target1HitRate.toFixed(1)}%</td>
                <td>{row.target2HitRate.toFixed(1)}%</td>
                <td>{row.cancelRate.toFixed(1)}%</td>
                <td>{row.winRate.toFixed(1)}%</td>
                <td>{row.avgReturnPct.toFixed(2)}%</td>
                <td>{row.avgTimeToEntryHours.toFixed(1)} ชม.</td>
                <td>{row.avgTimeToTargetHours.toFixed(1)} ชม.</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
