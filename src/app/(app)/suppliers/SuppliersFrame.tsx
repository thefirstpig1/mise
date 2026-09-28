"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import PageFrame from "@/components/layout/PageFrame";

// The order catalog (/suppliers/[id]/order) puts a picture, a price, a unit and
// a quantity on every row and needs room; the list and the forms read best
// narrow. Same approach as ProductsFrame.
export default function SuppliersFrame({ children }: { children: ReactNode }) {
  const wide = usePathname().endsWith("/order");
  return (
    <PageFrame title="ซัพพลายเออร์" width={wide ? "5xl" : "3xl"}>
      {children}
    </PageFrame>
  );
}
