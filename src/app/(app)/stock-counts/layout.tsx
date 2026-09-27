import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";

// Sprint 3 Part 15 L5a — shared chrome for every /stock-counts route.
// Mirrors src/app/goods-receipts/layout.tsx.
// Part 35 L4: the header and "← กลับหน้าหลัก" moved into the sidebar.
export default function StockCountLayout({ children }: { children: ReactNode }) {
  return (
    <PageFrame title="นับสต๊อก" width="4xl">
      {children}
    </PageFrame>
  );
}
