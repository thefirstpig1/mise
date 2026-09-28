"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import PageFrame from "@/components/layout/PageFrame";

// The product LIST is a card grid and wants room; every other /products route
// is a form that reads best narrow. One layout serves both, so it asks the path.
export default function ProductsFrame({ children }: { children: ReactNode }) {
  const wide = usePathname() === "/products";
  return (
    <PageFrame title="สินค้า/วัตถุดิบ" width={wide ? "5xl" : "3xl"}>
      {children}
    </PageFrame>
  );
}
