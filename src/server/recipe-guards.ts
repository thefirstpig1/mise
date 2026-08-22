// ============================================================
// Mise — recipe write guards (Sprint 5 Part 21 L3a, ADR 0021)
// ============================================================
// The conditions no CHECK constraint can express, because every one of them
// spans more than one table:
//
//   * Q1 — a PREPPED product is made by `parentProductId` + `yieldPercent` OR by
//     a production recipe, NEVER both. The two halves live in `product` and
//     `recipe`, so the invariant lives here.
//   * Q3/Q13 — no cycle, and no chain longer than Decision #58's five nodes,
//     counted over products AND menus in one budget.
//   * Q13 — a product still used by a recipe cannot be deleted, and the refusal
//     has to NAME the recipes.
//
// WHY ITS OWN FILE. `product.ts` needs the type-change and delete guards; this
// file needs nothing from `product.ts`. Putting them in `recipe.ts` — which does
// import `product.ts` for `assertRefBelongsToTenant` — would make the two files
// import each other. Keeping the guards free of `product.ts` breaks the cycle by
// construction rather than by hoping ESM hoisting saves us.
//
// ⚠️ THE GRAPH GUARD RUNS AFTER THE WRITE, INSIDE THE TRANSACTION. A recipe that
// does not exist yet cannot be walked, so `createRecipeLogic` writes the rows,
// walks the graph, and lets the throw roll the write back. `withTenantContext`
// is a real `$transaction`, so nothing survives the refusal.
// ============================================================

import type { PrismaClient } from "@prisma/client";
import { computeBangkokToday } from "@/lib/bangkok-date";
import {
  MAX_RECIPE_DEPTH,
  assertGraphValid,
  menuKey,
  productKey,
} from "@/server/recipe-graph";
import {
  loadRecipeGraph,
  resolveRecipeIds,
  type RecipeTarget,
} from "@/server/recipe-resolve";

// ------------------------------------------------------------
// Typed errors
// ------------------------------------------------------------

/**
 * Q1, both directions: a PREPPED product that names a parent while a production
 * recipe outputs it, or a production recipe written for a product that is
 * already made by a parent and a yield.
 *
 * The two notations are not rivals but two ways of writing one fact (a recipe of
 * 300 g in → 250 g out IS a yield of 83.3%), and keeping both would leave the
 * walker choosing between them — a choice nobody made and nothing on screen
 * would show.
 */
export class RecipeMethodConflictError extends Error {
  constructor(
    public readonly productId: string,
    public readonly productName: string
  ) {
    super(
      `Product "${productName}" (${productId}) is already made by a parent and a yield; it cannot also have a production recipe`
    );
    this.name = "RecipeMethodConflictError";
  }
}

/** A production recipe outputs something that is not PREPPED (Q1/Q2). */
export class RecipeOutputNotPreppedError extends Error {
  constructor(
    public readonly productId: string,
    public readonly productName: string
  ) {
    super(
      `Product "${productName}" (${productId}) is not PREPPED, so no recipe can produce it`
    );
    this.name = "RecipeOutputNotPreppedError";
  }
}

/**
 * Q13, the half that is refused outright: turning a PREPPED product into a RAW
 * one while a production recipe still outputs it would leave a recipe producing
 * a raw material.
 */
export class ProductTypeChangeBlockedError extends Error {
  constructor(
    public readonly productId: string,
    public readonly recipeNames: string[]
  ) {
    super(
      `Product ${productId} cannot become RAW: it is produced by ${recipeNames.length} recipe(s): ${recipeNames.join(", ")}`
    );
    this.name = "ProductTypeChangeBlockedError";
  }
}

/**
 * Q13's delete block, mirroring ADR 0007's block on deleting a product with live
 * children. The names are carried because a refusal that does not say WHICH
 * recipes is a dead end for whoever has to act on it.
 */
export class ProductUsedInRecipeError extends Error {
  constructor(
    public readonly productId: string,
    public readonly recipeNames: string[]
  ) {
    super(
      `Product ${productId} is used by ${recipeNames.length} recipe(s): ${recipeNames.join(", ")}`
    );
    this.name = "ProductUsedInRecipeError";
  }
}

/** Q3's mirror of the above for a menu that is a component of a set menu. */
export class MenuUsedInRecipeError extends Error {
  constructor(
    public readonly menuId: string,
    public readonly recipeNames: string[]
  ) {
    super(
      `Menu ${menuId} is a component of ${recipeNames.length} recipe(s): ${recipeNames.join(", ")}`
    );
    this.name = "MenuUsedInRecipeError";
  }
}

