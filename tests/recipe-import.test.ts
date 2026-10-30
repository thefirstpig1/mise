// ============================================================
// คิวงานข้อ 5d — recipes from the file the shop's own AI prepared
// ============================================================
// Kong 2026-10-30 ("ต่อเรื่องนำเข้าสูตรเลย"). A dish lands as a DRAFT; a dish
// is matched to a menu, an ingredient to a product, a kitchen measure is asked
// once — and nothing is skipped by default, because a recipe missing an
// ingredient is wrong in silence. Something the shop makes for its dishes
// (น้ำซุป) is a live production recipe instead ("เอาตามที่แนะนำ", same day).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prismaBypass, withRlsBypass } from "@/lib/db-admin";
import { splitPastedTable } from "@/lib/product-import";
import { draftRecipes, judgeIngredient, judgeRecipe, madeOutputs, readRecipeTable, toRecipeSave, type RawRecipeRow, type RecipeContext, type RecipeDraftRow } from "@/lib/recipe-import";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { RecipeImportRefError, getRecipeContextLogic, importRecipesLogic } from "@/server/recipe-import";
import { UnitNeedsRatioError, convertToPreppedLogic, getMadeHintsLogic } from "@/server/product";
import { sweepTestTenants } from "./support/sweep";

const CTX: RecipeContext = {
  menus: [
    { id: "m-fried", name: "ข้าวผัดหมู", code: "M03", hasRecipe: false, drafts: 0 },
    { id: "m-krapao", name: "ข้าวกะเพราหมู", code: "M01", hasRecipe: true, drafts: 0 },
  ],
  products: [
    { id: "p-pork", name: "หมูสับ", sku: "P-1", dimension: "WEIGHT", type: "RAW", made: null, units: [{ id: "u1", unitName: "kg", toBaseRatio: 1, isBase: true }] },
    { id: "p-rice", name: "ข้าวสวย", sku: "P-2", dimension: "WEIGHT", type: "RAW", made: null, units: [{ id: "u2", unitName: "g", toBaseRatio: 1, isBase: true }] },
    { id: "p-oyster", name: "น้ำมันหอย", sku: "P-3", dimension: "VOLUME", type: "RAW", made: null, units: [{ id: "u3", unitName: "ml", toBaseRatio: 1, isBase: true }] },
    { id: "p-basil", name: "กะเพรา", sku: "P-4", dimension: "WEIGHT", type: "RAW", made: null, units: [{ id: "u4", unitName: "g", toBaseRatio: 1, isBase: true }] },
  ],
  templates: [
    { unitName: "g", unitDimension: "WEIGHT", toSiRatio: 1 },
    { unitName: "kg", unitDimension: "WEIGHT", toSiRatio: 1000 },
    { unitName: "ขีด", unitDimension: "WEIGHT", toSiRatio: 100 },
    { unitName: "ml", unitDimension: "VOLUME", toSiRatio: 1 },
    { unitName: "l", unitDimension: "VOLUME", toSiRatio: 1000 },
    { unitName: "ช้อนโต๊ะ", unitDimension: "VOLUME", toSiRatio: 15 },
  ],
  canCreateProducts: true,
  madeFrom: "2026-10-01",
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

  it("R-2 dishes are matched to menus; a component with a recipe of its own is taken for shop-made", () => {
    expect(drafts.map((d) => d.menuText)).toEqual(["ข้าวผัดหมู", "กะเพราหมู", "น้ำซุปกระดูก", "ผัดผักรวม"]);
    expect(fried).toMatchObject({ kind: "MENU", menuHow: "EXACT", menu: { kind: "EXISTING", id: "m-fried" }, servings: 1 });
    expect(krapao).toMatchObject({ kind: "MENU", menuHow: "SIMILAR", menu: { kind: "EXISTING", id: "m-krapao" } });
    // Another dish uses it: a PREPPED product the file's own recipe makes.
    expect(soup).toMatchObject({ kind: "MADE", madeGuess: "USED", output: { kind: "NEW", name: "น้ำซุปกระดูก", baseUnit: "l" }, servings: 10, yieldUnit: "l" });
    expect(krapao.lines[1].choice).toEqual({ kind: "MADE", key: soup.key });
    expect(veg).toMatchObject({ kind: "MENU", menuHow: "NONE", menu: { kind: "UNSET" } });
    expect(judgeRecipe(veg, CTX, veg.lines.map((l) => judgeIngredient(l, CTX)))).toEqual({ kind: "NEED", why: "MENU" });
    // Its own ingredient is not in the shop's list yet.
    expect(judgeRecipe(soup, CTX, soup.lines.map((l) => judgeIngredient(l, CTX)))).toEqual({ kind: "NEED", why: "LINES" });
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
    // An ingredient another recipe in the file makes takes that recipe's product and its unit…
    const made = madeOutputs(drafts, CTX);
    expect(judgeIngredient(krapao.lines[1], CTX, made)).toMatchObject({ kind: "OK", unitName: "ml", unitIsNew: true, ratio: 0.001 });
    // …and when that recipe is switched back to a dish, it must be decided like any other.
    const asDish = madeOutputs(drafts.map((d) => (d === soup ? { ...d, kind: "MENU" as const } : d)), CTX);
    expect(judgeIngredient(krapao.lines[1], CTX, asDish)).toEqual({ kind: "NEED", why: "PRODUCT" });
  });

  it("R-4 the save carries only ready dishes, with refs for what is created", () => {
    const ready = drafts.map((d) =>
      d.menuText === "ข้าวผัดหมู"
        ? { ...d, lines: d.lines.map((l, i) => (i === 1 ? { ...l, ratio: 180 } : i === 3 ? { ...l, choice: { kind: "SKIP" as const } } : l)) }
        : d.menuText === "ผัดผักรวม"
          ? { ...d, menu: { kind: "NEW" as const, name: "ผัดผักรวม" }, lines: d.lines.map((l) => ({ ...l, choice: { kind: "NEW" as const, name: "ผักรวม", baseUnit: "g" }, ratio: 250 })) }
          : d === soup
            ? { ...d, lines: d.lines.map((l) => ({ ...l, choice: { kind: "NEW" as const, name: "กระดูกหมู", baseUnit: "kg" } })) }
            : d
    );
    const save = toRecipeSave(ready, CTX);
    expect(save.newMenus).toEqual([{ ref: "new:ผัดผักรวม", name: "ผัดผักรวม" }]);
    expect(save.newProducts).toEqual([
      { ref: "new:น้ำซุปกระดูก", name: "น้ำซุปกระดูก", baseUnitName: "l", prepped: true },
      { ref: "new:กระดูกหมู", name: "กระดูกหมู", baseUnitName: "kg", prepped: false },
      { ref: "new:ผักรวม", name: "ผักรวม", baseUnitName: "g", prepped: false },
    ]);
    expect(save.recipes.map((r) => [("id" in r.menu ? r.menu.id : r.menu.ref), r.servings, r.lines.map((l) => `${l.qty} ${l.unitName}`)])).toEqual([
      ["m-fried", 1, ["1 ขีด", "1 ทัพพี", "1 ช้อนโต๊ะ"]],
      ["m-krapao", 1, ["10 g", "100 ml"]],
      ["new:ผัดผักรวม", 1, ["1 ถุง"]],
    ]);
    // The soup is a production recipe: 10 litres, in the product's base unit.
    expect(save.made).toEqual([{ output: { ref: "new:น้ำซุปกระดูก" }, servings: 10, lines: [{ product: { ref: "new:กระดูกหมู" }, unitName: "kg", ratio: null, qty: 2, note: null }] }]);
    expect(save.recipes[1].lines[1].product).toEqual({ ref: "new:น้ำซุปกระดูก" });
    expect(save.convert).toEqual([]);
  });

  const STOCK: RecipeContext = {
    ...CTX,
    products: [
      ...CTX.products,
      { id: "p-stock", name: "น้ำซุป", sku: "P-5", dimension: "VOLUME", type: "RAW", made: null, units: [{ id: "u5", unitName: "ml", toBaseRatio: 1, isBase: true }] },
      { id: "p-sauce", name: "น้ำจิ้มซีฟู้ด", sku: "P-6", dimension: "VOLUME", type: "PREPPED", made: "RECIPE", units: [{ id: "u6", unitName: "ml", toBaseRatio: 1, isBase: true }] },
    ],
  };
  const madeRow = (over: Partial<RawRecipeRow>) => row({ menu: "น้ำซุป", yieldQty: "10", yieldUnit: "ลิตร", ingredient: "หมูสับ", qty: "1", unit: "kg", ...over });
  const verdictOf = (d: RecipeDraftRow, ctx: RecipeContext, all: RecipeDraftRow[] = [d]) => {
    const made = madeOutputs(all, ctx);
    return judgeRecipe(d, ctx, d.lines.map((l) => judgeIngredient(l, ctx, made)), made);
  };

  it("R-7 what a shop-made recipe yields is stored in its product's base unit — litres of a stock counted in ml", () => {
    const [stock] = draftRecipes([madeRow({}), row({ line: 3, menu: "ก๋วยเตี๋ยว", ingredient: "น้ำซุป", qty: "300", unit: "ml" })], STOCK);
    expect(stock).toMatchObject({ kind: "MADE", output: { kind: "EXISTING", id: "p-stock" }, outputHow: "EXACT" });
    expect(verdictOf(stock, STOCK)).toEqual({ kind: "READY", review: false, servings: 10_000 });
    // A blank unit is the base unit, worth a look.
    expect(verdictOf({ ...stock, yieldUnit: "" }, STOCK)).toEqual({ kind: "READY", review: true, servings: 10 });
    // A pot is a size nobody wrote down: asked, then used.
    expect(verdictOf({ ...stock, servings: 1, yieldUnit: "หม้อ" }, STOCK)).toEqual({ kind: "NEED", why: "YIELD_UNIT" });
    expect(verdictOf({ ...stock, servings: 1, yieldUnit: "หม้อ", yieldRatio: 20_000 }, STOCK)).toMatchObject({ kind: "READY", servings: 20_000 });
    // The existing ingredient becomes shop-made.
    expect(toRecipeSave([stock], STOCK).convert).toEqual(["p-stock"]);
  });

  it("R-8 a product already made by a recipe is not written over — but dishes in the file still point at it", () => {
    const drafts2 = draftRecipes([madeRow({ menu: "น้ำจิ้มซีฟู้ด" }), row({ line: 3, menu: "ทะเลเผา", ingredient: "น้ำจิ้มซีฟู้ด", qty: "30", unit: "ml" })], STOCK);
    expect(verdictOf(drafts2[0], STOCK, drafts2)).toEqual({ kind: "SKIP", why: "HAS_RECIPE" });
    const made = madeOutputs(drafts2, STOCK);
    expect(judgeIngredient(drafts2[1].lines[0], STOCK, made)).toMatchObject({ kind: "OK", unitName: "ml" });
    const save = toRecipeSave(drafts2.map((d) => (d.kind === "MENU" ? { ...d, menu: { kind: "NEW" as const, name: d.menuText } } : d)), STOCK);
    expect(save.made).toEqual([]);
    expect(save.recipes[0].lines[0].product).toEqual({ id: "p-sauce" });
  });

  it("R-9 a pot of curry named like a dish on the POS is that dish; a recipe that lists itself, or one thing twice, is stopped", () => {
    const CURRY: RecipeContext = { ...CTX, menus: [...CTX.menus, { id: "m-curry", name: "แกงเขียวหวาน", code: "M09", hasRecipe: false, drafts: 0 }] };
    const [curry, stock] = draftRecipes([row({ menu: "แกงเขียวหวาน", yieldQty: "1", yieldUnit: "หม้อ", ingredient: "หมูสับ", qty: "1", unit: "kg" }), madeRow({ menu: "น้ำซุปไก่" })], CURRY);
    expect(curry).toMatchObject({ kind: "MENU", madeGuess: null });
    expect(stock).toMatchObject({ kind: "MADE", madeGuess: "BATCH" });
    const self = { ...stock, lines: [{ ...stock.lines[0], unit: "ml", choice: { kind: "MADE" as const, key: stock.key } }] };
    expect(verdictOf(self, CURRY)).toEqual({ kind: "NEED", why: "SELF" });
    const twice = { ...stock, lines: [stock.lines[0], { ...stock.lines[0], line: 9 }] };
    expect(verdictOf(twice, CURRY)).toEqual({ kind: "NEED", why: "TWICE" });
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
        newProducts: [{ ref: "new:mix", name: "ผักรวม", baseUnitName: "g", prepped: false }],
        convert: [],
        made: [],
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
    expect(out).toMatchObject({ drafts: 2, made: 0, menusCreated: 1, productsCreated: 1, productsConverted: 0, unitsAdded: 3 });

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
      importRecipesLogic(tenant, { newMenus: [], newProducts: [], convert: [], made: [], recipes: [{ menu: { id: gone.id }, servings: 1, lines: [{ product: { id: pork }, unitName: "kg", ratio: null, qty: 0.1, note: null }] }] }, user)
    ).rejects.toBeInstanceOf(RecipeImportRefError);
    await expect(
      importRecipesLogic(tenant, { newMenus: [], newProducts: [], convert: [], made: [], recipes: [{ menu: { id: randomUUID() }, servings: 1, lines: [{ product: { id: pork }, unitName: "kg", ratio: null, qty: 0.1, note: null }] }] }, user)
    ).rejects.toBeInstanceOf(RecipeImportRefError);
  });

  it("R-6 a measure with no size writes nothing at all", async () => {
    const before = await prismaBypass.recipe.count({ where: { tenantId: tenant } });
    await expect(
      importRecipesLogic(tenant, { newMenus: [{ ref: "new:x", name: "เมนูทดลอง" }], newProducts: [], convert: [], made: [], recipes: [{ menu: { ref: "new:x" }, servings: 1, lines: [{ product: { id: rice }, unitName: "กำมือ", ratio: null, qty: 1, note: null }] }] }, user)
    ).rejects.toBeInstanceOf(UnitNeedsRatioError);
    expect(await prismaBypass.recipe.count({ where: { tenantId: tenant } })).toBe(before);
    expect(await prismaBypass.menu.count({ where: { tenantId: tenant, name: "เมนูทดลอง" } })).toBe(0);
  });

  it("R-10 a shop-made recipe is written LIVE from the first sales day, its product made PREPPED, and the dish that uses it points at it", async () => {
    const branch = await withRlsBypass((tx) => tx.branch.create({ data: { tenantId: tenant, name: "สาขาหลัก", code: "MAIN" } }));
    const firstSale = addDays(computeBangkokToday(), -12);
    await withRlsBypass((tx) => tx.salesDay.create({ data: { tenantId: tenant, branchId: branch.id, businessDate: firstSale } }));
    const stock = await withRlsBypass(async (tx) => {
      const p = await tx.product.create({ data: { tenantId: tenant, sku: "STOCK-1", name: "น้ำซุป", type: "RAW", primaryDimension: "VOLUME" } });
      await tx.productUnit.create({ data: { productId: p.id, unitName: "ml", unitDimension: "VOLUME", toBaseRatio: 1, isBase: true } });
      return p.id;
    });
    const noodle = (await withRlsBypass((tx) => tx.menu.create({ data: { tenantId: tenant, source: "MISE", name: "ก๋วยเตี๋ยว" } }))).id;
    const out = await importRecipesLogic(
      tenant,
      {
        newMenus: [],
        newProducts: [{ ref: "new:sauce", name: "น้ำจิ้ม", baseUnitName: "g", prepped: true }],
        convert: [stock],
        recipes: [{ menu: { id: noodle }, servings: 1, lines: [{ product: { id: stock }, unitName: "ทัพพี", ratio: 60, qty: 5, note: null }] }],
        made: [
          { output: { id: stock }, servings: 10_000, lines: [{ product: { id: pork }, unitName: "kg", ratio: null, qty: 2, note: "หมูสับ 2 กก." }] },
          { output: { ref: "new:sauce" }, servings: 500, lines: [{ product: { id: rice }, unitName: "g", ratio: null, qty: 100.12345, note: null }] },
        ],
      },
      user
    );
    expect(out).toMatchObject({ drafts: 1, made: 2, productsCreated: 1, productsConverted: 1, madeFrom: firstSale.toISOString().slice(0, 10) });

    const live = await prismaBypass.recipe.findMany({ where: { tenantId: tenant, outputProductId: { not: null } }, include: { outputProduct: true, ingredients: true }, orderBy: { servings: "asc" } });
    expect(live.map((r) => [r.outputProduct?.name, r.outputProduct?.type, r.isDraft, Number(r.servings), r.effectiveFrom.toISOString().slice(0, 10), r.ingredients.map((i) => Number(i.qty))])).toEqual([
      ["น้ำจิ้ม", "PREPPED", false, 500, firstSale.toISOString().slice(0, 10), [100.123]],
      ["น้ำซุป", "PREPPED", false, 10_000, firstSale.toISOString().slice(0, 10), [2]],
    ]);
    const dish = await prismaBypass.recipe.findFirstOrThrow({ where: { tenantId: tenant, menuId: noodle }, include: { ingredients: true } });
    expect(dish).toMatchObject({ isDraft: true });
    expect(dish.ingredients[0].productId).toBe(stock);
    // Nothing moved: a production recipe is a description until something is made or sold.
    expect(await prismaBypass.stockMovement.count({ where: { tenantId: tenant } })).toBe(0);

    // Seen again, the stock is made by a recipe now — a second import would not write over it.
    const ctx = await getRecipeContextLogic(tenant, true);
    expect(ctx.products.find((p) => p.id === stock)).toMatchObject({ type: "PREPPED", made: "RECIPE" });
    expect(ctx.madeFrom).toBe(firstSale.toISOString().slice(0, 10));
  });

  it("R-11 the products page names what the recipes use and nobody ever bought — a price from a supplier counts as bought", async () => {
    const names = async () => (await getMadeHintsLogic(tenant)).map((h) => h.name);
    // Drafts count: an imported recipe is a draft until it is published.
    expect(await names()).toEqual(expect.arrayContaining(["หมูสับ", "ข้าวสวย"]));
    // น้ำซุป is shop-made since R-10 — no longer a question.
    expect(await names()).not.toContain("น้ำซุป");
    const supplier = await withRlsBypass((tx) => tx.supplier.create({ data: { tenantId: tenant, nameFull: "ตลาดสด" } }));
    await withRlsBypass((tx) => tx.supplierProductMapping.create({ data: { tenantId: tenant, supplierId: supplier.id, productId: pork, effectiveFrom: computeBangkokToday() } }));
    expect(await names()).not.toContain("หมูสับ");
    // Pressing "เปลี่ยนเป็นของที่ร้านทำเอง" takes it off the list.
    expect(await convertToPreppedLogic(tenant, rice)).toBe(true);
    expect(await names()).not.toContain("ข้าวสวย");
  });
});
