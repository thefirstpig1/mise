// ============================================================
// Mise — resolving which recipe applies, and loading the graph (Part 21 L3)
// ============================================================
// Two questions, and the second is built from the first:
//
//   1. WHICH RECIPE applies to this thing, at this branch, on this day?
//   2. Load enough of the graph below it to walk (src/server/recipe-graph.ts).
//
// Question 1 has two dimensions and both are load-bearing:
//
//   BRANCH (Q8) — a line with no `recipe_branch` rows at all is CENTRAL and
//   serves every branch that has not decided otherwise. A line with rows serves
//   exactly those branches. A branch that has never copied has not decided
//   anything, so it follows central as central changes; the moment it copies, it
//   has its own line and nothing central reaches it again.
//
//   DATE (Q4) — versions of one line share a `lineId` and the one that applies
//   is the newest `effectiveFrom` at or before the day asked about. Superseded
//   versions are excluded entirely, because superseded means THIS VERSION WAS
//   WRONG, not "a later one exists" — see the `Recipe` model comment.
//
// Getting the date dimension wrong is not cosmetic. Part 19 imports periodically,
// so Part 22 posts consumption for thirty past days in one pass; a resolver that
// always answers "today's recipe" posts all thirty against it and overstates
// every ingredient for a fortnight with nothing on screen looking wrong.
//
// LOADING IS BATCHED BY LEVEL, never per node: four queries per level at most
// (products, recipe candidates, branch links, ingredients), and at most
// MAX_RECIPE_DEPTH + 1 levels — so a graph of any width costs the same as a
// narrow one. ADR 0014 Consequence 2 made the same call one layer down and for
// the same reason: 200 products one round trip at a time to Neon Singapore is
// 6 to 16 seconds.
// ============================================================

import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  MAX_RECIPE_DEPTH,
  type GraphMenu,
  type GraphProduct,
  type GraphRecipe,
  type RecipeGraph,
} from "@/server/recipe-graph";

/** What a resolution asks about: one menu, or one product's production recipe. */
export type RecipeTarget =
  | { kind: "menu"; id: string }
  | { kind: "product"; id: string };

const targetKey = (t: RecipeTarget) => `${t.kind}:${t.id}`;

export type ResolvedRecipeRow = {
  id: string;
  lineId: string;
  menuId: string | null;
  outputProductId: string | null;
  servings: Prisma.Decimal;
  effectiveFrom: Date;
  createdAt: Date;
};

/**
 * Which recipe id applies to each target, at one branch, on one day.
 *
 * Returns the resolved ROW rather than just its id, keyed `"menu:<id>"` /
 * `"product:<id>"`, so `servings` arrives with it and the walk costs one query
 * fewer per level.
 *
 * A target with no recipe is simply ABSENT from the map — most menus have none,
 * and that is not an error: Q10 shows "—" rather than pretending a dish costs
 * nothing.
 *
 * ⚠️ Ambiguity is resolved, never thrown. Nothing in the schema stops a branch
 * being linked to two lines for the same menu (the condition spans two tables),
 * so the write path guards it — but a READ must not be able to crash a page
 * because of a row someone else wrote. The ordering below is total, so the same
 * ambiguity always resolves the same way.
 */
