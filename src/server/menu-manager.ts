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

import { Prisma, type PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import type { CostAccess } from "@/lib/permissions/cost-access";
import { resolveRecipeIds, type RecipeTarget } from "@/server/recipe-resolve";
import { recipeCostsInTx, type RecipeConfidence } from "@/server/recipe-cost";
import { replayPairsInTx } from "@/server/stock-cost";
import { getDraftsLogic, getLabWhatIfLogic } from "@/server/menu-lab-read";
import type { LabWhatIfQuery } from "@/lib/validations/menu-lab";
import type { BranchReach } from "@/lib/permissions/service";

/** The window "used per day" is measured over. */
export const INGREDIENT_FACT_DAYS = 30;

const num = (d: Prisma.Decimal | null | undefined) => (d == null ? 0 : Number(d));
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

// ------------------------------------------------------------
// The price book: every price the screen shows, for one branch, ONCE
// ------------------------------------------------------------
// Measured 2026-10-04 (Kong: "หน้าไหนโหลดช้า"): the page priced every recipe
// before it painted (2.5 s), the sheet walked its recipe again (2.5 s) and the
// adder priced every recipe a third time (1.9 s). One read now answers all
// three, in the background after the list is on screen, and the client keeps it
// per branch — the profit-view pattern from /sales (mise-ui-review §5b).
//
// The numbers are the same functions as before, not a copy of them: the recipe
// walk (`recipeCostsInTx`, ADR 0021) for menus and production recipes, the FIFO
// replay (`replayPairsInTx`, ADR 0014) for raw products, parent ÷ yield for a
// parent + yield product — exactly what the walk does one level down.

export type PriceBook = {
  /** Every menu with a recipe at this branch today. */
  menus: Record<string, { recipeId: string; own: boolean; costPerServing: number | null; confidence: RecipeConfidence | null }>;
  /** Baht per BASE unit at this branch; absent = nobody has bought it here. */
  products: Record<string, number>;
};

export async function getMenuPriceBookLogic(
  tenantId: string,
  branchId: string,
  cost: CostAccess | null
): Promise<PriceBook> {
  if (cost === null) return { menus: {}, products: {} };
  const today = computeBangkokToday();

  const [walked, fifo] = await Promise.all([
    withTenantContext(
      tenantId,
      async (tx) => {
        const [menus, prepped] = await Promise.all([
          tx.menu.findMany({ where: { tenantId, deletedAt: null }, select: { id: true } }),
          tx.product.findMany({
            where: { tenantId, deletedAt: null, type: "PREPPED" },
            select: { id: true, parentProductId: true, yieldPercent: true },
          }),
        ]);
        const targets: RecipeTarget[] = [
          ...menus.map((m) => ({ kind: "menu" as const, id: m.id })),
          ...prepped.map((p) => ({ kind: "product" as const, id: p.id })),
        ];
        const resolved = await resolveRecipeIds(tx, tenantId, targets, branchId, today);
        const hits = [...resolved.values()];
        const lineIds = [...new Set(hits.map((r) => r.lineId))];
        const [own, costs] = await Promise.all([
          lineIds.length === 0
            ? Promise.resolve([] as { lineId: string }[])
            : tx.recipeBranch.findMany({ where: { tenantId, branchId, lineId: { in: lineIds } }, select: { lineId: true } }),
          hits.length === 0 ? Promise.resolve(new Map()) : recipeCostsInTx(tx, tenantId, { recipeIds: [...new Set(hits.map((h) => h.id))], branchId, asOf: today }),
        ]);
        return { menus, prepped, resolved, own: new Set(own.map((o) => o.lineId)), costs };
      },
      { timeout: 20_000 }
    ),
    withTenantContext(
      tenantId,
      async (tx) => {
        const products = await tx.product.findMany({ where: { tenantId, deletedAt: null }, select: { id: true } });
        return replayPairsInTx(tx, tenantId, products.map((p) => p.id), [branchId], today);
      },
      { timeout: 20_000 }
    ),
  ]);

  const book: PriceBook = { menus: {}, products: {} };
  for (const [key, row] of walked.resolved) {
    const c = walked.costs.get(row.id);
    if (key.startsWith("menu:")) {
      book.menus[key.slice(5)] = {
        recipeId: row.id,
        own: walked.own.has(row.lineId),
        costPerServing: c?.costPerServing == null ? null : Number(c.costPerServing),
        confidence: c?.confidence ?? null,
      };
    } else if (c?.costPerServing != null) {
      // A production recipe's servings are its OUTPUT in base units, so its
      // cost per serving IS its cost per base unit.
      book.products[key.slice(8)] = Number(c.costPerServing);
    }
  }
  for (const [key, c] of fifo) {
    const productId = key.split("|")[0];
    // UNPRICED is "nobody has bought this here", never "free".
    if (c.costSource !== "UNPRICED" && !(productId in book.products)) book.products[productId] = Number(c.costPerBaseUnit);
  }
  for (const p of walked.prepped) {
    if (p.id in book.products && !walked.resolved.has(`product:${p.id}`)) delete book.products[p.id]; // FIFO of a prepped item is not its price yet
    if (!(p.id in book.products) && p.parentProductId && p.yieldPercent) {
      const parent = book.products[p.parentProductId];
      if (parent !== undefined) book.products[p.id] = parent / (Number(p.yieldPercent) / 100);
    }
  }
  return book;
}

/**
 * Which menus have a recipe at this branch today, and whether it is the
 * branch's own — what the LIST needs before any price: the สูตร column, the
 * "ยังไม่มีสูตร" chip and the coverage share. One transaction, no walk.
 */
export async function getMenuRecipeStatusLogic(
  tenantId: string,
  branchId: string
): Promise<Record<string, { recipeId: string; own: boolean }>> {
  const today = computeBangkokToday();
  return withTenantContext(tenantId, async (tx) => {
    const menus = await tx.menu.findMany({ where: { tenantId, deletedAt: null }, select: { id: true } });
    const resolved = await resolveRecipeIds(tx, tenantId, menus.map((m) => ({ kind: "menu" as const, id: m.id })), branchId, today);
    const lineIds = [...new Set([...resolved.values()].map((r) => r.lineId))];
    const own =
      lineIds.length === 0
        ? new Set<string>()
        : new Set(
            (await tx.recipeBranch.findMany({ where: { tenantId, branchId, lineId: { in: lineIds } }, select: { lineId: true } })).map((l) => l.lineId)
          );
    const out: Record<string, { recipeId: string; own: boolean }> = {};
    for (const [key, row] of resolved) out[key.slice(5)] = { recipeId: row.id, own: own.has(row.lineId) };
    return out;
  });
}

// ------------------------------------------------------------
// Stock facts per ingredient
// ------------------------------------------------------------

export type IngredientFact = {
  productId: string;
  baseUnitName: string | null;
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
  if (productIds.length === 0) return { facts: {}, postedThrough: null, postedDays: 0 };
  return withTenantContext(tenantId, (tx) => ingredientFactsInTx(tx, tenantId, branchId, productIds));
}

/** The same read inside a caller's transaction — one BEGIN fewer per sheet. */
export async function ingredientFactsInTx(
  tx: PrismaClient,
  tenantId: string,
  branchId: string,
  productIds: string[]
): Promise<IngredientFacts> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return { facts: {}, postedThrough: null, postedDays: 0 };
  const to = computeBangkokToday();
  const from = addDays(to, -(INGREDIENT_FACT_DAYS - 1));
  {
    const sales = { sourceType: "SALES_CONSUMPTION" as const, type: { in: ["CONSUMPTION", "CONSUMPTION_REVERSAL"] as ("CONSUMPTION" | "CONSUMPTION_REVERSAL")[] } };
    const [units, balances, used, days, pars] = await Promise.all([
      tx.productUnit.findMany({ where: { productId: { in: ids }, isBase: true }, select: { productId: true, unitName: true } }),
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
        baseUnitName: units.find((u) => u.productId === id)?.unitName ?? null,
        onHand,
        usedPerDay,
        daysLeft: usedPerDay ? Math.max(0, Math.floor(onHand / usedPerDay)) : null,
        par,
        belowPar: par !== null && onHand < par,
      };
    }
    return { facts, postedThrough, postedDays };
  }
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
};

