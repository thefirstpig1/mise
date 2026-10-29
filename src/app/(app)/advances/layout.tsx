import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";

// ADR 0037 Q5–Q6 — what the shop owes its staff, for the accountant.
export default function AdvancesLayout({ children }: { children: ReactNode }) {
  return <PageFrame title="การเงิน">{children}</PageFrame>;
}
