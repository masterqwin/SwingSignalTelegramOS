import type { SignalRow } from "@/lib/types";

const statusClass: Record<string, string> = {
  SETUP: "bg-amber-50 text-amber-700 border-amber-200",
  ENTRY_HIT: "bg-emerald-50 text-emerald-700 border-emerald-200",
  TARGET1_HIT: "bg-blue-50 text-blue-700 border-blue-200",
  PRE_TARGET_1_MANAGEMENT: "bg-cyan-50 text-cyan-700 border-cyan-200",
  PROFIT_PROTECTION: "bg-purple-50 text-purple-700 border-purple-200",
  TARGET2_HIT: "bg-green-50 text-green-700 border-green-200",
  ENTRY_RETRACE_CLOSED: "bg-orange-50 text-orange-700 border-orange-200",
  TP2_TIMEOUT_CLOSED: "bg-zinc-100 text-zinc-700 border-zinc-200",
  PRE_TP1_REVIEW_REQUIRED: "bg-amber-50 text-amber-800 border-amber-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
  CLOSED: "bg-slate-100 text-slate-700 border-slate-200",
  HOLD: "bg-orange-50 text-orange-700 border-orange-200",
  NO_MORE_DCA: "bg-zinc-100 text-zinc-700 border-zinc-200"
};

export function SignalTable({ signals, compact = false }: { signals: SignalRow[]; compact?: boolean }) {
  if (!signals.length) {
    return <div className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted">ยังไม่มีสัญญาณในสถานะนี้</div>;
  }

  return (
    <div className="table-scroll">
      <table className="w-full min-w-[1380px] text-left text-sm">
        <thead className="text-xs uppercase text-muted">
          <tr className="border-b border-line">
            <th className="py-3">ID</th>
            <th>Coin</th>
            <th>Status</th>
            <th>Lifecycle</th>
            <th>Entry Zone</th>
            <th>Avg / BE</th>
            <th>Target 1</th>
            <th>Target 2</th>
            <th>Version</th>
            <th>Score</th>
            <th>Confidence</th>
            <th>Quality</th>
            <th>DCA</th>
            <th>Timer</th>
            <th>Remaining</th>
            <th>Stake</th>
            {!compact && <th>Created</th>}
          </tr>
        </thead>
        <tbody>
          {signals.map((signal) => (
            <tr key={signal.id} className="border-b border-line last:border-0">
              <td className="py-3 font-semibold">
                #{signal.signal_id}
                {signal.is_debug ? <span className="ml-2 rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-700">DEBUG</span> : null}
              </td>
              <td className="font-bold">{signal.symbol}/USDT</td>
              <td>
                <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${statusClass[signal.status] ?? "bg-slate-100"}`}>{signal.status}</span>
              </td>
              <td>{signal.lifecycle_status || signal.status}</td>
              <td>{signal.entry_low.toFixed(4)}-{signal.entry_high.toFixed(4)}</td>
              <td>
                {signal.average_entry_price ? signal.average_entry_price.toFixed(4) : "-"}
                <span className="block text-xs text-muted">{signal.break_even_price ? `BE ${signal.break_even_price.toFixed(4)}` : ""}</span>
              </td>
              <td>{signal.target1.toFixed(4)}</td>
              <td>{signal.target2.toFixed(4)}</td>
              <td>v{signal.target_version || 1}</td>
              <td>{signal.score}/100</td>
              <td>{signal.confidence_pct || 0}%</td>
              <td>
                <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{signal.quality_label || "C"}</span>
              </td>
              <td>{signal.dca_level && signal.dca_level > 1 ? `ไม้ ${signal.dca_level}` : "-"}</td>
              <td>{formatTimer(signal)}</td>
              <td>{signal.remaining_quantity ? signal.remaining_quantity.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "-"}</td>
              <td>{(signal.total_position_thb || signal.stake_thb).toLocaleString("th-TH")} บาท</td>
              {!compact && <td>{new Date(signal.created_at).toLocaleString("th-TH")}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatTimer(signal: SignalRow) {
  const timer = signal.status === "PROFIT_PROTECTION" ? signal.tp2_grace_expires_at : signal.position_plan_expires_at || signal.expires_at;
  return timer ? new Date(timer).toLocaleString("th-TH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";
}
