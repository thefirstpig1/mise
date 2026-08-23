// ============================================================
// Mise — the recipe reads (L3c, extended by L5a)
// ============================================================
// Two halves. The first answers "what would this change touch?" — a question a
// WRITE asks before it writes. The second (L5a, at the bottom of the file)
// answers "what is there?" — a question a SCREEN asks before it renders.
//
// The first half is three questions, and they are one query wearing three hats:
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
import { computeBangkokToday } from "@/lib/bangkok-date";
import { resolveRecipeIds, type RecipeTarget } from "@/server/recipe-resolve";
import { getRecipeCostsLogic, type RecipeCost } from "@/server/recipe-cost";
import type { RecipeWithIngredients } from "@/server/recipe";
import type {
  PreppedMethod,
  RecipeConfidence,
  RecipeUsageQuery,
} from "@/lib/validations/recipe";

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

// ============================================================
// The list-shaped reads (L5a) — "what is there?", not "what would this touch?"
// ============================================================
// The three reads above answer a question a WRITE asks before it writes. The
// three below answer a question a SCREEN asks before it renders, and they live
// here rather than in a file of their own because they obey the same hard rule
// `usageRows` does: central and branch recipes are grouped, never mixed.
//
// ⚠️ THEY DO NOT NEST `withTenantContext`. Each opens its own short transaction
// and then calls `getRecipeCostsLogic`, which opens its own. Nesting would hold
// two pooled connections for the length of the outer one, and a list page is
// exactly where a tenant with fifty menus would notice.
// ============================================================

/** A list page is a page, not an export — the same ceiling `/menus` uses. */
const MAX_RECIPE_LIST_ROWS = 500;

/** One row of `/recipes` — a dish, and whether anybody has written it down. */
export type RecipeListRow = {
  kind: "menu" | "product";
  /** The menu id or the output product id — what a "write a recipe" link needs. */
  targetId: string;
  name: string;
  /** Menu category, or the product's category. Null is common and fine. */
  categoryName: string | null;
  /** Menus only: a dish a POS file named that nobody has looked at yet. */
  isPosStub: boolean;
  /** PREPPED products only; `NONE` on every menu row. */
  preppedMethod: PreppedMethod;
  /** Null when no recipe applies at this branch on this day — Q10's "—". */
  recipeId: string | null;
  lineId: string | null;
  /**
   * True when the recipe that won is one THIS branch keeps for itself (Q8), so
   * the list can say สูตรสาขา rather than สูตรกลาง. A branch that never diverged
   * shows the central recipe and this stays false.
   */
  isBranchOwn: boolean;
  servings: Prisma.Decimal | null;
  /**
   * Baht for one serving at this branch on this day; null when there is no
   * recipe to cost.
   *
   * It NEVER travels without `confidence` — the rule the whole Part is arranged
   * around, and the reason this type carries both fields or neither.
   */
  costPerServing: Prisma.Decimal | null;
  confidence: RecipeConfidence | null;
  /** A broken graph names itself here instead of taking the page down. */
  problem: "CYCLE" | "TOO_DEEP" | null;
};

export type RecipeListResult = {
  /** The axis: every dish the shop sells, recipe or not. */
  menus: RecipeListRow[];
  /**
   * Q1's other kind of recipe. A PREPPED product is not a menu, so it cannot
   * appear on the menu axis, and without this it would have no screen at all.
   */
  prepped: RecipeListRow[];
  /** Menus with no recipe at this branch — the count beside the filter. */
  missingCount: number;
};

/**
 * Every menu, with recipe-or-not and what it costs, at ONE branch on ONE day.
 *
 * THE DISHES WITH NO RECIPE ARE THE POINT. A list of the recipes that exist
 * cannot show what is missing, and what is missing is the work; `missingOnly`
 * narrows to exactly that queue.
 *
 * ONE batched cost call for the whole page, never one per row — ADR 0014
 * Consequence 2, the rule `getRecipeCostLogic` keeps by being a wrapper over the
 * batch rather than a query of its own.
 */
