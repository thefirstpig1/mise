// ============================================================
// Mise — the reads behind "จัดการเมนู" (Kong, 2026-10-04)
// ============================================================
// /menus, /recipes and /menus/coverage became one screen with a sheet that
// opens over it. Nothing in this file is new arithmetic — every figure is one
// another screen already states, read the same way:
//
//   - a recipe's cost is `getRecipeCostLogic` (the walk, ADR 0021), never a sum
//     done here;
//   - an ingredient's cost per base unit is the FIFO replay (ADR 0014) for RAW,
//     and the recipe walk for PREPPED — the same two sources the walk itself
//     reads, so the sheet's live estimate and the saved figure agree;
//   - stock on hand is the ledger (`stock_movement`), and "used per day" is
//     what sales consumption actually took (Part 22), divided by the days that
//     were POSTED — not by calendar days, because a day nobody posted took
//     nothing and would make the shop look slower than it is (rule SI1's logic).
//
// Cost never leaves without the reader's ticket (ADR 0029 Q12): every money
// field is null when `cost` is null, and the walk is SKIPPED, not blanked.
// ============================================================

import { Prisma } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import type { CostAccess } from "@/lib/permissions/cost-access";
import { resolveRecipeIds } from "@/server/recipe-resolve";
import { getRecipeCostLogic, type RecipeConfidence } from "@/server/recipe-cost";
import { getProductCostsLogic } from "@/server/stock-cost";
import { getRecipeListLogic } from "@/server/recipe-read";

/** The window "used per day" is measured over. */
export const INGREDIENT_FACT_DAYS = 30;

const num = (d: Prisma.Decimal | null | undefined) => (d == null ? 0 : Number(d));
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

// ------------------------------------------------------------
// Stock facts per ingredient
// ------------------------------------------------------------

export type IngredientFact = {
  productId: string;
  /** The ledger balance at this branch, in the product's base unit. */
  onHand: number;
  /** Average taken by sales per POSTED day; null when no day was posted. */
  usedPerDay: number | null;
  /** onHand ÷ usedPerDay, floored; null without a rate. */
  daysLeft: number | null;
  par: number | null;
  belowPar: boolean;
};

export type IngredientFacts = {
  facts: Record<string, IngredientFact>;
  /** The last business day sales were posted to stock — "ตัดสต๊อกถึง". */
  postedThrough: string | null;
  /** How many days in the window were posted — the divisor above. */
  postedDays: number;
};

export async function getIngredientFactsLogic(
  tenantId: string,
  branchId: string,
  productIds: string[]
): Promise<IngredientFacts> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return { facts: {}, postedThrough: null, postedDays: 0 };
  const to = computeBangkokToday();
  const from = addDays(to, -(INGREDIENT_FACT_DAYS - 1));

  return withTenantContext(tenantId, async (tx) => {
    const sales = { sourceType: "SALES_CONSUMPTION" as const, type: { in: ["CONSUMPTION", "CONSUMPTION_REVERSAL"] as ("CONSUMPTION" | "CONSUMPTION_REVERSAL")[] } };
    const [balances, used, days, pars] = await Promise.all([
      tx.stockMovement.groupBy({
        by: ["productId"],
        where: { tenantId, branchId, productId: { in: ids } },
        _sum: { qty: true },
      }),
      tx.stockMovement.groupBy({
        by: ["productId"],
        where: { tenantId, branchId, productId: { in: ids }, occurredAt: { gte: from }, ...sales },
        _sum: { qty: true },
      }),
      // Distinct posted days — every product, so a dish nobody ordered on a
      // posted day still counts that day as a day it was not used.
      tx.stockMovement.groupBy({
        by: ["occurredAt"],
        where: { tenantId, branchId, occurredAt: { gte: from }, sourceType: "SALES_CONSUMPTION", type: "CONSUMPTION" },
      }),
      tx.parLevel.findMany({
        where: { tenantId, branchId, productId: { in: ids }, deletedAt: null },
        select: { productId: true, parQty: true },
      }),
    ]);

    const dayKeys = new Set(days.map((d) => isoDate(d.occurredAt)));
    const postedDays = dayKeys.size;
    const postedThrough = postedDays === 0 ? null : [...dayKeys].sort().at(-1)!;
    const facts: Record<string, IngredientFact> = {};
    for (const id of ids) {
      const onHand = num(balances.find((b) => b.productId === id)?._sum.qty);
      const taken = -num(used.find((u) => u.productId === id)?._sum.qty);
      const usedPerDay = postedDays > 0 && taken > 0 ? taken / postedDays : null;
      const parRow = pars.find((p) => p.productId === id);
      const par = parRow ? num(parRow.parQty) : null;
      facts[id] = {
        productId: id,
        onHand,
        usedPerDay,
        daysLeft: usedPerDay ? Math.max(0, Math.floor(onHand / usedPerDay)) : null,
        par,
        belowPar: par !== null && onHand < par,
      };
    }
    return { facts, postedThrough, postedDays };
  });
}

