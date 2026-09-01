import type { ReactNode } from "react";

// Sprint 3 Part 18 L5a — shared chrome for every /transfers route.
// Mirrors src/app/waste/layout.tsx.
export default function TransfersLayout({ children }: { children: ReactNode }) {
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
          <h1 className="mt-1 text-lg font-bold">โอนของระหว่างสาขา</h1>
        </div>
      </header>

      <main className="container mx-auto max-w-4xl px-4 py-8">{children}</main>
    </div>
  );
}
