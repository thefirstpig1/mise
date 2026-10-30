"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import PageFrame from "@/components/layout/PageFrame";

// The order catalog (/suppliers/[id]/order) puts a picture, a price, a unit and
// a quantity on every row and needs room; the list and the forms read best
// narrow. Same approach as ProductsFrame.
export default function SuppliersFrame({ children }: { children: ReactNode }) {
  const path = usePathname();
  // The bill import's review is a wide table and names itself with a breadcrumb.
  const billImport = path === "/suppliers/import";
  const wide = path.endsWith("/order") || billImport;
  // 2026-10-27: one supplier's page is an overview (cards + a catalog), not a
  // form — wide, and its breadcrumb names the section, so no frame title.
  const detail = /^\/suppliers\/[0-9a-f-]{36}$/.test(path);
  return (
    <PageFrame title={detail || billImport ? undefined : "ผู้ขาย"} width={wide || detail ? "5xl" : "3xl"}>
      {children}
    </PageFrame>
  );
}
