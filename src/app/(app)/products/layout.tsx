import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";

// Sprint 1 Part 7a — shared chrome for every /products route.
// Mirrors src/app/categories/layout.tsx.
// Part 35 L4: the header and "← กลับหน้าหลัก" moved into the sidebar.
export default function ProductsLayout({ children }: { children: ReactNode }) {
  return (
    <PageFrame title="สินค้า/วัตถุดิบ" width="3xl">
      {children}
    </PageFrame>
  );
}