// ------------------------------------------------------------
// The sheet: one dish, at one branch, today
// ------------------------------------------------------------

export type SheetLine = {
  ingredientId: string;
  kind: "product" | "menu";
  productId: string | null;
  componentMenuId: string | null;
  label: string;
  sku: string | null;
  prepped: boolean;
  qty: number;
  unitId: string | null;
  unitName: string | null;
  /** The chosen unit in base units — what turns a cost per base into this line's. */
  toBaseRatio: number;
  notes: string | null;
  /** Baht for this line in ONE writing of the recipe; null without the ticket. */
  cost: number | null;
};

export type MenuSheetRecipe = {
  id: string;
  lineId: string;
  /** Empty = central. */
  branchIds: string[];
  branchNames: string[];
  servings: number;
  notes: string | null;
  effectiveFrom: string;
  lines: SheetLine[];
  costPerServing: number | null;
  confidence: RecipeConfidence | null;
  /** Names of ingredients nobody has bought here — the reason for LOW. */
  unpriced: string[];
};

export type MenuSheet = {
  recipe: MenuSheetRecipe | null;
  /** Every version of the line that applies here, newest first. */
  history: { recipeId: string; effectiveFrom: string; isCurrent: boolean; isSuperseded: boolean }[];
  facts: IngredientFacts;
};

export async function getMenuSheetLogic(
  tenantId: string,
  query: { menuId: string; branchId: string },
  cost: CostAccess | null
): Promise<MenuSheet> {
  const today = computeBangkokToday();
  const base = await withTenantContext(tenantId, async (tx) => {
    const resolved = await resolveRecipeIds(tx, tenantId, [{ kind: "menu", id: query.menuId }], query.branchId, today);
    const hit = resolved.get(`menu:${query.menuId}`);
    if (hit === undefined) return null;
    const [recipe, links, versions] = await Promise.all([
      tx.recipe.findFirstOrThrow({
        where: { id: hit.id, tenantId },
        select: {
          id: true,
          lineId: true,
          menuId: true,
          servings: true,
          notes: true,
          effectiveFrom: true,
          ingredients: {
            orderBy: { sortOrder: "asc" },
            select: {
              id: true,
              productId: true,
              componentMenuId: true,
              qty: true,
              productUnitId: true,
              notes: true,
              product: { select: { name: true, sku: true, type: true } },
              componentMenu: { select: { name: true } },
              productUnit: { select: { unitName: true, toBaseRatio: true } },
            },
          },
        },
      }),
      tx.recipeBranch.findMany({
        where: { tenantId, lineId: hit.lineId },
        select: { branchId: true, branch: { select: { name: true } } },
      }),
      tx.recipe.findMany({
        where: { tenantId, lineId: hit.lineId, deletedAt: null, isDraft: false },
        select: { id: true, effectiveFrom: true, supersededAt: true },
        orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      }),
    ]);
    return { recipe, links, versions };
  });

  if (base === null) {
    return { recipe: null, history: [], facts: { facts: {}, postedThrough: null, postedDays: 0 } };
  }
  const { recipe, links, versions } = base;
  const productIds = recipe.ingredients.flatMap((i) => (i.productId ? [i.productId] : []));
  const [walk, facts] = await Promise.all([
    cost === null ? Promise.resolve(null) : getRecipeCostLogic(tenantId, { recipeId: recipe.id, branchId: query.branchId, asOf: today }),
    getIngredientFactsLogic(tenantId, query.branchId, productIds),
  ]);
  const lineCost = new Map((walk?.lines ?? []).map((l) => [l.ingredientId, Number(l.cost)]));

  return {
    recipe: {
      id: recipe.id,
      lineId: recipe.lineId,
      branchIds: links.map((l) => l.branchId),
      branchNames: links.map((l) => l.branch.name).sort((a, b) => a.localeCompare(b, "th")),
      servings: Number(recipe.servings),
      notes: recipe.notes,
      effectiveFrom: isoDate(recipe.effectiveFrom),
      lines: recipe.ingredients.map((i) => ({
        ingredientId: i.id,
        kind: i.componentMenuId ? ("menu" as const) : ("product" as const),
        productId: i.productId,
        componentMenuId: i.componentMenuId,
        label: i.product?.name ?? i.componentMenu?.name ?? "—",
        sku: i.product?.sku ?? null,
        prepped: i.product?.type === "PREPPED",
        qty: Number(i.qty),
        unitId: i.productUnitId,
        unitName: i.productUnit?.unitName ?? null,
        toBaseRatio: i.productUnit ? Number(i.productUnit.toBaseRatio) : 1,
        notes: i.notes,
        cost: walk === null ? null : (lineCost.get(i.id) ?? 0),
      })),
      costPerServing: walk === null ? null : Number(walk.costPerServing),
      confidence: walk?.confidence ?? null,
      unpriced: (walk?.unpriced ?? []).map((u) => u.name),
    },
    history: versions.map((v) => ({
      recipeId: v.id,
      effectiveFrom: isoDate(v.effectiveFrom),
      isSuperseded: v.supersededAt !== null,
      isCurrent: v.id === recipe.id,
    })),
    facts,
  };
}

