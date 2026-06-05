// Sprint 1 Part 7a — edit / delete one product.
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import {
  getProductByIdLogic,
  getUnitTemplates,
  getProductParentOptionsLogic,
  getLiquidDensityTemplates,
} from "@/server/product";
import { getCategoriesLogic } from "@/server/category";
import {
  getProductMappingsLogic,
  getPriceHistoryLogic,
} from "@/server/supplier-product-mapping";
import { updateProduct } from "../actions";
import { toProductView } from "../_components/product-view";
import {
  toMappingView,
  seriesKeyOf,
  type PriceHistorySeries,
} from "../_components/mapping-view";
import ProductForm from "../_components/ProductForm";
import DeleteProductButton from "../_components/DeleteProductButton";
import MappingListSection from "../_components/MappingListSection";
import MappingHistoryViewer from "../_components/MappingHistoryViewer";

// Next 15: route params are async (await before use).
export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tenantId } = await requireTenant();

  const [product, units, categories, allParents, densityTemplates, mappings] =
    await Promise.all([
      getProductByIdLogic(tenantId, id),
      getUnitTemplates(),
      getCategoriesLogic(tenantId),
      getProductParentOptionsLogic(tenantId),
      getLiquidDensityTemplates(),
      // "all" = live rows incl. those whose supplier is soft-deleted (orphans,
      // sorted last); the list toggles Active/All client-side (L5a).
      getProductMappingsLogic(tenantId, id, "all"),
    ]);
  if (!product) notFound();

  // Price history (L5a): one series per distinct (supplier, branch) tuple drawn
  // from the live mappings. getPriceHistoryLogic returns ALL rows incl.
  // soft-deleted (audit trail, Q9), newest first. Tuples are few per product, so
  // a Promise.all of per-tuple reads is fine for MVP (no new logic fn needed).
  const tuples = new Map<string, { supplierId: string; branchId: string | null }>();
  for (const m of mappings) {
    const key = seriesKeyOf(m.supplierId, m.branchId);
    if (!tuples.has(key)) {
      tuples.set(key, { supplierId: m.supplierId, branchId: m.branchId });
    }
  }
  const histories = await Promise.all(
    [...tuples.values()].map((t) =>
      getPriceHistoryLogic(tenantId, id, t.supplierId, t.branchId)
    )
  );
  const series: PriceHistorySeries[] = histories
    .filter((rows) => rows.length > 0)
    .map((rows) => {
      const views = rows.map(toMappingView);
      const head = views[0];
      return {
        key: seriesKeyOf(head.supplierId, head.branchId),
        supplier: head.supplier,
        branch: head.branch,
        rows: views,
      };
    });
  const mappingViews = mappings.map(toMappingView);

  // L5b: blast-radius items for the delete dialog — built from the mappings we
  // already fetched (no extra query). primaryLabel = supplier (the "other side"
  // on a product page); priceLabel mirrors MappingListSection's formatting.
  const cascadeItems = mappingViews.map((m) => ({
    id: m.id,
    primaryLabel: m.supplier?.name ?? "(ไม่ทราบ)",
    secondaryLabel: m.branch ? m.branch.name : "ทุกสาขา",
    priceLabel:
      m.currentUnitPrice === null
        ? "—"
        : `฿${m.currentUnitPrice}${m.orderUnit ? ` / ${m.orderUnit.name}` : ""}`,
  }));

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
        <DeleteProductButton id={product.id} cascadeItems={cascadeItems} />
      </div>
      <ProductForm
        action={updateProduct.bind(null, product.id)}
        initial={toProductView(product)}
        units={units}
        categories={categoryOptions}
        parentOptions={parentOptions}
        availableTemplates={densityTemplates}
        submitLabel="บันทึกการแก้ไข"
      />

      {/* Part 8 L5a — supplier price list + history (product-centric, Q9). Read
          only this layer; the create/edit form + row controls land in L5a-2. */}
      <MappingListSection mappings={mappingViews} productId={product.id} />
      <MappingHistoryViewer series={series} />
    </div>
  );
}
