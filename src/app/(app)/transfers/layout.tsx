import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";

// Sprint 3 Part 18 L5a — shared chrome for every /transfers route.
// Mirrors src/app/waste/layout.tsx.
// Part 35 L4: the header and "← กลับหน้าหลัก" moved into the sidebar.
export default function TransfersLayout({ children }: { children: ReactNode }) {
  // No section label: every page here names itself (a heading, or the
  // document header's "… › number" line) — Kong 2026-10-27, option A.
  return (
    <PageFrame>
      {children}
    </PageFrame>
  );
}
