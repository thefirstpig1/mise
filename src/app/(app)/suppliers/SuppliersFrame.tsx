"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import PageFrame from "@/components/layout/PageFrame";

// The order catalog (/suppliers/[id]/order) puts a picture, a price, a unit and
// a quantity on every row and needs room; the list and the forms read best
// narrow. Same approach as ProductsFrame.
export default function SuppliersFrame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const wide = path.endsWith("/order");
  // 2026-10-27: one supplier's page is an overview (cards + a catalog), not a
  // form — wide, and its breadcrumb names the section, so no frame title.
  const detail = /^\/suppliers\/[0-9a-f-]{36}$/.test(path);
  return (
    <PageFrame title={detail ? undefined : "ซัพพลายเออร์"} width={wide || detail ? "5xl" : "3xl"}>
      {children}
    </PageFrame>
  );
}
