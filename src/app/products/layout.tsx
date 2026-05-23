import type { ReactNode } from "react";

// Sprint 1 Part 7a — shared chrome for every /products route.
// Mirrors src/app/categories/layout.tsx.
export default function ProductsLayout({ children }: { children: ReactNode }) {
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
          <h1 className="mt-1 text-lg font-bold">สินค้า/วัตถุดิบ</h1>
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