export async function getRecipeListLogic(
  tenantId: string,
  query: {
    branchId: string;
    search?: string;
    missingOnly: boolean;
    asOf?: Date;
  }
): Promise<RecipeListResult> {
  const asOf = query.asOf ?? computeBangkokToday();
  const search = query.search;
  const insensitive = "insensitive" as const;

  const base = await withTenantContext(tenantId, async (tx) => {
    const [menus, prepped] = await Promise.all([
      tx.menu.findMany({
        where: {
          tenantId,
          deletedAt: null,
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: insensitive } },
                  { posMenuName: { contains: search, mode: insensitive } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          name: true,
          isPosStub: true,
          menuCategory: { select: { name: true } },
        },
        orderBy: [{ name: "asc" }],
        take: MAX_RECIPE_LIST_ROWS,
      }),
      tx.product.findMany({
        where: {
          tenantId,
          deletedAt: null,
          type: "PREPPED",
          ...(search ? { name: { contains: search, mode: insensitive } } : {}),
        },
        select: {
          id: true,
          name: true,
          parentProductId: true,
          yieldPercent: true,
          category: { select: { groupName: true } },
        },
        orderBy: [{ name: "asc" }],
        take: MAX_RECIPE_LIST_ROWS,
      }),
    ]);

    const targets: RecipeTarget[] = [
      ...menus.map((m) => ({ kind: "menu" as const, id: m.id })),
      ...prepped.map((p) => ({ kind: "product" as const, id: p.id })),
    ];
    const resolved = await resolveRecipeIds(
      tx,
      tenantId,
      targets,
      query.branchId,
      asOf
    );

    // Which of the winning lines belong to THIS branch — the difference between
    // สูตรกลาง and สูตรสาขา on screen, and it is one query, not one per row.
    const lineIds = [...new Set([...resolved.values()].map((r) => r.lineId))];
    const ownLinks =
      lineIds.length === 0
        ? []
        : await tx.recipeBranch.findMany({
            where: { tenantId, branchId: query.branchId, lineId: { in: lineIds } },
            select: { lineId: true },
          });

    return { menus, prepped, resolved, own: new Set(ownLinks.map((l) => l.lineId)) };
  });

  const recipeIds = [...base.resolved.values()].map((r) => r.id);
  const costs =
    recipeIds.length === 0
      ? new Map<string, RecipeCost>()
      : await getRecipeCostsLogic(tenantId, {
          recipeIds,
          branchId: query.branchId,
          asOf,
        });

  const row = (args: {
    kind: "menu" | "product";
    id: string;
    name: string;
    categoryName: string | null;
    isPosStub: boolean;
    preppedMethod: PreppedMethod;
  }): RecipeListRow => {
    const hit = base.resolved.get(`${args.kind}:${args.id}`);
    const cost = hit === undefined ? undefined : costs.get(hit.id);
    return {
      kind: args.kind,
      targetId: args.id,
      name: args.name,
      categoryName: args.categoryName,
      isPosStub: args.isPosStub,
      // A resolved recipe settles the question, whatever the columns say.
      preppedMethod: hit !== undefined ? "RECIPE" : args.preppedMethod,
      recipeId: hit?.id ?? null,
      lineId: hit?.lineId ?? null,
      isBranchOwn: hit !== undefined && base.own.has(hit.lineId),
      servings: hit?.servings ?? null,
      costPerServing: cost?.costPerServing ?? null,
      confidence: cost?.confidence ?? null,
      problem: cost?.problem ?? null,
    };
  };

  const menuRows = base.menus.map((m) =>
    row({
      kind: "menu",
      id: m.id,
      name: m.name,
      categoryName: m.menuCategory?.name ?? null,
      isPosStub: m.isPosStub,
      preppedMethod: "NONE",
    })
  );

  const preppedRows = base.prepped.map((p) =>
    row({
      kind: "product",
      id: p.id,
      name: p.name,
      categoryName: p.category?.groupName ?? null,
      isPosStub: false,
      // Q1: a parent WITH a yield is one method, a recipe is the other, and a
      // product holding half a parent cannot be saved — so these two columns are
      // enough to name the method when no recipe resolved.
      preppedMethod:
        p.parentProductId !== null && p.yieldPercent !== null
          ? "PARENT_YIELD"
          : "NONE",
    })
  );

  const missingCount = menuRows.filter((r) => r.recipeId === null).length;

  return {
    menus: query.missingOnly
      ? menuRows.filter((r) => r.recipeId === null)
      : menuRows,
    prepped: query.missingOnly
      ? preppedRows.filter((r) => r.preppedMethod === "NONE")
      : preppedRows,
    missingCount,
  };
}

