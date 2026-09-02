import type { ReactNode } from "react";
import Logo from "@/components/layout/Logo";

// Sprint 2 Part 11 L5a — shared chrome for every /purchase-orders route.
// Mirrors src/app/stock/layout.tsx.
//
// `max-w-5xl` rather than the stock section's `max-w-3xl`: an order is a table of
// lines with quantity, unit, price and total, and squeezing that into a narrow
// column pushes the money off the first screen.
export default function PurchaseOrdersLayout({
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
          <div className="mt-1 flex items-center gap-2.5">
            <Logo size={26} />
            <h1 className="text-lg font-bold">ใบสั่งซื้อ</h1>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