export type MenuSheet = {
  recipe: MenuSheetRecipe | null;
  /** Every version of the line that applies here, newest first. */
  history: { recipeId: string; effectiveFrom: string; isCurrent: boolean; isSuperseded: boolean }[];
  facts: IngredientFacts;
};

/**
 * No money here: the client prices the lines from the branch's price book,
 * which it already holds (getMenuPriceBookLogic) — walking the recipe again on
 * every open was the 2.5 s the sheet used to take.
 */
export async function getMenuSheetLogic(
  tenantId: string,
  query: { menuId: string; branchId: string }
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
            select: INGREDIENT_SELECT,
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
    const facts = await ingredientFactsInTx(
      tx,
      tenantId,
      query.branchId,
      recipe.ingredients.flatMap((i) => (i.productId ? [i.productId] : []))
    );
    return { recipe, links, versions, facts };
  });

  if (base === null) {
    return { recipe: null, history: [], facts: { facts: {}, postedThrough: null, postedDays: 0 } };
  }
  const { recipe, links, versions, facts } = base;

  return {
    recipe: {
      id: recipe.id,
      lineId: recipe.lineId,
      branchIds: links.map((l) => l.branchId),
      branchNames: links.map((l) => l.branch.name).sort((a, b) => a.localeCompare(b, "th")),
      servings: Number(recipe.servings),
      notes: recipe.notes,
      effectiveFrom: isoDate(recipe.effectiveFrom),
      lines: recipe.ingredients.map(toSheetLine),
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

const INGREDIENT_SELECT = {
  id: true,
  productId: true,
  componentMenuId: true,
  qty: true,
  productUnitId: true,
  notes: true,
  product: { select: { name: true, sku: true, type: true } },
  componentMenu: { select: { name: true } },
  productUnit: { select: { unitName: true, toBaseRatio: true } },
} as const;

type IngredientRow = {
  id: string;
  productId: string | null;
  componentMenuId: string | null;
  qty: Prisma.Decimal;
  productUnitId: string | null;
  notes: string | null;
  product: { name: string; sku: string; type: string } | null;
  componentMenu: { name: string } | null;
  productUnit: { unitName: string; toBaseRatio: Prisma.Decimal } | null;
};
const toSheetLine = (i: IngredientRow): SheetLine => ({
  ingredientId: i.id,
  kind: i.componentMenuId ? "menu" : "product",
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
});

// ------------------------------------------------------------
// What can go into a recipe — the adder's list, priced at one branch
// ------------------------------------------------------------

export type IngredientOption = {
  kind: "product" | "menu";
  id: string;
  name: string;
  sku: string | null;
  prepped: boolean;
  /** WEIGHT | VOLUME | COUNT — which standard measures apply without setup. */
  dimension: string;
  units: { id: string; unitName: string; toBaseRatio: number; isBase: boolean }[];
};

/** A standard measure (unit_template, Thai names only): what one is in grams or ml. */
export type StandardUnit = { unitName: string; dimension: string; si: number };

/** Every product and dish that can be an ingredient. Prices come from the price book. */
export async function getIngredientOptionsLogic(
  tenantId: string
): Promise<{ options: IngredientOption[]; standards: StandardUnit[] }> {
  const [products, menus, templates] = await withTenantContext(tenantId, (tx) =>
    Promise.all([
      tx.product.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        select: {
          id: true,
          name: true,
          sku: true,
          type: true,
          primaryDimension: true,
          productUnits: { select: { id: true, unitName: true, toBaseRatio: true, isBase: true }, orderBy: { displayOrder: "asc" } },
        },
        orderBy: { name: "asc" },
      }),
      tx.menu.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        select: { id: true, name: true, posMenuId: true },
        orderBy: { name: "asc" },
      }),
      // Global reference data, not tenant-scoped. English spellings (g, kg) are
      // the same sizes as the Thai ones and would only double the list.
      tx.unitTemplate.findMany({
        where: { toSiRatio: { not: null }, displayOrderEn: null },
        select: { unitName: true, unitDimension: true, toSiRatio: true },
        orderBy: [{ unitDimension: "asc" }, { displayOrderTh: "asc" }],
      }),
    ])
  );
  const options: IngredientOption[] = [
    ...products.map((p) => ({
      kind: "product" as const,
      id: p.id,
      name: p.name,
      sku: p.sku,
      prepped: p.type === "PREPPED",
      dimension: p.primaryDimension,
      units: p.productUnits.map((u) => ({ id: u.id, unitName: u.unitName, toBaseRatio: Number(u.toBaseRatio), isBase: u.isBase })),
    })),
    ...menus.map((m) => ({ kind: "menu" as const, id: m.id, name: m.name, sku: m.posMenuId, prepped: false, dimension: "COUNT", units: [] })),
  ];
  return {
    options,
    standards: templates.map((t) => ({ unitName: t.unitName, dimension: t.unitDimension, si: Number(t.toSiRatio) })),
  };
}

