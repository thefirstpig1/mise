import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";

// Part 38 (ADR 0036) — the kitchen's purchase request and the purchaser's
// round-cutting screen. 7xl: the board carries the list AND the below-par panel
// side by side, and the cut sheet is a wide table of lines × suppliers × prices.
export default function PurchaseRequestsLayout({ children }: { children: ReactNode }) {
  return (
    <PageFrame title="ใบขอซื้อ" width="7xl">
      {children}
    </PageFrame>
  );
}
