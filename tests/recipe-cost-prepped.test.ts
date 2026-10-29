// ============================================================
// Mise — a recipe is costed at the prepped stock on the shelf (ADR 0040 Q10)
// ============================================================
// "ต้นทุนในสูตรใช้ต้นทุนของสต๊อกที่มีอยู่ก่อน สต๊อกเป็นศูนย์จึงคิดจากสูตรผลิต"
// — so the number on the menu screen is the number a sale will take.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass, prismaBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { recipeCostQuerySchema, recipeInputSchema } from "@/lib/validations/recipe";
import { createRecipeLogic } from "@/server/recipe";
import { getRecipeCostLogic } from "@/server/recipe-cost";
import { createStockAdjustmentLogic } from "@/server/stock-movement";
import { createStockAdjustmentInputSchema } from "@/lib/validations/stock-movement";
import { declareStockCostLogic } from "@/server/cost-declaration";
import { declareStockCostInputSchema } from "@/lib/validations/stock-cost";
import { getMenuPriceBookLogic } from "@/server/menu-manager";
import { costAccessFor } from "@/lib/permissions/cost-access";
import { sweepTestTenants } from "./support/sweep";

describe("recipe cost uses the prepped shelf first (ADR 0040 Q10)", () => {
  let tenant: string;
  let user: string;
  let branch: string;
  const today = computeBangkokToday();

  const product = (tag: string, type: "RAW" | "PREPPED", base: "kg" | "l") =>
    createProductLogic(
      tenant,
      productInputSchema.parse({
        name: `RC-${tag}-${randomUUID().slice(0, 6)}`,
        type,
        primaryDimension: base === "kg" ? "WEIGHT" : "VOLUME",
        baseUnitName: base,
      })
    );
  const unit = (p: ProductWithUnits) => p.productUnits.find((u) => u.isBase)!.id;

  const stockAt = async (p: ProductWithUnits, qty: number, unitCost: number) => {
    const { movement } = await createStockAdjustmentLogic(
      tenant,
      createStockAdjustmentInputSchema.parse({
        submitKey: randomUUID(),
        productId: p.id,
        branchId: branch,
        type: "ADJUST_GAIN",
        reason: "RECOUNT",
        inputQty: qty,
        inputUnitId: unit(p),
        occurredAt: addDays(new Date(), -5),
        notes: null,
      }),
      user
    );
    await declareStockCostLogic(
      tenant,
      declareStockCostInputSchema.parse({ movementId: movement.id, unitCost, unitId: unit(p), note: "ทดสอบ" }),
      user
    );
  };

  const recipe = (
    target: { menuId: string } | { outputProductId: string; servings: number },
    lines: [ProductWithUnits, number][]
  ) =>
    createRecipeLogic(
      tenant,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId: "menuId" in target ? target.menuId : null,
        outputProductId: "outputProductId" in target ? target.outputProductId : null,
        servings: "servings" in target ? target.servings : 1,
        effectiveFrom: addDays(today, -60),
        ingredients: lines.map(([p, qty], i) => ({
          productId: p.id,
          componentMenuId: null,
          qty,
          productUnitId: unit(p),
          sortOrder: i,
          notes: null,
        })),
        notes: null,
      }),
      user
    );

  const costOf = (recipeId: string) =>
    getRecipeCostLogic(tenant, recipeCostQuerySchema.parse({ recipeId, branchId: branch }));

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      tenant = (await tx.tenant.create({ data: { name: "Recipe Cost Prepped Tenant" } })).id;
      branch = (await tx.branch.create({ data: { tenantId: tenant, name: "ทองหล่อ", code: "THL" } })).id;
      user = (await tx.user.create({ data: { email: `rc-${randomUUID()}@example.com`, name: "เชฟ" } })).id;
    });
  });

  afterAll(async () => {
    await sweepTestTenants(prismaBypass, { ids: [tenant] });
    await withRlsBypass((tx) => tx.user.deleteMany({ where: { id: user } }));
  });

  it("RC1: an empty soup shelf costs the noodle by the bones; soup on the shelf costs it by the soup", async () => {
    const bones = await product("bones", "RAW", "kg");
    const soup = await product("soup", "PREPPED", "l");
    await stockAt(bones, 50, 50);
    const soupRecipe = await recipe({ outputProductId: soup.id, servings: 20 }, [[bones, 8]]); // ฿20 / L
    const menu = await withRlsBypass((tx) =>
      tx.menu.create({ data: { tenantId: tenant, source: "MISE", name: `ก๋วยเตี๋ยว-${randomUUID().slice(0, 4)}` }, select: { id: true } })
    );
    const noodle = await recipe({ menuId: menu.id }, [[soup, 0.5]]);

    expect((await costOf(noodle.id))!.costPerServing.toNumber()).toBe(10);

    await stockAt(soup, 5, 30); // soup bought at ฿30 / L
    const withShelf = (await costOf(noodle.id))!;
    expect(withShelf.costPerServing.toNumber()).toBe(15);
    // The line breakdown makes the same stop, so it still adds up.
    expect(withShelf.lines[0].cost.toNumber()).toBe(15);

    // The soup's own production recipe page still prices its RECIPE.
    expect((await costOf(soupRecipe.id))!.costPerServing.toNumber()).toBe(20);

    // And the menu screen's price book shows the soup at what is on the shelf.
    const book = await getMenuPriceBookLogic(tenant, branch, costAccessFor("owner"));
    expect(book.products[soup.id]).toBe(30);
    expect(book.menus[menu.id].costPerServing).toBe(15);
  });
});
