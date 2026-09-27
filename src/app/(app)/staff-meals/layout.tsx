import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";

// Sprint 5 Part 26 L5 — shared chrome for every /staff-meals route.
// Mirrors src/app/waste/layout.tsx.
// Part 35 L4: the header and "← กลับหน้าหลัก" moved into the sidebar.
export default function StaffMealsLayout({ children }: { children: ReactNode }) {
  return (
    <PageFrame title="มื้อพนักงาน" width="3xl">
      {children}
    </PageFrame>
  );
}
