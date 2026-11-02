import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";

// ADR 0044 — the reporter's own problem reports. Not a sidebar item: it opens
// from the report form and from the e-mail, so the frame names it itself.
export default function ReportsLayout({ children }: { children: ReactNode }) {
  return <PageFrame title="แจ้งปัญหาหรือเสนอแนะ">{children}</PageFrame>;
}
