"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import PageFrame from "@/components/layout/PageFrame";

// The product LIST is a card grid and wants room, and so does the import's
// review table; every other /products route is a form that reads best narrow.
// One layout serves both, so it asks the path.
export default function ProductsFrame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const wide = path === "/products" || path === "/products/import";
  return (
    // The import page names itself with a breadcrumb ("สินค้า/วัตถุดิบ › …"),
    // so the frame's label would say it twice (Kong 2026-10-27, expenses).
    <PageFrame title={path === "/products/import" ? undefined : "สินค้า/วัตถุดิบ"} width={wide ? "5xl" : "3xl"}>
      {children}
    </PageFrame>
  );
}
