import type { ReactNode } from "react";

// Sprint 1 Part 5, Step 7.1 — shared chrome for every /suppliers route.
// Header markup mirrors src/app/settings/page.tsx (back link + title).
export default function SuppliersLayout({ children }: { children: ReactNode }) {
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
          <h1 className="mt-1 text-lg font-bold">ซัพพลายเออร์</h1>
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
