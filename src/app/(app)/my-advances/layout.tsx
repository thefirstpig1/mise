import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";

// ADR 0037 Q5–Q6 — the staff member's own advances.
export default function MyAdvancesLayout({ children }: { children: ReactNode }) {
  return <PageFrame title="ซื้อของ">{children}</PageFrame>;
}
