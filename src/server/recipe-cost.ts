// ============================================================
// Mise — what a recipe costs (Sprint 5 Part 21 L3b, ADR 0021)
// ============================================================
// Two engines meet here and neither is re-implemented.
//
//   `recipe-graph.ts` answers WHAT A RECIPE CONSUMES, in raw products.
//   `stock-cost.ts`   answers WHAT A RAW PRODUCT COSTS at this branch, by
//                     replaying the ledger (ADR 0014).
//
// This file multiplies the two together, and its whole job is to do that without
// (a) storing the answer or (b) asking the database once per ingredient.
//
// **NOTHING IS STORED** (Q7). H.9's `recipe_cost_snapshot` dissolves: a receipt
// keyed three weeks late changes what a past day cost and fires no event, so the
// snapshot would be falsified with nothing able to detect it — the same
// falsification that killed `cost_layer` and `product_cost_history` one layer
// down. Every read walks the recipe and replays the ledger fresh.
//
// **THE BATCH IS THE PRIMITIVE.** A list of fifty menus resolves once, loads ONE
// graph covering all of them, walks it in memory, and prices every leaf of every
// recipe in ONE batched `replayPairsInTx` — four round trips no matter how many
// products come back. `getRecipeCostLogic` is a thin wrapper over the batch, so
// there is no cheap-looking single-recipe call for a loop to reach for. That is
// ADR 0014 Consequence 2's rule, applied one level up.
//
// **THE WALK IS SHARED, WHICH IS Q7's MEMO.** The same prepped product appears
// in many recipes; loading one graph for all roots means it is loaded once and
// walked from a map. Nothing can change mid-request, so the memo cannot be
// wrong, and it is discarded before anything can go stale.
//
// **A ZERO IS NOT AN ANSWER.** Every place a cost is unknown says so and drags
// the whole recipe to LOW (Q6) — including the case the walker cannot express on
// its own: a component menu with no recipe, which contributes nothing to the set
// that holds it and would otherwise make the set look cheap.
// ============================================================

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { computeBangkokToday } from "@/lib/bangkok-date";
import {
  RecipeCycleError,
  RecipeDepthExceededError,
  explodeToRaw,
  menuKey,
  productKey,
  reachable,
  type NodeKey,
  type RecipeGraph,
} from "@/server/recipe-graph";
import {
  loadRecipeGraph,
  type RecipeTarget,
  type ResolvedRecipeRow,
} from "@/server/recipe-resolve";
import { costKeyOf, replayPairsInTx, type ProductCost } from "@/server/stock-cost";
import type { CostSource } from "@/lib/validations/stock-cost";
import {
  type RecipeConfidence,
  type RecipeCostQuery,
} from "@/lib/validations/recipe";

export type { RecipeConfidence };

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

/**
 * Money is kept at FULL PRECISION here and rounded by the serializer (L4).
 *
 * A recipe cost is a computation, not a document: nothing is written, nothing is
 * reconciled against it, and rounding each ingredient to the satang before
 * summing would erase a pinch of salt that legitimately costs 0.003 ฿ a plate
 * and then lose it again across two hundred plates. Rounding happens once, where
 * the number becomes text.
 */
const RECIPE_COST_SCALE = 6;
const trim = (d: Prisma.Decimal) => d.toDecimalPlaces(RECIPE_COST_SCALE);

// ------------------------------------------------------------
// Confidence (Q6)
// ------------------------------------------------------------

/**
 * One ingredient's cost source, read as confidence.
 *
 * `DECLARED` and `LAST_KNOWN` are both MEDIUM and for the same reason: each is a
 * real number about real goods that is not the price of the goods in the pot —
 * one is a person's estimate, the other a purchase that has since been used up.
 * Neither is a guess, and neither is the front layer.
 */
const CONFIDENCE_BY_COST_SOURCE: Record<CostSource, RecipeConfidence> = {
  FRONT_LAYER: "HIGH",
  DECLARED: "MEDIUM",
  LAST_KNOWN: "MEDIUM",
  UNPRICED: "LOW",
};

const CONFIDENCE_RANK: Record<RecipeConfidence, number> = {
  HIGH: 2,
  MEDIUM: 1,
  LOW: 0,
};

