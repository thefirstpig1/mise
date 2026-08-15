// ============================================================
// Mise — supplier-product-mapping *Logic integration tests (Sprint 1 Part 8 L3a)
// ============================================================
// Exercises src/server/supplier-product-mapping.ts against the real Neon DB
// through withTenantContext, keyed by tenantId (no auth mock). Tenant isolation
// is verified at the APP LAYER (explicit tenantId filtering) — RLS is inert
// until Sprint 7 (ADR 0004). Mirrors tests/product-logic.test.ts.
//
// 15 slices M1–M15 per the Part 8 L3 Drive handoff section 4 (ADR 0009 / grill
// Q3b, Q4, Q5i, Q6). RED until L3a STEP B implements the *Logic bodies — the
// skeleton throws `notImplemented()`, so every slice fails (a generic Error is
// neither the asserted typed error nor the asserted happy-path value).
//
// Composite-key isolation: each slice mints a FRESH supplier and/or product so
// the (tenant, supplier, product, branch, effectiveFrom) partial-unique key and
// the Q4 supersede/overlap logic never collide ACROSS slices.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Supplier } from "@prisma/client";
import { withAdminContext, prisma } from "@/lib/db";
import { supplierProductMappingInputSchema as schema } from "@/lib/validations/supplier-product-mapping";
import { supplierInputSchema } from "@/lib/validations/supplier";
import { productInputSchema } from "@/lib/validations/product";
import { createSupplierLogic, deleteSupplierLogic } from "@/server/supplier";
import {
  createProductLogic,
  CrossTenantReferenceError,
  type ProductWithUnits,
} from "@/server/product";
import {
  createSupplierProductMappingLogic,
  updateSupplierProductMappingLogic,
  deleteSupplierProductMappingLogic,
  getSupplierProductMappingByIdLogic,
  getProductMappingsLogic,
  getPriceHistoryLogic,
  MappingOverlapError,
  OrderUnitMismatchError,
} from "@/server/supplier-product-mapping";

/** @db.Date round-trips to a UTC-midnight Date; compare on the date portion only. */
const isoDate = (d: Date | null | undefined): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

