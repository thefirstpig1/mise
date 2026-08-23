import type { ReactNode } from "react";

// Sprint 5 Part 21 L5b — shared chrome for every /recipes route.
export default function RecipesLayout({ children }: { children: ReactNode }) {
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
          <h1 className="mt-1 text-lg font-bold">สูตรอาหาร</h1>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
