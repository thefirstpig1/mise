// ============================================================
// คิวงานข้อ 5d — recipes from the file the shop's own AI prepared
// ============================================================
// Kong 2026-10-30 ("ต่อเรื่องนำเข้าสูตรเลย"). Every recipe lands as a DRAFT;
// a dish is matched to a menu, an ingredient to a product, a kitchen measure
// is asked once — and nothing is skipped by default, because a recipe missing
// an ingredient is wrong in silence.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prismaBypass, withRlsBypass } from "@/lib/db-admin";
import { splitPastedTable } from "@/lib/product-import";
import { draftRecipes, judgeIngredient, judgeRecipe, readRecipeTable, toRecipeSave, type RawRecipeRow, type RecipeContext } from "@/lib/recipe-import";
import { RecipeImportRefError, getRecipeContextLogic, importRecipesLogic } from "@/server/recipe-import";
import { UnitNeedsRatioError } from "@/server/product";
import { sweepTestTenants } from "./support/sweep";

const CTX: RecipeContext = {
  menus: [
    { id: "m-fried", name: "ข้าวผัดหมู", code: "M03", hasRecipe: false, drafts: 0 },
    { id: "m-krapao", name: "ข้าวกะเพราหมู", code: "M01", hasRecipe: true, drafts: 0 },
  ],
  products: [
    { id: "p-pork", name: "หมูสับ", sku: "P-1", dimension: "WEIGHT", units: [{ id: "u1", unitName: "kg", toBaseRatio: 1, isBase: true }] },
    { id: "p-rice", name: "ข้าวสวย", sku: "P-2", dimension: "WEIGHT", units: [{ id: "u2", unitName: "g", toBaseRatio: 1, isBase: true }] },
    { id: "p-oyster", name: "น้ำมันหอย", sku: "P-3", dimension: "VOLUME", units: [{ id: "u3", unitName: "ml", toBaseRatio: 1, isBase: true }] },
    { id: "p-basil", name: "กะเพรา", sku: "P-4", dimension: "WEIGHT", units: [{ id: "u4", unitName: "g", toBaseRatio: 1, isBase: true }] },
  ],
  templates: [
    { unitName: "g", unitDimension: "WEIGHT", toSiRatio: 1 },
    { unitName: "kg", unitDimension: "WEIGHT", toSiRatio: 1000 },
    { unitName: "ขีด", unitDimension: "WEIGHT", toSiRatio: 100 },
    { unitName: "ml", unitDimension: "VOLUME", toSiRatio: 1 },
    { unitName: "ช้อนโต๊ะ", unitDimension: "VOLUME", toSiRatio: 15 },
  ],
  canCreateProducts: true,
};

const row = (over: Partial<RawRecipeRow>): RawRecipeRow => ({ line: 2, menu: "", yieldQty: "1", yieldUnit: "จาน", ingredient: "", qty: "", unit: "", original: "", unsure: "", ...over });

