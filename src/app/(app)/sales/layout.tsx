import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";

// Sprint 4 Part 19 L5 — shared chrome for every /sales route.
// Mirrors src/app/waste/layout.tsx.
// Part 35 L4: the header and "← กลับหน้าหลัก" moved into the sidebar.
export default function SalesLayout({ children }: { children: ReactNode }) {
  return (
    <PageFrame title="ยอดขาย" width="5xl">
      {children}
    </PageFrame>
  );
}
