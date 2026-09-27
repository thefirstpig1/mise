import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";

// Sprint 2 Part 11 L5a — shared chrome for every /purchase-orders route.
// Mirrors src/app/stock/layout.tsx.
//
// `max-w-5xl` rather than the stock section's `max-w-3xl`: an order is a table of
// lines with quantity, unit, price and total, and squeezing that into a narrow
// column pushes the money off the first screen.
// Part 35 L4: the header and "← กลับหน้าหลัก" moved into the sidebar.
export default function PurchaseOrdersLayout({ children }: { children: ReactNode }) {
  return (
    <PageFrame title="ใบสั่งซื้อ" width="5xl">
      {children}
    </PageFrame>
  );
}
