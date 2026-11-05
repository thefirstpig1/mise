import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";
import { requireTenant } from "@/lib/require-tenant";

// Kong 2026-11-05: ค่าใช้จ่าย and วิเคราะห์รายจ่าย are the same bills seen two
// ways — one menu item, two tabs. The analysis comes first (Kong 2026-10-28:
// it is what an owner opens this section for).
export default async function ExpenseLayout({ children }: { children: ReactNode }) {
  const { can } = await requireTenant("any:member");
  const tabs = can("expense:view")
    ? [
        { href: "/expenses/analysis", label: "วิเคราะห์" },
        { href: "/expenses", label: "บิลทั้งหมด" },
      ]
    : [];
  return (
    // No section label: every expense page carries its own "ค่าใช้จ่าย › …"
    // line or heading, and the label repeated it (Kong 2026-10-27, option A).
    <PageFrame tabs={tabs} tabsLabel="หน้าในค่าใช้จ่าย">
      {children}
    </PageFrame>
  );
}
