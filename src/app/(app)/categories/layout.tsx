import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";

// Sprint 1 Part 6, Step 6.4 — shared chrome for every /categories route.
// Mirrors src/app/suppliers/layout.tsx.
// Part 35 L4: the header and "← กลับหน้าหลัก" moved into the sidebar.
export default function CategoriesLayout({ children }: { children: ReactNode }) {
  return (
    <PageFrame title="หมวดบัญชี" width="4xl">
      {children}
    </PageFrame>
  );
}
