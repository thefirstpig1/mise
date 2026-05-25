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
  ProductUnitNameConflictError,
  InvalidBaseUnitError,
  CrossTenantReferenceError,
} from "@/server/product";
import type { ProductInput } from "@/lib/validations/product";

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

  // Slice L1 (7b) — create writes the base unit PLUS additional units, flags correct
  it("createProductLogic writes the base unit plus additional units", async () => {
    const p = await createProductLogic(
      tenantA,
      input({
        name: "ข้าวสาร",
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [
          { unitName: "กระสอบ", toBaseRatio: 25 }, // custom packaging
          { unitName: "g", toBaseRatio: 0.001 }, // template name → source=system
        ],
        defaultBuyUnitName: "กระสอบ", // order by sack, not the base
      })
    );

    expect(p.productUnits).toHaveLength(3);

    const base = p.productUnits.find((u) => u.isBase)!;
    expect(base.unitName).toBe("kg");
    expect(Number(base.toBaseRatio)).toBe(1);
    expect(base.unitDimension).toBe("WEIGHT");
    expect(base.source).toBe("system");
    expect(base.isDefaultBuyUnit).toBe(false); // default-buy is กระสอบ

    const sack = p.productUnits.find((u) => u.unitName === "กระสอบ")!;
    expect(sack.isBase).toBe(false);
    expect(Number(sack.toBaseRatio)).toBe(25);
    expect(sack.unitDimension).toBe("WEIGHT"); // inherits primaryDimension (Q2)
    expect(sack.source).toBe("custom"); // not a unit_template entry
    expect(sack.isDefaultBuyUnit).toBe(true);

    const gram = p.productUnits.find((u) => u.unitName === "g")!;
    expect(gram.source).toBe("system"); // "g" IS a WEIGHT template unit
    expect(gram.isDefaultBuyUnit).toBe(false);

    // invariants: exactly one base, exactly one default-buy
    expect(p.productUnits.filter((u) => u.isBase)).toHaveLength(1);
    expect(p.productUnits.filter((u) => u.isDefaultBuyUnit)).toHaveLength(1);
  });

  // Slice L4 (7b) — update ADDS an additional unit; base row id stays stable
  it("updateProductLogic adds an additional unit without disturbing the base row", async () => {
    const created = await createProductLogic(tenantA, input({ name: "แป้ง", baseUnitName: "kg" }));
    const baseIdBefore = created.productUnits.find((u) => u.isBase)!.id;

    const updated = await updateProductLogic(
      tenantA,
      created.id,
      input({ name: "แป้ง", baseUnitName: "kg", additionalUnits: [{ unitName: "กระสอบ", toBaseRatio: 25 }] })
    );

    expect(updated!.productUnits).toHaveLength(2);
    expect(updated!.productUnits.find((u) => u.isBase)!.id).toBe(baseIdBefore); // ADR 0005: base id stable
    const sack = updated!.productUnits.find((u) => u.unitName === "กระสอบ")!;
    expect(Number(sack.toBaseRatio)).toBe(25);
    expect(sack.source).toBe("custom");
  });

  // Slice L5 (7b) — update CHANGES an additional unit's ratio in place (matched by unitName)
  it("updateProductLogic updates an existing additional unit's ratio without changing its id", async () => {
    const created = await createProductLogic(
      tenantA,
      input({ name: "น้ำมัน-L5", primaryDimension: "VOLUME", baseUnitName: "l", additionalUnits: [{ unitName: "ขวด", toBaseRatio: 0.75 }] })
    );
    const bottleIdBefore = created.productUnits.find((u) => u.unitName === "ขวด")!.id;

    const updated = await updateProductLogic(
      tenantA,
      created.id,
      input({ name: "น้ำมัน-L5", primaryDimension: "VOLUME", baseUnitName: "l", additionalUnits: [{ unitName: "ขวด", toBaseRatio: 0.6 }] })
    );

    expect(updated!.productUnits).toHaveLength(2);
    const bottle = updated!.productUnits.find((u) => u.unitName === "ขวด")!;
    expect(bottle.id).toBe(bottleIdBefore); // same row, matched by unitName (Q5-C)
    expect(Number(bottle.toBaseRatio)).toBe(0.6);
  });

  // Slice L6 (7b) — update REMOVES an additional unit (hard delete); removing the
  // default-buy unit drops the default back to the base (Q4b / Q5c)
  it("updateProductLogic hard-deletes a removed additional unit and falls the default back to base", async () => {
    const created = await createProductLogic(
      tenantA,
      input({ name: "ข้าว-L6", baseUnitName: "kg", additionalUnits: [{ unitName: "กระสอบ", toBaseRatio: 25 }], defaultBuyUnitName: "กระสอบ" })
    );
    const baseIdBefore = created.productUnits.find((u) => u.isBase)!.id;
    const sackId = created.productUnits.find((u) => u.unitName === "กระสอบ")!.id;
    expect(created.productUnits.find((u) => u.isBase)!.isDefaultBuyUnit).toBe(false); // กระสอบ was default

    const updated = await updateProductLogic(
      tenantA,
      created.id,
      input({ name: "ข้าว-L6", baseUnitName: "kg", additionalUnits: [], defaultBuyUnitName: null })
    );

    expect(updated!.productUnits).toHaveLength(1); // กระสอบ gone
    const base = updated!.productUnits[0];
    expect(base.id).toBe(baseIdBefore); // base row never recreated
    expect(base.isDefaultBuyUnit).toBe(true); // default fell back to base
    expect(updated!.productUnits.filter((u) => u.isDefaultBuyUnit)).toHaveLength(1);

    // hard delete: the additional row is physically gone (no deletedAt on ProductUnit)
    const ghost = await withAdminContext((tx) => tx.productUnit.findUnique({ where: { id: sackId } }));
    expect(ghost).toBeNull();
  });

  // Slice L7 (7b) — update moves the default-buy flag from base to an additional unit
  it("updateProductLogic moves the default-buy flag from the base to an additional unit", async () => {
    const created = await createProductLogic(tenantA, input({ name: "ข้าว-L7", baseUnitName: "kg" }));
    expect(created.productUnits[0].isBase).toBe(true);
    expect(created.productUnits[0].isDefaultBuyUnit).toBe(true); // base is default initially

    const updated = await updateProductLogic(
      tenantA,
      created.id,
      input({ name: "ข้าว-L7", baseUnitName: "kg", additionalUnits: [{ unitName: "กระสอบ", toBaseRatio: 25 }], defaultBuyUnitName: "กระสอบ" })
    );

    const base = updated!.productUnits.find((u) => u.isBase)!;
    const sack = updated!.productUnits.find((u) => u.unitName === "กระสอบ")!;
    expect(base.isDefaultBuyUnit).toBe(false); // moved off base
    expect(sack.isDefaultBuyUnit).toBe(true); // onto the additional
    expect(updated!.productUnits.filter((u) => u.isDefaultBuyUnit)).toHaveLength(1);
  });

  // Slice L8 (7b, Pitfall #24) — a DB-level duplicate unit name → ProductUnitNameConflictError
  it("maps a duplicate unit-name P2002 to ProductUnitNameConflictError, not sku conflict", async () => {
    // Bypass zod (which dedupes names) to hit the @@unique([productId, unitName]) at the DB.
    const raw: ProductInput = {
      ...input({ name: "DUP-UNIT", baseUnitName: "kg" }),
      additionalUnits: [
        { unitName: "กระสอบ", toBaseRatio: 25 },
        { unitName: "กระสอบ", toBaseRatio: 50 }, // same name twice
      ],
    };
    await expect(createProductLogic(tenantA, raw)).rejects.toBeInstanceOf(
      ProductUnitNameConflictError
    );
    // atomic: the tx rolled back, no ghost product
    const ghosts = (await getProductsLogic(tenantA)).filter((p) => p.name === "DUP-UNIT");
    expect(ghosts).toHaveLength(0);
  });

  // Slice 10 — categoryId must belong to the calling tenant (cross-tenant FK guard)
  it("rejects a categoryId owned by another tenant, on both create and update", async () => {
    // B's category — A must NOT be able to reference it.
    const bCat = await withAdminContext((tx) =>
      tx.category.create({
        data: { tenantId: tenantB, account: "COGS", accountingSection: "Food", groupName: "B-Only" },
      })
    );

    // create: A points at B's category → throws, no ghost product written
    await expect(
      createProductLogic(tenantA, input({ name: "CROSS-CAT", categoryId: bCat.id }))
    ).rejects.toBeInstanceOf(CrossTenantReferenceError);
    const ghosts = (await getProductsLogic(tenantA)).filter((p) => p.name === "CROSS-CAT");
    expect(ghosts).toHaveLength(0);

    // null categoryId is allowed (no-op guard)
    const noCat = await createProductLogic(tenantA, input({ name: "ไม่มีหมวด", categoryId: null }));
    expect(noCat.categoryId).toBeNull();

    // update: re-pointing an own product at B's category → throws, original kept
    await expect(
      updateProductLogic(tenantA, noCat.id, input({ name: "ไม่มีหมวด", categoryId: bCat.id }))
    ).rejects.toBeInstanceOf(CrossTenantReferenceError);
    expect((await getProductByIdLogic(tenantA, noCat.id))?.categoryId).toBeNull();
  });
});
