// ensureProductUnitLogic — the unit a recipe line asks for (Kong 2026-10-04).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass } from "@/lib/db-admin";
import { productInputSchema } from "@/lib/validations/product";
import { UnitNeedsRatioError, createProductLogic, ensureProductUnitLogic, type ProductWithUnits } from "@/server/product";

describe("ensureProductUnitLogic", () => {
  let tenant: string;
  let pork: ProductWithUnits;
  let fishSauce: ProductWithUnits;
  let sugar: ProductWithUnits;
  const make = (name: string, dim: "WEIGHT" | "VOLUME", base: string) =>
    createProductLogic(
      tenant,
      productInputSchema.parse({ name: `${name}-${randomUUID().slice(0, 6)}`, primaryDimension: dim, baseUnitName: base, additionalUnits: [], defaultBuyUnitName: base })
    );

  beforeAll(async () => {
    tenant = (await withRlsBypass((tx) => tx.tenant.create({ data: { name: "Unit Ensure Tenant" } }))).id;
    pork = await make("หมูสับ", "WEIGHT", "kg");
    fishSauce = await make("น้ำปลา", "VOLUME", "l");
    sugar = await make("น้ำตาล", "WEIGHT", "kg");
  });
  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.productUnit.deleteMany({ where: { product: { tenantId: tenant } } });
      await tx.product.deleteMany({ where: { tenantId: tenant } });
      await tx.category.deleteMany({ where: { tenantId: tenant } });
      await tx.tenant.deleteMany({ where: { id: tenant } });
    });
  });

  it("a standard measure of the product's own dimension converts by itself", async () => {
    expect(await ensureProductUnitLogic(tenant, { productId: pork.id, unitName: "กรัม" })).toMatchObject({ unitName: "กรัม", toBaseRatio: 0.001 });
    expect(await ensureProductUnitLogic(tenant, { productId: fishSauce.id, unitName: "ช้อนโต๊ะ" })).toMatchObject({ toBaseRatio: 0.015 });
    expect(await ensureProductUnitLogic(tenant, { productId: fishSauce.id, unitName: "หยิบมือ" })).toMatchObject({ toBaseRatio: 0.0003 });
  });

  it("is idempotent by name and never rewrites an existing unit's ratio", async () => {
    const a = await ensureProductUnitLogic(tenant, { productId: pork.id, unitName: "ขีด" });
    const b = await ensureProductUnitLogic(tenant, { productId: pork.id, unitName: "ขีด", toBaseRatio: 5 });
    expect(b).toEqual(a);
    expect(a.toBaseRatio).toBe(0.1);
  });

  it("a spoon of a WEIGHED product, or a unit nobody knows, is refused without the shop's number", async () => {
    await expect(ensureProductUnitLogic(tenant, { productId: sugar.id, unitName: "ช้อนโต๊ะ" })).rejects.toBeInstanceOf(UnitNeedsRatioError);
    await expect(ensureProductUnitLogic(tenant, { productId: pork.id, unitName: "ทัพพี" })).rejects.toBeInstanceOf(UnitNeedsRatioError);
    expect(await ensureProductUnitLogic(tenant, { productId: sugar.id, unitName: "ช้อนโต๊ะ", toBaseRatio: 0.0125 })).toMatchObject({ toBaseRatio: 0.0125 });
  });
});