export async function resolveRecipeIds(
  tx: PrismaClient,
  tenantId: string,
  targets: RecipeTarget[],
  branchId: string,
  asOf: Date
): Promise<Map<string, ResolvedRecipeRow>> {
  const resolved = new Map<string, ResolvedRecipeRow>();
  if (targets.length === 0) return resolved;

  const menuIds = targets.filter((t) => t.kind === "menu").map((t) => t.id);
  const productIds = targets.filter((t) => t.kind === "product").map((t) => t.id);

  const candidates: ResolvedRecipeRow[] = await tx.recipe.findMany({
    where: {
      tenantId,
      deletedAt: null,
      // Superseded means "this version was wrong" (see the model comment), so it
      // is excluded at every date, not only after some cut-off.
      supersededAt: null,
      effectiveFrom: { lte: asOf },
      OR: [
        ...(menuIds.length > 0 ? [{ menuId: { in: menuIds } }] : []),
        ...(productIds.length > 0
          ? [{ outputProductId: { in: productIds } }]
          : []),
      ],
    },
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

  if (candidates.length === 0) return resolved;

  // Which lines are attached to branches at all, and which serve THIS one.
  const lineIds = [...new Set(candidates.map((r) => r.lineId))];
  const links = await tx.recipeBranch.findMany({
    where: { tenantId, lineId: { in: lineIds } },
    select: { lineId: true, branchId: true },
  });

  const linesWithAnyBranch = new Set(links.map((l) => l.lineId));
  const linesServingThisBranch = new Set(
    links.filter((l) => l.branchId === branchId).map((l) => l.lineId)
  );

  // Group candidates by target.
  const byTarget = new Map<string, ResolvedRecipeRow[]>();
  for (const r of candidates) {
    const key =
      r.menuId !== null ? `menu:${r.menuId}` : `product:${r.outputProductId}`;
    const list = byTarget.get(key);
    if (list === undefined) byTarget.set(key, [r]);
    else list.push(r);
  }

  for (const [key, rows] of byTarget) {
    // This branch's own line wins; otherwise the central line, which is the one
    // attached to NO branches. A line attached to other branches only is not a
    // fallback — it belongs to them.
    const mine = rows.filter((r) => linesServingThisBranch.has(r.lineId));
    const central = rows.filter((r) => !linesWithAnyBranch.has(r.lineId));
    const pool = mine.length > 0 ? mine : central;
    if (pool.length === 0) continue;

    // Newest effective date wins; a correction written later on the SAME date
    // wins over what it corrected; the id is the final tiebreak so the ordering
    // is total and an ambiguity resolves identically on every read.
    const best = [...pool].sort((a, b) => {
      const e = b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
      if (e !== 0) return e;
      const c = b.createdAt.getTime() - a.createdAt.getTime();
      if (c !== 0) return c;
      return a.id < b.id ? -1 : 1;
    })[0];

    resolved.set(key, best);
  }

  return resolved;
}

// ------------------------------------------------------------
// Loading the graph
// ------------------------------------------------------------

type IngredientRow = {
  recipeId: string;
  productId: string | null;
  componentMenuId: string | null;
  qty: Prisma.Decimal;
  productUnit: { toBaseRatio: Prisma.Decimal } | null;
};

/**
 * Load every node reachable from `roots`, resolved for one branch and one day.
 *
 * Breadth-first BY LEVEL, so the number of round trips is bounded by the depth
 * cap rather than by the size of the graph: four queries per level at most, and
 * at most MAX_RECIPE_DEPTH + 1 levels.
 *
 * It deliberately loads ONE LEVEL PAST the cap. Stopping exactly at the cap
 * would leave the walker unable to tell "the chain ends here" from "the chain
 * continues and we did not look", and the walker treats a missing node as a bug
 * precisely so that difference can never be silently resolved as "ends here".
 */
export async function loadRecipeGraph(
  tx: PrismaClient,
  tenantId: string,
  roots: RecipeTarget[],
  branchId: string,
  asOf: Date
): Promise<RecipeGraph> {
  const products = new Map<string, GraphProduct>();
  const menus = new Map<string, GraphMenu>();

  let frontier: RecipeTarget[] = dedupeTargets(roots);
  let level = 0;

  while (frontier.length > 0 && level <= MAX_RECIPE_DEPTH + 1) {
    const wantedMenus = frontier.filter((t) => t.kind === "menu").map((t) => t.id);
    const wantedProducts = frontier
      .filter((t) => t.kind === "product")
      .map((t) => t.id);

    // 1. Products at this level — their type, method and yield.
    const productRows =
      wantedProducts.length === 0
        ? []
        : await tx.product.findMany({
            where: { tenantId, id: { in: wantedProducts } },
            select: {
              id: true,
              type: true,
              yieldPercent: true,
              parentProductId: true,
            },
          });

    for (const p of productRows) {
      if (products.has(p.id)) continue;
      products.set(p.id, {
        id: p.id,
        type: p.type === "PREPPED" ? "PREPPED" : "RAW",
        yieldPercent: p.yieldPercent,
        parentProductId: p.parentProductId,
        productionRecipe: null,
      });
    }

    // 2. Which recipe applies to each node at this level. A RAW product is a
    //    leaf and is never asked about — the FIFO replay takes over there.
    const askable: RecipeTarget[] = [
      ...wantedMenus.map((id) => ({ kind: "menu" as const, id })),
      ...productRows
        .filter((p) => p.type === "PREPPED")
        .map((p) => ({ kind: "product" as const, id: p.id })),
    ];

    const resolved = await resolveRecipeIds(
      tx,
      tenantId,
      askable,
      branchId,
      asOf
    );

    // 3. The ingredients of every recipe just resolved, in one query, with the
    //    unit ratio joined so the base-unit value can be computed at read (Q17).
    const resolvedRows = [...resolved.values()];
    const recipeIds = [...new Set(resolvedRows.map((r) => r.id))];
    const servingsById = new Map(resolvedRows.map((r) => [r.id, r.servings]));
    const ingredientRows: IngredientRow[] =
      recipeIds.length === 0
        ? []
        : await tx.recipeIngredient.findMany({
            where: { tenantId, recipeId: { in: recipeIds } },
            select: {
              recipeId: true,
              productId: true,
              componentMenuId: true,
              qty: true,
              productUnit: { select: { toBaseRatio: true } },
            },
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          });

    const byRecipe = new Map<string, IngredientRow[]>();
    for (const row of ingredientRows) {
      const list = byRecipe.get(row.recipeId);
      if (list === undefined) byRecipe.set(row.recipeId, [row]);
      else list.push(row);
    }

    const buildRecipe = (recipeId: string): GraphRecipe => ({
      id: recipeId,
      servings: servingsById.get(recipeId) ?? new Prisma.Decimal(1),
      ingredients: (byRecipe.get(recipeId) ?? []).map((i) => ({
        productId: i.productId,
        componentMenuId: i.componentMenuId,
        qty: i.qty,
        toBaseRatio: i.productUnit?.toBaseRatio ?? null,
      })),
    });

    // 4. Attach, and work out what the next level owes.
    const next: RecipeTarget[] = [];

    for (const id of wantedMenus) {
      if (menus.has(id)) continue;
      const row = resolved.get(`menu:${id}`);
      const recipe = row === undefined ? null : buildRecipe(row.id);
      menus.set(id, { id, recipe });
      if (recipe !== null) next.push(...ingredientTargets(recipe));
    }

    for (const p of productRows) {
      const node = products.get(p.id);
      if (node === undefined || node.type !== "PREPPED") continue;
      const row = resolved.get(`product:${p.id}`);
      if (row !== undefined) {
        node.productionRecipe = buildRecipe(row.id);
        next.push(...ingredientTargets(node.productionRecipe));
      } else if (node.parentProductId !== null) {
        next.push({ kind: "product", id: node.parentProductId });
      }
    }

    frontier = dedupeTargets(next).filter((t) =>
      t.kind === "menu" ? !menus.has(t.id) : !products.has(t.id)
    );
    level += 1;
  }

  return { products, menus };
}

function ingredientTargets(r: GraphRecipe): RecipeTarget[] {
  return r.ingredients.map((i) =>
    i.productId !== null
      ? { kind: "product" as const, id: i.productId }
      : { kind: "menu" as const, id: i.componentMenuId as string }
  );
}

function dedupeTargets(targets: RecipeTarget[]): RecipeTarget[] {
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
