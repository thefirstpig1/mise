// Sprint 1 Part 8 L5a-2 — create a supplier-product price mapping for one
// product (product-centric write side, Q9). Loads the reference data the form
// needs: the tenant's suppliers + branches, and THIS product's order units.
// All three are projected to id+label plain shapes BEFORE crossing to the
// client form (Pitfall #20: Supplier and ProductUnit both carry Decimals).
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { getProductByIdLogic } from "@/server/product";
import { getSuppliersLogic } from "@/server/supplier";
import { getBranchesLogic } from "@/server/branch";
import { createMappingAction } from "@/app/supplier-product-mappings/actions";
import MappingForm from "../../../_components/MappingForm";

// Next 15: route params are async (await before use).
export default async function NewMappingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tenantId } = await requireTenant("master:write");

  const [product, suppliers, branches] = await Promise.all([
    getProductByIdLogic(tenantId, id),
    getSuppliersLogic(tenantId),
    getBranchesLogic(tenantId),
  ]);
  if (!product) notFound();

  const supplierOptions = suppliers.map((s) => ({
    id: s.id,
    nameFull: s.nameFull,
  }));
  const branchOptions = branches.map((b) => ({ id: b.id, name: b.name }));
  // Project the product's units to id + name (drop the Decimal toBaseRatio).
  const orderUnits = product.productUnits.map((u) => ({
    id: u.id,
    unitName: u.unitName,
  }));

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">เพิ่มรายการราคา</h2>
      <p className="text-sm text-muted-foreground">{product.name}</p>
      <MappingForm
        action={createMappingAction}
        productId={product.id}
        suppliers={supplierOptions}
        branches={branchOptions}
        orderUnits={orderUnits}
        submitLabel="บันทึก"
      />
    </div>
  );
}
