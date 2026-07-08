import Link from "next/link";
import { Activity, BarChart3, Coins, History, LayoutDashboard, Settings } from "lucide-react";

const nav = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/active", label: "Active Signals", icon: Activity },
  { href: "/history", label: "Signal History", icon: History },
  { href: "/performance", label: "Performance", icon: BarChart3 },
  { href: "/ranking", label: "Coin Ranking", icon: Coins },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="border-b border-line bg-ink text-white lg:min-h-screen lg:border-b-0 lg:border-r">
        <div className="p-5">
          <div className="text-lg font-bold">SwingSignalTelegramOS</div>
          <div className="mt-1 text-xs text-slate-300">Signal + paper tracking only</div>
        </div>
        <nav className="flex gap-2 overflow-x-auto px-3 pb-4 lg:block lg:space-y-1 lg:overflow-visible">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className="flex min-w-max items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-200 hover:bg-white/10">
              <item.icon size={17} />
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <section>
        <header className="border-b border-line bg-paper px-5 py-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-muted">Team SBP Local V1</div>
              <div className="text-2xl font-bold">ระบบสัญญาณ Crypto Swing/Range</div>
            </div>
            <div className="rounded-md border border-line px-3 py-2 text-sm text-muted">No auto-trading / No exchange keys</div>
          </div>
        </header>
        <div className="p-4 sm:p-6">{children}</div>
      </section>
    </div>
  );
}
