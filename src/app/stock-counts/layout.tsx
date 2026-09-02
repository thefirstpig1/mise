import type { ReactNode } from "react";
import Logo from "@/components/layout/Logo";

// Sprint 3 Part 15 L5a — shared chrome for every /stock-counts route.
// Mirrors src/app/goods-receipts/layout.tsx.
export default function StockCountLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="container mx-auto px-4 py-3">
          <a
            href="/dashboard"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← กลับหน้าหลัก
          </a>
          <div className="mt-1 flex items-center gap-2.5">
            <Logo size={26} />
            <h1 className="text-lg font-bold">นับสต๊อก</h1>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-4xl px-4 py-8">{children}</main>
    </div>
  );
}
