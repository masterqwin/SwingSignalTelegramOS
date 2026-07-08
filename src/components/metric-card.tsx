import type { LucideIcon } from "lucide-react";

export function MetricCard({ icon: Icon, label, value, helper }: { icon: LucideIcon; label: string; value: string | number; helper: string }) {
  return (
    <div className="rounded-lg border border-line bg-paper p-4 shadow-soft">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm font-semibold text-muted">{label}</div>
        <Icon className="text-blue" size={19} />
      </div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="mt-1 text-xs text-muted">{helper}</div>
    </div>
  );
}
