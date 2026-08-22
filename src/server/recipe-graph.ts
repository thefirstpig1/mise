// ============================================================
// Mise — the recipe graph walker (Sprint 5 Part 21 L3, ADR 0021)
// ============================================================
// PURE. No Prisma, no tenantId, no I/O — the same split `fifo-replay.ts` keeps,
// and for the same reason: the arithmetic that decides what a dish costs should
// be testable without a database, and the database should not be able to make it
// wrong by being slow or absent.
//
// The caller loads a bounded slice of the graph (src/server/recipe.ts does it in
// at most two queries per level, five levels deep) and hands it here as plain
// maps. Everything below walks those maps.
//
// WHAT THIS WALKER IS FOR, twice over:
//   - L3a's write guard — is this edge a cycle, and how deep is the chain now?
//   - L3b's cost — what raw materials does one serving actually consume?
// Both walk the SAME graph, which is why it is one file. ADR 0021 Consequence 1
// says the walker's shape is the expensive part of this Part; it takes products
// AND menus from the first line precisely so a set menu is not a rewrite later.
//
// THE GRAPH IS OVER THINGS, NOT OVER RECIPE VERSIONS (Q3). An edge says "this
// dish contains a steak", never "this dish contains steak recipe v3", so the
// caller resolves each node's recipe for its own branch and date before handing
// the graph over.
// ============================================================

import { Prisma } from "@prisma/client";

/** Base-unit quantities carry 3 dp, like every quantity in the ledger. */
export const QTY_SCALE = 3;

/**
 * Decision #58, counted in NODES and spent by ONE budget across both kinds of
 * hop. เซ็ท B → สเต็ก → สเต็กแล่ → เนื้อทั้งชิ้น has spent four of five.
 *
 * ADR 0007 chose the product graph's cap to line up with this one exactly, so
 * there is no off-by-one between them.
 *
 * RE-EXPORTED, not re-declared. The number is defined once, in the validations
 * file, because a Client Component renders it inside an error message and
 * `src/server/*` drags Prisma into the browser bundle. Two literals held
 * together by a comment is what this Part inherited from ADR 0007 and is exactly
 * what L3a was meant to end.
 */
export { MAX_RECIPE_DEPTH } from "@/lib/validations/recipe";
import { MAX_RECIPE_DEPTH } from "@/lib/validations/recipe";

// ------------------------------------------------------------
// Node keys
// ------------------------------------------------------------

/**
 * A node is a THING, and the two kinds share one namespace because they share
 * one depth budget and one visited-set. A cycle that runs menu → menu is just as
 * fatal as one that runs product → product, and Q3 made the first kind possible.
 */
export type NodeKey = string;

export const productKey = (id: string): NodeKey => `p:${id}`;
export const menuKey = (id: string): NodeKey => `m:${id}`;

export const isProductKey = (k: NodeKey): boolean => k.startsWith("p:");
export const keyId = (k: NodeKey): string => k.slice(2);

// ------------------------------------------------------------
// The loaded graph
// ------------------------------------------------------------

export type GraphIngredient = {
  /** Exactly one of these two — `recipe_ingredient_target_check`. */
  productId: string | null;
  componentMenuId: string | null;
  /** As typed, in the unit named below. */
  qty: Prisma.Decimal;
  /**
   * The unit's ratio to the product's base unit, read at LOAD time and never
   * stored on the row (Q17). NULL exactly when this line points at a menu.
   */
  toBaseRatio: Prisma.Decimal | null;
};

export type GraphRecipe = {
  id: string;
  /**
   * How much one writing makes: portions for a menu recipe, the output
   * product's BASE UNITS for a production recipe. Guaranteed > 0 by
   * `recipe_servings_check`, so dividing by it is safe.
   */
  servings: Prisma.Decimal;
  ingredients: GraphIngredient[];
};

export type GraphProduct = {
  id: string;
  type: "RAW" | "PREPPED";
  /** PREPPED only, and only on the parent-and-yield half of Q1. */
  yieldPercent: Prisma.Decimal | null;
  parentProductId: string | null;
  /** PREPPED only, and only on the production-recipe half of Q1. */
  productionRecipe: GraphRecipe | null;
};

