import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";

// Sprint 3 Part 17 L5a — shared chrome for every /waste route.
// Mirrors src/app/expenses/layout.tsx.
// Part 35 L4: the header and "← กลับหน้าหลัก" moved into the sidebar.
export default function WasteLayout({ children }: { children: ReactNode }) {
  return (
    <PageFrame title="ของเสีย" width="3xl">
      {children}
    </PageFrame>
  );
}
