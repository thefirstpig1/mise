import { requireTenant } from "@/lib/require-tenant";
import { getAllBranchesForAdminLogic } from "@/server/branch";
import { AddBranchForm, BranchList, type BranchRowView } from "./_components/BranchForms";

// Part 35 L1 — the screen that did not exist: a shop could never add its
// second branch, so transfers, branch reach and per-branch cost were
// unreachable for every real customer.
export default async function BranchesPage() {
  const { tenantId } = await requireTenant("settings:write");
  const rows: BranchRowView[] = (await getAllBranchesForAdminLogic(tenantId)).map((b) => ({
    id: b.id,
    name: b.name,
    code: b.code,
    address: b.address,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">สาขา</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          เจ้าของร้านและแอดมินเห็นสาขาใหม่ทันที ส่วนผู้จัดการสาขาต้องเพิ่มสิทธิ์ให้ที่หน้า “คนในร้าน”
        </p>
      </div>
      <BranchList rows={rows} />
      <AddBranchForm />
    </div>
  );
}
