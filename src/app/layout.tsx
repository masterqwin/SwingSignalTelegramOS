import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "SwingSignalTelegramOS",
  description: "Thai crypto swing signal and paper-tracking dashboard"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
