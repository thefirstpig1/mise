import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";

// Sprint 2 Part 13 L5a — shared chrome for every /goods-receipts route.
// Mirrors src/app/purchase-orders/layout.tsx, including `print:hidden` on the
// header: the detail page IS the printable document (ADR 0013 Q5 follows Q7 of
// ADR 0012 in reusing the page rather than building a separate print route).
// Part 35 L4: the header and "← กลับหน้าหลัก" moved into the sidebar.
export default function GoodsReceiptsLayout({ children }: { children: ReactNode }) {
  return (
    <PageFrame title="รับสินค้า" width="5xl">
      {children}
    </PageFrame>
  );
}