// ------------------------------------------------------------
// Which graphs a write has to be valid in
// ------------------------------------------------------------

/**
 * A branch that has decided nothing, used to probe the CENTRAL resolution.
 *
 * `resolveRecipeIds` only ever asks whether a branch id appears in
 * `recipe_branch`, so any id that cannot appear there answers the question "what
 * does a branch which has never copied see?". The nil UUID is that id: uuid v4
 * never generates it, so no real branch can collide with it.
 */
export const CENTRAL_PROBE_BRANCH_ID = "00000000-0000-0000-0000-000000000000";

/**
 * The (branch, day) pairs a write must be valid in — and the bound on how many.
 *
 * The naive answer, "every branch", costs four queries per level per branch and
 * is unaffordable for a chain of shops. The cheap answer, "just central", is
 * wrong: Q8 lets สาขาอโศก keep its own สเต็ก recipe, so a cycle can exist there
 * and nowhere else.
 *
 * The answer that is both: **a branch with no `recipe_branch` row at all
 * resolves EVERY node to central**, so one central probe covers all of them
 * exactly. Only branches that have diverged for something can see a different
 * graph, so only they need their own pass. A shop that has never pressed the
 * copy button pays for one probe; a chain with five mall branches pays for six.
 *
 * ON DATES — two are needed and two are enough. `effectiveFrom` is when this
 * version starts applying. Today is checked as well because a version written
 * earlier may carry a LATER effective date than the one being written now, and
 * on that later day the graph differs. Nothing beyond today needs checking,
 * because future-dating is refused at L2, so no version can start applying on a
 * day that has not happened yet.
 */
export async function probeContexts(
  tx: PrismaClient,
  tenantId: string,
  effectiveFrom: Date
): Promise<{ branchId: string; asOf: Date }[]> {
  const diverged = await tx.recipeBranch.findMany({
    where: { tenantId },
    select: { branchId: true },
    distinct: ["branchId"],
  });

  const branchIds = [CENTRAL_PROBE_BRANCH_ID, ...diverged.map((d) => d.branchId)];

  // A UTC-midnight day value, so it compares like the `@db.Date` column it is
  // matched against — `new Date()` would carry a time component and quietly
  // include a version that only starts applying later today.
  const today = computeBangkokToday();
  const dates =
    effectiveFrom.getTime() >= today.getTime()
      ? [effectiveFrom]
      : [effectiveFrom, today];

  return branchIds.flatMap((branchId) => dates.map((asOf) => ({ branchId, asOf })));
}

// ------------------------------------------------------------
// The cycle + depth guard
// ------------------------------------------------------------

const rootKey = (t: RecipeTarget) =>
  t.kind === "menu" ? menuKey(t.id) : productKey(t.id);

const targetKey = (t: RecipeTarget) => `${t.kind}:${t.id}`;

/**
 * Refuse a cycle, and refuse a chain longer than Decision #58's five nodes — in
 * every graph this write can be seen through (see `probeContexts`).
 *
 * BOTH DIRECTIONS ARE WALKED. Downward is the obvious half: what does this thing
 * expand into. Upward is the half that is easy to forget and just as fatal —
 * adding a level under a prepped product that is itself an ingredient of a set
 * menu can push the SET over the cap, and the first anyone would hear of it is a
 * cost page throwing on a dish nobody just edited. `assertParentValid` in
 * `product.ts` takes exactly the same two-sided shape, and for the same reason.
 *
 * Throws `RecipeCycleError` / `RecipeDepthExceededError` from `recipe-graph.ts`,
 * both of which carry the offending PATH, so the refusal can name the dishes
 * rather than only saying "ลึกเกินไป".
 */
export async function assertRecipeGraphValid(
  tx: PrismaClient,
  tenantId: string,
  target: RecipeTarget,
  effectiveFrom: Date
): Promise<void> {
  const contexts = await probeContexts(tx, tenantId, effectiveFrom);

  for (const { branchId, asOf } of contexts) {
    const graph = await loadRecipeGraph(tx, tenantId, [target], branchId, asOf);
    const above = await ancestorDepth(tx, tenantId, target, branchId, asOf);
    assertGraphValid(graph, rootKey(target), above);
  }
}

