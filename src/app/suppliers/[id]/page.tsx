// Sprint 1 Part 5, Step 7.5 — edit / delete one supplier.
// Sprint 1 Part 9 L5c — supplier-centric mapping views: the same price-list and
// price-history components the product page uses, rendered here in "supplier"
// perspective (rows labelled by product). Read-only (decision iii) — create/edit
// stays on the product-centric routes; each row links there to edit.
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { getSupplierByIdLogic } from "@/server/supplier";
import {
  getSupplierMappingsLogic,
  getPriceHistoryLogic,
} from "@/server/supplier-product-mapping";
import { updateSupplier } from "../actions";
import SupplierForm from "../_components/SupplierForm";
import DeleteSupplierButton from "../_components/DeleteSupplierButton";
import { toSupplierView } from "../_components/supplier-view";
// Shared mapping UI lives under products/_components (generalized in L5c). The
// `_components` folder is a private-folder convention, not an import boundary —
// importing across routes is fine.
import MappingListSection from "../../products/_components/MappingListSection";
import MappingHistoryViewer from "../../products/_components/MappingHistoryViewer";
import {
  toMappingView,
  seriesKeyOf,
  type PriceHistorySeries,
} from "../../products/_components/mapping-view";

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
    // L5b/L5c: "all" = live mappings of this supplier incl. orphans whose product
    // is soft-deleted (still live rows). Feeds BOTH the delete blast-radius dialog
    // and the read-only price list below.
    getSupplierMappingsLogic(tenantId, id, "all"),
  ]);
  if (!supplier) notFound();

  const mappingViews = mappings.map(toMappingView);

  // Price history (L5c): one series per distinct (product, branch) tuple for THIS
  // supplier — the supplier-perspective mirror of the product page's per-supplier
  // series. getPriceHistoryLogic returns ALL rows incl. soft-deleted (audit
  // trail, Q9), newest first. Tuples are few, so per-tuple Promise.all is fine.
  const tuples = new Map<
    string,
    { productId: string; branchId: string | null }
  >();
  for (const m of mappings) {
    const key = seriesKeyOf(m.productId, m.branchId);
    if (!tuples.has(key)) {
      tuples.set(key, { productId: m.productId, branchId: m.branchId });
    }
  }
  const histories = await Promise.all(
    [...tuples.values()].map((t) =>
      getPriceHistoryLogic(tenantId, t.productId, id, t.branchId)
    )
  );
  const series: PriceHistorySeries[] = histories
    .filter((rows) => rows.length > 0)
    .map((rows) => {
      const views = rows.map(toMappingView);
      const head = views[0];
      return {
        key: seriesKeyOf(head.productId, head.branchId),
        supplier: head.supplier,
        product: head.product,
        branch: head.branch,
        rows: views,
      };
    });

  // L5b: blast-radius items for the delete dialog — built from the serialized
  // views (no extra query, no raw Decimal). primaryLabel = product (the "other
  // side" on a supplier page); priceLabel mirrors MappingListSection's format.
  const cascadeItems = mappingViews.map((m) => ({
    id: m.id,
    primaryLabel: m.product?.name ?? "(ไม่ทราบ)",
    secondaryLabel: m.branch ? m.branch.name : "ทุกสาขา",
    priceLabel:
      m.currentUnitPrice === null
        ? "—"
        : `฿${m.currentUnitPrice}${m.orderUnit ? ` / ${m.orderUnit.name}` : ""}`,
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
      <MappingListSection mappings={mappingViews} perspective="supplier" />
      <MappingHistoryViewer series={series} perspective="supplier" />
    </div>
  );
}