/**
 * The FLOOR, never an average (Q6).
 *
 * Weighting confidence by each ingredient's share of cost reads as the
 * reasonable answer and is self-defeating: an ingredient with no known price is
 * valued at 0, therefore carries 0 weight, therefore the less we know about
 * something the less the system thinks it matters. The logic inverts exactly
 * where it needs to hold.
 */
const weakest = (a: RecipeConfidence, b: RecipeConfidence): RecipeConfidence =>
  CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;

// ------------------------------------------------------------
// The result
// ------------------------------------------------------------

/** One RAW product that ONE WRITING of the recipe consumes, priced. */
export type RecipeCostLeaf = {
  productId: string;
  productName: string;
  /**
   * Base units consumed by one whole writing of the recipe, after every yield
   * division below it (rule R2's second half). Batch scale rather than per
   * serving so the quantity is the one the person wrote, unrounded by a division
   * the money can do more precisely.
   */
  qty: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  cost: Prisma.Decimal;
  costSource: CostSource;
};

/**
 * One ingredient AS WRITTEN — the row the screen lists, with what it contributes
 * to one writing of the recipe. Its cost is the whole subtree beneath it, so a
 * line naming a prepped product carries what that product's own recipe costs.
 */
export type RecipeCostLine = {
  ingredientId: string;
  productId: string | null;
  componentMenuId: string | null;
  /** The product's or menu's name — a recipe line has no name of its own. */
  label: string;
  /** As typed, in `unitName`. */
  qty: Prisma.Decimal;
  unitName: string | null;
  sortOrder: number;
  /** Cost of this line for one whole writing — the lines sum to `costPerBatch`. */
  cost: Prisma.Decimal;
  confidence: RecipeConfidence;
};

/** Something the walk could not price, and what kind of thing it is (Q6). */
export type UnpricedComponent = {
  kind: "product" | "menu";
  id: string;
  name: string;
  /**
   * `NEVER_PURCHASED` — a RAW product this branch has no ledger money for; the
   * screen links to ADR 0014 Q11's declaration form.
   * `NO_RECIPE` — a component menu, or a prepped product, with nothing saying
   * what it is made of. Not the same problem and not the same fix.
   */
  reason: "NEVER_PURCHASED" | "NO_RECIPE";
};

export type RecipeCost = {
  recipeId: string;
  branchId: string;
  asOf: Date;
  /** Portions for a menu recipe; the output's base units for a production one. */
  servings: Prisma.Decimal;
  /** What ONE serving costs — `costPerBatch ÷ servings`, divided in MONEY. */
  costPerServing: Prisma.Decimal;
  /** What one whole writing of the recipe costs. The figure the walk computes. */
  costPerBatch: Prisma.Decimal;
  confidence: RecipeConfidence;
  lines: RecipeCostLine[];
  leaves: RecipeCostLeaf[];
  unpriced: UnpricedComponent[];
  /**
   * Q1/Q16 read backwards: a production recipe whose inputs total 300 g and
   * whose output is 250 g *is* a yield of 83.3%.
   *
   * `null` whenever it cannot be computed rather than invented — a recipe of
   * 200 g, 100 ml and 5 eggs has no common dimension, and so has no answer.
   * Menu recipes are always null: portions are not a weight.
   */
  yieldPercentComputed: Prisma.Decimal | null;
  /**
   * A graph problem found while walking. The cost is 0 and the confidence LOW,
   * and the page says which recipe is broken instead of failing to render.
   *
   * The write guards make both unreachable through the app; a row that predates
   * them, or one written by a repair script, must not be able to take down a
   * list of fifty other recipes. A READ never throws for data reasons — the same
   * doctrine `resolveRecipeIds` applies to an ambiguous branch link.
   */
  problem: "CYCLE" | "TOO_DEEP" | null;
};

// ------------------------------------------------------------
// The batch read
// ------------------------------------------------------------

export type GetRecipeCostsQuery = {
  recipeIds: string[];
  branchId: string;
  asOf?: Date;
};

/**
 * What each of these recipes costs at one branch on one day.
 *
 * THE NAMED VERSION IS USED VERBATIM AS THE ROOT; everything below it resolves
 * for the branch and the day. A recipe page names a version and a branch
 * separately — the user is looking at the central กะเพราหมู and asking what it
 * would cost at สาขาอโศก, which is the per-branch comparison Q5 puts on that
 * page. Resolving the root instead would quietly answer a different question:
 * อโศก's own recipe at อโศก's prices, so the "comparison" would be one recipe
 * against another.
 *
 * A recipe id that does not belong to this tenant is simply absent from the
 * result, the same way a menu with no recipe is absent from a resolution.
 */
