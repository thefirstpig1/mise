// Sprint 1 Part 5, Step 7.3 — create a supplier.
import { requireTenant } from "@/lib/require-tenant";
import { createSupplier } from "../actions";
import SupplierForm from "../_components/SupplierForm";

export default async function NewSupplierPage() {
  await requireTenant("master:write"); // auth gate / redirect; tenantId resolved inside the action
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">เพิ่มซัพพลายเออร์</h2>
      <SupplierForm action={createSupplier} submitLabel="บันทึก" />
    </div>
  );
}
