import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";

// Sprint 3 Part 16 L5a — shared chrome for every /expenses route.
// Mirrors src/app/stock-counts/layout.tsx.
// Part 35 L4: the header and "← กลับหน้าหลัก" moved into the sidebar.
export default function ExpenseLayout({ children }: { children: ReactNode }) {
  return (
    // No section label: every expense page carries its own "ค่าใช้จ่าย › …"
    // line or heading, and the label repeated it (Kong 2026-10-27, option A).
    <PageFrame width="5xl">
      {children}
    </PageFrame>
  );
}
