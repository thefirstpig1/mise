// ============================================================
// คิดครัว — recipes from a file: read it, then write the reviewed drafts
// ============================================================
// The rules live in src/lib/recipe-import.ts, shared with the review screen.
// The write is ONE transaction: products the person chose to create, units the
// recipes used, MISE menus for dishes not in the POS yet, and the recipes —
// every one a DRAFT (Part 24): it resolves on no day, so it moves no stock and
// no cost until the shop presses "ใช้สูตร" for that dish in ทดลองเมนู. A
// shop-made component's recipe (น้ำซุป) is a production recipe instead, written
// LIVE through `createRecipeInTx` so every guard the recipe form runs still runs
// (Kong 2026-10-30, "เอาตามที่แนะนำ").
// ============================================================

import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma, withTenantContext } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { MAX_BACKDATE_DAYS } from "@/lib/validations/stock-movement";
import { recipeInputSchema } from "@/lib/validations/recipe";
import { RECIPE_SHEET, splitPastedTable, nameKey } from "@/lib/product-import";
import { readRecipeTable, type RecipeContext, type RecipeSave, type RecipeTableResult } from "@/lib/recipe-import";
import { convertToPreppedInTx, ensureProductUnitInTx } from "@/server/product";
import { createRecipeInTx } from "@/server/recipe";
import { importProductsInTx, loadImportGrids } from "@/server/product-import";

/**
 * The day a shop-made recipe starts: the shop's first sales day, so a month of
 * sales imported before the recipes can be posted against it — never earlier
 * than the ledger accepts (ADR 0011 Q5), and today for a shop with no sales.
 */
export async function madeFromDay(tx: PrismaClient, tenantId: string): Promise<Date> {
  const today = computeBangkokToday();
  const first = await tx.salesDay.findFirst({ where: { tenantId }, orderBy: { businessDate: "asc" }, select: { businessDate: true } });
  if (first === null) return today;
  const floor = addDays(today, -MAX_BACKDATE_DAYS);
  return first.businessDate < floor ? floor : first.businessDate > today ? today : first.businessDate;
}

export async function getRecipeContextLogic(tenantId: string, canCreateProducts: boolean): Promise<RecipeContext> {
  const [facts, templates] = await Promise.all([
    withTenantContext(tenantId, async (tx) => {
      const menus = await tx.menu.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, name: true, posMenuId: true },
        orderBy: { name: "asc" },
      });
      // A menu merged into another is another spelling of it (Part 25): the
      // recipe belongs on the winner.
      const losers = new Set(
        (await tx.menuMerge.findMany({ where: { tenantId, revokedAt: null }, select: { losingMenuId: true } })).map((m) => m.losingMenuId)
      );
      const recipes = await tx.recipe.findMany({
        where: { tenantId, deletedAt: null, supersededAt: null },
        select: { menuId: true, outputProductId: true, isDraft: true },
      });
      const products = await tx.product.findMany({
        where: { tenantId, deletedAt: null },
        select: {
          id: true,
          name: true,
          sku: true,
          type: true,
          parentProductId: true,
          primaryDimension: true,
          productUnits: { select: { id: true, unitName: true, toBaseRatio: true, isBase: true } },
        },
        orderBy: { name: "asc" },
      });
      // ADR 0040: a part of a trim recipe is made one way already.
      const trimParts = await tx.trimRecipePart.findMany({ where: { tenantId, deletedAt: null, trimRecipe: { deletedAt: null } }, select: { productId: true } });
      const madeFrom = await madeFromDay(tx, tenantId);
      return { menus: menus.filter((m) => !losers.has(m.id)), recipes, products, trimParts, madeFrom };
    }),
    prisma.unitTemplate.findMany({ select: { unitName: true, unitDimension: true, toSiRatio: true } }),
  ]);
  const menuRecipes = facts.recipes.filter((r) => r.menuId !== null);
  const live = new Set(menuRecipes.filter((r) => !r.isDraft).map((r) => r.menuId!));
  const drafts = new Map<string, number>();
  for (const r of menuRecipes) if (r.isDraft) drafts.set(r.menuId!, (drafts.get(r.menuId!) ?? 0) + 1);
  const produced = new Set(facts.recipes.filter((r) => r.outputProductId !== null && !r.isDraft).map((r) => r.outputProductId!));
  const trimmed = new Set(facts.trimParts.map((t) => t.productId));
  return {
    menus: facts.menus.map((m) => ({ id: m.id, name: m.name, code: m.posMenuId, hasRecipe: live.has(m.id), drafts: drafts.get(m.id) ?? 0 })),
    products: facts.products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      dimension: p.primaryDimension,
      type: p.type === "PREPPED" ? "PREPPED" : "RAW",
      made: produced.has(p.id) ? "RECIPE" : p.parentProductId !== null || trimmed.has(p.id) ? "TRIM" : null,
      units: p.productUnits.map((u) => ({ id: u.id, unitName: u.unitName, toBaseRatio: Number(u.toBaseRatio), isBase: u.isBase })),
    })),
    templates: templates.map((t) => ({ unitName: t.unitName, unitDimension: t.unitDimension, toSiRatio: t.toSiRatio === null ? null : Number(t.toSiRatio) })),
    canCreateProducts,
    madeFrom: facts.madeFrom.toISOString().slice(0, 10),
  };
}

