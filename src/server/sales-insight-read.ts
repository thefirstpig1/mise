// ============================================================
// Mise — the reads behind the sales insights (Kong, 2026-09-28)
// ============================================================
// Two things, both thin: the menu × branch × day rows (getSalesMenuDaysLogic)
// and the cost of one serving of each dish at each branch. All arithmetic is
// in src/lib/sales-insight.ts, which is tested without a database.
//
// THE COST COMES FROM THE RECIPE ENGINE, NOT FROM HERE. `getRecipeListLogic`
// already prices every menu at a branch on a day, recursively and
// yield-correct, and never lets a cost leave without its confidence (Part 21).
// A per-dish cost of our own would be the second cost engine ADR 0025 Q4
// refused. It is priced as of the LAST day of the period (rule SI2) — the
// ledger keeps no cost per menu (ADR 0022 explodes a dish into products at
// posting), so "what this dish cost on the 3rd" is not a question it can
// answer, and the screen says which date the cost is from.
//
// The ticket (`CostAccess`) gates the exit, as everywhere since Part 28: null
// means nobody may see a cost, so the walk is skipped entirely and profit is
// simply not offered.
// ============================================================

import type { CostAccess } from "@/lib/permissions/cost-access";
import { costKey, type CostMap } from "@/lib/sales-insight";
import { getRecipeListLogic } from "@/server/recipe-read";

/** One serving's recipe cost per menu per branch, priced on `asOf`. */
export async function getMenuCostMapLogic(
  tenantId: string,
  branchIds: string[],
  asOf: Date,
  cost: CostAccess | null
): Promise<CostMap> {
  const out: CostMap = new Map();
  if (cost === null || branchIds.length === 0) return out;
  // One batched walk per branch — never one per dish (ADR 0014 Consequence 2).
  const lists = await Promise.all(
    branchIds.map((branchId) =>
      getRecipeListLogic(tenantId, { branchId, missingOnly: false, asOf }, cost).then((r) => ({ branchId, r }))
    )
  );
  for (const { branchId, r } of lists) {
    for (const m of r.menus) {
      if (m.kind !== "menu" || m.costPerServing === null || m.problem !== null) continue;
      out.set(costKey(branchId, m.targetId), {
        cost: Number(m.costPerServing),
        confidence: m.confidence ?? "LOW",
        recipeId: m.recipeId,
      });
    }
  }
  return out;
}