// ------------------------------------------------------------
// Q9 — the same dish, branch by branch
// ------------------------------------------------------------

/** One recipe that some set of branches follows for one dish. */
export type RecipeBranchGroup = {
  recipeId: string;
  lineId: string;
  isCentral: boolean;
  /** Empty on the central group; sorted, and these branches DECIDED (Q8). */
  branchNames: string[];
  branchCount: number;
  effectiveFrom: Date;
  ingredientCount: number;
  servings: Prisma.Decimal;
  /**
   * Baht per serving — **priced at `pricedAtBranchName`, not at some tenant-wide
   * average**, because rule R4 says a recipe cost is as many numbers as there are
   * branches. A branch group is priced at one of its own branches; the central
   * group at a branch that actually follows it. The screen must print the branch
   * name beside the figure, or two numbers that differ only by their prices read
   * as two different recipes.
   */
  costPerServing: Prisma.Decimal | null;
  confidence: RecipeConfidence | null;
  problem: "CYCLE" | "TOO_DEEP" | null;
  pricedAtBranchId: string | null;
  pricedAtBranchName: string | null;
};

export type RecipeBranchComparison = {
  label: string;
  /** How many branches follow no recipe at all for this dish. */
  branchesWithNoRecipe: string[];
  /** Central first, then by branch count. */
  groups: RecipeBranchGroup[];
};

/**
 * Which branches follow which recipe for one dish, and what each one costs.
 *
 * ADR 0021 Q9, verbatim: GROUP BY RECIPE, COUNT THE BRANCHES. The alternative —
 * a row per branch — answers "which branches diverged?" only by making the
 * reader compare adjacent rows, and on a hundred-branch tenant that is a page of
 * identical lines hiding the two that differ.
 *
 * The costs are fetched one call PER DISTINCT BRANCH, not per group: two branch
 * recipes at two branches is two calls, and a tenant where every branch diverged
 * has already chosen that shape.
 */
