import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";

// ปิดเดือน · ส่งให้บัญชี (Kong 2026-10-29) — under การเงิน in the sidebar.
export default function MonthEndLayout({ children }: { children: ReactNode }) {
  return <PageFrame title="การเงิน">{children}</PageFrame>;
}
