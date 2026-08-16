import type { ReactNode } from "react";

// Sprint 2 Part 14 L5a — shared chrome for every /cost route.
// Mirrors src/app/stock/layout.tsx. Wider than the others on purpose: the branch
// comparison is a table meant to be read across, not a form.
export default function CostLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-3">
          <a
            href="/dashboard"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← กลับหน้าหลัก
          </a>
          <h1 className="mt-1 text-lg font-bold">ต้นทุน</h1>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