export async function getRecipeBranchComparisonLogic(
  tenantId: string,
  args: { target: RecipeTarget; asOf?: Date }
): Promise<RecipeBranchComparison | null> {
  const asOf = args.asOf ?? computeBangkokToday();
  const { target } = args;

  const base = await withTenantContext(tenantId, async (tx) => {
    const label =
      target.kind === "menu"
        ? (await tx.menu.findFirst({
            where: { id: target.id, tenantId, deletedAt: null },
            select: { name: true },
          }))?.name
        : (await tx.product.findFirst({
            where: { id: target.id, tenantId, deletedAt: null },
            select: { name: true },
          }))?.name;
    if (label === undefined) return null;

    // Superseded versions are excluded at every date (a superseded version means
    // "this version was wrong"); a merely-past one is not, and the newest version
    // effective on `asOf` is the one each line is showing.
    const candidates = await tx.recipe.findMany({
      where: {
        tenantId,
        deletedAt: null,
        supersededAt: null,
        effectiveFrom: { lte: asOf },
        ...(target.kind === "menu"
          ? { menuId: target.id }
          : { outputProductId: target.id }),
      },
      select: {
        id: true,
        lineId: true,
        servings: true,
        effectiveFrom: true,
        createdAt: true,
        _count: { select: { ingredients: true } },
      },
    });
    if (candidates.length === 0) return null;

    const branches = await tx.branch.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    const links = await tx.recipeBranch.findMany({
      where: { tenantId, lineId: { in: candidates.map((c) => c.lineId) } },
      select: { lineId: true, branchId: true, branch: { select: { name: true } } },
    });

    return { label, candidates, branches, links };
  });

  if (base === null) return null;
  const { label, candidates, branches, links } = base;

  // One winner per line: the newest version effective on `asOf`, the same total
  // ordering `resolveRecipeIds` uses so a comparison cannot disagree with the
  // list it was opened from.
  const winners = new Map<string, (typeof candidates)[number]>();
  for (const c of candidates) {
    const held = winners.get(c.lineId);
    if (
      held === undefined ||
      c.effectiveFrom > held.effectiveFrom ||
      (c.effectiveFrom.getTime() === held.effectiveFrom.getTime() &&
        c.createdAt > held.createdAt)
    ) {
      winners.set(c.lineId, c);
    }
  }

  const branchesByLine = new Map<string, { id: string; name: string }[]>();
  for (const l of links) {
    const list = branchesByLine.get(l.lineId);
    const entry = { id: l.branchId, name: l.branch.name };
    if (list === undefined) branchesByLine.set(l.lineId, [entry]);
    else list.push(entry);
  }
  const divergedBranchIds = new Set(links.map((l) => l.branchId));

  // A branch that follows the central recipe is any branch that did not decide
  // for itself; the central group is priced at the first of them. When EVERY
  // branch diverged the central recipe still exists but nobody follows it, so it
  // is priced nowhere and the screen says so rather than inventing a branch.
  const followsCentral = branches.filter((b) => !divergedBranchIds.has(b.id));

  const draft = [...winners.values()].map((w) => {
    const own = (branchesByLine.get(w.lineId) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name, "th")
    );
    const isCentral = own.length === 0;
    const pricedAt = isCentral ? (followsCentral[0] ?? null) : own[0];
    return { w, own, isCentral, pricedAt };
  });

  // Group the roots by the branch they will be priced at, then one batched call
  // per branch.
  const byBranch = new Map<string, string[]>();
  for (const d of draft) {
    if (d.pricedAt === null) continue;
    const list = byBranch.get(d.pricedAt.id);
    if (list === undefined) byBranch.set(d.pricedAt.id, [d.w.id]);
    else list.push(d.w.id);
  }
  const costs = new Map<string, RecipeCost>();
  for (const [branchId, recipeIds] of byBranch) {
    const batch = await getRecipeCostsLogic(tenantId, { recipeIds, branchId, asOf });
    for (const [id, c] of batch) costs.set(id, c);
  }

  const groups: RecipeBranchGroup[] = draft.map((d) => {
    const cost = costs.get(d.w.id);
    return {
      recipeId: d.w.id,
      lineId: d.w.lineId,
      isCentral: d.isCentral,
      branchNames: d.own.map((b) => b.name),
      branchCount: d.isCentral ? followsCentral.length : d.own.length,
      effectiveFrom: d.w.effectiveFrom,
      ingredientCount: d.w._count.ingredients,
      servings: d.w.servings,
      costPerServing: cost?.costPerServing ?? null,
      confidence: cost?.confidence ?? null,
      problem: cost?.problem ?? null,
      pricedAtBranchId: d.pricedAt?.id ?? null,
      pricedAtBranchName: d.pricedAt?.name ?? null,
    };
  });

  groups.sort((a, b) => {
    if (a.isCentral !== b.isCentral) return a.isCentral ? -1 : 1;
    if (a.branchCount !== b.branchCount) return b.branchCount - a.branchCount;
    return (a.branchNames[0] ?? "").localeCompare(b.branchNames[0] ?? "", "th");
  });

  // A branch follows nothing only when there IS no central recipe — otherwise
  // central covers it. Naming those branches is the honest answer to "why does
  // this dish cost nothing at อโศก".
  const hasCentral = groups.some((g) => g.isCentral);
  const branchesWithNoRecipe = hasCentral
    ? []
    : followsCentral.map((b) => b.name);

  return { label, branchesWithNoRecipe, groups };
}

