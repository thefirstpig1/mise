// Sprint 1 Part 5, Step 7.5 — edit / delete one supplier.
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { getSupplierByIdLogic } from "@/server/supplier";
import { updateSupplier } from "../actions";
import SupplierForm from "../_components/SupplierForm";
import DeleteSupplierButton from "../_components/DeleteSupplierButton";
import { toSupplierView } from "../_components/supplier-view";

// Next 15: route params are async (await before use).
export default async function EditSupplierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tenantId } = await requireTenant();

  const supplier = await getSupplierByIdLogic(tenantId, id);
  if (!supplier) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-bold">แก้ไขซัพพลายเออร์</h2>
        <DeleteSupplierButton id={supplier.id} />
      </div>
      <SupplierForm
        action={updateSupplier.bind(null, supplier.id)}
        initial={toSupplierView(supplier)}
        submitLabel="บันทึกการแก้ไข"
      />
    </div>
  );
}
