import { SignalTable } from "@/components/signal-table";
import { getSignalsByStatus } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export default async function SignalHistoryPage() {
  const signals = await getSignalsByStatus([
    "SETUP",
    "ENTRY_HIT",
    "PRE_TARGET_1_MANAGEMENT",
    "TARGET1_HIT",
    "PROFIT_PROTECTION",
    "TARGET2_HIT",
    "ENTRY_RETRACE_CLOSED",
    "TP2_TIMEOUT_CLOSED",
    "PRE_TP1_REVIEW_REQUIRED",
    "CANCELLED",
    "CLOSED",
    "HOLD",
    "NO_MORE_DCA"
  ]);
  return (
    <main className="rounded-lg border border-line bg-paper p-5 shadow-soft">
      <h1 className="text-xl font-bold">Signal History</h1>
      <p className="mb-4 mt-1 text-sm text-muted">ประวัติทุกสัญญาณเพื่อวัดผลแบบ objective paper tracking</p>
      <SignalTable signals={signals} />
    </main>
  );
}
