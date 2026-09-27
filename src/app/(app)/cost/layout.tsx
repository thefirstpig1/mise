import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";

// Sprint 2 Part 14 L5a — shared chrome for every /cost route.
// Mirrors src/app/stock/layout.tsx. Wider than the others on purpose: the branch
// comparison is a table meant to be read across, not a form.
// Part 35 L4: the header and "← กลับหน้าหลัก" moved into the sidebar.
export default function CostLayout({ children }: { children: ReactNode }) {
  return (
    <PageFrame title="ต้นทุน" width="5xl">
      {children}
    </PageFrame>
  );
}
