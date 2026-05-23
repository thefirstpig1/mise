// Sprint 1 Part 7a — edit / delete one product.
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { getProductByIdLogic, getUnitTemplates } from "@/server/product";
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

  const [product, units, categories] = await Promise.all([
    getProductByIdLogic(tenantId, id),
    getUnitTemplates(),
    getCategoriesLogic(tenantId),
  ]);
  if (!product) notFound();

  const categoryOptions = categories.map((c) => ({
    id: c.id,
    account: c.account,
    accountingSection: c.accountingSection,
    groupName: c.groupName,
  }));

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
        submitLabel="บันทึกการแก้ไข"
      />
    </div>
  );
}
