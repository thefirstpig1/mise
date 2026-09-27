import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";

// Sprint 5 Part 21 L5b — shared chrome for every /recipes route.
// Part 35 L4: the header and "← กลับหน้าหลัก" moved into the sidebar.
export default function RecipesLayout({ children }: { children: ReactNode }) {
  return (
    <PageFrame title="สูตรอาหาร" width="5xl">
      {children}
    </PageFrame>
  );
}