export type GraphMenu = {
  id: string;
  /** Resolved for the branch and date the caller asked about. */
  recipe: GraphRecipe | null;
};

export type RecipeGraph = {
  products: Map<string, GraphProduct>;
  menus: Map<string, GraphMenu>;
};

// ------------------------------------------------------------
// Errors
// ------------------------------------------------------------

/**
 * A cycle, and the message names the chain rather than only saying one exists —
 * "ลึกเกินไป" with no path is a dead end for whoever has to fix it (Q3).
 */
export class RecipeCycleError extends Error {
  constructor(public readonly path: NodeKey[]) {
    super(`Recipe cycle: ${path.join(" -> ")}`);
    this.name = "RecipeCycleError";
  }
}

/** Past Decision #58's five nodes, carrying the chain that overflowed. */
export class RecipeDepthExceededError extends Error {
  constructor(
    public readonly depth: number,
    public readonly path: NodeKey[]
  ) {
    super(
      `Recipe chain depth ${depth} exceeds the limit of ${MAX_RECIPE_DEPTH}: ${path.join(
        " -> "
      )}`
    );
    this.name = "RecipeDepthExceededError";
  }
}

/**
 * The graph ran off the end of what the caller loaded. This is a BUG in the
 * loader, not a user error, and it throws rather than treating the missing node
 * as a leaf: a silently truncated explosion consumes less stock than the dish
 * really used, and every figure downstream would be quietly too good.
 */
export class GraphNodeMissingError extends Error {
  constructor(public readonly key: NodeKey) {
    super(`Node not loaded into the recipe graph: ${key}`);
    this.name = "GraphNodeMissingError";
  }
}

/**
 * A PREPPED product that names a parent but whose yield is missing or zero.
 *
 * Distinct from `GraphNodeMissingError`: the row is right here, it simply cannot
 * answer the question. Reading a null yield as 100% would silently understate
 * the raw material, and a zero cannot be divided by at all — a product you get
 * nothing out of has no answer to "how much do I need".
 */
export class RecipeMethodMissingError extends Error {
  constructor(public readonly productId: string) {
    super(`PREPPED product ${productId} has no usable yield`);
    this.name = "RecipeMethodMissingError";
  }
}

// ------------------------------------------------------------
// Edges
// ------------------------------------------------------------

/**
 * What one node expands into. A RAW product expands into nothing — it is where
 * the walk stops and where the FIFO replay takes over.
 *
 * A PREPPED product expands one of two ways and NEVER both (Q1): through its
 * production recipe, or through its single parent. The caller's loader is
 * responsible for the invariant; here, a production recipe simply wins if both
 * are somehow present, because that is the more expressive notation and the one
 * that would otherwise be silently ignored.
 */
export function edgesOf(graph: RecipeGraph, key: NodeKey): NodeKey[] {
  if (isProductKey(key)) {
    const p = graph.products.get(keyId(key));
    if (p === undefined) throw new GraphNodeMissingError(key);
    if (p.type === "RAW") return [];
    if (p.productionRecipe !== null) {
      return ingredientKeys(p.productionRecipe);
    }
    return p.parentProductId === null ? [] : [productKey(p.parentProductId)];
  }

  const m = graph.menus.get(keyId(key));
  if (m === undefined) throw new GraphNodeMissingError(key);
  return m.recipe === null ? [] : ingredientKeys(m.recipe);
}

function ingredientKeys(r: GraphRecipe): NodeKey[] {
  return r.ingredients.map((i) =>
    i.productId !== null ? productKey(i.productId) : menuKey(i.componentMenuId as string)
  );
}

// ------------------------------------------------------------
// Depth and cycles
// ------------------------------------------------------------

/**
 * The longest chain of NODES starting at `root`, inclusive. A RAW product on its
 * own is 1.
 *
 * Throws on the first cycle found, carrying the path — the caller turns that
 * into a Thai message naming the dishes involved, because "ลึกเกินไป" with no
 * path is a dead end for whoever has to fix it.
 *
 * Termination is guaranteed by the cycle check, not by a depth bound: an acyclic
 * graph is finite, and a cyclic one throws before it can loop. The memo makes it
 * O(V+E) rather than exponential, which matters because the same prepped product
 * legitimately appears in many recipes — and it is safe precisely because the
 * depth BELOW a node does not depend on the path above it.
 */
