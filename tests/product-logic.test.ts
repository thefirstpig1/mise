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
  ProductHasChildrenError,
  ProductParentCycleError,
  ProductDepthExceededError,
  type ProductWithUnits,
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
      // 7c: PREPPED chains create parent_product_id FKs. Null them out before
      // deleteMany (no onDelete cascade declared in schema → Restrict).
      await tx.product.updateMany({
        where: { tenantId: { in: ids } },
        data: { parentProductId: null },
      });
      await tx.productUnit.deleteMany({ where: { product: { tenantId: { in: ids } } } });
      await tx.product.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.category.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.tenant.deleteMany({ where: { id: { in: ids } } });
    });
    await prisma.$disconnect();
  });

  // ----- 7c test helpers -----
  /** Create a PREPPED product under `parentId` with a default yield of 80%. */
  const createPrepped = (
    tenant: string,
    name: string,
    parentId: string,
    yieldPct = 80
  ) =>
    createProductLogic(
      tenant,
      input({
        name,
        type: "PREPPED",
        parentProductId: parentId,
        yieldPercent: yieldPct,
      })
    );

  /**
   * Build a PREPPED chain of `n` nodes (1 RAW + n-1 PREPPED), oldest → deepest.
   * Each step relies on assertParentValid passing; the cap is 5 nodes
   * (ADR 0007 / Decision #58), so n ≤ 5 here.
   */
  const buildChain = async (
    tenant: string,
    n: number,
    prefix: string
  ): Promise<ProductWithUnits[]> => {
    const chain: ProductWithUnits[] = [];
    chain.push(
      await createProductLogic(tenant, input({ name: `${prefix}-1`, type: "RAW" }))
    );
    for (let i = 2; i <= n; i++) {
      chain.push(await createPrepped(tenant, `${prefix}-${i}`, chain[i - 2].id));
    }
    return chain;
  };

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

  // ============================================================
  // Sprint 1 Part 7c — PREPPED (parentProductId + yieldPercent)
  // ADR 0007. Depth limit = 5 via `ancestorDepth(P)+1+descendantHeight(X) ≤ 5`,
  // live-only traversal + visited-set guard.
  // ============================================================

  // L9 — happy path: create RAW (parent+yield = null) and PREPPED (both set)
  it("createProductLogic honors type: RAW has null parent/yield, PREPPED carries both", async () => {
    const raw = await createProductLogic(tenantA, input({ name: "L9-raw", type: "RAW" }));
    expect(raw.type).toBe("RAW");
    expect(raw.parentProductId).toBeNull();
    expect(raw.yieldPercent).toBeNull();

    const prepped = await createPrepped(tenantA, "L9-prepped", raw.id, 80);
    expect(prepped.type).toBe("PREPPED");
    expect(prepped.parentProductId).toBe(raw.id);
    expect(Number(prepped.yieldPercent)).toBe(80);

    // ADR 0005 invariant: PREPPED still owns exactly one base ProductUnit
    expect(prepped.productUnits).toHaveLength(1);
    expect(prepped.productUnits[0].isBase).toBe(true);
  });

  // L10 — parent guards: cross-tenant + self-ref + cycle
  it("rejects PREPPED with cross-tenant parent, self-reference, or cycle", async () => {
    // (a) Cross-tenant: B's RAW must not parent an A product.
    const bRaw = await createProductLogic(tenantB, input({ name: "L10-bRaw", type: "RAW" }));
    await expect(
      createPrepped(tenantA, "L10-cross", bRaw.id)
    ).rejects.toBeInstanceOf(CrossTenantReferenceError);

    // (b) Self-reference on update: X.parent = X.id.
    const x = await createProductLogic(tenantA, input({ name: "L10-self", type: "RAW" }));
    await expect(
      updateProductLogic(
        tenantA,
        x.id,
        input({
          name: "L10-self",
          type: "PREPPED",
          parentProductId: x.id,
          yieldPercent: 80,
        })
      )
    ).rejects.toBeInstanceOf(ProductParentCycleError);

    // (c) Cycle: A → B (B.parent=A), then try to set A.parent=B.
    const a = await createProductLogic(tenantA, input({ name: "L10-cycA", type: "RAW" }));
    const b = await createPrepped(tenantA, "L10-cycB", a.id);
    await expect(
      updateProductLogic(
        tenantA,
        a.id,
        input({
          name: "L10-cycA",
          type: "PREPPED",
          parentProductId: b.id,
          yieldPercent: 80,
        })
      )
    ).rejects.toBeInstanceOf(ProductParentCycleError);
  });

  // L11 — depth boundary: 5-node chain is the maximum allowed; a 6th → reject.
  // (Decision #58, ADR 0007: formula `ancestorDepth(P)+1+descendantHeight(X) ≤ 4`,
  // equivalent to chain ≤ 5 nodes. The 5th node creates at formula = 3+1+0 = 4
  // — boundary OK. Adding a 6th gives 4+1+0 = 5 > 4 → reject.)
  it("enforces depth ≤ 5 nodes — chain of 5 succeeds, a 6th rejects", async () => {
    const chain = await buildChain(tenantA, 5, "L11");
    expect(chain).toHaveLength(5); // boundary case OK

    await expect(
      createPrepped(tenantA, "L11-6", chain[4].id)
    ).rejects.toBeInstanceOf(ProductDepthExceededError);
  });

  // L12 — type-change on update: RAW↔PREPPED; PREPPED→RAW server-forces null
  it("allows type-change RAW↔PREPPED on update; PREPPED→RAW forces parent/yield null", async () => {
    const parent = await createProductLogic(tenantA, input({ name: "L12-parent", type: "RAW" }));
    const x = await createProductLogic(tenantA, input({ name: "L12-x", type: "RAW" }));

    // RAW → PREPPED
    const toPrepped = await updateProductLogic(
      tenantA,
      x.id,
      input({
        name: "L12-x",
        type: "PREPPED",
        parentProductId: parent.id,
        yieldPercent: 80,
      })
    );
    expect(toPrepped?.type).toBe("PREPPED");
    expect(toPrepped?.parentProductId).toBe(parent.id);
    expect(Number(toPrepped?.yieldPercent)).toBe(80);

    // PREPPED → RAW — server forces parent/yield null
    const toRaw = await updateProductLogic(tenantA, x.id, input({ name: "L12-x", type: "RAW" }));
    expect(toRaw?.type).toBe("RAW");
    expect(toRaw?.parentProductId).toBeNull();
    expect(toRaw?.yieldPercent).toBeNull();
  });

  // L13 — delete is BLOCKED when the product has live PREPPED children
  it("blocks delete when live PREPPED children exist → ProductHasChildrenError", async () => {
    const parent = await createProductLogic(tenantA, input({ name: "L13-parent", type: "RAW" }));
    const child = await createPrepped(tenantA, "L13-child", parent.id);

    await expect(deleteProductLogic(tenantA, parent.id)).rejects.toBeInstanceOf(
      ProductHasChildrenError
    );
    // Parent survives the failed delete.
    expect(await getProductByIdLogic(tenantA, parent.id)).not.toBeNull();

    // Leaf with no children deletes normally.
    expect(await deleteProductLogic(tenantA, child.id)).toBe(true);
  });

  // L14 — descendantHeight check on re-parent (ADR 0007 numeric trace, 5-node cap).
  // X has subtree height 2 (X→C→B). Re-parent X under:
  //   - P at ancestorDepth=2 → 2+1+2 = 5 > 4 → REJECT (chain would be 6 nodes)
  //   - mid at ancestorDepth=1 → 1+1+2 = 4 ≤ 4 → OK (boundary, chain = 5 nodes)
  //   - pRoot at ancestorDepth=0 → 0+1+2 = 3 ≤ 4 → OK (chain = 4 nodes)
  it("rejects a re-parent that would push the chain past 5 nodes (descendantHeight trace)", async () => {
    // P-side chain: pRoot → mid → P (P.ancestorDepth = 2)
    const pRoot = await createProductLogic(tenantA, input({ name: "L14-pRoot", type: "RAW" }));
    const mid = await createPrepped(tenantA, "L14-mid", pRoot.id);
    const P = await createPrepped(tenantA, "L14-P", mid.id);

    // X subtree: X (RAW for now) → C → B — descendantHeight(X)=2
    const X = await createProductLogic(tenantA, input({ name: "L14-X", type: "RAW" }));
    const C = await createPrepped(tenantA, "L14-C", X.id);
    await createPrepped(tenantA, "L14-B", C.id);

    // (i) Re-parent X under P: formula = 2 + 1 + 2 = 5 > 4 → REJECT (6-node chain)
    await expect(
      updateProductLogic(
        tenantA,
        X.id,
        input({
          name: "L14-X",
          type: "PREPPED",
          parentProductId: P.id,
          yieldPercent: 80,
        })
      )
    ).rejects.toBeInstanceOf(ProductDepthExceededError);

    // (ii) Re-parent X under pRoot: formula = 0 + 1 + 2 = 3 → OK (4-node chain)
    const okShallow = await updateProductLogic(
      tenantA,
      X.id,
      input({
        name: "L14-X",
        type: "PREPPED",
        parentProductId: pRoot.id,
        yieldPercent: 80,
      })
    );
    expect(okShallow?.parentProductId).toBe(pRoot.id);

    // (iii) Re-parent X under mid: formula = 1 + 1 + 2 = 4 → OK (exact boundary, 5-node chain)
    const okBoundary = await updateProductLogic(
      tenantA,
      X.id,
      input({
        name: "L14-X",
        type: "PREPPED",
        parentProductId: mid.id,
        yieldPercent: 80,
      })
    );
    expect(okBoundary?.parentProductId).toBe(mid.id);
  });

  // L15 — live-only traversal: a soft-deleted ancestor mid-chain doesn't count.
  // Build a max-depth chain (5 nodes), then BYPASS deleteProductLogic (which
  // would block on live children — Q5) by directly stamping the middle node as
  // soft-deleted via withAdminContext. With one ancestor removed from the
  // count, adding a 6th descendant via the live walker (formula = 3+1+0 = 4)
  // succeeds where the raw walker (formula = 4+1+0 = 5) would have rejected.
  it("live-only traversal: soft-deleted ancestors don't count toward depth", async () => {
    const chain = await buildChain(tenantA, 5, "L15");

    // Confirm raw-counted depth is at the cap: adding a 6th is rejected.
    await expect(
      createPrepped(tenantA, "L15-6-blocked", chain[4].id)
    ).rejects.toBeInstanceOf(ProductDepthExceededError);

    // Bypass Q5 to soft-delete the middle node (chain[2]) while it has live
    // descendants — simulates a state the live-only walker must still handle.
    await withAdminContext((tx) =>
      tx.product.update({
        where: { id: chain[2].id },
        data: { deletedAt: new Date() },
      })
    );

    // Live ancestors of chain[4] = {chain[0], chain[1], chain[3]} = 3.
    // Formula = 3 + 1 + 0 = 4 ≤ 4 → adding the 6th now succeeds.
    const n6 = await createPrepped(tenantA, "L15-6-allowed", chain[4].id);
    expect(n6.parentProductId).toBe(chain[4].id);
  });

  // L16 — parent that is soft-deleted is rejected by the existing tenant guard
  it("rejects a PREPPED whose parentProductId points at a soft-deleted product", async () => {
    const parent = await createProductLogic(tenantA, input({ name: "L16-parent", type: "RAW" }));
    // No children yet → soft-delete is allowed.
    expect(await deleteProductLogic(tenantA, parent.id)).toBe(true);

    await expect(
      createPrepped(tenantA, "L16-orphan", parent.id)
    ).rejects.toBeInstanceOf(CrossTenantReferenceError);
  });

  // L17 — delete counts only LIVE children: once all children are soft-deleted,
  // the parent can be deleted normally.
  it("allows delete of a parent whose only children have been soft-deleted", async () => {
    const parent = await createProductLogic(tenantA, input({ name: "L17-parent", type: "RAW" }));
    const child = await createPrepped(tenantA, "L17-child", parent.id);

    // Soft-delete the (leaf) child first; parent now has zero LIVE children.
    expect(await deleteProductLogic(tenantA, child.id)).toBe(true);
    // Parent can be deleted because the soft-deleted child doesn't count.
    expect(await deleteProductLogic(tenantA, parent.id)).toBe(true);
  });

  // ============================================================
  // Sprint 1 Part 7d — liquid density (data-capture only). ADR 0008.
  // L3 server logic: density persistence, COUNT / stale-toggle cleanse, read-path
  // include, and template-FK validation (template is GLOBAL reference data — a
  // plain findFirst, NOT assertRefBelongsToTenant). L2 zod (XOR + COUNT gate) is
  // already committed (ff28a63); L23 re-checks that wiring from the logic side.
  // RED until L3 implements density write + include + LiquidDensityTemplateNotFoundError.
  // The typed error is asserted by `.name` (not `toBeInstanceOf`) so the not-yet-
  // existing export does not break module load during the RED phase.
  // ============================================================

  /** A seeded global density template (นมสด = milk, 1.030 g/ml). */
  const milkTemplate = () =>
    prisma.liquidDensityTemplate.findFirstOrThrow({ where: { name: "นมสด" } });

  /** Read a raw product row (all scalars) bypassing tenant scope. */
  const rawProductRow = (id: string) =>
    withAdminContext((tx) => tx.product.findUnique({ where: { id } }));

  // A well-formed uuid that is NOT a seeded template id.
  const MISSING_TEMPLATE_ID = "00000000-0000-4000-8000-000000000000";

  // L18 — create a COUNT product carrying BOTH density fields (zod bypassed via
  // spread, the L8 pattern): the server cleanses COUNT → both density columns null
  // BEFORE the write (mirror of the 7c PREPPED→RAW cleanse ordering).
  it("createProductLogic nulls density on a COUNT product (server cleanse)", async () => {
    const milk = await milkTemplate();
    const raw: ProductInput = {
      ...input({ name: "L18-count", primaryDimension: "COUNT", baseUnitName: "ชิ้น" }),
      liquidDensityTemplateId: milk.id,
      densityGPerMlOverride: 1.5,
    };
    const p = await createProductLogic(tenantA, raw);
    expect(p.liquidDensityTemplateId).toBeNull();
    expect(p.densityGPerMlOverride).toBeNull();

    const row = await rawProductRow(p.id);
    expect(row?.liquidDensityTemplateId).toBeNull();
    expect(row?.densityGPerMlOverride).toBeNull();
  });

  // L19 — a VOLUME product persists its override; toggling to COUNT cleanses the
  // now-stale density back to null (mirror of the 7c PREPPED→RAW stale-null cleanse).
  it("updateProductLogic clears stale density when VOLUME→COUNT", async () => {
    const created = await createProductLogic(
      tenantA,
      input({
        name: "L19-vol",
        primaryDimension: "VOLUME",
        baseUnitName: "l",
        densityGPerMlOverride: 0.91,
      })
    );
    expect(Number(created.densityGPerMlOverride)).toBe(0.91); // persisted on create

    const toggled = await updateProductLogic(
      tenantA,
      created.id,
      input({ name: "L19-vol", primaryDimension: "COUNT", baseUnitName: "ชิ้น" })
    );
    expect(toggled?.primaryDimension).toBe("COUNT");
    expect(toggled?.densityGPerMlOverride).toBeNull(); // stale density cleansed
    expect(toggled?.liquidDensityTemplateId).toBeNull();
  });

  // L20 — read path: getProductByIdLogic populates liquidDensityTemplate when the
  // FK is set, projected to {id, name, gPerMl, description, displayOrder} (Q5).
  it("getProductByIdLogic includes the liquidDensityTemplate when FK is set", async () => {
    const milk = await milkTemplate();
    const created = await createProductLogic(
      tenantA,
      input({
        name: "L20-tpl",
        primaryDimension: "VOLUME",
        baseUnitName: "l",
        liquidDensityTemplateId: milk.id,
      })
    );
    expect(created.liquidDensityTemplateId).toBe(milk.id); // persisted on create

    const read = await getProductByIdLogic(tenantA, created.id);
    const tpl = (
      read as unknown as {
        liquidDensityTemplate: Record<string, unknown> | null;
      } | null
    )?.liquidDensityTemplate;
    expect(tpl).toBeTruthy();
    expect(tpl?.id).toBe(milk.id);
    expect(tpl?.name).toBe("นมสด");
    expect(Number(tpl?.gPerMl)).toBe(1.03);
    // select shape: exactly these keys, nothing heavier crosses the boundary.
    expect(Object.keys(tpl ?? {}).sort()).toEqual(
      ["description", "displayOrder", "gPerMl", "id", "name"]
    );
  });

  // L21 — an invalid template FK (well-formed uuid, no such row) is rejected with a
  // typed LiquidDensityTemplateNotFoundError — NOT a cross-tenant error and NOT a
  // raw Prisma FK error (template is global reference data: plain findFirst by id).
  it("createProductLogic rejects an unknown liquidDensityTemplateId (typed)", async () => {
    const raw = input({
      name: "L21-badtpl",
      primaryDimension: "VOLUME",
      baseUnitName: "l",
      liquidDensityTemplateId: MISSING_TEMPLATE_ID,
    });
    let thrown: unknown;
    try {
      await createProductLogic(tenantA, raw);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as Error | undefined)?.name).toBe(
      "LiquidDensityTemplateNotFoundError"
    );

    // guard ran before any write — no ghost product row
    const ghosts = (await getProductsLogic(tenantA)).filter(
      (p) => p.name === "L21-badtpl"
    );
    expect(ghosts).toHaveLength(0);
  });

  // L22 — Q3: a granular WEIGHT product MAY carry a custom override; it persists
  // (Mise does not paternalize — density of granular solids is the user's call).
  it("createProductLogic persists a density override on a WEIGHT product", async () => {
    const p = await createProductLogic(
      tenantA,
      input({
        name: "L22-sugar",
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        densityGPerMlOverride: 0.85,
      })
    );
    expect(Number(p.densityGPerMlOverride)).toBe(0.85);
    expect(p.liquidDensityTemplateId).toBeNull();

    const row = await rawProductRow(p.id);
    expect(Number(row?.densityGPerMlOverride)).toBe(0.85);
  });

  // L23 — Q2 XOR re-checked from the logic side: template + override together on a
  // non-COUNT product is rejected by zod superRefine (L2 wiring, ff28a63).
  it("productInputSchema rejects template + override together (XOR, L2 wiring)", () => {
    expect(() =>
      productInputSchema.parse({
        name: "L23-both",
        primaryDimension: "VOLUME",
        baseUnitName: "l",
        liquidDensityTemplateId: MISSING_TEMPLATE_ID,
        densityGPerMlOverride: 0.91,
      })
    ).toThrow();
  });
});
