import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";

// Sprint 1 Part 5, Step 7.1 — shared chrome for every /suppliers route.
// Header markup mirrors src/app/settings/page.tsx (back link + title).
// Part 35 L4: the header and "← กลับหน้าหลัก" moved into the sidebar.
export default function SuppliersLayout({ children }: { children: ReactNode }) {
  return (
    <PageFrame title="ซัพพลายเออร์" width="3xl">
      {children}
    </PageFrame>
  );
}
