import type { ReactNode } from "react";
import PageFrame from "@/components/layout/PageFrame";
import { requireTenant } from "@/lib/require-tenant";
import { advanceTabs } from "@/lib/advance-tabs";

export default async function AdvancesLayout({ children }: { children: ReactNode }) {
  const { can } = await requireTenant("any:member");
  return (
    <PageFrame title="การเงิน" tabs={advanceTabs(can)} tabsLabel="หน้าในสำรองจ่าย">
      {children}
    </PageFrame>
  );
}