describe("reading and drafting", () => {
  it("R-1 the recipes table is found by its header; a dish named once covers the lines under it", () => {
    const t = readRecipeTable(
      splitPastedTable(
        ["แผ่น “สูตร”", "ชื่อเมนู\tได้\tหน่วยที่ได้\tวัตถุดิบ\tปริมาณ\tหน่วย\tข้อความเดิม\tไม่แน่ใจ", "ข้าวผัดหมู\t1\tจาน\tหมูสับ\t1\tขีด\tหมูสับ 1 ขีด\t", "\t\t\tข้าวสวย\t1\tทัพพี\tข้าว 1 ทัพพี\t", "\t\t\t\t\t\t\t"].join("\n")
      )
    );
    expect(t.ok && t.rows.map((r) => [r.menu, r.ingredient, r.unit])).toEqual([
      ["ข้าวผัดหมู", "หมูสับ", "ขีด"],
      ["ข้าวผัดหมู", "ข้าวสวย", "ทัพพี"],
    ]);
    expect(readRecipeTable([["ชื่อ", "หน่วย"]])).toEqual({ ok: false, reason: "NO_HEADER" });
  });

  const drafts = draftRecipes(
    [
      row({ line: 2, menu: "ข้าวผัดหมู", ingredient: "หมูสับ", qty: "1", unit: "ขีด" }),
      row({ line: 3, menu: "ข้าวผัดหมู", ingredient: "ข้าวสวย", qty: "1", unit: "ทัพพี" }),
      row({ line: 4, menu: "ข้าวผัดหมู", ingredient: "น้ำมันหอย", qty: "1", unit: "ช้อนโต๊ะ", unsure: "พบในวิธีทำ" }),
      row({ line: 5, menu: "ข้าวผัดหมู", ingredient: "พริก", qty: "", unit: "", unsure: "ไม่ได้ระบุปริมาณ" }),
      row({ line: 6, menu: "กะเพราหมู", ingredient: "กะเพรา", qty: "10", unit: "g" }),
      row({ line: 7, menu: "กะเพราหมู", ingredient: "น้ำซุปกระดูก", qty: "100", unit: "ml" }),
      row({ line: 8, menu: "น้ำซุปกระดูก", yieldQty: "10", yieldUnit: "ลิตร", ingredient: "กระดูกหมู", qty: "2", unit: "กก." }),
      row({ line: 9, menu: "ผัดผักรวม", ingredient: "ผักรวม", qty: "1", unit: "ถุง" }),
    ],
    CTX
  );
  const [fried, krapao, soup, veg] = drafts;

  it("R-2 dishes are matched to menus; a component with a recipe of its own is named and set aside", () => {
    expect(drafts.map((d) => d.menuText)).toEqual(["ข้าวผัดหมู", "กะเพราหมู", "น้ำซุปกระดูก", "ผัดผักรวม"]);
    expect(fried).toMatchObject({ menuHow: "EXACT", menu: { kind: "EXISTING", id: "m-fried" }, servings: 1, component: false });
    expect(krapao).toMatchObject({ menuHow: "SIMILAR", menu: { kind: "EXISTING", id: "m-krapao" } });
    expect(soup).toMatchObject({ component: true, menu: { kind: "SKIP" } });
    expect(veg).toMatchObject({ menuHow: "NONE", menu: { kind: "UNSET" } });
    expect(judgeRecipe(veg, CTX, veg.lines.map((l) => judgeIngredient(l, CTX)))).toEqual({ kind: "NEED", why: "MENU" });
    expect(judgeRecipe(soup, CTX, [])).toEqual({ kind: "SKIP", why: "COMPONENT" });
  });

  it("R-3 a known size converts itself; a kitchen measure is asked once; nothing is skipped by default", () => {
    const [pork, rice, oyster, chili] = fried.lines.map((l) => judgeIngredient(l, CTX));
    expect(pork).toMatchObject({ kind: "OK", qty: 1, unitName: "ขีด", unitIsNew: true, ratio: 0.1 });
    expect(rice).toEqual({ kind: "NEED", why: "RATIO" });
    expect(judgeIngredient({ ...fried.lines[1], ratio: 180 }, CTX)).toMatchObject({ kind: "OK", unitName: "ทัพพี", unitIsNew: true, ratio: 180 });
    expect(oyster).toMatchObject({ kind: "OK", unitName: "ช้อนโต๊ะ", ratio: 15 });
    expect(oyster.kind === "OK" && oyster.flags).toContain("FROM_METHOD");
    expect(chili).toEqual({ kind: "NEED", why: "PRODUCT" });
    expect(judgeIngredient({ ...fried.lines[3], choice: { kind: "PRODUCT", id: "p-basil" } }, CTX)).toEqual({ kind: "NEED", why: "QTY" });
    // An ingredient used by another dish that is itself a component must still be decided.
    expect(judgeIngredient(krapao.lines[1], CTX)).toEqual({ kind: "NEED", why: "PRODUCT" });
  });

  it("R-4 the save carries only ready dishes, with refs for what is created", () => {
    const ready = drafts.map((d) =>
      d.menuText === "ข้าวผัดหมู"
        ? { ...d, lines: d.lines.map((l, i) => (i === 1 ? { ...l, ratio: 180 } : i === 3 ? { ...l, choice: { kind: "SKIP" as const } } : l)) }
        : d.menuText === "ผัดผักรวม"
          ? { ...d, menu: { kind: "NEW" as const, name: "ผัดผักรวม" }, lines: d.lines.map((l) => ({ ...l, choice: { kind: "NEW" as const, name: "ผักรวม", baseUnit: "g" }, ratio: 250 })) }
          : d
    );
    const save = toRecipeSave(ready, CTX);
    expect(save.newMenus).toEqual([{ ref: "new:ผัดผักรวม", name: "ผัดผักรวม" }]);
    expect(save.newProducts).toEqual([{ ref: "new:ผักรวม", name: "ผักรวม", baseUnitName: "g" }]);
    expect(save.recipes.map((r) => [("id" in r.menu ? r.menu.id : r.menu.ref), r.servings, r.lines.map((l) => `${l.qty} ${l.unitName}`)])).toEqual([
      ["m-fried", 1, ["1 ขีด", "1 ทัพพี", "1 ช้อนโต๊ะ"]],
      ["new:ผัดผักรวม", 1, ["1 ถุง"]],
    ]);
  });
});

