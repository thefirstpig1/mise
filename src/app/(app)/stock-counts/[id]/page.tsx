// Sprint 3 Part 15 L5b/L5c — the count sheet, and the closed document.
// ADR 0034 (Part 36) — counted by many devices at once.
//
// One page for both states, because they are the same document: while DRAFT it
// is a sheet everyone counts into, and once CLOSED it is the record of what was
// found and by whom.
//
// Everything expensive happens ONCE, here, when the sheet is opened — the
// product list, the stocked products, and one batched cost read (risk R1).
// Counting afterwards never re-renders this page (ADR 0034 Q7): each ยืนยัน
// returns the sheet, and other devices poll for it.
//
// `params` is a PROMISE in Next 15 (Part 10 L5a).

import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { hasCapability } from "@/lib/permissions/service";
import { getStockCountByIdLogic, getStockedProductIdsLogic } from "@/server/stock-count";
import { getProductsLogic } from "@/server/product";
import { getProductCostsLogic } from "@/server/stock-cost";
import { getProductCostsQuerySchema } from "@/lib/validations/stock-cost";
import { toStockCountDetailView } from "../_components/stock-count-view";
import CountSheet from "../_components/CountSheet";
import {
  closeStockCountAction,
  confirmCountAction,
  deleteContributionAction,
  editContributionAction,
  getCountSheetAction,
  removeStockCountLineAction,
  voidStockCountAction,
} from "../actions";

export default async function StockCountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { tenantId, membership, role } = await requireTenant("count:write");
  const { id } = await params;

  const count = await getStockCountByIdLogic(tenantId, id);
  if (!count) notFound();

  const detail = toStockCountDetailView(count);

  const [allProducts, stockedProductIds] = await Promise.all([
    getProductsLogic(tenantId),
    detail.status === "DRAFT" ? getStockedProductIdsLogic(tenantId, detail.branchId) : Promise.resolve([]),
  ]);

  // Live, active products are what a counter can count; a soft-deleted product
  // already on the sheet is added back by the sheet itself.
  const products = allProducts
    .filter((p) => p.isActive)
    .map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      imageUrl: p.imageUrl,
      section: p.category?.accountingSection ?? null,
      group: p.category?.groupName ?? null,
      units: [...p.productUnits]
        .sort((a, b) => Number(b.isBase) - Number(a.isBase))
        .map((u) => ({ id: u.id, unitName: u.unitName, isBase: u.isBase })),
    }));

  // One batched cost read for everything that can show a variance: what is
  // stocked here, plus what is already on the sheet (R1 — never one per product).
  const valued = Array.from(new Set([...stockedProductIds, ...detail.items.map((i) => i.productId)]));
  const costs = valued.length
    ? await getProductCostsLogic(
        tenantId,
        getProductCostsQuerySchema.parse({ productIds: valued, branchId: detail.branchId })
      )
    : new Map();
  const costByProduct: Record<string, string> = {};
  for (const [productId, state] of costs) {
    costByProduct[productId] = state.costPerBaseUnit.toString();
  }

  return (
    <CountSheet
      initial={detail}
      products={products}
      costByProduct={costByProduct}
      stockedProductIds={stockedProductIds}
      currentUserId={membership.userId}
      canCloseAny={hasCapability(role, "count:close")}
      confirmCount={confirmCountAction}
      editContribution={editContributionAction}
      deleteContribution={deleteContributionAction}
      removeLine={removeStockCountLineAction}
      poll={getCountSheetAction}
      close={closeStockCountAction}
      voidCount={voidStockCountAction}
    />
  );
}