describe("supplier-product-mapping *Logic (tenant-scoped, app-layer isolation)", () => {
  let tenantA: string;
  let tenantB: string;
  let branchA: string; // tenant-A branch for branch-override slices (M2)
  let supB: Supplier; // tenant-B supplier (cross-tenant fixture, M3)
  let prodB: ProductWithUnits; // tenant-B product (cross-tenant fixture, M4)

  /** Fresh tenant-A supplier (unique nameFull per tag → no code collisions). */
  const freshSupplier = (tenant: string, tag: string): Promise<Supplier> =>
    createSupplierLogic(tenant, supplierInputSchema.parse({ nameFull: `S-${tag}` }));

  /** Fresh WEIGHT/kg product with its base unit (productUnits[0]). */
  const freshProduct = (tenant: string, tag: string): Promise<ProductWithUnits> =>
    createProductLogic(
      tenant,
      productInputSchema.parse({
        name: `P-${tag}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
      })
    );

  /** A fresh (supplier, product) pair + the product's base ProductUnit id. */
  const freshPair = async (tenant: string, tag: string) => {
    const supplier = await freshSupplier(tenant, tag);
    const product = await freshProduct(tenant, tag);
    return { supplier, product, baseUnitId: product.productUnits[0].id };
  };

  /** Build a validated mapping input (minimal required + overrides). */
  const mInput = (
    supplierId: string,
    productId: string,
    over: Record<string, unknown> = {}
  ) =>
    schema.parse({
      supplierId,
      productId,
      effectiveFrom: "2026-06-01",
      ...over,
    });

  beforeAll(async () => {
    await withAdminContext(async (tx) => {
      const a = await tx.tenant.create({ data: { name: "Mapping Test Tenant A" } });
      const b = await tx.tenant.create({ data: { name: "Mapping Test Tenant B" } });
      tenantA = a.id;
      tenantB = b.id;
      const br = await tx.branch.create({
        data: { tenantId: tenantA, name: "สาขาทดสอบ A", code: "MAIN" },
      });
      branchA = br.id;
    });
    supB = await freshSupplier(tenantB, "B-cross");
    prodB = await freshProduct(tenantB, "B-cross");
  });

  afterAll(async () => {
    const ids = [tenantA, tenantB];
    await withAdminContext(async (tx) => {
      await tx.supplierProductMapping.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId: { in: ids } } } });
      await tx.product.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.supplier.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.branch.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.tenant.deleteMany({ where: { id: { in: ids } } });
    });
    await prisma.$disconnect();
  });

  // M1 — create minimal mapping → row saved, open (effectiveTo NULL)
  it("M1 creates a minimal mapping with effectiveTo NULL", async () => {
    const { supplier, product } = await freshPair(tenantA, "M1");
    const m = await createSupplierProductMappingLogic(
      tenantA,
      mInput(supplier.id, product.id)
    );
    expect(m.id).toBeDefined();
    expect(m.tenantId).toBe(tenantA);
    expect(m.supplierId).toBe(supplier.id);
    expect(m.productId).toBe(product.id);
    expect(m.branchId).toBeNull();
    expect(m.effectiveTo).toBeNull();
    expect(m.deletedAt).toBeNull();
    expect(isoDate(m.effectiveFrom)).toBe("2026-06-01");
  });

  // M2 — create with all optional fields (branch override + orderUnit + terms)
  it("M2 creates a full mapping (all optional fields within range)", async () => {
    const { supplier, product, baseUnitId } = await freshPair(tenantA, "M2");
    const m = await createSupplierProductMappingLogic(
      tenantA,
      mInput(supplier.id, product.id, {
        branchId: branchA,
        supplierItemCode: "FB-12345",
        supplierItemName: "Salmon Atlantic Norway 5kg",
        orderUnitId: baseUnitId,
        currentUnitPrice: 250.5,
        minOrderQty: 5,
        leadTimeDays: 3,
        isPreferred: true,
        effectiveTo: "2026-12-31",
      })
    );
    expect(m.branchId).toBe(branchA);
    expect(m.orderUnitId).toBe(baseUnitId);
    expect(Number(m.currentUnitPrice)).toBe(250.5);
    expect(Number(m.minOrderQty)).toBe(5);
    expect(m.leadTimeDays).toBe(3);
    expect(m.isPreferred).toBe(true);
    expect(isoDate(m.effectiveTo)).toBe("2026-12-31");
  });

  // M3 — supplier owned by another tenant → CrossTenantReferenceError
  it("M3 rejects a cross-tenant supplier", async () => {
    const { product } = await freshPair(tenantA, "M3");
    await expect(
      createSupplierProductMappingLogic(tenantA, mInput(supB.id, product.id))
    ).rejects.toBeInstanceOf(CrossTenantReferenceError);
  });

  // M4 — product owned by another tenant → CrossTenantReferenceError
  it("M4 rejects a cross-tenant product", async () => {
    const { supplier } = await freshPair(tenantA, "M4");
    await expect(
      createSupplierProductMappingLogic(tenantA, mInput(supplier.id, prodB.id))
    ).rejects.toBeInstanceOf(CrossTenantReferenceError);
  });

  // M5 — orderUnitId points at a ProductUnit of a DIFFERENT product → OrderUnitMismatchError (Q5i)
  it("M5 rejects an orderUnit that is not a unit of this product", async () => {
    const { supplier, product } = await freshPair(tenantA, "M5");
    const other = await freshProduct(tenantA, "M5-other");
    const wrongUnit = other.productUnits[0].id;
    await expect(
      createSupplierProductMappingLogic(
        tenantA,
        mInput(supplier.id, product.id, { orderUnitId: wrongUnit })
      )
    ).rejects.toBeInstanceOf(OrderUnitMismatchError);
  });

  // M6 — supersede: a later effectiveFrom closes the prior open row (Q4)
  it("M6 supersedes the prior open row when a later-dated row is inserted", async () => {
    const { supplier, product } = await freshPair(tenantA, "M6");
    const r1 = await createSupplierProductMappingLogic(
      tenantA,
      mInput(supplier.id, product.id, { effectiveFrom: "2026-06-01" })
    );
    expect(r1.effectiveTo).toBeNull();

    const r2 = await createSupplierProductMappingLogic(
      tenantA,
      mInput(supplier.id, product.id, { effectiveFrom: "2026-07-01" })
    );
    expect(r2.effectiveTo).toBeNull(); // new open row

    // old row now closes at new.effectiveFrom − 1 day = 2026-06-30
    const r1after = await getSupplierProductMappingByIdLogic(tenantA, r1.id);
    expect(isoDate(r1after?.effectiveTo)).toBe("2026-06-30");
  });

  // M7 — two live rows with overlapping date ranges (not a clean supersede) → MappingOverlapError (Q4)
  it("M7 rejects an overlapping date range", async () => {
    const { supplier, product } = await freshPair(tenantA, "M7");
    await createSupplierProductMappingLogic(
      tenantA,
      mInput(supplier.id, product.id, {
        effectiveFrom: "2026-09-01",
        effectiveTo: "2026-09-30",
      })
    );
    await expect(
      createSupplierProductMappingLogic(
        tenantA,
        mInput(supplier.id, product.id, {
          effectiveFrom: "2026-09-15", // falls inside the existing closed window
          effectiveTo: "2026-10-15",
        })
      )
    ).rejects.toBeInstanceOf(MappingOverlapError);
  });

  // M8 — isPreferred singleton: a second preferred flips the first to false (Q3b)
  it("M8 normalizes siblings: only one preferred per (product, branch-scope)", async () => {
    const product = await freshProduct(tenantA, "M8");
    const supX = await freshSupplier(tenantA, "M8-X");
    const supY = await freshSupplier(tenantA, "M8-Y");

    const a = await createSupplierProductMappingLogic(
      tenantA,
      mInput(supX.id, product.id, { isPreferred: true })
    );
    expect(a.isPreferred).toBe(true);

    const b = await createSupplierProductMappingLogic(
      tenantA,
      mInput(supY.id, product.id, { isPreferred: true })
    );
    expect(b.isPreferred).toBe(true);

    // the earlier preferred mapping is normalized to false
    const aAfter = await getSupplierProductMappingByIdLogic(tenantA, a.id);
    expect(aAfter?.isPreferred).toBe(false);
  });

  // M9 — list "active": one live mapping returned for the product
  it("M9 lists a product's mappings (active filter)", async () => {
    const { supplier, product } = await freshPair(tenantA, "M9");
    await createSupplierProductMappingLogic(tenantA, mInput(supplier.id, product.id));
    const active = await getProductMappingsLogic(tenantA, product.id, "active");
    expect(active).toHaveLength(1);
    expect(active[0].supplierId).toBe(supplier.id);
  });

  // M10 — list "all": an orphan (supplier soft-deleted) is hidden by "active",
  // shown at the END by "all" (Q6 orphan handling)
  it("M10 places orphan mappings at the end under the 'all' filter", async () => {
    const product = await freshProduct(tenantA, "M10");
    const supLive = await freshSupplier(tenantA, "M10-live");
    const supDead = await freshSupplier(tenantA, "M10-dead");
    await createSupplierProductMappingLogic(tenantA, mInput(supLive.id, product.id));
    await createSupplierProductMappingLogic(tenantA, mInput(supDead.id, product.id));

    // soft-delete supDead → its mapping becomes an orphan
    expect(await deleteSupplierLogic(tenantA, supDead.id)).toBe(true);

    const active = await getProductMappingsLogic(tenantA, product.id, "active");
    expect(active.map((m) => m.supplierId)).toEqual([supLive.id]); // orphan hidden

    const all = await getProductMappingsLogic(tenantA, product.id, "all");
    expect(all).toHaveLength(2);
    expect(all[all.length - 1].supplierId).toBe(supDead.id); // orphan sorted last
  });

  // M11 — update price with NO date change → no supersede, no new row
  it("M11 updates a mapping (price change, no date change) without superseding", async () => {
    const { supplier, product } = await freshPair(tenantA, "M11");
    const r = await createSupplierProductMappingLogic(
      tenantA,
      mInput(supplier.id, product.id, { effectiveFrom: "2026-06-01", currentUnitPrice: 100 })
    );
    const upd = await updateSupplierProductMappingLogic(
      tenantA,
      r.id,
      mInput(supplier.id, product.id, { effectiveFrom: "2026-06-01", currentUnitPrice: 120 })
    );
    expect(Number(upd?.currentUnitPrice)).toBe(120);
    expect(upd?.effectiveTo).toBeNull(); // still the open row

    const all = await getProductMappingsLogic(tenantA, product.id, "all");
    expect(all).toHaveLength(1); // update did NOT append a row
  });

  // M12 — update that moves effectiveFrom recomputes the prior row's supersede close (Q4)
  it("M12 recomputes supersede when effectiveFrom is moved on update", async () => {
    const { supplier, product } = await freshPair(tenantA, "M12");
    const r1 = await createSupplierProductMappingLogic(
      tenantA,
      mInput(supplier.id, product.id, { effectiveFrom: "2026-06-01" })
    );
    const r2 = await createSupplierProductMappingLogic(
      tenantA,
      mInput(supplier.id, product.id, { effectiveFrom: "2026-07-01" })
    );
    // after the M6-style supersede, r1 closed at 2026-06-30.

    // Move r2 later → r1 must re-close at the new effectiveFrom − 1 day = 2026-07-31.
    const upd = await updateSupplierProductMappingLogic(
      tenantA,
      r2.id,
      mInput(supplier.id, product.id, { effectiveFrom: "2026-08-01" })
    );
    expect(isoDate(upd?.effectiveFrom)).toBe("2026-08-01");

    const r1after = await getSupplierProductMappingByIdLogic(tenantA, r1.id);
    expect(isoDate(r1after?.effectiveTo)).toBe("2026-07-31");
  });

  // M13 — soft-delete: deletedAt stamped, gone from active reads, still in history
  it("M13 soft-deletes a mapping (out of active reads, present in history)", async () => {
    const { supplier, product } = await freshPair(tenantA, "M13");
    const r = await createSupplierProductMappingLogic(tenantA, mInput(supplier.id, product.id));

    expect(await deleteSupplierProductMappingLogic(tenantA, r.id)).toBe(true);
    expect(await getSupplierProductMappingByIdLogic(tenantA, r.id)).toBeNull();
    expect(await getProductMappingsLogic(tenantA, product.id, "active")).toHaveLength(0);

    // history (audit trail) still surfaces the soft-deleted row
    const history = await getPriceHistoryLogic(tenantA, product.id, supplier.id, null);
    expect(history.some((h) => h.id === r.id)).toBe(true);

    // row physically survives
    const row = await withAdminContext((tx) =>
      tx.supplierProductMapping.findUnique({ where: { id: r.id } })
    );
    expect(row?.deletedAt).not.toBeNull();
  });

  // M14 — future-dated row (effectiveFrom > today) is allowed (scheduled price)
  it("M14 allows a future-dated mapping", async () => {
    const { supplier, product } = await freshPair(tenantA, "M14");
    const future = await createSupplierProductMappingLogic(
      tenantA,
      mInput(supplier.id, product.id, { effectiveFrom: "2027-01-01" })
    );
    expect(isoDate(future.effectiveFrom)).toBe("2027-01-01");
    expect(future.effectiveTo).toBeNull();
  });

  // M15 — duplicate composite key (same supplier+product+branch+effectiveFrom)
  // is rejected. The app overlap guard (Q4) fires here; the partial unique index
  // (Q10) is the DB-level backstop. NOTE for STEP B review: whether to ALSO map a
  // raw P2002 (partial-unique) to a distinct typed conflict — or rely solely on
  // the app guard — is the open decision flagged in the Drive handoff (M15).
  it("M15 rejects a duplicate composite key (same effectiveFrom)", async () => {
    const { supplier, product } = await freshPair(tenantA, "M15");
    await createSupplierProductMappingLogic(
      tenantA,
      mInput(supplier.id, product.id, { effectiveFrom: "2026-06-01" })
    );
    await expect(
      createSupplierProductMappingLogic(
        tenantA,
        mInput(supplier.id, product.id, { effectiveFrom: "2026-06-01" })
      )
    ).rejects.toBeInstanceOf(MappingOverlapError);
  });
});
