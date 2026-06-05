// Sprint 1 Part 5, Step 7.5 — edit / delete one supplier.
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { getSupplierByIdLogic } from "@/server/supplier";
import { getSupplierMappingsLogic } from "@/server/supplier-product-mapping";
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

  const [supplier, mappings] = await Promise.all([
    getSupplierByIdLogic(tenantId, id),
    // L5b: live mappings of this supplier feed the delete blast-radius dialog
    // ("all" includes orphans whose product is soft-deleted — still live rows).
    getSupplierMappingsLogic(tenantId, id, "all"),
  ]);
  if (!supplier) notFound();

  // primaryLabel = product (the "other side" on a supplier page). currentUnitPrice
  // is a Prisma Decimal here (raw row) → stringify server-side (Pitfall #20) so a
  // plain, Decimal-free shape crosses to the client dialog.
  const cascadeItems = mappings.map((m) => ({
    id: m.id,
    primaryLabel: m.product.name,
    secondaryLabel: m.branch ? m.branch.name : "ทุกสาขา",
    priceLabel:
      m.currentUnitPrice === null
        ? "—"
        : `฿${m.currentUnitPrice.toString()}${m.orderUnit ? ` / ${m.orderUnit.unitName}` : ""}`,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-bold">แก้ไขซัพพลายเออร์</h2>
        <DeleteSupplierButton id={supplier.id} cascadeItems={cascadeItems} />
      </div>
      <SupplierForm
        action={updateSupplier.bind(null, supplier.id)}
        initial={toSupplierView(supplier)}
        submitLabel="บันทึกการแก้ไข"
      />
    </div>
  );
}
