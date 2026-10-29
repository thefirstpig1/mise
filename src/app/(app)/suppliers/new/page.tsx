// Sprint 1 Part 5, Step 7.3 — create a supplier.
import { requireTenant } from "@/lib/require-tenant";
import { createSupplier } from "../actions";
import SupplierForm from "../_components/SupplierForm";

export default async function NewSupplierPage() {
  const { membership } = await requireTenant("master:write"); // auth gate / redirect; tenantId resolved inside the action
  return (
    <div className="max-w-3xl space-y-6">
      <h2 className="text-2xl font-semibold">เพิ่มผู้ขาย</h2>
      <SupplierForm action={createSupplier} submitLabel="บันทึก" shopVatRate={membership.tenant.defaultVatRatePercent.toString()} />
    </div>
  );
}