describe("the write", () => {
  let tenant: string;
  let user: string;
  let menu: string;
  let pork: string;
  let rice: string;

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      tenant = (await tx.tenant.create({ data: { name: "Recipe Import Test" } })).id;
      user = (await tx.user.create({ data: { email: `recipe-import-${randomUUID()}@example.com`, name: "เจ้าของ" } })).id;
      menu = (await tx.menu.create({ data: { tenantId: tenant, source: "MISE", name: "ข้าวผัดหมู" } })).id;
      pork = (await tx.product.create({ data: { tenantId: tenant, sku: "P-0001", name: "หมูสับ", type: "RAW", primaryDimension: "WEIGHT" } })).id;
      await tx.productUnit.create({ data: { productId: pork, unitName: "kg", unitDimension: "WEIGHT", toBaseRatio: 1, isBase: true } });
      rice = (await tx.product.create({ data: { tenantId: tenant, sku: "P-0002", name: "ข้าวสวย", type: "RAW", primaryDimension: "WEIGHT" } })).id;
      await tx.productUnit.create({ data: { productId: rice, unitName: "g", unitDimension: "WEIGHT", toBaseRatio: 1, isBase: true } });
    });
  });
  afterAll(async () => {
    await sweepTestTenants(prismaBypass, { ids: [tenant] });
    await prismaBypass.user.deleteMany({ where: { id: user } });
  }, 180_000);

  it("R-5 drafts, menus, products and units are written in one go — and nothing is live", async () => {
    const out = await importRecipesLogic(
      tenant,
      {
        newMenus: [{ ref: "new:veg", name: "ผัดผักรวม" }],
        newProducts: [{ ref: "new:mix", name: "ผักรวม", baseUnitName: "g" }],
        recipes: [
          {
            menu: { id: menu },
            servings: 1,
            lines: [
              { product: { id: pork }, unitName: "ขีด", ratio: 0.1, qty: 1, note: "หมูสับ 1 ขีด" },
              { product: { id: rice }, unitName: "ทัพพี", ratio: 180, qty: 1, note: "ข้าว 1 ทัพพี" },
            ],
          },
          { menu: { ref: "new:veg" }, servings: 2, lines: [{ product: { ref: "new:mix" }, unitName: "ถุง", ratio: 250, qty: 1, note: null }] },
        ],
      },
      user
    );
    expect(out).toEqual({ drafts: 2, menusCreated: 1, productsCreated: 1, unitsAdded: 3 });

    const recipes = await prismaBypass.recipe.findMany({ where: { tenantId: tenant }, include: { ingredients: { include: { productUnit: true }, orderBy: { sortOrder: "asc" } }, menu: true }, orderBy: { servings: "asc" } });
    expect(recipes.map((r) => [r.menu?.name, r.isDraft, r.draftStatus, Number(r.servings), r.ingredients.map((i) => `${Number(i.qty)} ${i.productUnit?.unitName}`)])).toEqual([
      ["ข้าวผัดหมู", true, "DRAFT", 1, ["1 ขีด", "1 ทัพพี"]],
      ["ผัดผักรวม", true, "DRAFT", 2, ["1 ถุง"]],
    ]);
    const ladle = await prismaBypass.productUnit.findFirstOrThrow({ where: { productId: rice, unitName: "ทัพพี" } });
    expect(Number(ladle.toBaseRatio)).toBe(180);
    const hundred = await prismaBypass.productUnit.findFirstOrThrow({ where: { productId: pork, unitName: "ขีด" } });
    expect(Number(hundred.toBaseRatio)).toBe(0.1);
    expect(await prismaBypass.recipe.count({ where: { tenantId: tenant, isDraft: false } })).toBe(0);
    expect(await prismaBypass.stockMovement.count({ where: { tenantId: tenant } })).toBe(0);

    const ctx = await getRecipeContextLogic(tenant, true);
    expect(ctx.menus.find((m) => m.id === menu)).toMatchObject({ hasRecipe: false, drafts: 1 });
  });

  it("R-5b a menu that is deleted, or another shop's, is refused — the bulk check stands in for the per-line one", async () => {
    const gone = await withRlsBypass((tx) => tx.menu.create({ data: { tenantId: tenant, source: "MISE", name: "เลิกขายแล้ว", deletedAt: new Date() } }));
    await expect(
      importRecipesLogic(tenant, { newMenus: [], newProducts: [], recipes: [{ menu: { id: gone.id }, servings: 1, lines: [{ product: { id: pork }, unitName: "kg", ratio: null, qty: 0.1, note: null }] }] }, user)
    ).rejects.toBeInstanceOf(RecipeImportRefError);
    await expect(
      importRecipesLogic(tenant, { newMenus: [], newProducts: [], recipes: [{ menu: { id: randomUUID() }, servings: 1, lines: [{ product: { id: pork }, unitName: "kg", ratio: null, qty: 0.1, note: null }] }] }, user)
    ).rejects.toBeInstanceOf(RecipeImportRefError);
  });

  it("R-6 a measure with no size writes nothing at all", async () => {
    const before = await prismaBypass.recipe.count({ where: { tenantId: tenant } });
    await expect(
      importRecipesLogic(tenant, { newMenus: [{ ref: "new:x", name: "เมนูทดลอง" }], newProducts: [], recipes: [{ menu: { ref: "new:x" }, servings: 1, lines: [{ product: { id: rice }, unitName: "กำมือ", ratio: null, qty: 1, note: null }] }] }, user)
    ).rejects.toBeInstanceOf(UnitNeedsRatioError);
    expect(await prismaBypass.recipe.count({ where: { tenantId: tenant } })).toBe(before);
    expect(await prismaBypass.menu.count({ where: { tenantId: tenant, name: "เมนูทดลอง" } })).toBe(0);
  });
});