// ------------------------------------------------------------
// The history of one line (rule R8)
// ------------------------------------------------------------

export type RecipeVersionRow = {
  recipeId: string;
  effectiveFrom: Date;
  createdAt: Date;
  ingredientCount: number;
  servings: Prisma.Decimal;
  notes: string | null;
  /**
   * A version somebody replaced because it was WRONG, not because the dish
   * changed. It governs no day at all — which is why it is shown struck through
   * rather than hidden: a reader who remembers typing it needs to see where it
   * went.
   */
  isSuperseded: boolean;
  /** True for the version in force on `asOf` — one row per line, or none. */
  isCurrent: boolean;
};

/**
 * Every version of one recipe line, newest first.
 *
 * THIS IS THE ONLY SCREEN THAT SHOWS `effectiveFrom` (rule R8). On a current
 * recipe page the date changes no answer — "มีผลตั้งแต่ 15 พ.ย. 2569" still
 * sitting there in 2575 tells a reader nothing they can act on. Here it is the
 * whole content: it says which days each writing of the dish governs, and Part
 * 22 posts each past day against exactly that.
 */
export async function getRecipeHistoryLogic(
  tenantId: string,
  lineId: string,
  asOf?: Date
): Promise<RecipeVersionRow[]> {
  const day = asOf ?? computeBangkokToday();

  return withTenantContext(tenantId, async (tx) => {
    const versions = await tx.recipe.findMany({
      where: { tenantId, lineId, deletedAt: null },
      select: {
        id: true,
        effectiveFrom: true,
        createdAt: true,
        servings: true,
        notes: true,
        supersededAt: true,
        _count: { select: { ingredients: true } },
      },
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    });
    if (versions.length === 0) return [];

    const currentId = versions.find(
      (v) => v.supersededAt === null && v.effectiveFrom <= day
    )?.id;

    return versions.map((v) => ({
      recipeId: v.id,
      effectiveFrom: v.effectiveFrom,
      createdAt: v.createdAt,
      ingredientCount: v._count.ingredients,
      servings: v.servings,
      notes: v.notes,
      isSuperseded: v.supersededAt !== null,
      isCurrent: v.id === currentId,
    }));
  });
}

/**
 * One recipe version, by its id, with what it is made of and what it makes.
 *
 * The page addresses a VERSION, not a line: `/recipes/<id>` opened from a
 * history row has to render the version that row names, and resolving it back to
 * "whatever is current" would quietly answer a different question. Which version
 * governs today is `isCurrent` on the history rows, and the page says so.
 */
export async function getRecipeByIdLogic(
  tenantId: string,
  recipeId: string
): Promise<
  | (RecipeWithIngredients & {
      targetName: string;
      targetKind: "menu" | "product";
      isSuperseded: boolean;
      /** The branches that follow THIS line — empty on a central recipe. */
      branchNames: string[];
    })
  | null
> {
  return withTenantContext(tenantId, async (tx) => {
    const recipe = await tx.recipe.findFirst({
      where: { id: recipeId, tenantId, deletedAt: null },
      include: {
        ingredients: true,
        menu: { select: { name: true } },
        outputProduct: { select: { name: true } },
      },
    });
    if (recipe === null) return null;

    const links = await tx.recipeBranch.findMany({
      where: { tenantId, lineId: recipe.lineId },
      select: { branch: { select: { name: true } } },
    });

    const { menu, outputProduct, ...rest } = recipe;
    return {
      ...rest,
      targetName: menu?.name ?? outputProduct?.name ?? recipe.id,
      targetKind: recipe.menuId !== null ? ("menu" as const) : ("product" as const),
      isSuperseded: recipe.supersededAt !== null,
      branchNames: links.map((l) => l.branch.name).sort(),
    };
  });
}
