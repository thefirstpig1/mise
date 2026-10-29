import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";

// ADR 0040 step 7 — shared chrome for /production (the /waste pattern).
export default function ProductionLayout({ children }: { children: ReactNode }) {
  return <PageFrame title="การผลิต">{children}</PageFrame>;
}
