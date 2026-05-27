// Sprint 1 Part 7a — create a product.
// Loads unit templates (base-unit dropdown), the tenant's categories
// (classification dropdown), and (7c) all live products of the tenant for the
// PREPPED parent picker. The action resolves tenantId itself.
import { requireTenant } from "@/lib/require-tenant";
import {
  getUnitTemplates,
  getProductParentOptionsLogic,
} from "@/server/product";
import { getCategoriesLogic } from "@/server/category";
import { createProduct } from "../actions";
import ProductForm from "../_components/ProductForm";

export default async function NewProductPage() {
  const { tenantId } = await requireTenant();
  const [units, categories, parentOptions] = await Promise.all([
    getUnitTemplates(),
    getCategoriesLogic(tenantId),
    getProductParentOptionsLogic(tenantId),
  ]);

  const categoryOptions = categories.map((c) => ({
    id: c.id,
    account: c.account,
    accountingSection: c.accountingSection,
    groupName: c.groupName,
  }));

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">เพิ่มสินค้า</h2>
      <ProductForm
        action={createProduct}
        units={units}
        categories={categoryOptions}
        parentOptions={parentOptions}
        submitLabel="บันทึก"
      />
    </div>
  );
}
