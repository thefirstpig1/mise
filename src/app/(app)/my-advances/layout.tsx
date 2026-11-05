import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";
import { requireTenant } from "@/lib/require-tenant";
import { advanceTabs } from "@/lib/advance-tabs";

export default async function MyAdvancesLayout({ children }: { children: ReactNode }) {
  const { can } = await requireTenant("any:member");
  return (
    <PageFrame title="ซื้อของ" tabs={advanceTabs(can)} tabsLabel="หน้าในสำรองจ่าย">
      {children}
    </PageFrame>
  );
}