/**
 * How many nodes sit ABOVE `target` in the graph resolved for one branch on one
 * day. A thing nothing uses answers 0.
 *
 * Level by level and batched, never node by node, for the reason ADR 0014
 * Consequence 2 gives: 200 round trips to Neon Singapore is 6 to 16 seconds. The
 * walk stops once it has counted past the cap — beyond that the exact number
 * changes nothing, the write is refused either way — which also makes an
 * already-cyclic database terminate here instead of looping.
 */
export async function ancestorDepth(
  tx: PrismaClient,
  tenantId: string,
  target: RecipeTarget,
  branchId: string,
  asOf: Date
): Promise<number> {
  const seen = new Set<string>([targetKey(target)]);
  let frontier: RecipeTarget[] = [target];
  let depth = 0;

  while (frontier.length > 0 && depth <= MAX_RECIPE_DEPTH) {
    const users = await usersOf(tx, tenantId, frontier, branchId, asOf);
    const fresh = users.filter((u) => !seen.has(targetKey(u)));
    if (fresh.length === 0) break;
    for (const u of fresh) seen.add(targetKey(u));
    depth += 1;
    frontier = fresh;
  }

  return depth;
}

/**
 * The things that expand INTO any of `nodes`, in the graph resolved for this
 * branch and day. Two kinds of edge point downward, so two kinds are reversed:
 *
 *   1. an ingredient line — but only where the recipe holding it is the one that
 *      actually APPLIES here. A branch that keeps its own กะเพราหมู is not
 *      reached through the central version's ingredient list.
 *   2. a PREPPED product's `parentProductId`, and only where that product has no
 *      production recipe — `edgesOf` lets a production recipe win when both are
 *      somehow present, so the reverse walk has to agree with it exactly or the
 *      two disagree about what the graph is.
 */
async function usersOf(
  tx: PrismaClient,
  tenantId: string,
  nodes: RecipeTarget[],
  branchId: string,
  asOf: Date
): Promise<RecipeTarget[]> {
  const productIds = nodes.filter((n) => n.kind === "product").map((n) => n.id);
  const menuIds = nodes.filter((n) => n.kind === "menu").map((n) => n.id);

  const out: RecipeTarget[] = [];

  // --- 1. ingredient lines pointing at these nodes ---
  const lines = await tx.recipeIngredient.findMany({
    where: {
      tenantId,
      OR: [
        ...(productIds.length > 0 ? [{ productId: { in: productIds } }] : []),
        ...(menuIds.length > 0 ? [{ componentMenuId: { in: menuIds } }] : []),
      ],
      recipe: { deletedAt: null, supersededAt: null },
    },
    select: {
      recipeId: true,
      recipe: { select: { menuId: true, outputProductId: true } },
    },
  });

  if (lines.length > 0) {
    const holders: RecipeTarget[] = [];
    const recipeIdsByTarget = new Map<string, Set<string>>();
    for (const l of lines) {
      const t: RecipeTarget =
        l.recipe.menuId !== null
          ? { kind: "menu", id: l.recipe.menuId }
          : { kind: "product", id: l.recipe.outputProductId as string };
      const k = targetKey(t);
      const set = recipeIdsByTarget.get(k);
      if (set === undefined) {
        recipeIdsByTarget.set(k, new Set([l.recipeId]));
        holders.push(t);
      } else {
        set.add(l.recipeId);
      }
    }

    // Only an edge if the version holding the line is the one that applies here.
    const applies = await resolveRecipeIds(tx, tenantId, holders, branchId, asOf);
    for (const h of holders) {
      const k = targetKey(h);
      const winner = applies.get(k);
      if (winner !== undefined && recipeIdsByTarget.get(k)?.has(winner.id)) {
        out.push(h);
      }
    }
  }

  // --- 2. PREPPED children whose parent is one of these products ---
  if (productIds.length > 0) {
    const children = await tx.product.findMany({
      where: {
        tenantId,
        deletedAt: null,
        type: "PREPPED",
        parentProductId: { in: productIds },
      },
      select: { id: true },
    });

    if (children.length > 0) {
      const asTargets: RecipeTarget[] = children.map((c) => ({
        kind: "product" as const,
        id: c.id,
      }));
      const produced = await resolveRecipeIds(
        tx,
        tenantId,
        asTargets,
        branchId,
        asOf
      );
      for (const t of asTargets) {
        // A production recipe wins over the parent link, so a child that has one
        // does not reach its parent at all and is not an ancestor of it.
        if (!produced.has(targetKey(t))) out.push(t);
      }
    }
  }

  return dedupe(out);
}

