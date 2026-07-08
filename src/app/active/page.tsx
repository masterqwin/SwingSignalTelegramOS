import { SignalTable } from "@/components/signal-table";
import { getSignalsByStatus } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export default async function ActiveSignalsPage() {
  const signals = await getSignalsByStatus(["SETUP", "ENTRY_HIT", "TARGET1_HIT", "HOLD", "NO_MORE_DCA"]);
  return (
    <main className="rounded-lg border border-line bg-paper p-5 shadow-soft">
      <h1 className="text-xl font-bold">Active Signals</h1>
      <p className="mb-4 mt-1 text-sm text-muted">สัญญาณที่ยังไม่หมดอายุหรือยังไม่ปิดแผนจำลอง</p>
      <SignalTable signals={signals} />
    </main>
  );
}
