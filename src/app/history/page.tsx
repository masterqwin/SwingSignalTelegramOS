import { SignalTable } from "@/components/signal-table";
import { getSignalsByStatus } from "@/lib/dashboard-data";

export default async function SignalHistoryPage() {
  const signals = await getSignalsByStatus(["SETUP", "ENTRY_HIT", "TARGET1_HIT", "TARGET2_HIT", "CANCELLED", "CLOSED", "HOLD", "NO_MORE_DCA"]);
  return (
    <main className="rounded-lg border border-line bg-paper p-5 shadow-soft">
      <h1 className="text-xl font-bold">Signal History</h1>
      <p className="mb-4 mt-1 text-sm text-muted">ประวัติทุกสัญญาณเพื่อวัดผลแบบ objective paper tracking</p>
      <SignalTable signals={signals} />
    </main>
  );
}
