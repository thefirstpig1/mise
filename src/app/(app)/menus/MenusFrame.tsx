"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import PageFrame from "@/components/layout/PageFrame";

// The recipe import names itself with a breadcrumb ("จัดการเมนู › …"), so the
// frame's label would say it twice (Kong 2026-10-27, expenses). Same approach
// as ProductsFrame.
export default function MenusFrame({ children }: { children: ReactNode }) {
  const path = usePathname();
  return <PageFrame title={path === "/menus/import" ? undefined : "เมนู"}>{children}</PageFrame>;
}