// ------------------------------------------------------------
// What can go into a recipe — the adder's list, priced at one branch
// ------------------------------------------------------------

export type IngredientOption = {
  kind: "product" | "menu";
  id: string;
  name: string;
  sku: string | null;
  prepped: boolean;
  units: { id: string; unitName: string; toBaseRatio: number; isBase: boolean }[];
  /** Baht per base unit (per serving for a menu); null without the ticket or a price. */
  costPerBase: number | null;
};

/**
 * Every product and every dish that can be an ingredient, with what one base
 * unit costs at this branch. RAW from the FIFO replay; PREPPED and menus from
 * the recipe walk at the same branch — the two sources the walk itself uses, so
 * an estimate built from these agrees with the figure the save will produce.
 */
export async function getIngredientOptionsLogic(
  tenantId: string,
  branchId: string,
  cost: CostAccess | null
): Promise<IngredientOption[]> {
  const [products, menus] = await withTenantContext(tenantId, (tx) =>
    Promise.all([
      tx.product.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        select: {
          id: true,
          name: true,
          sku: true,
          type: true,
          parentProductId: true,
          yieldPercent: true,
          productUnits: { select: { id: true, unitName: true, toBaseRatio: true, isBase: true }, orderBy: { displayOrder: "asc" } },
        },
        orderBy: { name: "asc" },
      }),
      tx.menu.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        select: { id: true, name: true, posMenuId: true },
        orderBy: { name: "asc" },
      }),
    ])
  );

  let raw = new Map<string, number>();
  let walked = new Map<string, number>();
  if (cost !== null) {
    const [fifo, list] = await Promise.all([
      getProductCostsLogic(tenantId, { productIds: products.map((p) => p.id), branchId }),
      getRecipeListLogic(tenantId, { branchId, missingOnly: false }, cost),
    ]);
    raw = new Map([...fifo].map(([id, c]) => [id, Number(c.costPerBaseUnit)]));
    walked = new Map(
      [...list.menus, ...list.prepped].flatMap((r) => (r.costPerServing === null ? [] : [[r.targetId, Number(r.costPerServing)] as const]))
    );
  }

  const priceOf = (p: (typeof products)[number]): number | null => {
    if (cost === null) return null;
    if (p.type !== "PREPPED") return raw.get(p.id) ?? null;
    // A prepped product with stock is consumed from that stock first (ADR 0040
    // Q10, once built); until then the walk prices it through its recipe or its
    // parent ÷ yield.
    if (walked.has(p.id)) return walked.get(p.id)!;
    if (p.parentProductId && p.yieldPercent) {
      const parent = raw.get(p.parentProductId);
      return parent == null ? null : parent / (Number(p.yieldPercent) / 100);
    }
    return null;
  };

  return [
    ...products.map((p) => ({
      kind: "product" as const,
      id: p.id,
      name: p.name,
      sku: p.sku,
      prepped: p.type === "PREPPED",
      units: p.productUnits.map((u) => ({ id: u.id, unitName: u.unitName, toBaseRatio: Number(u.toBaseRatio), isBase: u.isBase })),
      costPerBase: priceOf(p),
    })),
    ...menus.map((m) => ({
      kind: "menu" as const,
      id: m.id,
      name: m.name,
      sku: m.posMenuId,
      prepped: false,
      units: [],
      costPerBase: cost === null ? null : (walked.get(m.id) ?? null),
    })),
  ];
}

