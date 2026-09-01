import type { ReactNode } from "react";

// Sprint 2 Part 13 L5a — shared chrome for every /goods-receipts route.
// Mirrors src/app/purchase-orders/layout.tsx, including `print:hidden` on the
// header: the detail page IS the printable document (ADR 0013 Q5 follows Q7 of
// ADR 0012 in reusing the page rather than building a separate print route).
export default function GoodsReceiptsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface print:hidden">
        <div className="container mx-auto px-4 py-3">
          <a
            href="/dashboard"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← กลับหน้าหลัก
          </a>
          <h1 className="mt-1 text-lg font-bold">รับสินค้า</h1>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
