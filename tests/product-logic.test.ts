// ============================================================
// Mise — product *Logic integration tests (Sprint 1 Part 7a)
// ============================================================
// Exercises src/server/product.ts against the real Neon DB through
// withTenantContext, keyed by tenantId (no auth mock). Tenant isolation is
// verified at the APP LAYER (explicit tenantId filtering) — RLS is inert until
// Sprint 7 (ADR 0004). Relies on the system seed (unit_template) being present
// (pnpm db:seed:system). Mirrors tests/category-logic.test.ts.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withAdminContext, prisma } from "@/lib/db";
import { productInputSchema } from "@/lib/validations/product";
import {
  createProductLogic,
  getProductsLogic,
  getProductByIdLogic,
  updateProductLogic,
  deleteProductLogic,
  ProductSkuConflictError,
  InvalidBaseUnitError,
} from "@/server/product";

/** Build a validated ProductInput from minimal overrides (blank sku → auto-gen). */
const input = (over: Record<string, unknown> = {}) =>
  productInputSchema.parse({
    name: "หมูสามชั้น",
    primaryDimension: "WEIGHT",
    baseUnitName: "kg",
    ...over,
  });

describe("product *Logic (tenant-scoped, app-layer isolation)", () => {
  let tenantA: string;
  let tenantB: string;
  let tenantC: string; // dedicated to the sku auto-gen sequence test

  beforeAll(async () => {
    await withAdminContext(async (tx) => {
      const a = await tx.tenant.create({ data: { name: "Product Test Tenant A" } });
      const b = await tx.tenant.create({ data: { name: "Product Test Tenant B" } });
      const c = await tx.tenant.create({ data: { name: "Product Test Tenant C" } });
      tenantA = a.id;
      tenantB = b.id;
      tenantC = c.id;
    });
  });

  afterAll(async () => {
    const ids = [tenantA, tenantB, tenantC];
    await withAdminContext(async (tx) => {
      await tx.productUnit.deleteMany({ where: { product: { tenantId: { in: ids } } } });
      await tx.product.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.category.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.tenant.deleteMany({ where: { id: { in: ids } } });
    });
    await prisma.$disconnect();
  });

  // Slice 1 — create writes a RAW product + its single base unit, atomically
  it("createProductLogic creates a RAW product with one base unit", async () => {
    const p = await createProductLogic(tenantA, input());
    expect(p.id).toBeDefined();
    expect(p.tenantId).toBe(tenantA);
    expect(p.type).toBe("RAW");
    expect(p.sku).toMatch(/^P-\d{4}$/); // auto-generated
    expect(p.deletedAt).toBeNull();

    expect(p.productUnits).toHaveLength(1);
    const base = p.productUnits[0];
    expect(base.isBase).toBe(true);
    expect(base.isDefaultBuyUnit).toBe(true);
    expect(base.unitName).toBe("kg");
    expect(base.unitDimension).toBe("WEIGHT");
    expect(Number(base.toBaseRatio)).toBe(1);
  });

  // Slice 2 — categoryId is set and the relation is returned
  it("createProductLogic links the chosen category", async () => {
    const cat = await withAdminContext((tx) =>
      tx.category.create({
        data: { tenantId: tenantA, account: "COGS", accountingSection: "Food", groupName: "Meat" },
      })
    );
    const p = await createProductLogic(tenantA, input({ name: "เนื้อ", categoryId: cat.id }));
    expect(p.categoryId).toBe(cat.id);
    expect(p.category?.groupName).toBe("Meat");
  });

  // Slice 3 — isolation (Tenant A vs Tenant B)
  it("getProductsLogic returns only the calling tenant's products", async () => {
    await createProductLogic(tenantB, input({ name: "ปลาทูแขก" }));

    const aNames = (await getProductsLogic(tenantA)).map((p) => p.name);
    expect(aNames).toContain("หมูสามชั้น");
    expect(aNames).not.toContain("ปลาทูแขก"); // B's row never leaks to A

    const bList = await getProductsLogic(tenantB);
    expect(bList.every((p) => p.tenantId === tenantB)).toBe(true);
    expect(bList.map((p) => p.name)).toContain("ปลาทูแขก");
    expect(bList.map((p) => p.name)).not.toContain("หมูสามชั้น");
  });

  // Slice 4 — single-row read is tenant-scoped
  it("getProductByIdLogic finds own-tenant rows and returns null cross-tenant", async () => {
    const created = await createProductLogic(tenantA, input({ name: "หาให้เจอ" }));

    const own = await getProductByIdLogic(tenantA, created.id);
    expect(own?.id).toBe(created.id);
    expect(own?.productUnits).toHaveLength(1);

    const cross = await getProductByIdLogic(tenantB, created.id);
    expect(cross).toBeNull();
  });

  // Slice 5 — update is tenant-scoped; base unit + dimension can change (Q5)
  it("updateProductLogic updates fields + base unit, and refuses cross-tenant", async () => {
    const created = await createProductLogic(tenantA, input({ name: "ก่อนแก้" }));

    // change name + base unit (still WEIGHT: kg → g)
    const updated = await updateProductLogic(
      tenantA,
      created.id,
      input({ name: "หลังแก้", baseUnitName: "g" })
    );
    expect(updated?.name).toBe("หลังแก้");
    expect(updated?.productUnits.find((u) => u.isBase)?.unitName).toBe("g");

    // change dimension entirely: WEIGHT → COUNT (ชิ้น)
    const dimChanged = await updateProductLogic(
      tenantA,
      created.id,
      input({ name: "หลังแก้", primaryDimension: "COUNT", baseUnitName: "ชิ้น" })
    );
    expect(dimChanged?.primaryDimension).toBe("COUNT");
    const base = dimChanged?.productUnits.find((u) => u.isBase);
    expect(base?.unitName).toBe("ชิ้น");
    expect(base?.unitDimension).toBe("COUNT");

    // cross-tenant hijack is a no-op
    const hijack = await updateProductLogic(
      tenantB,
      created.id,
      input({ name: "โดนแฮก", baseUnitName: "g" })
    );
    expect(hijack).toBeNull();
    expect((await getProductByIdLogic(tenantA, created.id))?.name).toBe("หลังแก้");
  });

  // Slice 6 — soft-delete, tenant-scoped, row physically survives
  it("deleteProductLogic soft-deletes own-tenant rows and refuses cross-tenant", async () => {
    const created = await createProductLogic(tenantA, input({ name: "จะลบ" }));

    const hijack = await deleteProductLogic(tenantB, created.id);
    expect(hijack).toBe(false);
    expect(await getProductByIdLogic(tenantA, created.id)).not.toBeNull();

    const ok = await deleteProductLogic(tenantA, created.id);
    expect(ok).toBe(true);
    expect(await getProductByIdLogic(tenantA, created.id)).toBeNull();

    // row still physically exists (soft-delete, not hard delete)
    const row = await withAdminContext((tx) =>
      tx.product.findUnique({ where: { id: created.id } })
    );
    expect(row?.deletedAt).not.toBeNull();
  });

  // Slice 7 — duplicate sku within a tenant rejected; same sku across tenants fine
  it("createProductLogic rejects a duplicate sku within a tenant, allows it across tenants", async () => {
    await createProductLogic(tenantA, input({ name: "ตัวแรก", sku: "DUP-1" }));

    await expect(
      createProductLogic(tenantA, input({ name: "ตัวซ้ำ", sku: "DUP-1" }))
    ).rejects.toBeInstanceOf(ProductSkuConflictError);

    const b = await createProductLogic(tenantB, input({ name: "คนละร้าน", sku: "DUP-1" }));
    expect(b.sku).toBe("DUP-1");
    expect(b.tenantId).toBe(tenantB);
  });

  // Slice 8 — sku auto-gen produces a P-#### running sequence (fresh tenant)
  it("createProductLogic auto-generates a running P-#### sku when blank", async () => {
    const p1 = await createProductLogic(tenantC, input({ name: "หนึ่ง" }));
    const p2 = await createProductLogic(tenantC, input({ name: "สอง" }));
    expect(p1.sku).toBe("P-0001");
    expect(p2.sku).toBe("P-0002");
  });

  // Slice 9 — invalid base unit is rejected AND leaves no partial product row
  it("createProductLogic rejects a base unit that doesn't match the dimension", async () => {
    await expect(
      createProductLogic(
        tenantA,
        input({ name: "GHOST", primaryDimension: "VOLUME", baseUnitName: "kg" })
      )
    ).rejects.toBeInstanceOf(InvalidBaseUnitError);

    const ghosts = (await getProductsLogic(tenantA)).filter((p) => p.name === "GHOST");
    expect(ghosts).toHaveLength(0); // guard ran before any write
  });
});
