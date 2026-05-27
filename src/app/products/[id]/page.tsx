// Sprint 1 Part 7a — edit / delete one product.
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import {
  getProductByIdLogic,
  getUnitTemplates,
  getProductParentOptionsLogic,
} from "@/server/product";
import { getCategoriesLogic } from "@/server/category";
import { updateProduct } from "../actions";
import { toProductView } from "../_components/product-view";
import ProductForm from "../_components/ProductForm";
import DeleteProductButton from "../_components/DeleteProductButton";

// Next 15: route params are async (await before use).
export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tenantId } = await requireTenant();

  const [product, units, categories, allParents] = await Promise.all([
    getProductByIdLogic(tenantId, id),
    getUnitTemplates(),
    getCategoriesLogic(tenantId),
    getProductParentOptionsLogic(tenantId),
  ]);
  if (!product) notFound();

  const categoryOptions = categories.map((c) => ({
    id: c.id,
    account: c.account,
    accountingSection: c.accountingSection,
    groupName: c.groupName,
  }));

  // 7c: drop self from the parent picker. Cycle/depth among the remaining
  // descendants is enforced server-side (assertParentValid) — picking a
  // descendant surfaces a Thai field error rather than being pre-filtered.
  const parentOptions = allParents.filter((p) => p.id !== product.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-bold">แก้ไขสินค้า</h2>
        <DeleteProductButton id={product.id} />
      </div>
      <ProductForm
        action={updateProduct.bind(null, product.id)}
        initial={toProductView(product)}
        units={units}
        categories={categoryOptions}
        parentOptions={parentOptions}
        submitLabel="บันทึกการแก้ไข"
      />
    </div>
  );
}