function dedupe(targets: RecipeTarget[]): RecipeTarget[] {
  const seen = new Set<string>();
  const out: RecipeTarget[] = [];
  for (const t of targets) {
    const k = targetKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

// ------------------------------------------------------------
// Q1 — one method, never two
// ------------------------------------------------------------

/**
 * Guard the production-recipe half of Q1: the output must be PREPPED, and it
 * must not already be made by a parent and a yield.
 *
 * A missing product is a no-op here — the caller runs the cross-tenant guard
 * first, and duplicating its refusal would give the same mistake two different
 * messages depending on which check happened to fire.
 */
export async function assertMethodExclusivityForRecipe(
  tx: PrismaClient,
  tenantId: string,
  outputProductId: string
): Promise<void> {
  const product = await tx.product.findFirst({
    where: { id: outputProductId, tenantId, deletedAt: null },
    select: { id: true, name: true, type: true, parentProductId: true },
  });
  if (product === null) return;

  if (product.type !== "PREPPED") {
    throw new RecipeOutputNotPreppedError(product.id, product.name);
  }
  if (product.parentProductId !== null) {
    throw new RecipeMethodConflictError(product.id, product.name);
  }
}

/**
 * The same invariant approached from the product side: setting a parent on a
 * PREPPED product that a production recipe already outputs.
 *
 * Refused rather than resolved, because both notations are meaningful and
 * choosing one silently would leave the other on the row with nothing reading
 * it — `SYSTEM_INITIAL`'s sin inverted, and a future maintainer believes it
 * either way.
 */
export async function assertNoProductionRecipeFor(
  tx: PrismaClient,
  tenantId: string,
  productId: string,
  productName: string
): Promise<void> {
  const recipe = await tx.recipe.findFirst({
    where: {
      tenantId,
      outputProductId: productId,
      deletedAt: null,
      supersededAt: null,
    },
    select: { id: true },
  });
  if (recipe !== null) {
    throw new RecipeMethodConflictError(productId, productName);
  }
}

// ------------------------------------------------------------
// The reverse lookup (Q13's delete refusal, Q14's substitution screen)
// ------------------------------------------------------------

export type RecipeUsage = {
  recipeId: string;
  lineId: string;
  /** What the recipe MAKES — a recipe has no name of its own (Q10). */
  label: string;
  /** Empty on a central line; the branch names otherwise (Q8). */
  branchNames: string[];
};

/**
 * Which live recipes use this thing, named by what they make.
 *
 * SUPERSEDED VERSIONS ARE EXCLUDED and past ones are NOT. A superseded version
 * means "this version was wrong" and is unreachable at every date, so it cannot
 * block anything; a version that merely has a newer sibling still governs the
 * days it covered, and Part 22 will post consumption against exactly those days.
 */
export async function recipesUsing(
  tx: PrismaClient,
  tenantId: string,
  target: RecipeTarget
): Promise<RecipeUsage[]> {
  const lines = await tx.recipeIngredient.findMany({
    where: {
      tenantId,
      ...(target.kind === "product"
        ? { productId: target.id }
        : { componentMenuId: target.id }),
      recipe: { deletedAt: null, supersededAt: null },
    },
    select: {
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

  const lineIds = [...new Set(lines.map((l) => l.recipe.lineId))];
  const links = await tx.recipeBranch.findMany({
    where: { tenantId, lineId: { in: lineIds } },
    select: { lineId: true, branch: { select: { name: true } } },
  });
  const branchesByLine = new Map<string, string[]>();
  for (const l of links) {
    const names = branchesByLine.get(l.lineId);
    if (names === undefined) branchesByLine.set(l.lineId, [l.branch.name]);
    else names.push(l.branch.name);
  }

  const byRecipe = new Map<string, RecipeUsage>();
  for (const l of lines) {
    const r = l.recipe;
    if (byRecipe.has(r.id)) continue;
    byRecipe.set(r.id, {
      recipeId: r.id,
      lineId: r.lineId,
      label: r.menu?.name ?? r.outputProduct?.name ?? r.id,
      branchNames: branchesByLine.get(r.lineId) ?? [],
    });
  }

  return [...byRecipe.values()].sort((a, b) => (a.label < b.label ? -1 : 1));
}

/**
 * Q13's delete refusal. Called from `deleteProductLogic`, and the message names
 * the recipes because "cannot delete" on its own leaves the user hunting.
 *
 * Both roles count: the product may be an INGREDIENT of a recipe, or the OUTPUT
 * of a production recipe. Deleting it in either case leaves a recipe pointing at
 * a product no screen will show.
 */
export async function assertProductNotUsedInRecipes(
  tx: PrismaClient,
  tenantId: string,
  productId: string
): Promise<void> {
  const [ingredientOf, producedBy] = await Promise.all([
    recipesUsing(tx, tenantId, { kind: "product", id: productId }),
    tx.recipe.findMany({
      where: {
        tenantId,
        outputProductId: productId,
        deletedAt: null,
        supersededAt: null,
      },
      select: { outputProduct: { select: { name: true } } },
    }),
  ]);

  const names = [
    ...ingredientOf.map((u) => u.label),
    ...producedBy.map((r) => r.outputProduct?.name ?? productId),
  ];
  if (names.length > 0) {
    throw new ProductUsedInRecipeError(productId, [...new Set(names)]);
  }
}

/**
 * Q3's mirror: a menu that is a component of a set menu cannot be deleted.
 *
 * ⚠️ NOT WIRED YET, because no delete path for a menu exists — Part 19 gave
 * menus a `deletedAt` column and no way to set it. Exported now because the
 * reverse lookup it needs is here and correct, and because Part 22 or the Menu
 * Lab adding a delete button must not have to rediscover that the guard is owed.
 */
export async function assertMenuNotUsedInRecipes(
  tx: PrismaClient,
  tenantId: string,
  menuId: string
): Promise<void> {
  const usages = await recipesUsing(tx, tenantId, { kind: "menu", id: menuId });
  if (usages.length > 0) {
    throw new MenuUsedInRecipeError(menuId, [
      ...new Set(usages.map((u) => u.label)),
    ]);
  }
}

// ------------------------------------------------------------
// Q13 — changing a product's type
// ------------------------------------------------------------

/**
 * CONTEXT.md has owed this since Sprint 1: *"once procurement / recipe / stock
 * start consuming `type`, add a write-time guard on changing it."* Two changes
 * now break something real.
 *
 * **PREPPED → RAW while a production recipe outputs it** — refused outright, and
 * that is this function. The recipe would produce a raw material, which is a
 * contradiction rather than a number to recompute.
 *
 * **RAW → PREPPED while recipes use it** — allowed, and rechecked afterwards by
 * `assertUsersStillWithinDepth`. Blocking it was rejected in the grill: a RAW
 * used in twenty recipes that turns out to need trimming SHOULD become PREPPED —
 * that makes all twenty more accurate — and forbidding it forces the data to
 * stay wrong.
 */
export async function assertTypeChangeAllowed(
  tx: PrismaClient,
  tenantId: string,
  productId: string,
  fromType: string,
  toType: string
): Promise<void> {
  if (fromType === toType) return;

  if (fromType === "PREPPED" && toType === "RAW") {
    const produced = await tx.recipe.findMany({
      where: {
        tenantId,
        outputProductId: productId,
        deletedAt: null,
        supersededAt: null,
      },
      select: { outputProduct: { select: { name: true } } },
    });
    if (produced.length > 0) {
      throw new ProductTypeChangeBlockedError(productId, [
        ...new Set(produced.map((r) => r.outputProduct?.name ?? productId)),
      ]);
    }
  }
}

/**
 * The RAW → PREPPED half, run AFTER the product row has been written so the walk
 * sees the new shape. Every recipe that uses this product gains a level, and the
 * first chain that overflows carries its own path in the error.
 *
 * The date is today rather than a version date: a type change is not dated, it
 * takes effect the moment it is saved.
 */
export async function assertUsersStillWithinDepth(
  tx: PrismaClient,
  tenantId: string,
  productId: string
): Promise<void> {
  const usages = await recipesUsing(tx, tenantId, {
    kind: "product",
    id: productId,
  });
  if (usages.length === 0) return;

  const holders = await tx.recipe.findMany({
    where: { id: { in: usages.map((u) => u.recipeId) } },
    select: { menuId: true, outputProductId: true },
  });

  const seen = new Set<string>();
  const today = computeBangkokToday();
  for (const h of holders) {
    const target: RecipeTarget =
      h.menuId !== null
        ? { kind: "menu", id: h.menuId }
        : { kind: "product", id: h.outputProductId as string };
    const k = targetKey(target);
    if (seen.has(k)) continue;
    seen.add(k);
    await assertRecipeGraphValid(tx, tenantId, target, today);
  }
}

/** Re-exported so a caller needs one import for the guards and their failures. */
export {
  MAX_RECIPE_DEPTH,
  RecipeCycleError,
  RecipeDepthExceededError,
} from "@/server/recipe-graph";
