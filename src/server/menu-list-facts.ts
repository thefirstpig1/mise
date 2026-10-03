// ============================================================
// Mise — what the /menus list says about each dish (UI run-through 2026-10-02)
// ============================================================
// The list used to print a dish's name and nothing else, so the three things an
// owner asks of a menu screen — is it selling, at what price, does it have a
// recipe — meant opening /sales and /recipes and matching by eye.
//
// Nothing here is new arithmetic; each fact is the same one another screen
// already states, read the same way:
//   - SALES are `sales_line` rows that still stand (`supersededAt: null`), in the
//     branches the reader may see (rule A5), FOLDED onto the dish a spelling
//     was merged into — reporting folds retroactively and always (ADR 0026 Q5),
//     exactly as /sales does. Revenue is after discount, excl VAT and SC (P16).
//   - A RECIPE is a live, current, non-draft version (`isDraft: false`,
//     `supersededAt: null`) — a draft is not a recipe (ADR 0025 Q4). Whether it
//     applies at a GIVEN branch on a GIVEN day is /menus/coverage's question;
//     this one only says whether one has been written at all.
// ============================================================

import { withTenantContext } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { branchScopeWhere, type BranchReach } from "@/lib/permissions/service";
import { foldRowsByMenu, foldMenuId, loadMergeFold } from "@/server/menu-merge-fold";

export const MENU_FACT_DAYS = 30;

export type MenuListFact = {
  /** Plates sold in the last MENU_FACT_DAYS days, folded onto the dish. */
  qty: number;
  /** Revenue over the same days. */
  net: number;
  /** The current recipe to open, or null when nobody has written one. */
  recipeId: string | null;
  /** Somebody is drafting one in Menu Lab. */
  hasDraft: boolean;
};

export async function getMenuListFactsLogic(
  tenantId: string,
  reach: BranchReach
): Promise<{ facts: Map<string, MenuListFact>; from: Date; to: Date }> {
  const to = computeBangkokToday();
  const from = addDays(to, -(MENU_FACT_DAYS - 1));

  const [sold, recipes, fold] = await Promise.all([
    withTenantContext(tenantId, (tx) =>
      tx.salesLine.groupBy({
        by: ["menuId"],
        where: {
          tenantId,
          supersededAt: null,
          businessDate: { gte: from, lte: to },
          branch: { deletedAt: null, ...branchScopeWhere(reach) },
        },
        _sum: { qty: true, netAmount: true },
      })
    ),
    withTenantContext(tenantId, (tx) =>
      tx.recipe.findMany({
        where: { tenantId, deletedAt: null, supersededAt: null, menuId: { not: null } },
        select: { id: true, menuId: true, isDraft: true, effectiveFrom: true },
        orderBy: { effectiveFrom: "desc" },
      })
    ),
    withTenantContext(tenantId, (tx) => loadMergeFold(tx, tenantId)),
  ]);

  const facts = new Map<string, MenuListFact>();
  const factOf = (menuId: string) => {
    let f = facts.get(menuId);
    if (f === undefined) {
      f = { qty: 0, net: 0, recipeId: null, hasDraft: false };
      facts.set(menuId, f);
    }
    return f;
  };

  const folded = foldRowsByMenu(
    fold,
    sold.map((r) => ({
      menuId: foldMenuId(fold, r.menuId),
      qty: Number(r._sum.qty ?? 0),
      net: Number(r._sum.netAmount ?? 0),
    })),
    (r) => r.menuId,
    (a, b) => ({ menuId: a.menuId, qty: a.qty + b.qty, net: a.net + b.net })
  );
  for (const r of folded) {
    const f = factOf(r.menuId);
    f.qty = r.qty;
    f.net = r.net;
  }

  // Newest first, so the first live recipe met is the one to open.
  for (const r of recipes) {
    const f = factOf(r.menuId!);
    if (r.isDraft) f.hasDraft = true;
    else if (f.recipeId === null) f.recipeId = r.id;
  }

  return { facts, from, to };
}
