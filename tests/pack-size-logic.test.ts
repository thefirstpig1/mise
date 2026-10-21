// "+ ขนาดใหม่…" (Kong 2026-10-21): coffee bought in a 500 g bag after a 250 g
// one. The size is added on the product, and on the supplier's order page it
// may become that supplier's regular order unit — through the price list's own
// append + supersede rule, so the old price stays in its history.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass } from "@/lib/db-admin";
import { productInputSchema } from "@/lib/validations/product";
import { supplierInputSchema } from "@/lib/validations/supplier";
import { supplierProductMappingInputSchema } from "@/lib/validations/supplier-product-mapping";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { createSupplierLogic } from "@/server/supplier";
import { createSupplierProductMappingLogic } from "@/server/supplier-product-mapping";
import { PackSizeUnitError, addPackSizeLogic, setMappingOrderUnitLogic } from "@/server/pack-size";

describe("pack sizes", () => {
  let tenant: string;
  let coffee: ProductWithUnits;
  let supplierId: string;

  beforeAll(async () => {
    tenant = (await withRlsBypass((tx) => tx.tenant.create({ data: { name: "Pack Size Tenant" } }))).id;
    coffee = await createProductLogic(
      tenant,
      productInputSchema.parse({
        name: `เมล็ดกาแฟ-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [{ unitName: "ถุง 250 g", toBaseRatio: 0.25 }],
        defaultBuyUnitName: "ถุง 250 g",
      })
    );
    supplierId = (await createSupplierLogic(tenant, supplierInputSchema.parse({ nameFull: `S-${randomUUID().slice(0, 6)}` }))).id;
  });

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.supplierProductMapping.deleteMany({ where: { tenantId: tenant } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId: tenant } } });
      await tx.product.deleteMany({ where: { tenantId: tenant } });
      await tx.supplier.deleteMany({ where: { tenantId: tenant } });
      await tx.category.deleteMany({ where: { tenantId: tenant } });
      await tx.tenant.deleteMany({ where: { id: tenant } });
    });
  });

  it("a 500 g bag of a kg-counted product is named in g and holds 0.5 kg; asking again returns the same unit", async () => {
    const a = await addPackSizeLogic(tenant, { productId: coffee.id, box: "ถุง", size: 500, sizeUnit: "g" });
    expect(a).toMatchObject({ unitName: "ถุง 500 g", toBaseRatio: 0.5 });
    const b = await addPackSizeLogic(tenant, { productId: coffee.id, box: "ถุง", size: 500, sizeUnit: "g" });
    expect(b.id).toBe(a.id);
  });

  it("refuses a size it cannot convert (ml for a weighed product)", async () => {
    await expect(addPackSizeLogic(tenant, { productId: coffee.id, box: "ขวด", size: 500, sizeUnit: "ml" })).rejects.toBeInstanceOf(PackSizeUnitError);
  });

  it("making it the regular order unit opens a new price-list row from today and keeps the old one", async () => {
    const old250 = coffee.productUnits.find((u) => u.unitName === "ถุง 250 g")!;
    const past = new Date(Date.UTC(2026, 0, 1));
    const mapping = await createSupplierProductMappingLogic(
      tenant,
      supplierProductMappingInputSchema.parse({ supplierId, productId: coffee.id, orderUnitId: old250.id, currentUnitPrice: 320, minOrderQty: 2, effectiveFrom: past })
    );
    const bag = await addPackSizeLogic(tenant, { productId: coffee.id, box: "ถุง", size: 500, sizeUnit: "g" });
    await setMappingOrderUnitLogic(tenant, { mappingId: mapping.id, unitId: bag.id, unitPrice: 600 });

    const rows = await withRlsBypass((tx) =>
      tx.supplierProductMapping.findMany({ where: { tenantId: tenant, productId: coffee.id, deletedAt: null }, orderBy: { effectiveFrom: "asc" } })
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ orderUnitId: old250.id, effectiveTo: expect.any(Date) });
    expect(Number(rows[0].currentUnitPrice)).toBe(320);
    expect(rows[1]).toMatchObject({ orderUnitId: bag.id, effectiveTo: null, minOrderQty: null });
    expect(Number(rows[1].currentUnitPrice)).toBe(600);
  });
});
