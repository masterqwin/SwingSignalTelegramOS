import { SettingsPanel } from "@/components/settings-panel";
import { getSystemConfig } from "@/lib/config";

export default async function SettingsPage() {
  const config = getSystemConfig();
  return (
    <main className="rounded-lg border border-line bg-paper p-5 shadow-soft">
      <h1 className="text-xl font-bold">Settings</h1>
      <p className="mb-5 mt-1 text-sm text-muted">ค่าหลักอ่านจาก `.env.local` และใช้สำหรับ scanner/dashboard</p>
      <SettingsPanel config={config} />
    </main>
  );
}
