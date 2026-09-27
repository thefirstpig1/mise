import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";

// Sprint 3 Part 18 L5a — shared chrome for every /transfers route.
// Mirrors src/app/waste/layout.tsx.
// Part 35 L4: the header and "← กลับหน้าหลัก" moved into the sidebar.
export default function TransfersLayout({ children }: { children: ReactNode }) {
  return (
    <PageFrame title="โอนของระหว่างสาขา" width="4xl">
      {children}
    </PageFrame>
  );
}
