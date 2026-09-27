import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";

// Sprint 2 Part 10 L5a — shared chrome for every /stock route.
// Mirrors src/app/products/layout.tsx.
// Part 35 L4: the header and "← กลับหน้าหลัก" moved into the sidebar.
export default function StockLayout({ children }: { children: ReactNode }) {
  return (
    <PageFrame title="สต๊อก" width="3xl">
      {children}
    </PageFrame>
  );
}
