import type { ReactNode } from "react";

// Sprint 3 Part 17 L5a — shared chrome for every /waste route.
// Mirrors src/app/expenses/layout.tsx.
export default function WasteLayout({ children }: { children: ReactNode }) {
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
          <h1 className="mt-1 text-lg font-bold">ของเสีย</h1>
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
