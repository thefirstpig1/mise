// Sprint 1 Part 8 L5a-2 — edit / delete one supplier-product price mapping
// (product-centric write side, Q9). Fetches the mapping (404 if missing,
// soft-deleted, or cross-tenant) + the same reference data as the new page.
// Supplier + branch are immutable on update, so the form locks them; orderUnit,
// pricing, dates, and isPreferred stay editable. Reference data is projected to
// id+label plain shapes (Pitfall #20: Supplier + ProductUnit carry Decimals).
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { getProductByIdLogic } from "@/server/product";
import { getSuppliersLogic } from "@/server/supplier";
import { getBranchesLogic } from "@/server/branch";
import { getSupplierProductMappingByIdLogic } from "@/server/supplier-product-mapping";
import { updateMappingAction } from "@/app/supplier-product-mappings/actions";
import { toMappingView } from "../../../../_components/mapping-view";
import MappingForm from "../../../../_components/MappingForm";
import DeleteMappingButton from "../../../../_components/DeleteMappingButton";

// Next 15: route params are async (await before use).
export default async function EditMappingPage({
  params,
}: {
  params: Promise<{ id: string; mappingId: string }>;
}) {
  const { id, mappingId } = await params;
  const { tenantId } = await requireTenant("master:write");

  const [product, mapping, suppliers, branches] = await Promise.all([
    getProductByIdLogic(tenantId, id),
    getSupplierProductMappingByIdLogic(tenantId, mappingId),
    getSuppliersLogic(tenantId),
    getBranchesLogic(tenantId),
  ]);
  if (!product || !mapping) notFound();

  const supplierOptions = suppliers.map((s) => ({
    id: s.id,
    nameFull: s.nameFull,
  }));
  const branchOptions = branches.map((b) => ({ id: b.id, name: b.name }));
  const orderUnits = product.productUnits.map((u) => ({
    id: u.id,
    unitName: u.unitName,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-bold">แก้ไขรายการราคา</h2>
        <DeleteMappingButton mappingId={mapping.id} productId={product.id} />
      </div>
      <p className="text-sm text-muted-foreground">{product.name}</p>
      <MappingForm
        action={updateMappingAction.bind(null, mapping.id)}
        initial={toMappingView(mapping)}
        productId={product.id}
        suppliers={supplierOptions}
        branches={branchOptions}
        orderUnits={orderUnits}
        submitLabel="บันทึกการแก้ไข"
      />
    </div>
  );
}
