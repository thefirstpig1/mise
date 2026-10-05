// Removing a unit something was written in (Kong 2026-10-05).
//
// recipe_ingredient holds its unit with ON DELETE SET NULL, so before this
// guard the product form could delete "ทัพพี" and every recipe line written as
// "2 ทัพพี" silently became "2 กก." — in cost and in the ledger, past days too.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass } from "@/lib/db-admin";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { recipeInputSchema } from "@/lib/validations/recipe";
import {
  ProductUnitInUseError,
  createProductLogic,
  ensureProductUnitLogic,
  updateProductLogic,
  type ProductWithUnits,
} from "@/server/product";
import { createRecipeLogic } from "@/server/recipe";

describe("a unit in use cannot be removed", () => {
  let tenant: string;
  let user: string;
  let menuName: string;
  let rice: ProductWithUnits;
  let ladleId: string;

  const formOf = (units: { unitName: string; toBaseRatio: number }[]) =>
    productInputSchema.parse({
      name: rice.name,
      primaryDimension: "WEIGHT",
      baseUnitName: "kg",
      additionalUnits: units,
      defaultBuyUnitName: "kg",
    });

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      tenant = (await tx.tenant.create({ data: { name: "Unit In Use Tenant" } })).id;
      user = (await tx.user.create({ data: { email: `unit-in-use-${randomUUID()}@example.com` } })).id;
    });
    rice = await createProductLogic(
      tenant,
      productInputSchema.parse({ name: `ข้าวสวย-${randomUUID().slice(0, 6)}`, primaryDimension: "WEIGHT", baseUnitName: "kg", additionalUnits: [{ unitName: "ถุง", toBaseRatio: 5 }], defaultBuyUnitName: "kg" })
    );
    ladleId = (await ensureProductUnitLogic(tenant, { productId: rice.id, unitName: "ทัพพี", toBaseRatio: 0.15 })).id;
    menuName = `ข้าวผัด-${randomUUID().slice(0, 4)}`;
    const menu = await withRlsBypass((tx) => tx.menu.create({ data: { tenantId: tenant, source: "MISE", name: menuName }, select: { id: true } }));
    await createRecipeLogic(
      tenant,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId: menu.id,
        outputProductId: null,
        servings: 1,
        effectiveFrom: computeBangkokToday(),
        ingredients: [{ productId: rice.id, componentMenuId: null, qty: 2, productUnitId: ladleId, sortOrder: 0, notes: null }],
        notes: null,
      }),
      user
    );
  }, 120_000);

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.recipeIngredient.deleteMany({ where: { tenantId: tenant } });
      await tx.recipe.deleteMany({ where: { tenantId: tenant } });
      await tx.menu.deleteMany({ where: { tenantId: tenant } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId: tenant } } });
      await tx.product.deleteMany({ where: { tenantId: tenant } });
      await tx.category.deleteMany({ where: { tenantId: tenant } });
      await tx.tenant.deleteMany({ where: { id: tenant } });
      await tx.user.deleteMany({ where: { id: user } });
    });
  }, 120_000);

  it("U1: removing a unit a recipe is written in is refused, naming the dish — and nothing moves", async () => {
    const err = await updateProductLogic(tenant, rice.id, formOf([{ unitName: "ถุง", toBaseRatio: 5 }])).catch((e) => e);
    expect(err).toBeInstanceOf(ProductUnitInUseError);
    expect((err as ProductUnitInUseError).unitName).toBe("ทัพพี");
    expect((err as ProductUnitInUseError).recipeNames).toEqual([menuName]);

    const line = await withRlsBypass((tx) => tx.recipeIngredient.findFirstOrThrow({ where: { tenantId: tenant }, select: { productUnitId: true } }));
    expect(line.productUnitId).toBe(ladleId);
  });

  it("U2: renaming it is the same removal, and refused the same way", async () => {
    await expect(
      updateProductLogic(tenant, rice.id, formOf([{ unitName: "ถุง", toBaseRatio: 5 }, { unitName: "ทัพพีใหญ่", toBaseRatio: 0.15 }]))
    ).rejects.toBeInstanceOf(ProductUnitInUseError);
  });

  it("U3: a unit nothing uses still comes off, and changing a used unit's NUMBER is allowed", async () => {
    await updateProductLogic(tenant, rice.id, formOf([{ unitName: "ทัพพี", toBaseRatio: 0.16 }]));
    const units = await withRlsBypass((tx) => tx.productUnit.findMany({ where: { productId: rice.id, isBase: false }, select: { id: true, unitName: true, toBaseRatio: true } }));
    expect(units.map((u) => u.unitName)).toEqual(["ทัพพี"]);
    expect(units[0].id).toBe(ladleId);
    expect(Number(units[0].toBaseRatio)).toBe(0.16);
  });
});