export function chainDepth(graph: RecipeGraph, root: NodeKey): number {
  const onPath = new Set<NodeKey>();
  const path: NodeKey[] = [];
  const done = new Map<NodeKey, number>();

  function walk(key: NodeKey): number {
    if (onPath.has(key)) {
      throw new RecipeCycleError([...path, key]);
    }
    const memo = done.get(key);
    if (memo !== undefined) return memo;

    onPath.add(key);
    path.push(key);

    let best = 1;
    for (const child of edgesOf(graph, key)) {
      const d = 1 + walk(child);
      if (d > best) best = d;
    }

    onPath.delete(key);
    path.pop();
    done.set(key, best);
    return best;
  }

  return walk(root);
}

/**
 * The write-time guard (Q3, Q13). Refuses a cycle outright, and refuses a chain
 * longer than Decision #58's five nodes.
 *
 * `ancestorDepth` is how many nodes sit ABOVE the root already — the same shape
 * ADR 0007's `assertParentValid` uses, and for the same reason: re-parenting a
 * node that already has a deep subtree can produce a chain too long for the cost
 * engine, and we would otherwise only find out at cost-compute time, far from
 * where the bad edit happened.
 */
export function assertGraphValid(
  graph: RecipeGraph,
  root: NodeKey,
  ancestorDepth: number = 0
): void {
  const below = chainDepth(graph, root);
  const total = ancestorDepth + below;
  if (total > MAX_RECIPE_DEPTH) {
    throw new RecipeDepthExceededError(total, deepestPath(graph, root));
  }
}

/**
 * The chain `chainDepth` measured, so the refusal can NAME what overflowed.
 *
 * Called only on the failing path, so it re-walks rather than sharing the memo —
 * a few dozen nodes on a path that is about to be rejected, against carrying a
 * parallel structure through the hot walk that succeeds every other time.
 *
 * `budget` is a safety net, not the algorithm: `onPath` already stops a cycle
 * from looping. It exists so that a graph which somehow slipped past the guard
 * still produces an error message instead of a stack overflow.
 */
export function deepestPath(graph: RecipeGraph, root: NodeKey): NodeKey[] {
  const onPath = new Set<NodeKey>();

  function walk(key: NodeKey, budget: number): NodeKey[] {
    if (onPath.has(key) || budget <= 0) return [key];
    onPath.add(key);
    let best: NodeKey[] = [];
    for (const child of edgesOf(graph, key)) {
      const p = walk(child, budget - 1);
      if (p.length > best.length) best = p;
    }
    onPath.delete(key);
    return [key, ...best];
  }

  return walk(root, MAX_RECIPE_DEPTH + 2);
}

// ------------------------------------------------------------
// The explosion
// ------------------------------------------------------------

export type LeafDemand = {
  productId: string;
  /** In the product's BASE unit, 3 dp. */
  qty: Prisma.Decimal;
};

/**
 * WHAT ONE UNIT OF `root` ACTUALLY CONSUMES, expressed only in RAW products.
 *
 * "One unit" means one serving of a menu, or one base unit of a product.
 *
 * Two divisions apply and they are different things (rule R2, ADR 0021 Q16):
 *
 *     per_serving = recipe_qty / servings          split a batch into what is taken from it
 *     raw_qty     = per_serving / (yield% / 100)   account for what the knife takes
 *
 * The second is Decision #59, and it is a DIVISION. `qty × (1 + loss%)` is the
 * wrong formula and gives a smaller answer every time: 80 g of trimmed beef at
 * 80% yield needs 100 g of untrimmed, not 96.
 *
 * ⚠️ The walk goes STRAIGHT THROUGH prepped products to RAW (Q11). A PREPPED
 * product is a way of writing a recipe, not something the system believes is
 * sitting in the fridge — nothing can raise its balance until production
 * movements exist. When they do, this is where the walk gains an earlier
 * stopping condition, and nothing else here changes.
 */
