import { requireTenant } from "@/lib/require-tenant";
import { getAllBranchesForAdminLogic } from "@/server/branch";
import { cutoffToHHMM } from "@/lib/validations/branch";
import { AddBranchButton, BranchList, type BranchRowView } from "./_components/BranchForms";

// Part 35 L1 — the screen that did not exist: a shop could never add its
// second branch, so transfers, branch reach and per-branch cost were
// unreachable for every real customer.
export default async function BranchesPage() {
  const { tenantId, reach } = await requireTenant("settings:write");
  const rows: BranchRowView[] = (await getAllBranchesForAdminLogic(tenantId, reach)).map((b) => ({
    id: b.id,
    name: b.name,
    code: b.code,
    address: b.address,
    salesDayCutoff: cutoffToHHMM(b.salesDayCutoffMinutes),
  }));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold leading-tight">สาขา</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows.length} สาขา · กดที่สาขาเพื่อแก้ไข · ผู้จัดการสาขาเห็นสาขาใหม่เมื่อเพิ่มให้ที่หน้า{" "}
            <a href="/settings/members" className="font-semibold text-primary hover:underline">คนในร้าน</a>
          </p>
        </div>
        <AddBranchButton />
      </header>
      <BranchList rows={rows} />
    </div>
  );
}
