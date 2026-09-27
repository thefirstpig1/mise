// Sprint 3 Part 15 L5b/L5c — the count sheet, and the closed document.
//
// One page for both states, because they are the same document: while DRAFT it
// is a sheet you type into, and once CLOSED it is the record of what was found.
// Splitting them would duplicate the line table for no gain.
//
// Money is SHOWN but not stored (ADR 0015 Q4): the value of each variance is
// computed here from the cost engine, in ONE batched read for the whole sheet
// (risk R1 — never one call per product).
//
// `params` / `searchParams` are PROMISES in Next 15 (Part 10 L5a).

import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import {
  getStockCountByIdLogic,
  getUncountedStockedCountLogic,
} from "@/server/stock-count";
import { getProductsLogic } from "@/server/product";
import { getProductCostsLogic } from "@/server/stock-cost";
import { getProductCostsQuerySchema } from "@/lib/validations/stock-cost";
import { toStockCountDetailView } from "../_components/stock-count-view";
import CountSheet from "../_components/CountSheet";
import {
  closeStockCountAction,
  removeStockCountLineAction,
  saveStockCountLineAction,
  voidStockCountAction,
} from "../actions";

export default async function StockCountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { tenantId } = await requireTenant("count:write");
  const { id } = await params;

  const count = await getStockCountByIdLogic(tenantId, id);
  if (!count) notFound();

  const detail = toStockCountDetailView(count);

  // Products available to count. Live only: a soft-deleted product still holding
  // stock shows on its existing line but should not be added to a new sheet.
  const products = (await getProductsLogic(tenantId)).map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    units: p.productUnits.map((u) => ({
      id: u.id,
      unitName: u.unitName,
      isBase: u.isBase,
    })),
  }));

  // One batched cost read for every product on the sheet (R1).
  const countedIds = detail.items.map((i) => i.productId);
  const costs = countedIds.length
    ? await getProductCostsLogic(
        tenantId,
        getProductCostsQuerySchema.parse({
          productIds: Array.from(new Set(countedIds)),
          branchId: detail.branchId,
        })
      )
    : new Map();
  const costByProduct: Record<string, string> = {};
  for (const [productId, state] of costs) {
    costByProduct[productId] = state.costPerBaseUnit.toString();
  }

  const uncounted =
    detail.status === "DRAFT"
      ? await getUncountedStockedCountLogic(tenantId, detail.id)
      : 0;

  return (
    <CountSheet
      detail={detail}
      products={products}
      costByProduct={costByProduct}
      uncountedStocked={uncounted}
      saveLine={saveStockCountLineAction}
      removeLine={removeStockCountLineAction}
      close={closeStockCountAction}
      voidCount={voidStockCountAction}
    />
  );
}