export function explodeToRaw(
  graph: RecipeGraph,
  root: NodeKey,
  multiplier: Prisma.Decimal = new Prisma.Decimal(1)
): LeafDemand[] {
  const totals = new Map<string, Prisma.Decimal>();
  const onPath = new Set<NodeKey>();

  function visit(key: NodeKey, qty: Prisma.Decimal): void {
    if (onPath.has(key)) {
      throw new RecipeCycleError([...onPath, key]);
    }
    if (onPath.size >= MAX_RECIPE_DEPTH) {
      throw new RecipeDepthExceededError(onPath.size + 1, [...onPath, key]);
    }

    if (isProductKey(key)) {
      const p = graph.products.get(keyId(key));
      if (p === undefined) throw new GraphNodeMissingError(key);

      if (p.type === "RAW") {
        totals.set(p.id, (totals.get(p.id) ?? new Prisma.Decimal(0)).plus(qty));
        return;
      }

      onPath.add(key);
      if (p.productionRecipe !== null) {
        // `servings` here is the output product's own base units, so the number
        // of batches needed is a plain ratio.
        expandRecipe(p.productionRecipe, qty);
      } else if (p.parentProductId !== null) {
        // Decision #59, and it is a DIVISION. A missing or zero yield cannot be
        // read as 100% — that silently understates the raw material — and it
        // cannot be divided by either.
        const pct = p.yieldPercent;
        if (pct === null || pct.lessThanOrEqualTo(0)) {
          throw new RecipeMethodMissingError(p.id);
        }
        visit(productKey(p.parentProductId), qty.div(pct.div(100)));
      } else {
        // A PREPPED product with NEITHER method. Reachable for real: Q1 lets a
        // product be made by a production recipe, so there is a window between
        // creating the product and writing that recipe.
        //
        // It is emitted as a LEAF rather than contributing nothing. Contributing
        // nothing makes the dish consume less than it really does and every
        // figure downstream quietly too good — the failure this whole Part is
        // organised against. As a leaf it goes to the FIFO replay, comes back
        // `UNPRICED` (nothing ever received it), and Q6 then makes the entire
        // recipe LOW and names it on screen. The machinery for saying "we do not
        // know what this costs" already exists; this routes into it.
        totals.set(p.id, (totals.get(p.id) ?? new Prisma.Decimal(0)).plus(qty));
      }
      onPath.delete(key);
      return;
    }

    const m = graph.menus.get(keyId(key));
    if (m === undefined) throw new GraphNodeMissingError(key);
    if (m.recipe === null) return;

    onPath.add(key);
    expandRecipe(m.recipe, qty);
    onPath.delete(key);
  }

  function expandRecipe(r: GraphRecipe, outerQty: Prisma.Decimal): void {
    for (const ing of r.ingredients) {
      // Division 1: one writing of the recipe makes `servings`.
      const perUnit = ing.qty.div(r.servings).mul(outerQty);

      if (ing.productId !== null) {
        // Q17: the base-unit value is computed here, at read, from the ratio the
        // unit currently has. A recipe says "use one bag"; correcting what a bag
        // weighs should move every recipe that says bag.
        const ratio = ing.toBaseRatio ?? new Prisma.Decimal(1);
        visit(productKey(ing.productId), perUnit.mul(ratio));
      } else {
        visit(menuKey(ing.componentMenuId as string), perUnit);
      }
    }
  }

  visit(root, multiplier);

  return [...totals.entries()]
    .map(([productId, qty]) => ({
      productId,
      qty: qty.toDecimalPlaces(QTY_SCALE),
    }))
    .sort((a, b) => (a.productId < b.productId ? -1 : 1));
}

/**
 * Every node reachable from `root`, both kinds. Used by the loader to know what
 * it still has to fetch, and by the guard to check nothing in the subtree was
 * left out.
 */
export function reachable(graph: RecipeGraph, root: NodeKey): Set<NodeKey> {
  const seen = new Set<NodeKey>();
  const stack: NodeKey[] = [root];
  while (stack.length > 0) {
    const k = stack.pop() as NodeKey;
    if (seen.has(k)) continue;
    seen.add(k);
    for (const child of edgesOf(graph, k)) stack.push(child);
  }
  return seen;
}
