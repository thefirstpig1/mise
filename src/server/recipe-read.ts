// ============================================================
// Mise — recipe reads that answer "what would this change touch?" (L3c)
// ============================================================
// Three questions, and they are one query wearing three hats:
//
//   Q13 — which recipes use this product? A delete refusal has to NAME them.
//   Q14 — same list, with checkboxes: the substitution screen.
//   Q17 — which recipes does changing this unit's ratio MOVE? ADR 0006 left the
//         guard open for want of a downstream reference; recipes supply it.
//
// All three exist because of one rule that runs through this Part: **a change
// states what it will touch before it touches it.** Part 19's import preview,
// Q8's copy button and Q13's delete refusal are the same shape, and the reason
// is always that the alternative is a silent edit somebody discovers in a cost
// figure three weeks later.
//
// CENTRAL AND BRANCH RECIPES ARE GROUPED, NEVER MIXED (Q8/Q14). A bulk edit that
// quietly includes สาขาอโศก's own recipe undoes a decision that branch made, and
// Q8 exists to make that decision deliberate. A shop that has genuinely stopped
// buying an ingredient does need every branch to change — the screen presents
// that and does not decide it.
// ============================================================

import type { Prisma, PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import type { RecipeTarget } from "@/server/recipe-resolve";
import type { RecipeUsageQuery } from "@/lib/validations/recipe";

/** One recipe that uses the thing asked about, and the line that names it. */
export type RecipeUsageRow = {
  recipeId: string;
  lineId: string;
  /** What the recipe MAKES — a recipe has no name of its own (Q10). */
  label: string;
  /** True when no branch is linked: the recipe everyone follows by default. */
  isCentral: boolean;
  /** Empty on a central line; the branches that decided for themselves (Q8). */
  branchNames: string[];
  effectiveFrom: Date;
  /** The ingredient line naming the thing asked about. */
  ingredientId: string;
  qty: Prisma.Decimal;
  unitId: string | null;
  unitName: string | null;
};

/**
 * Which live recipes use this product or menu.
 *
 * SUPERSEDED VERSIONS ARE EXCLUDED and merely-past ones are NOT. A superseded
 * version means "this version was wrong" and is unreachable at every date; a
 * version that only has a newer sibling still governs the days it covered, and
 * Part 22 posts consumption against exactly those days.
 *
 * Sorted central first, then by name, because that is the order the substitution
 * screen has to read in: the recipes everybody uses, then the exceptions.
 */
export async function getRecipeUsageLogic(
  tenantId: string,
  query: RecipeUsageQuery
): Promise<RecipeUsageRow[]> {
  if (query.productId === undefined && query.menuId === undefined) return [];
  const target: RecipeTarget =
    query.productId !== undefined
      ? { kind: "product", id: query.productId }
      : { kind: "menu", id: query.menuId as string };

  return withTenantContext(tenantId, (tx) => usageRows(tx, tenantId, target));
}

async function usageRows(
  tx: PrismaClient,
  tenantId: string,
  target: RecipeTarget
): Promise<RecipeUsageRow[]> {
  const lines = await tx.recipeIngredient.findMany({
    where: {
      tenantId,
      ...(target.kind === "product"
        ? { productId: target.id }
        : { componentMenuId: target.id }),
      recipe: { deletedAt: null, supersededAt: null },
    },
    select: {
      id: true,
      qty: true,
      productUnitId: true,
      productUnit: { select: { unitName: true } },
      recipe: {
        select: {
          id: true,
          lineId: true,
          effectiveFrom: true,
          menu: { select: { name: true } },
          outputProduct: { select: { name: true } },
        },
      },
    },
  });
  if (lines.length === 0) return [];

  const links = await tx.recipeBranch.findMany({
    where: {
      tenantId,
      lineId: { in: [...new Set(lines.map((l) => l.recipe.lineId))] },
    },
    select: { lineId: true, branch: { select: { name: true } } },
  });
  const branchesByLine = new Map<string, string[]>();
  for (const l of links) {
    const names = branchesByLine.get(l.lineId);
    if (names === undefined) branchesByLine.set(l.lineId, [l.branch.name]);
    else names.push(l.branch.name);
  }

  const rows: RecipeUsageRow[] = lines.map((l) => {
    const branchNames = branchesByLine.get(l.recipe.lineId) ?? [];
    return {
      recipeId: l.recipe.id,
      lineId: l.recipe.lineId,
      label: l.recipe.menu?.name ?? l.recipe.outputProduct?.name ?? l.recipe.id,
      isCentral: branchNames.length === 0,
      branchNames: [...branchNames].sort(),
      effectiveFrom: l.recipe.effectiveFrom,
      ingredientId: l.id,
      qty: l.qty,
      unitId: l.productUnitId,
      unitName: l.productUnit?.unitName ?? null,
    };
  });

  return rows.sort((a, b) => {
    if (a.isCentral !== b.isCentral) return a.isCentral ? -1 : 1;
    return a.label < b.label ? -1 : 1;
  });
}

// ------------------------------------------------------------
// Q14/Q15 — the substitution plan
// ------------------------------------------------------------

export type SubstitutionPlanRow = RecipeUsageRow & {
  /**
   * The quantity the screen may PREFILL, or `null` when it must be re-entered.
   *
   * Q15, and it is the whole reason this read exists rather than the form
   * guessing: พริกกะเหรี่ยง → พริกชี้ฟ้า is the same kind of thing in the same
   * unit, so 20 g stays 20 g. พริกกะเหรี่ยง → พริกกะเหรี่ยงผัดน้ำมัน is not —
   * the fried product has absorbed oil and lost water, so 20 g of it holds
   * nowhere near 20 g of chilli. Carrying the old number over gives a WRONG
   * DEFAULT THAT SOMEBODY CLICKS PAST, and every plate is wrong from that day
   * with nothing on screen looking wrong.
   *
   * Carrying it over with a highlight was rejected: a warning that does not
   * block is a warning that gets skipped, most reliably in the middle of
   * changing four recipes at once.
   */
  carryQty: Prisma.Decimal | null;
  /** The replacement's unit matching this line's, when one exists. */
  carryUnitId: string | null;
};

export type SubstitutionPlan = {
  fromProductId: string;
  fromLabel: string;
  toLabel: string;
  /** Recipes everyone follows. */
  central: SubstitutionPlanRow[];
  /** Recipes belonging to branches that decided for themselves (Q8). */
  branch: SubstitutionPlanRow[];
};

/**
 * What a substitution would touch, and where the quantity may carry over.
 *
 * The confirmation step this feeds is the same pattern as Part 19's import
 * preview and Q8's copy button: state what will be written, then write it.
 */
export async function getSubstitutionPlanLogic(
  tenantId: string,
  args: {
    fromProductId: string;
    toProductId?: string | null;
    toComponentMenuId?: string | null;
  }
): Promise<SubstitutionPlan> {
  return withTenantContext(tenantId, async (tx) => {
    const rows = await usageRows(tx, tenantId, {
      kind: "product",
      id: args.fromProductId,
    });

    const from = await tx.product.findFirst({
      where: { id: args.fromProductId, tenantId },
      select: { name: true, type: true },
    });

    // A MENU replacement never carries a quantity: a set-menu line counts dishes
    // ("1 steak") and the line being replaced counts a weight. There is no
    // conversion between them, only a person who has to say how many.
    if (args.toProductId == null) {
      const menu =
        args.toComponentMenuId == null
          ? null
          : await tx.menu.findFirst({
              where: { id: args.toComponentMenuId, tenantId },
              select: { name: true },
            });
      return group(rows.map((r) => ({ ...r, carryQty: null, carryUnitId: null })), {
        fromProductId: args.fromProductId,
        fromLabel: from?.name ?? args.fromProductId,
        toLabel: menu?.name ?? "",
      });
    }

    const to = await tx.product.findFirst({
      where: { id: args.toProductId, tenantId },
      select: { name: true, type: true, productUnits: { select: { id: true, unitName: true } } },
    });
    const unitIdByName = new Map(
      (to?.productUnits ?? []).map((u) => [u.unitName, u.id])
    );

    // Same kind of thing AND the same unit exists on the replacement → the
    // number means the same thing and may carry. Anything else must be retyped.
    const sameType = from !== null && to !== null && from.type === to.type;

    return group(
      rows.map((r) => {
        const carryUnitId =
          r.unitName === null ? undefined : unitIdByName.get(r.unitName);
        const canCarry = sameType && carryUnitId !== undefined;
        return {
          ...r,
          carryQty: canCarry ? r.qty : null,
          carryUnitId: canCarry ? (carryUnitId as string) : null,
        };
      }),
      {
        fromProductId: args.fromProductId,
        fromLabel: from?.name ?? args.fromProductId,
        toLabel: to?.name ?? args.toProductId,
      }
    );
  });
}

function group(
  rows: SubstitutionPlanRow[],
  head: Pick<SubstitutionPlan, "fromProductId" | "fromLabel" | "toLabel">
): SubstitutionPlan {
  return {
    ...head,
    central: rows.filter((r) => r.isCentral),
    branch: rows.filter((r) => !r.isCentral),
  };
}

// ------------------------------------------------------------
// Q17 — which recipes does this unit's ratio move?
// ------------------------------------------------------------

export type UnitRecipeUsageRow = {
  recipeId: string;
  label: string;
  isCentral: boolean;
  qty: Prisma.Decimal;
  productName: string;
};

/**
 * The recipes written in this unit — the guard ADR 0006 left open.
 *
 * A recipe stores what the person typed and the unit they typed it in; the
 * base-unit value is computed at read (Q17). That is right, and it has a
 * consequence: correcting a กระสอบ from 1 kg to 1.2 kg silently moves every
 * recipe that says กระสอบ. The instruction has not changed but the quantity it
 * denotes has.
 *
 * ⚠️ THIS READ EXISTS; NOTHING CALLS IT YET. It is deliberately a read and not a
 * block — refusing a ratio correction would force the data to stay wrong, which
 * is the same argument Q13 makes about RAW → PREPPED. The product form showing
 * it before saving is L5's, and it is listed there.
 */
export async function getRecipesUsingUnitLogic(
  tenantId: string,
  productUnitId: string
): Promise<UnitRecipeUsageRow[]> {
  return withTenantContext(tenantId, async (tx) => {
    const lines = await tx.recipeIngredient.findMany({
      where: {
        tenantId,
        productUnitId,
        recipe: { deletedAt: null, supersededAt: null },
      },
      select: {
        qty: true,
        product: { select: { name: true } },
        recipe: {
          select: {
            id: true,
            lineId: true,
            menu: { select: { name: true } },
            outputProduct: { select: { name: true } },
          },
        },
      },
    });
    if (lines.length === 0) return [];

    const links = await tx.recipeBranch.findMany({
      where: {
        tenantId,
        lineId: { in: [...new Set(lines.map((l) => l.recipe.lineId))] },
      },
      select: { lineId: true },
    });
    const linked = new Set(links.map((l) => l.lineId));

    return lines
      .map((l) => ({
        recipeId: l.recipe.id,
        label: l.recipe.menu?.name ?? l.recipe.outputProduct?.name ?? l.recipe.id,
        isCentral: !linked.has(l.recipe.lineId),
        qty: l.qty,
        productName: l.product?.name ?? "",
      }))
      .sort((a, b) => (a.label < b.label ? -1 : 1));
  });
}
