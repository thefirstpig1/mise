// ============================================================
// คิดครัว — how far along the shop is, for "นี่คืออะไร" (queue item 10)
// ============================================================
// The checklist in the window behind every figure that is still waiting
// (src/components/ui/WaitingFor.tsx) says what THIS shop has entered, each
// line from a count here — never a box somebody ticked. Read after the window
// opens (GET /api/readiness), so no page pays for it on first paint.
//
// Counted within the reader's reach, narrowed to one branch when the page is
// looking at one. Recipes, menus and products belong to the shop, so their
// counts are shop-wide; what is entered PER branch (sales days, counts,
// receipts, posted days) is not.
//
// Two definitions worth knowing:
//   menus     — live, active menus that are not merged into another (ADR
//               0026: a two-branch shop has one dish twice until merged, and
//               the menus page counts it once)
//   priced    — a raw ingredient with a cost at a branch in scope: it was
//               received on a goods receipt, or a price was declared for it
//               (the opening count, ระบุต้นทุน). A supplier's price list alone
//               prices an ORDER, not the stock, so it does not count.
// ============================================================

import type { Prisma } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import type { BranchReach } from "@/lib/permissions/service";
import type { Readiness } from "@/lib/data-needs";

/** The branches in scope, as a `branchId` filter. Outside the reach matches nothing. */
export function readinessBranches(reach: BranchReach, branchId?: string): { branchId?: string | { in: string[] } } {
  if (reach.allBranches) return branchId ? { branchId } : {};
  const allowed = [...reach.allowedBranchIds];
  if (branchId) return { branchId: allowed.includes(branchId) ? branchId : { in: [] } };
  return { branchId: { in: allowed } };
}

export async function dataReadinessLogic(tenantId: string, reach: BranchReach, branchId?: string): Promise<Readiness> {
  const b = readinessBranches(reach, branchId);
  const liveMenu: Prisma.MenuWhereInput = {
    tenantId,
    deletedAt: null,
    isActive: true,
    mergedInto: { none: { revokedAt: null } },
  };
  return withTenantContext(tenantId, async (tx) => {
    const [salesDays, menus, menusWithRecipe, products, priced, closedCounts, postedDays, receipts, expenses, guestDays, categorisedMenus, parLevels, lastSales, lastCount, lastReceipt] =
      await Promise.all([
        // A day with a POS file — a pulse typed alone makes a sales_day too (ADR 0020).
        tx.salesDay.count({ where: { tenantId, ...b, currentBatchId: { not: null } } }),
        tx.menu.count({ where: liveMenu }),
        tx.menu.count({ where: { ...liveMenu, recipes: { some: { isDraft: false, supersededAt: null } } } }),
        tx.product.count({ where: { tenantId, deletedAt: null, type: "RAW" } }),
        tx.stockMovement.groupBy({
          by: ["productId"],
          where: {
            tenantId,
            ...b,
            product: { deletedAt: null, type: "RAW" },
            OR: [{ type: "PO_RECEIVE" }, { costDeclarations: { some: { supersededAt: null } } }],
          },
        }),
        tx.stockCount.count({ where: { tenantId, ...b, status: "CLOSED", deletedAt: null } }),
        tx.salesConsumptionRun.count({ where: { tenantId, ...b, voidedAt: null } }),
        tx.goodsReceipt.count({ where: { tenantId, ...b, status: "CONFIRMED", deletedAt: null } }),
        tx.expense.count({ where: { tenantId, ...b, deletedAt: null } }),
        tx.salesDay.count({ where: { tenantId, ...b, guestCount: { not: null } } }),
        tx.menu.count({ where: { ...liveMenu, menuCategoryId: { not: null } } }),
        tx.parLevel.count({ where: { tenantId, ...b, deletedAt: null } }),
        // The newest of each, so "มีแล้ว 20 วัน" also says how recent (page help).
        tx.salesDay.aggregate({ where: { tenantId, ...b, currentBatchId: { not: null } }, _max: { businessDate: true } }),
        tx.stockCount.aggregate({ where: { tenantId, ...b, status: "CLOSED", deletedAt: null }, _max: { countDate: true } }),
        tx.goodsReceipt.aggregate({ where: { tenantId, ...b, status: "CONFIRMED", deletedAt: null }, _max: { receivedAt: true } }),
      ]);
    const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
    return {
      salesDays,
      menus,
      menusWithRecipe,
      products,
      pricedProducts: priced.length,
      closedCounts,
      postedDays,
      receipts,
      expenses,
      guestDays,
      categorisedMenus,
      parLevels,
      lastSalesDay: iso(lastSales._max.businessDate),
      lastCountDay: iso(lastCount._max.countDate),
      lastReceiptDay: iso(lastReceipt._max.receivedAt),
    };
  });
}