export async function readRecipeFile(bytes: Uint8Array, fileName: string): Promise<RecipeTableResult | { error: "UNREADABLE" | "UNSUPPORTED" }> {
  const grids = await loadImportGrids(bytes, fileName);
  if ("error" in grids) return grids;
  const named = grids.find((g) => g.name === RECIPE_SHEET);
  if (named) return readRecipeTable(named.grid);
  for (const g of grids) {
    const t = readRecipeTable(g.grid);
    if (t.ok) return t;
  }
  return readRecipeTable(grids[0]?.grid ?? []);
}

export function readRecipeText(text: string): RecipeTableResult {
  return readRecipeTable(splitPastedTable(text));
}

// ------------------------------------------------------------
// The write
// ------------------------------------------------------------

export class RecipeImportRefError extends Error {
  constructor(what: string) {
    super(`not a live ${what} of this tenant`);
    this.name = "RecipeImportRefError";
  }
}

export type RecipeImportOutcome = {
  drafts: number;
  /** Production recipes written live, and the day they start. */
  made: number;
  madeFrom: string;
  menusCreated: number;
  productsCreated: number;
  productsConverted: number;
  unitsAdded: number;
};

export async function importRecipesLogic(tenantId: string, save: RecipeSave, createdBy: string): Promise<RecipeImportOutcome> {
  return withTenantContext(tenantId, (tx) => importRecipesInTx(tx, tenantId, save, createdBy), { timeout: 60_000 });
}