// ------------------------------------------------------------
// One ingredient, opened over the dish
// ------------------------------------------------------------

export type IngredientInsight = {
  product: { id: string; name: string; sku: string; type: string; baseUnitName: string | null };
  facts: IngredientFacts;
  costPerBase: number | null;
  /** The last four confirmed receipts at this branch; null without the ticket. */
  receipts: { date: string; supplier: string; packUnit: string; qty: number; price: number; perBase: number }[] | null;
  /** Current recipes that use it, one row per recipe LINE. */
  usedIn: { menuId: string | null; label: string; qty: number; unitName: string | null; isCentral: boolean }[];
  /** How a PREPPED product is made; null for RAW. */
  made:
    | null
    | { how: "yield"; parentId: string; parentName: string; yieldPercent: number }
    | { how: "recipe"; recipeId: string; servings: number; lines: SheetLine[] }
    | { how: "none" };
};

export async function getIngredientInsightLogic(
  tenantId: string,
  query: { productId: string; branchId: string },
  cost: CostAccess | null
): Promise<IngredientInsight | null> {
  const today = computeBangkokToday();
  const base = await withTenantContext(tenantId, async (tx) => {
    const product = await tx.product.findFirst({
      where: { id: query.productId, tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        sku: true,
        type: true,
        yieldPercent: true,
        parentProduct: { select: { id: true, name: true } },
        productUnits: { where: { isBase: true }, select: { unitName: true } },
      },
    });
    if (product === null) return null;

    const [usage, receipts, produced] = await Promise.all([
      tx.recipeIngredient.findMany({
        where: {
          tenantId,
          productId: product.id,
          recipe: { deletedAt: null, supersededAt: null, isDraft: false, effectiveFrom: { lte: today } },
        },
        select: {
          qty: true,
          productUnit: { select: { unitName: true } },
          recipe: { select: { lineId: true, effectiveFrom: true, createdAt: true, menuId: true, menu: { select: { name: true } }, outputProduct: { select: { name: true } } } },
        },
      }),
      cost === null
        ? Promise.resolve([])
        : tx.goodsReceiptItem.findMany({
            where: { tenantId, productId: product.id, goodsReceipt: { branchId: query.branchId, status: "CONFIRMED" } },
            select: {
              qtyReceivedActual: true,
              receivedUnitName: true,
              toBaseRatio: true,
              unitPriceActual: true,
              goodsReceipt: { select: { receivedAt: true, supplier: { select: { nameShort: true, nameFull: true } } } },
            },
            orderBy: { goodsReceipt: { receivedAt: "desc" } },
            take: 4,
          }),
      product.type === "PREPPED"
        ? resolveRecipeIds(tx, tenantId, [{ kind: "product", id: product.id }], query.branchId, today)
        : Promise.resolve(new Map()),
    ]);

    const links = await tx.recipeBranch.findMany({
      where: { tenantId, lineId: { in: [...new Set(usage.map((u) => u.recipe.lineId))] } },
      select: { lineId: true },
    });
    return { product, usage, receipts, produced, branchLines: new Set(links.map((l) => l.lineId)) };
  });
  if (base === null) return null;
  const { product, usage, receipts, produced, branchLines } = base;

  // One row per LINE: only the newest version at or before today still governs.
  const newest = new Map<string, (typeof usage)[number]>();
  for (const u of usage) {
    const cur = newest.get(u.recipe.lineId);
    if (!cur || u.recipe.effectiveFrom > cur.recipe.effectiveFrom || (+u.recipe.effectiveFrom === +cur.recipe.effectiveFrom && u.recipe.createdAt > cur.recipe.createdAt)) {
      newest.set(u.recipe.lineId, u);
    }
  }

  const producedHit = produced.get(`product:${product.id}`);
  const [facts, fifo, producedSheet] = await Promise.all([
    getIngredientFactsLogic(tenantId, query.branchId, [product.id]),
    cost === null ? Promise.resolve(null) : getProductCostsLogic(tenantId, { productIds: [product.id], branchId: query.branchId }),
    producedHit === undefined ? Promise.resolve(null) : productionSheet(tenantId, producedHit.id, query.branchId, cost),
  ]);

  let made: IngredientInsight["made"] = null;
  if (product.type === "PREPPED") {
    if (producedSheet) made = producedSheet;
    else if (product.parentProduct && product.yieldPercent)
      made = { how: "yield", parentId: product.parentProduct.id, parentName: product.parentProduct.name, yieldPercent: Number(product.yieldPercent) };
    else made = { how: "none" };
  }

  let costPerBase: number | null = null;
  if (cost !== null) {
    if (product.type !== "PREPPED") costPerBase = Number(fifo!.get(product.id)!.costPerBaseUnit);
    else if (made?.how === "recipe") {
      const total = made.lines.reduce((s, l) => s + (l.cost ?? 0), 0);
      costPerBase = made.servings > 0 ? total / made.servings : null;
    } else if (made?.how === "yield") {
      const parent = await getProductCostsLogic(tenantId, { productIds: [made.parentId], branchId: query.branchId });
      costPerBase = Number(parent.get(made.parentId)!.costPerBaseUnit) / (made.yieldPercent / 100);
    }
  }

  return {
    product: { id: product.id, name: product.name, sku: product.sku, type: product.type, baseUnitName: product.productUnits[0]?.unitName ?? null },
    facts,
    costPerBase,
    receipts:
      cost === null
        ? null
        : receipts.map((r) => ({
            date: isoDate(r.goodsReceipt.receivedAt),
            supplier: r.goodsReceipt.supplier.nameShort ?? r.goodsReceipt.supplier.nameFull,
            packUnit: r.receivedUnitName,
            qty: Number(r.qtyReceivedActual),
            price: Number(r.unitPriceActual),
            perBase: Number(r.unitPriceActual) / Number(r.toBaseRatio),
          })),
    usedIn: [...newest.values()]
      .map((u) => ({
        menuId: u.recipe.menuId,
        label: u.recipe.menu?.name ?? u.recipe.outputProduct?.name ?? "—",
        qty: Number(u.qty),
        unitName: u.productUnit?.unitName ?? null,
        isCentral: !branchLines.has(u.recipe.lineId),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "th")),
    made,
  };
}

async function productionSheet(
  tenantId: string,
  recipeId: string,
  branchId: string,
  cost: CostAccess | null
): Promise<IngredientInsight["made"]> {
  const [recipe, walk] = await Promise.all([
    withTenantContext(tenantId, (tx) =>
      tx.recipe.findFirstOrThrow({
        where: { id: recipeId, tenantId },
        select: {
          servings: true,
          ingredients: {
            orderBy: { sortOrder: "asc" },
            select: {
              id: true,
              productId: true,
              componentMenuId: true,
              qty: true,
              productUnitId: true,
              notes: true,
              product: { select: { name: true, sku: true, type: true } },
              componentMenu: { select: { name: true } },
              productUnit: { select: { unitName: true, toBaseRatio: true } },
            },
          },
        },
      })
    ),
    cost === null ? Promise.resolve(null) : getRecipeCostLogic(tenantId, { recipeId, branchId, asOf: computeBangkokToday() }),
  ]);
  const lineCost = new Map((walk?.lines ?? []).map((l) => [l.ingredientId, Number(l.cost)]));
  return {
    how: "recipe",
    recipeId,
    servings: Number(recipe.servings),
    lines: recipe.ingredients.map((i) => ({
      ingredientId: i.id,
      kind: i.componentMenuId ? ("menu" as const) : ("product" as const),
      productId: i.productId,
      componentMenuId: i.componentMenuId,
      label: i.product?.name ?? i.componentMenu?.name ?? "—",
      sku: i.product?.sku ?? null,
      prepped: i.product?.type === "PREPPED",
      qty: Number(i.qty),
      unitId: i.productUnitId,
      unitName: i.productUnit?.unitName ?? null,
      toBaseRatio: i.productUnit ? Number(i.productUnit.toBaseRatio) : 1,
      notes: i.notes,
      cost: walk === null ? null : (lineCost.get(i.id) ?? 0),
    })),
  };
}