// ------------------------------------------------------------
// One ingredient, opened over the dish
// ------------------------------------------------------------

export type IngredientInsight = {
  product: { id: string; name: string; sku: string; type: string; baseUnitName: string | null };
  facts: IngredientFacts;
  /** The last four confirmed receipts at this branch; null without the ticket. */
  receipts: { date: string; supplier: string; packUnit: string; qty: number; price: number; perBase: number }[] | null;
  /** Current recipes that use it, one row per recipe LINE. */
  usedIn: { menuId: string | null; label: string; qty: number; unitName: string | null; isCentral: boolean }[];
  /** How a PREPPED product is made; null for RAW. Priced by the client's price book. */
  made:
    | null
    | { how: "yield"; parentId: string; parentName: string; yieldPercent: number }
    | { how: "recipe"; recipeId: string; servings: number; lines: SheetLine[] }
    | { how: "none" };
};

/**
 * Everything the stacked sheet shows about one product. The reads do not
 * depend on each other, so they run side by side (stock facts, the product and
 * its usage, receipts) — the sheet waited on them one after another before.
 */
export async function getIngredientInsightLogic(
  tenantId: string,
  query: { productId: string; branchId: string },
  cost: CostAccess | null
): Promise<IngredientInsight | null> {
  const today = computeBangkokToday();
  const [base, facts] = await Promise.all([
    withTenantContext(tenantId, async (tx) => {
      const [product, usage, receipts, produced] = await Promise.all([
        tx.product.findFirst({
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
        }),
        tx.recipeIngredient.findMany({
          where: {
            tenantId,
            productId: query.productId,
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
              where: { tenantId, productId: query.productId, goodsReceipt: { branchId: query.branchId, status: "CONFIRMED" } },
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
        resolveRecipeIds(tx, tenantId, [{ kind: "product", id: query.productId }], query.branchId, today),
      ]);
      if (product === null) return null;
      const hit = produced.get(`product:${product.id}`);
      const [links, recipe] = await Promise.all([
        tx.recipeBranch.findMany({
          where: { tenantId, lineId: { in: [...new Set(usage.map((u) => u.recipe.lineId))] } },
          select: { lineId: true },
        }),
        hit === undefined
          ? Promise.resolve(null)
          : tx.recipe.findFirst({
              where: { id: hit.id, tenantId },
              select: {
                id: true,
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
            }),
      ]);
      return { product, usage, receipts, recipe, branchLines: new Set(links.map((l) => l.lineId)) };
    }),
    getIngredientFactsLogic(tenantId, query.branchId, [query.productId]),
  ]);
  if (base === null) return null;
  const { product, usage, receipts, recipe, branchLines } = base;

  // One row per LINE: only the newest version at or before today still governs.
  const newest = new Map<string, (typeof usage)[number]>();
  for (const u of usage) {
    const cur = newest.get(u.recipe.lineId);
    if (!cur || u.recipe.effectiveFrom > cur.recipe.effectiveFrom || (+u.recipe.effectiveFrom === +cur.recipe.effectiveFrom && u.recipe.createdAt > cur.recipe.createdAt)) {
      newest.set(u.recipe.lineId, u);
    }
  }

  let made: IngredientInsight["made"] = null;
  if (product.type === "PREPPED") {
    if (recipe) made = { how: "recipe", recipeId: recipe.id, servings: Number(recipe.servings), lines: recipe.ingredients.map(toSheetLine) };
    else if (product.parentProduct && product.yieldPercent)
      made = { how: "yield", parentId: product.parentProduct.id, parentName: product.parentProduct.name, yieldPercent: Number(product.yieldPercent) };
    else made = { how: "none" };
  }

  return {
    product: { id: product.id, name: product.name, sku: product.sku, type: product.type, baseUnitName: product.productUnits[0]?.unitName ?? null },
    facts,
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

// ------------------------------------------------------------
// ทดลองเมนู — drafts with their lines (Kong 2026-10-04)
// ------------------------------------------------------------
// The lab list prices every draft from the branch's price book in the browser,
// the same book "จัดการเมนู" uses, so it needs the LINES, not just a count.
// A draft is still costed by the engine (ADR 0025 Q4) — the lab asks
// `what=lab` after each save and shows that figure with its confidence; the
// book only answers while somebody types.

export type LabDraft = {
  recipeId: string;
  menuId: string;
  menuName: string;
  posCode: string | null;
  /** The lab made this menu — no POS knows it yet. */
  menuIsMise: boolean;
  menuCategoryId: string | null;
  servings: number;
  plannedPrice: number | null;
  notes: string | null;
  updatedAt: string;
  /** Publishing takes over this live central recipe. */
  liveRecipeId: string | null;
  hasSales: boolean;
  lines: SheetLine[];
};

export async function getLabDraftsLogic(tenantId: string): Promise<LabDraft[]> {
  const [rows, detail] = await Promise.all([
    getDraftsLogic(tenantId),
    withTenantContext(tenantId, (tx) =>
      tx.recipe.findMany({
        where: { tenantId, isDraft: true, deletedAt: null },
        select: {
          id: true,
          notes: true,
          menu: { select: { posMenuId: true, menuCategoryId: true } },
          ingredients: { orderBy: { sortOrder: "asc" }, select: INGREDIENT_SELECT },
        },
      })
    ),
  ]);
  const byId = new Map(detail.map((d) => [d.id, d]));
  return rows.map((r) => {
    const d = byId.get(r.recipeId);
    return {
      recipeId: r.recipeId,
      menuId: r.menuId,
      menuName: r.menuName,
      posCode: d?.menu?.posMenuId ?? null,
      menuIsMise: r.menuIsMise,
      menuCategoryId: d?.menu?.menuCategoryId ?? null,
      servings: Number(r.servings),
      plannedPrice: r.plannedPrice === null ? null : Number(r.plannedPrice),
      notes: d?.notes ?? null,
      updatedAt: r.updatedAt.toISOString(),
      liveRecipeId: r.liveRecipeId,
      hasSales: r.hasSales,
      lines: (d?.ingredients ?? []).map(toSheetLine),
    };
  });
}

/** A saved draft, costed by the engine at one branch — the figure the lab trusts. */
export async function getLabDraftCostLogic(
  tenantId: string,
  query: { recipeId: string; branchId: string },
  reach: BranchReach
): Promise<{ costPerServing: number; confidence: RecipeConfidence; unpriced: string[] } | null> {
  const draft = await withTenantContext(tenantId, (tx) =>
    tx.recipe.findFirst({
      where: { id: query.recipeId, tenantId, isDraft: true, deletedAt: null },
      select: {
        servings: true,
        ingredients: {
          orderBy: { sortOrder: "asc" },
          select: { productId: true, componentMenuId: true, qty: true, productUnitId: true, sortOrder: true },
        },
      },
    })
  );
  if (draft === null) return null;
  const res = await getLabWhatIfLogic(
    tenantId,
    {
      branchId: query.branchId,
      servings: Number(draft.servings),
      plannedPrice: null,
      ingredients: draft.ingredients.map((i) => ({
        productId: i.productId,
        componentMenuId: i.componentMenuId,
        qty: Number(i.qty),
        productUnitId: i.productUnitId,
        sortOrder: i.sortOrder,
      })),
    } as LabWhatIfQuery,
    reach
  );
  return {
    costPerServing: Number(res.cost.costPerServing),
    confidence: res.cost.confidence,
    unpriced: res.cost.unpriced.map((u) => u.name),
  };
}