async function importRecipesInTx(tx: PrismaClient, tenantId: string, save: RecipeSave, createdBy: string): Promise<RecipeImportOutcome> {
  // 1. Products chosen to be created from a recipe line, and the shop-made
  // things a recipe in the file makes (PREPPED).
  let productsCreated = 0;
  if (save.newProducts.length > 0) {
    const out = await importProductsInTx(
      tx,
      tenantId,
      save.newProducts.map((p) => ({ name: p.name, baseUnitName: p.baseUnitName, categoryId: null, extraUnit: null, prepped: p.prepped }))
    );
    productsCreated = out.created.length;
  }
  // An ingredient that turned out to have a recipe of its own.
  let productsConverted = 0;
  for (const id of save.convert) {
    if (!(await convertToPreppedInTx(tx, tenantId, id))) throw new RecipeImportRefError("product");
    productsConverted++;
  }
  const products = await tx.product.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true, productUnits: { select: { id: true, unitName: true } } },
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  const productByName = new Map(products.map((p) => [nameKey(p.name), p]));
  const productName = new Map(save.newProducts.map((p) => [p.ref, p.name]));
  const productOf = (ref: { id: string } | { ref: string }) => {
    const p = "id" in ref ? productById.get(ref.id) : productByName.get(nameKey(productName.get(ref.ref) ?? ""));
    if (!p) throw new RecipeImportRefError("product");
    return p;
  };

  // 2. Menus for dishes the POS has not reported yet — Mise's own (source MISE).
  const menuOf = new Map<string, string>();
  let menusCreated = 0;
  for (const m of save.newMenus) {
    const created = await tx.menu.create({ data: { tenantId, source: "MISE", name: m.name }, select: { id: true } });
    menuOf.set(m.ref, created.id);
    menusCreated++;
  }

  // 3. Units the recipes measured in that the product does not have yet.
  let unitsAdded = 0;
  const unitIdOf = new Map<string, string>();
  for (const r of [...save.recipes, ...save.made]) {
    for (const l of r.lines) {
      const p = productOf(l.product);
      const key = `${p.id}|${l.unitName}`;
      if (unitIdOf.has(key)) continue;
      const have = p.productUnits.find((u) => u.unitName === l.unitName);
      if (have) {
        unitIdOf.set(key, have.id);
        continue;
      }
      const u = await ensureProductUnitInTx(tx, tenantId, { productId: p.id, unitName: l.unitName, toBaseRatio: l.ratio });
      p.productUnits.push({ id: u.id, unitName: u.unitName });
      unitIdOf.set(key, u.id);
      unitsAdded++;
    }
  }

  // 4. The drafts, in two inserts. The references are checked in bulk rather
  // than per line (assertWriteRefsValid's way, one query each): every product
  // came out of this tenant's own list above and every unit out of that
  // product's own units, so what is left to prove is that each menu is live
  // and this tenant's. A hundred dishes of ten lines must not be two thousand
  // round trips to Singapore inside one transaction.
  const menuIds = [...new Set(save.recipes.map((r) => ("id" in r.menu ? r.menu.id : menuOf.get(r.menu.ref))))];
  if (menuIds.some((id) => id === undefined)) throw new RecipeImportRefError("menu");
  const liveMenus = await tx.menu.count({ where: { tenantId, deletedAt: null, id: { in: menuIds as string[] } } });
  if (liveMenus !== menuIds.length) throw new RecipeImportRefError("menu");

  // `effectiveFrom` means nothing while a recipe is a draft — publishing
  // stamps the one that counts (menu-lab.ts).
  const today = computeBangkokToday();
  const stamp = today.toISOString().slice(0, 10);
  const recipes = save.recipes.map((r) => ({ id: randomUUID(), r, menuId: ("id" in r.menu ? r.menu.id : menuOf.get(r.menu.ref))! }));
  await tx.recipe.createMany({
    data: recipes.map(({ id, r, menuId }) => ({
      id,
      tenantId,
      lineId: randomUUID(),
      menuId,
      outputProductId: null,
      servings: new Prisma.Decimal(r.servings),
      effectiveFrom: today,
      isDraft: true,
      draftStatus: "DRAFT" as const,
      notes: `นำเข้าจากไฟล์ ${stamp}`,
      createdBy,
    })),
  });
  await tx.recipeIngredient.createMany({
    data: recipes.flatMap(({ id, r }) =>
      r.lines.map((l, i) => {
        const p = productOf(l.product);
        return {
          tenantId,
          recipeId: id,
          productId: p.id,
          componentMenuId: null,
          qty: new Prisma.Decimal(l.qty),
          productUnitId: unitIdOf.get(`${p.id}|${l.unitName}`)!,
          sortOrder: i,
          notes: l.note,
        };
      })
    ),
  });

  // 5. The shop-made recipes, live, one at a time through the recipe form's own
  // write — the output must be PREPPED and made one way only, and the graph
  // must stay acyclic and within depth.
  const madeFrom = await madeFromDay(tx, tenantId);
  for (const m of save.made) {
    const output = productOf(m.output);
    await createRecipeInTx(
      tx,
      tenantId,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId: null,
        outputProductId: output.id,
        servings: m.servings,
        effectiveFrom: madeFrom,
        ingredients: m.lines.map((l, i) => {
          const p = productOf(l.product);
          return {
            productId: p.id,
            componentMenuId: null,
            qty: Math.round(l.qty * 1000) / 1000,
            productUnitId: unitIdOf.get(`${p.id}|${l.unitName}`)!,
            sortOrder: i,
            notes: l.note,
          };
        }),
        notes: `นำเข้าจากไฟล์ ${stamp}`,
      }),
      createdBy
    );
  }

  return {
    drafts: save.recipes.length,
    made: save.made.length,
    madeFrom: madeFrom.toISOString().slice(0, 10),
    menusCreated,
    productsCreated,
    productsConverted,
    unitsAdded,
  };
}
