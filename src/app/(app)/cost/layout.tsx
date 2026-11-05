import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";
import { requireTenant } from "@/lib/require-tenant";

// Kong 2026-11-05: the four cost pages are one menu item with tabs — they all
// answer "how is cost going, and why". ตามแผนก shows only where the shop has
// switched departments on.
export default async function CostLayout({ children }: { children: ReactNode }) {
  const { can, membership } = await requireTenant("any:member");
  const tabs = can("cost:view")
    ? [
        { href: "/cost", label: "ภาพรวม" },
        ...(membership.tenant.enableDepartments ? [{ href: "/cost/departments", label: "ตามแผนก" }] : []),
        { href: "/cost/leaks", label: "ของหายไปไหน" },
        { href: "/cost/prices", label: "ราคาวัตถุดิบ" },
      ]
    : [];
  return (
    <PageFrame title="ต้นทุน" tabs={tabs} tabsLabel="หน้าในต้นทุน">
      {children}
    </PageFrame>
  );
}