export async function getRecipeCostsLogic(
  tenantId: string,
  query: GetRecipeCostsQuery
): Promise<Map<string, RecipeCost>> {
  const asOf = query.asOf ?? computeBangkokToday();
  const { branchId } = query;

  return withTenantContext(tenantId, async (tx) => {
    const roots = await tx.recipe.findMany({
      where: { id: { in: query.recipeIds }, tenantId, deletedAt: null },
      select: {
        id: true,
        lineId: true,
        menuId: true,
        outputProductId: true,
        servings: true,
        effectiveFrom: true,
        createdAt: true,
      },
    });
    if (roots.length === 0) return new Map();

    const targets: RecipeTarget[] = roots.map(targetOf);
    const pinned = new Map<string, ResolvedRecipeRow>(
      roots.map((r) => [targetKey(targetOf(r)), r])
    );

    const graph = await loadRecipeGraph(
      tx,
      tenantId,
      targets,
      branchId,
      asOf,
      pinned
    );

    // The ingredient ROWS of the roots — ids, unit names, the order the person
    // wrote them in. The graph carries the arithmetic; this carries the writing.
    const lineRows = await tx.recipeIngredient.findMany({
      where: { tenantId, recipeId: { in: roots.map((r) => r.id) } },
      select: {
        id: true,
        recipeId: true,
        productId: true,
        componentMenuId: true,
        qty: true,
        sortOrder: true,
        product: { select: { name: true } },
        componentMenu: { select: { name: true } },
        productUnit: { select: { unitName: true, toBaseRatio: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    const linesByRecipe = new Map<string, typeof lineRows>();
    for (const row of lineRows) {
      const list = linesByRecipe.get(row.recipeId);
      if (list === undefined) linesByRecipe.set(row.recipeId, [row]);
      else list.push(row);
    }

    // --- walk every root, in memory, off the one graph ---
    type Walked = {
      root: (typeof roots)[number];
      demand: Map<string, Prisma.Decimal> | null;
      problem: RecipeCost["problem"];
    };
    const walked: Walked[] = roots.map((root) => {
      try {
        // EXPLODED AT BATCH SCALE, not per serving, and the difference is not
        // cosmetic. A leaf quantity is rounded to the ledger's 3 dp (Part 22
        // will post exactly these numbers), so dividing by `servings` first and
        // multiplying the money back afterwards bakes that rounding into the
        // batch: 0.25 kg of chilli over 0.25 servings comes back as 0.833 kg and
        // the pot is out by half a satang for no reason. At batch scale the
        // walk reproduces the quantities the person actually wrote, and the
        // per-serving figure is a division of MONEY, which keeps 6 dp.
        const leaves = explodeToRaw(graph, rootKeyOf(root), root.servings);
        return {
          root,
          demand: new Map(leaves.map((l) => [l.productId, l.qty])),
          problem: null,
        };
      } catch (e) {
        if (e instanceof RecipeCycleError) return { root, demand: null, problem: "CYCLE" };
        if (e instanceof RecipeDepthExceededError) {
          return { root, demand: null, problem: "TOO_DEEP" };
        }
        // A missing node is a BUG in the loader, not bad data — it must not be
        // swallowed into a plausible-looking zero.
        throw e;
      }
    });

    // --- one batched replay for every leaf of every root (Q7) ---
    const leafProductIds = [
      ...new Set(walked.flatMap((w) => [...(w.demand?.keys() ?? [])])),
    ];
    const costs =
      leafProductIds.length === 0
        ? new Map<string, ProductCost>()
        : await replayPairsInTx(tx, tenantId, leafProductIds, [branchId], asOf);

    // --- names for everything that might have to be NAMED (Q6) ---
    const names = await loadNames(tx, tenantId, graph, leafProductIds);

    // --- the percentage a production recipe reads as (Q16) ---
    const dimensions = await loadDimensions(tx, tenantId, roots, linesByRecipe);

    const out = new Map<string, RecipeCost>();
    for (const w of walked) {
      out.set(
        w.root.id,
        assemble({
          root: w.root,
          demand: w.demand,
          problem: w.problem,
          graph,
          costs,
          names,
          dimensions,
          lineRows: linesByRecipe.get(w.root.id) ?? [],
          branchId,
          asOf,
        })
      );
    }
    return out;
  });
}

/**
 * One recipe's cost. A thin wrapper over the batch primitive — never its own
 * query, so there is no cheap-looking call for a loop to reach for (ADR 0014
 * Consequence 2, and the same shape `getProductCostLogic` takes).
 */
export async function getRecipeCostLogic(
  tenantId: string,
  query: RecipeCostQuery
): Promise<RecipeCost | null> {
  const costs = await getRecipeCostsLogic(tenantId, {
    recipeIds: [query.recipeId],
    branchId: query.branchId,
    asOf: query.asOf,
  });
  return costs.get(query.recipeId) ?? null;
}

// ------------------------------------------------------------
// The what-if (Part 24 L3d, ADR 0025 Q3)
// ------------------------------------------------------------

/**
 * A recipe that exists nowhere: the lines a person is typing into Menu Lab,
 * before Save and possibly for ever.
 *
 * It lives in THIS file rather than in a lab-shaped one, and that placement is
 * ADR 0025 Q4's whole argument made concrete. The walk, the batched replay, the
 * confidence floor and the assembler below are used unchanged; the only new
 * thing is a root node spliced into the loaded graph. A lab with its own cost
 * code would be the second engine that ADR refused, and the day it disagreed
 * with the recipe page nothing would report it.
 *
 * The root is a MENU node with a synthetic id, so every rule that applies to a
 * dish applies here: the depth cap counts it, a cycle through it throws, a
 * component menu with no recipe drags it to LOW.
 */
export type WhatIfLine = {
  productId: string | null;
  componentMenuId: string | null;
  qty: number;
  productUnitId: string | null;
  sortOrder: number;
};

export type WhatIfCostQuery = {
  lines: WhatIfLine[];
  servings: number;
  branchId: string;
  asOf?: Date;
};

export async function getWhatIfCostLogic(
  tenantId: string,
  query: WhatIfCostQuery
): Promise<RecipeCost> {
  const asOf = query.asOf ?? computeBangkokToday();
  const { branchId } = query;
  const servings = new Prisma.Decimal(query.servings);
  // Not a real menu and never written down. Random rather than fixed so it
  // cannot collide with a row somebody creates.
  const virtualId = randomUUID();

  const emptyCost: RecipeCost = {
    recipeId: virtualId,
    branchId,
    asOf,
    servings,
    costPerServing: ZERO,
    costPerBatch: ZERO,
    // An empty calculator is a screen somebody just opened. ฿0.00 at HIGH
    // confidence would be the "a zero would be a lie" failure with nothing on
    // screen to contradict it.
    confidence: "LOW",
    lines: [],
    leaves: [],
    unpriced: [],
    yieldPercentComputed: null,
    problem: null,
  };
  if (query.lines.length === 0) return emptyCost;

  return withTenantContext(tenantId, async (tx) => {
    // The units and names the lines are written in — the same joins
    // `getRecipeCostsLogic` gets for free from `recipeIngredient`.
    const unitIds = query.lines
      .map((l) => l.productUnitId)
      .filter((id): id is string => id !== null);
    const productIds = query.lines
      .map((l) => l.productId)
      .filter((id): id is string => id !== null);
    const menuIds = query.lines
      .map((l) => l.componentMenuId)
      .filter((id): id is string => id !== null);

    const [units, products, menus] = await Promise.all([
      unitIds.length === 0
        ? Promise.resolve([])
        : tx.productUnit.findMany({
            where: { id: { in: unitIds }, product: { tenantId } },
            select: {
              id: true,
              productId: true,
              unitName: true,
              toBaseRatio: true,
            },
          }),
      productIds.length === 0
        ? Promise.resolve([])
        : tx.product.findMany({
            where: { id: { in: productIds }, tenantId, deletedAt: null },
            select: { id: true, name: true },
          }),
      menuIds.length === 0
        ? Promise.resolve([])
        : tx.menu.findMany({
            where: { id: { in: menuIds }, tenantId, deletedAt: null },
            select: { id: true, name: true },
          }),
    ]);
    const unitById = new Map(units.map((u) => [u.id, u]));
    const productById = new Map(products.map((p) => [p.id, p]));
    const menuById = new Map(menus.map((m) => [m.id, m]));

    // A line naming something this tenant does not have is dropped rather than
    // thrown: a READ never throws for data reasons, and the form is L2's job.
    const usable = query.lines.filter((l) =>
      l.productId !== null
        ? productById.has(l.productId) && unitById.has(l.productUnitId ?? "")
        : menuById.has(l.componentMenuId as string)
    );
    if (usable.length === 0) return emptyCost;

    const targets: RecipeTarget[] = usable.map((l) =>
      l.productId !== null
        ? { kind: "product", id: l.productId }
        : { kind: "menu", id: l.componentMenuId as string }
    );

    const graph = await loadRecipeGraph(tx, tenantId, targets, branchId, asOf);

    // THE SPLICE. Everything below the root was loaded and resolved normally;
    // this adds the one node that has no row anywhere.
    graph.menus.set(virtualId, {
      id: virtualId,
      recipe: {
        id: virtualId,
        servings,
        ingredients: usable.map((l) => ({
          productId: l.productId,
          componentMenuId: l.componentMenuId,
          qty: new Prisma.Decimal(l.qty),
          toBaseRatio:
            l.productUnitId === null
              ? null
              : (unitById.get(l.productUnitId)?.toBaseRatio ?? null),
        })),
      },
    });

    const root = {
      id: virtualId,
      menuId: virtualId,
      outputProductId: null,
      servings,
    };

    let demand: Map<string, Prisma.Decimal> | null = null;
    let problem: RecipeCost["problem"] = null;
    try {
      demand = new Map(
        explodeToRaw(graph, menuKey(virtualId), servings).map((l) => [
          l.productId,
          l.qty,
        ])
      );
    } catch (e) {
      if (e instanceof RecipeCycleError) problem = "CYCLE";
      else if (e instanceof RecipeDepthExceededError) problem = "TOO_DEEP";
      else throw e;
    }

    const leafProductIds = [...(demand?.keys() ?? [])];
    const costs =
      leafProductIds.length === 0
        ? new Map<string, ProductCost>()
        : await replayPairsInTx(tx, tenantId, leafProductIds, [branchId], asOf);

    const names = await loadNames(tx, tenantId, graph, leafProductIds);

    return assemble({
      root,
      demand,
      problem,
      graph,
      costs,
      names,
      // A menu root has no yield percentage to compute (portions are not a
      // weight), so the dimension lookup would be a query with no reader.
      dimensions: new Map(),
      lineRows: usable.map((l, i) => ({
        // The screen keys its rows by position; nothing here is stored.
        id: `${i}`,
        recipeId: virtualId,
        productId: l.productId,
        componentMenuId: l.componentMenuId,
        qty: new Prisma.Decimal(l.qty),
        sortOrder: l.sortOrder,
        product:
          l.productId === null
            ? null
            : { name: productById.get(l.productId)?.name ?? l.productId },
        componentMenu:
          l.componentMenuId === null
            ? null
            : {
                name:
                  menuById.get(l.componentMenuId)?.name ?? l.componentMenuId,
              },
        productUnit:
          l.productUnitId === null
            ? null
            : {
                unitName: unitById.get(l.productUnitId)?.unitName ?? "",
                toBaseRatio:
                  unitById.get(l.productUnitId)?.toBaseRatio ??
                  new Prisma.Decimal(1),
              },
      })),
      branchId,
      asOf,
    });
  });
}

// ------------------------------------------------------------
// Assembly
// ------------------------------------------------------------

const targetOf = (r: {
  menuId: string | null;
  outputProductId: string | null;
}): RecipeTarget =>
  r.menuId !== null
    ? { kind: "menu", id: r.menuId }
    : { kind: "product", id: r.outputProductId as string };

const targetKey = (t: RecipeTarget) => `${t.kind}:${t.id}`;

const rootKeyOf = (r: { menuId: string | null; outputProductId: string | null }) =>
  r.menuId !== null ? menuKey(r.menuId) : productKey(r.outputProductId as string);

type NameMap = { products: Map<string, string>; menus: Map<string, string> };
type DimensionMap = Map<string, string>;
type LineRow = {
  id: string;
  recipeId: string;
  productId: string | null;
  componentMenuId: string | null;
  qty: Prisma.Decimal;
  sortOrder: number;
  product: { name: string } | null;
  componentMenu: { name: string } | null;
  productUnit: { unitName: string; toBaseRatio: Prisma.Decimal } | null;
};

function assemble(args: {
  root: {
    id: string;
    menuId: string | null;
    outputProductId: string | null;
    servings: Prisma.Decimal;
  };
  demand: Map<string, Prisma.Decimal> | null;
  problem: RecipeCost["problem"];
  graph: RecipeGraph;
  costs: Map<string, ProductCost>;
  names: NameMap;
  dimensions: DimensionMap;
  lineRows: LineRow[];
  branchId: string;
  asOf: Date;
}): RecipeCost {
  const { root, demand, problem, graph, costs, names, dimensions, lineRows } = args;
  const { branchId, asOf } = args;

  if (demand === null) {
    // A broken graph. Zero with LOW confidence and a named problem, so the page
    // renders and says which recipe to go and look at.
    return {
      recipeId: root.id,
      branchId,
      asOf,
      servings: root.servings,
      costPerServing: ZERO,
      costPerBatch: ZERO,
      confidence: "LOW",
      lines: [],
      leaves: [],
      unpriced: [],
      yieldPercentComputed: null,
      problem,
    };
  }

  // --- the leaves, priced ---
  const leaves: RecipeCostLeaf[] = [];
  let total = ZERO;
  let confidence: RecipeConfidence = "HIGH";

  for (const [productId, qty] of demand) {
    const state = costs.get(costKeyOf(productId, branchId));
    const unitCost = state?.costPerBaseUnit ?? ZERO;
    const costSource: CostSource = state?.costSource ?? "UNPRICED";
    const cost = trim(qty.mul(unitCost));
    total = total.plus(cost);
    confidence = weakest(confidence, CONFIDENCE_BY_COST_SOURCE[costSource]);
    leaves.push({
      productId,
      productName: names.products.get(productId) ?? productId,
      qty,
      unitCost,
      cost,
      costSource,
    });
  }
  leaves.sort((a, b) => (a.productName < b.productName ? -1 : 1));

  // --- what could not be priced, and why (Q6) ---
  const unpriced: UnpricedComponent[] = leaves
    .filter((l) => l.costSource === "UNPRICED")
    .map((l) => ({
      kind: "product" as const,
      id: l.productId,
      // A prepped product reaches the leaves only when nothing says how it is
      // made (recipe-graph.ts's own note), which is a different fix from a raw
      // material nobody has bought yet.
      reason:
        graph.products.get(l.productId)?.type === "PREPPED"
          ? ("NO_RECIPE" as const)
          : ("NEVER_PURCHASED" as const),
      name: l.productName,
    }));

  // A COMPONENT MENU WITH NO RECIPE contributes nothing to the walk and is
  // invisible in the leaves — the set menu holding it simply looks cheaper than
  // it is. This is the one unpriced case the explosion cannot express, because a
  // leaf is a productId, so it is found by scanning the graph instead.
  for (const key of reachable(graph, rootKeyOf(root))) {
    if (!key.startsWith("m:")) continue;
    const id = key.slice(2);
    if (graph.menus.get(id)?.recipe != null) continue;
    unpriced.push({
      kind: "menu",
      id,
      name: names.menus.get(id) ?? id,
      reason: "NO_RECIPE",
    });
    confidence = "LOW";
  }

  // --- the lines as written, each carrying its whole subtree ---
  const lines: RecipeCostLine[] = lineRows.map((row) => {
    const child: NodeKey =
      row.productId !== null
        ? productKey(row.productId)
        : menuKey(row.componentMenuId as string);
    // Batch scale again, so the lines add up to `costPerBatch` exactly — a
    // column that does not add up is a column nobody trusts.
    const multiplier =
      row.productId !== null
        ? row.qty.mul(row.productUnit?.toBaseRatio ?? new Prisma.Decimal(1))
        : row.qty;

    let cost = ZERO;
    let lineConfidence: RecipeConfidence = "HIGH";
    for (const leaf of explodeToRaw(graph, child, multiplier)) {
      const state = costs.get(costKeyOf(leaf.productId, branchId));
      cost = cost.plus(leaf.qty.mul(state?.costPerBaseUnit ?? ZERO));
      lineConfidence = weakest(
        lineConfidence,
        CONFIDENCE_BY_COST_SOURCE[state?.costSource ?? "UNPRICED"]
      );
    }
    // A menu component with no recipe explodes to nothing at all, so the loop
    // above leaves the line at HIGH and 0 — which reads as "this costs nothing"
    // rather than "we do not know".
    if (
      row.componentMenuId !== null &&
      graph.menus.get(row.componentMenuId)?.recipe == null
    ) {
      lineConfidence = "LOW";
    }

    return {
      ingredientId: row.id,
      productId: row.productId,
      componentMenuId: row.componentMenuId,
      label: row.product?.name ?? row.componentMenu?.name ?? row.id,
      qty: row.qty,
      unitName: row.productUnit?.unitName ?? null,
      sortOrder: row.sortOrder,
      cost: trim(cost),
      confidence: lineConfidence,
    };
  });

  return {
    recipeId: root.id,
    branchId,
    asOf,
    servings: root.servings,
    costPerBatch: trim(total),
    costPerServing: trim(total.div(root.servings)),
    confidence,
    lines,
    leaves,
    unpriced,
    yieldPercentComputed: computeYieldPercent(root, lineRows, dimensions),
    problem: null,
  };
}

/**
 * Q1's percentage view: a production recipe of 300 g in and 250 g out reads as
 * 83.3%, which is the same fact its parent-and-yield twin states directly.
 *
 * Computed at read and never stored, because a stored copy can disagree with the
 * recipe it came from. Returned as `null` — not as a guess — whenever the inputs
 * have no common dimension with the output, which is most of the time: 200 g,
 * 100 ml and 5 eggs do not add up to anything.
 */
function computeYieldPercent(
  root: { outputProductId: string | null; servings: Prisma.Decimal },
  lineRows: LineRow[],
  dimensions: DimensionMap
): Prisma.Decimal | null {
  if (root.outputProductId === null) return null; // a menu makes portions
  if (lineRows.length === 0) return null;

  const outputDimension = dimensions.get(root.outputProductId);
  if (outputDimension === undefined) return null;

  let inputs = ZERO;
  for (const row of lineRows) {
    // A menu inside a production recipe has no weight at all, so the sum has no
    // answer rather than a smaller one.
    if (row.productId === null) return null;
    if (dimensions.get(row.productId) !== outputDimension) return null;
    inputs = inputs.plus(
      row.qty.mul(row.productUnit?.toBaseRatio ?? new Prisma.Decimal(1))
    );
  }
  if (inputs.lessThanOrEqualTo(0)) return null;

  return root.servings.div(inputs).mul(HUNDRED).toDecimalPlaces(1);
}

// ------------------------------------------------------------
// Two small lookups
// ------------------------------------------------------------

/** Names for anything the result might have to name — one query per kind. */
async function loadNames(
  tx: PrismaClient,
  tenantId: string,
  graph: RecipeGraph,
  leafProductIds: string[]
): Promise<NameMap> {
  const productIds = [...new Set([...graph.products.keys(), ...leafProductIds])];
  const menuIds = [...graph.menus.keys()];

  const [products, menus] = await Promise.all([
    productIds.length === 0
      ? Promise.resolve([])
      : tx.product.findMany({
          where: { tenantId, id: { in: productIds } },
          select: { id: true, name: true },
        }),
    menuIds.length === 0
      ? Promise.resolve([])
      : tx.menu.findMany({
          where: { tenantId, id: { in: menuIds } },
          select: { id: true, name: true },
        }),
  ]);

  return {
    products: new Map(products.map((p) => [p.id, p.name])),
    menus: new Map(menus.map((m) => [m.id, m.name])),
  };
}

/**
 * `primaryDimension` for the products a production recipe compares, and only for
 * those — a shop with no production recipes pays nothing for this.
 */
async function loadDimensions(
  tx: PrismaClient,
  tenantId: string,
  roots: { id: string; outputProductId: string | null }[],
  linesByRecipe: Map<string, LineRow[]>
): Promise<DimensionMap> {
  const wanted = new Set<string>();
  for (const root of roots) {
    if (root.outputProductId === null) continue;
    wanted.add(root.outputProductId);
    for (const row of linesByRecipe.get(root.id) ?? []) {
      if (row.productId !== null) wanted.add(row.productId);
    }
  }
  if (wanted.size === 0) return new Map();

  const rows = await tx.product.findMany({
    where: { tenantId, id: { in: [...wanted] } },
    select: { id: true, primaryDimension: true },
  });
  return new Map(rows.map((r) => [r.id, r.primaryDimension]));
}
