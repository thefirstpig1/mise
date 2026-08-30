// ============================================================
// Mise — product-restore *Logic integration tests (Sprint 1 Part 8.5 L3a)
// ============================================================
// Exercises the READ half of src/server/product-restore.ts against the real Neon
// DB through withTenantContext, keyed by tenantId (no auth mock). Tenant isolation
// is verified at the APP LAYER (explicit tenantId filtering) — RLS inert until
// Sprint 7 (ADR 0004). Mirrors tests/supplier-product-mapping-logic.test.ts.
//
// All candidates live in ONE tenant; each slice uses a DISTINCT name/sku stem so
// the pg_trgm similarity between different slices' products stays well under the
// 0.4 threshold and they never cross-match (live products never appear at all —
// the search is `deleted_at IS NOT NULL` only).
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma, type Supplier } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withRlsBypass } from "@/lib/db-admin";
import { supplierInputSchema } from "@/lib/validations/supplier";
import { productInputSchema } from "@/lib/validations/product";
import { supplierProductMappingInputSchema as mappingSchema } from "@/lib/validations/supplier-product-mapping";
import { createSupplierLogic, deleteSupplierLogic } from "@/server/supplier";
import {
  createProductLogic,
  deleteProductLogic,
  type ProductWithUnits,
} from "@/server/product";
import {
  createSupplierProductMappingLogic,
  MappingNotFoundError,
} from "@/server/supplier-product-mapping";
import { ProductSkuConflictError } from "@/server/product";
import type { MappingUpdate } from "@/lib/validations/product-restore";
import {
  fuzzySearchSoftDeletedProductsLogic,
  getOrphanMappingsForProductLogic,
  detectSkuConflictLogic,
  restoreProductLogic,
  computeBangkokToday,
  ProductNotFoundError,
} from "@/server/product-restore";

describe("product-restore *Logic (read; tenant-scoped, app-layer isolation)", () => {
  let tenantA: string;

  /** Create a LIVE WEIGHT/kg product (optionally with a custom sku). */
  const makeProduct = (
    name: string,
    sku?: string
  ): Promise<ProductWithUnits> =>
    createProductLogic(
      tenantA,
      productInputSchema.parse({
        name,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        ...(sku ? { sku } : {}),
      })
    );

  /** Create a LIVE supplier with a unique nameFull (avoids code collisions). */
  const makeSupplier = (tag: string): Promise<Supplier> =>
    createSupplierLogic(tenantA, supplierInputSchema.parse({ nameFull: `Sup-${tag}` }));

  /** Create a LIVE mapping (minimal required + overrides). */
  const makeMapping = (
    supplierId: string,
    productId: string,
    over: Record<string, unknown> = {}
  ) =>
    createSupplierProductMappingLogic(
      tenantA,
      mappingSchema.parse({
        supplierId,
        productId,
        effectiveFrom: "2026-06-01",
        ...over,
      })
    );

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const a = await tx.tenant.create({ data: { name: "Restore Test Tenant A" } });
      tenantA = a.id;
    });
  });

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.supplierProductMapping.deleteMany({ where: { tenantId: tenantA } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId: tenantA } } });
      await tx.product.deleteMany({ where: { tenantId: tenantA } });
      await tx.supplier.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.deleteMany({ where: { id: tenantA } });
    });
    await prisma.$disconnect();
  });

  // --- fuzzy search ---

  it("ranks an exact name match top with score ~1 and matchedOn name", async () => {
    const p = await makeProduct("alphaexactword");
    await deleteProductLogic(tenantA, p.id);

    const res = await fuzzySearchSoftDeletedProductsLogic(tenantA, "alphaexactword");
    expect(res[0]?.id).toBe(p.id);
    expect(res[0].score).toBeGreaterThanOrEqual(0.99);
    expect(res[0].matchedOn).toBe("name");
    expect(res[0].hasSkuConflict).toBe(false);
  });

  it("returns a partial name match below the exact one (ordering by score)", async () => {
    const exact = await makeProduct("bravoorderword");
    const ext = await makeProduct("bravoorderwordlongertail");
    await deleteProductLogic(tenantA, exact.id);
    await deleteProductLogic(tenantA, ext.id);

    const res = await fuzzySearchSoftDeletedProductsLogic(tenantA, "bravoorderword");
    expect(res[0]?.id).toBe(exact.id);
    const partial = res.find((r) => r.id === ext.id);
    expect(partial).toBeDefined();
    expect(partial!.score).toBeGreaterThan(0.4);
    expect(partial!.score).toBeLessThan(1);
  });

  it("sets matchedOn to 'sku' when the sku is the stronger match", async () => {
    const p = await makeProduct("charlienameonly", "DELTASKUCODE");
    await deleteProductLogic(tenantA, p.id);

    const res = await fuzzySearchSoftDeletedProductsLogic(tenantA, "DELTASKUCODE");
    const cand = res.find((r) => r.id === p.id);
    expect(cand).toBeDefined();
    expect(cand!.matchedOn).toBe("sku");
    expect(cand!.score).toBeGreaterThanOrEqual(0.99);
  });

  it("returns [] when nothing clears the similarity threshold", async () => {
    const res = await fuzzySearchSoftDeletedProductsLogic(tenantA, "echononexistentqzx");
    expect(res).toHaveLength(0);
  });

  it("returns [] defensively for a search term under 3 chars", async () => {
    const res = await fuzzySearchSoftDeletedProductsLogic(tenantA, "ab");
    expect(res).toHaveLength(0);
  });

  it("flags hasSkuConflict when a LIVE product holds the candidate's sku", async () => {
    const dead = await makeProduct("foxtrotconflict", "GOLFSKUDUP");
    await deleteProductLogic(tenantA, dead.id); // free the sku for a live re-use
    const live = await makeProduct("hotelliveprod", "GOLFSKUDUP");

    const res = await fuzzySearchSoftDeletedProductsLogic(tenantA, "foxtrotconflict");
    const cand = res.find((r) => r.id === dead.id);
    expect(cand).toBeDefined();
    expect(cand!.hasSkuConflict).toBe(true);
    expect(cand!.conflictingLiveProductName).toBe("hotelliveprod");
    expect(live.id).not.toBe(dead.id);
  });

  it("leaves hasSkuConflict false when no live product shares the sku", async () => {
    const p = await makeProduct("indiaconflictfree", "INDIAUNIQUESKU");
    await deleteProductLogic(tenantA, p.id);

    const res = await fuzzySearchSoftDeletedProductsLogic(tenantA, "indiaconflictfree");
    const cand = res.find((r) => r.id === p.id);
    expect(cand!.hasSkuConflict).toBe(false);
    expect(cand!.conflictingLiveProductName).toBeNull();
  });

  // --- orphan-mapping preview ---

  it("reports 0 orphan mappings with an empty sample", async () => {
    const p = await makeProduct("julietzeroorphan");
    await deleteProductLogic(tenantA, p.id);

    const res = await fuzzySearchSoftDeletedProductsLogic(tenantA, "julietzeroorphan");
    const cand = res.find((r) => r.id === p.id);
    expect(cand!.orphanMappingCount).toBe(0);
    expect(cand!.orphanMappingSample).toEqual([]);
  });

  it("previews a single orphan mapping with a serialized (string) price", async () => {
    const p = await makeProduct("kilooneorphan");
    const sup = await makeSupplier("kilo");
    await makeMapping(sup.id, p.id, { currentUnitPrice: 120, isPreferred: true });
    await deleteProductLogic(tenantA, p.id);

    const res = await fuzzySearchSoftDeletedProductsLogic(tenantA, "kilooneorphan");
    const cand = res.find((r) => r.id === p.id);
    expect(cand!.orphanMappingCount).toBe(1);
    expect(cand!.orphanMappingSample).toHaveLength(1);
    const s = cand!.orphanMappingSample[0];
    expect(s.supplierName).toBe(sup.nameFull);
    expect(typeof s.currentUnitPrice).toBe("string"); // Decimal serialized, Pitfall #20
    expect(s.isPreferred).toBe(true);
    expect(s.effectiveFrom).toBe("2026-06-01");
  });

  it("caps the orphan sample at 3 and puts the preferred mapping first", async () => {
    const p = await makeProduct("limafiveorphan");
    for (let i = 0; i < 4; i++) {
      const sup = await makeSupplier(`lima-${i}`);
      await makeMapping(sup.id, p.id, { currentUnitPrice: 10 + i });
    }
    const pref = await makeSupplier("lima-pref");
    await makeMapping(pref.id, p.id, { currentUnitPrice: 99, isPreferred: true });
    await deleteProductLogic(tenantA, p.id);

    const res = await fuzzySearchSoftDeletedProductsLogic(tenantA, "limafiveorphan");
    const cand = res.find((r) => r.id === p.id);
    expect(cand!.orphanMappingCount).toBe(5);
    expect(cand!.orphanMappingSample).toHaveLength(3);
    expect(cand!.orphanMappingSample[0].isPreferred).toBe(true);
  });

  it("keeps an orphan whose supplier is soft-deleted (F2: not filtered out)", async () => {
    const p = await makeProduct("mikesupdel");
    const sup = await makeSupplier("mike");
    await makeMapping(sup.id, p.id, { currentUnitPrice: 55 });
    await deleteSupplierLogic(tenantA, sup.id, []); // supplier soft-deleted, mapping stays live
    await deleteProductLogic(tenantA, p.id);

    const res = await fuzzySearchSoftDeletedProductsLogic(tenantA, "mikesupdel");
    const cand = res.find((r) => r.id === p.id);
    expect(cand!.orphanMappingCount).toBe(1);
    expect(cand!.orphanMappingSample[0].supplierName).toBe(sup.nameFull);
  });

  // --- getOrphanMappingsForProductLogic (internal full-relation read for L3b) ---

  it("getOrphanMappingsForProductLogic returns live orphans with full relations", async () => {
    const p = await makeProduct("novemberorphanfetch");
    const sup = await makeSupplier("november");
    await makeMapping(sup.id, p.id, { currentUnitPrice: 77 });
    await deleteProductLogic(tenantA, p.id);

    const rows = await getOrphanMappingsForProductLogic(tenantA, p.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).toBeNull();
    expect(rows[0].supplier.nameFull).toBe(sup.nameFull);
    expect(rows[0].product.id).toBe(p.id); // full relations included
    expect(rows[0].currentUnitPrice).toBeInstanceOf(Prisma.Decimal); // raw type, Decimal kept
  });

  // --- detectSkuConflictLogic (action-layer pre-check) ---

  it("detectSkuConflict returns false when no live product owns the sku", async () => {
    const res = await detectSkuConflictLogic(tenantA, randomUUID(), "ZULUUNUSEDSKU");
    expect(res.hasConflict).toBe(false);
    expect(res.conflictingProductName).toBeNull();
  });

  it("detectSkuConflict returns true with the owning live product's name", async () => {
    const live = await makeProduct("oscarlive", "PAPASKULIVE");
    const res = await detectSkuConflictLogic(tenantA, randomUUID(), "PAPASKULIVE");
    expect(res.hasConflict).toBe(true);
    expect(res.conflictingProductName).toBe("oscarlive");
    expect(live.id).toBeDefined();
  });

  it("detectSkuConflict excludes the candidate itself (own sku is not a conflict)", async () => {
    const live = await makeProduct("quebeclive", "ROMEOSKU");
    const res = await detectSkuConflictLogic(tenantA, live.id, "ROMEOSKU");
    expect(res.hasConflict).toBe(false);
    expect(res.conflictingProductName).toBeNull();
  });

  // ============================================================
  // L3b — restoreProductLogic (write; supersede / overwrite / conflicts)
  // ============================================================

  const PRICE = { currentUnitPrice: 150, minOrderQty: 5, leadTimeDays: 2 };
  /** An "update" price-review decision for one orphan mapping. */
  const upd = (
    mappingId: string,
    updates: { currentUnitPrice: number; minOrderQty: number; leadTimeDays: number } = PRICE
  ): MappingUpdate => ({ mappingId, action: "update", updates });
  /** A "keep" decision (leave the orphan price as-is). */
  const keep = (mappingId: string): MappingUpdate => ({ mappingId, action: "keep" });
  /** YYYY-MM-DD of a UTC-midnight date (the @db.Date wire format). */
  const ymd = (d: Date): string => d.toISOString().slice(0, 10);
  /** Every mapping row of a product (incl. closed history), oldest effectiveFrom first. */
  const rowsOf = (productId: string) =>
    withRlsBypass((tx) =>
      tx.supplierProductMapping.findMany({
        where: { productId },
        orderBy: { effectiveFrom: "asc" },
      })
    );

  it("restores a soft-deleted product (no newSku, no mapping updates)", async () => {
    const p = await makeProduct("restorebasicword");
    await deleteProductLogic(tenantA, p.id);

    const res = await restoreProductLogic(tenantA, p.id);
    expect(res.product.id).toBe(p.id);
    expect(res.product.deletedAt).toBeNull();
    expect(res.affectedSupplierIds).toEqual([]); // no orphan mappings → nothing to revalidate
  });

  it("throws ProductNotFoundError when the product is already live (double-submit)", async () => {
    const p = await makeProduct("restorealiveword");
    await expect(restoreProductLogic(tenantA, p.id)).rejects.toBeInstanceOf(
      ProductNotFoundError
    );
  });

  it("throws ProductNotFoundError for an unknown / cross-tenant id", async () => {
    await expect(restoreProductLogic(tenantA, randomUUID())).rejects.toBeInstanceOf(
      ProductNotFoundError
    );
  });

  it("restores with a conflict-free newSku (sku replaced)", async () => {
    const p = await makeProduct("restorenewskuword", "OLDSKUONE");
    await deleteProductLogic(tenantA, p.id);

    const res = await restoreProductLogic(tenantA, p.id, { newSku: "FRESHSKUONE" });
    expect(res.product.sku).toBe("FRESHSKUONE");
    expect(res.product.deletedAt).toBeNull();
  });

  it("throws ProductSkuConflictError when newSku collides with a live product", async () => {
    const dead = await makeProduct("restoreconflword", "DEADSKUTWO");
    await deleteProductLogic(tenantA, dead.id);
    const live = await makeProduct("restoreliveword", "TAKENSKUTWO");

    await expect(
      restoreProductLogic(tenantA, dead.id, { newSku: "TAKENSKUTWO" })
    ).rejects.toBeInstanceOf(ProductSkuConflictError);
    expect(live.sku).toBe("TAKENSKUTWO");
  });

  it("accepts newSku equal to the candidate's own original sku (self not a conflict)", async () => {
    const p = await makeProduct("restoreownskuword", "SELFSKUTHREE");
    await deleteProductLogic(tenantA, p.id);

    const res = await restoreProductLogic(tenantA, p.id, { newSku: "SELFSKUTHREE" });
    expect(res.product.sku).toBe("SELFSKUTHREE");
  });

  it("throws ProductSkuConflictError on original-sku collision when no newSku given (#5 backstop)", async () => {
    const dead = await makeProduct("restoreorigword", "REUSEDSKUFOUR");
    await deleteProductLogic(tenantA, dead.id); // frees the sku for a live re-use
    const live = await makeProduct("restoreshadowword", "REUSEDSKUFOUR");

    await expect(restoreProductLogic(tenantA, dead.id)).rejects.toBeInstanceOf(
      ProductSkuConflictError
    );
    // rolled back: the dead product stays soft-deleted, the live owner keeps the sku.
    const [still] = await withRlsBypass((tx) =>
      tx.product.findMany({ where: { id: dead.id } })
    );
    expect(still.deletedAt).not.toBeNull();
    expect(live.sku).toBe("REUSEDSKUFOUR");
  });

  it("applies a keep + update mix (only the 'update' row supersedes)", async () => {
    const p = await makeProduct("restoremixword");
    const supKeep = await makeSupplier("mix-keep");
    const supUpd = await makeSupplier("mix-upd");
    const mKeep = await makeMapping(supKeep.id, p.id, { currentUnitPrice: 100 });
    const mUpd = await makeMapping(supUpd.id, p.id, { currentUnitPrice: 100 });
    await deleteProductLogic(tenantA, p.id);

    const res = await restoreProductLogic(tenantA, p.id, {
      mappingUpdates: [keep(mKeep.id), upd(mUpd.id)],
    });

    // affectedSupplierIds = ALL live orphan suppliers (keep + update), distinct.
    expect([...res.affectedSupplierIds].sort()).toEqual(
      [supKeep.id, supUpd.id].sort()
    );

    const rows = await rowsOf(p.id);
    const keepRows = rows.filter((r) => r.supplierId === supKeep.id);
    const updRows = rows.filter((r) => r.supplierId === supUpd.id);
    expect(keepRows).toHaveLength(1); // untouched
    expect(Number(keepRows[0].currentUnitPrice)).toBe(100);
    expect(keepRows[0].effectiveTo).toBeNull();
    expect(updRows).toHaveLength(2); // superseded → old + new
  });

  it("supersedes an older-date orphan: closes old at today−1, inserts a new open row", async () => {
    const today = computeBangkokToday();
    const p = await makeProduct("restoresupersedeword");
    const sup = await makeSupplier("supersede");
    const m = await makeMapping(sup.id, p.id, {
      effectiveFrom: "2026-06-01",
      currentUnitPrice: 100,
    });
    await deleteProductLogic(tenantA, p.id);

    await restoreProductLogic(tenantA, p.id, { mappingUpdates: [upd(m.id)] });

    const rows = await rowsOf(p.id);
    expect(rows).toHaveLength(2);
    const [oldRow, newRow] = rows; // oldest effectiveFrom first
    expect(oldRow.id).toBe(m.id);
    expect(oldRow.effectiveTo!.getTime()).toBe(today.getTime() - 86_400_000);
    expect(newRow.effectiveFrom.getTime()).toBe(today.getTime());
    expect(newRow.effectiveTo).toBeNull();
    expect(Number(newRow.currentUnitPrice)).toBe(150);
  });

  it("overwrites a same-day (Bangkok) orphan in place (no new row)", async () => {
    const today = computeBangkokToday();
    const p = await makeProduct("restoreoverwriteword");
    const sup = await makeSupplier("overwrite");
    const m = await makeMapping(sup.id, p.id, {
      effectiveFrom: ymd(today),
      currentUnitPrice: 100,
    });
    await deleteProductLogic(tenantA, p.id);

    await restoreProductLogic(tenantA, p.id, { mappingUpdates: [upd(m.id)] });

    const rows = await rowsOf(p.id);
    expect(rows).toHaveLength(1); // overwrite — no supersede row
    expect(rows[0].id).toBe(m.id);
    expect(rows[0].effectiveFrom.getTime()).toBe(today.getTime());
    expect(rows[0].effectiveTo).toBeNull();
    expect(Number(rows[0].currentUnitPrice)).toBe(150);
  });

  it("throws MappingNotFoundError for an unknown mappingId and rolls the restore back", async () => {
    const p = await makeProduct("restorebadmapword");
    await deleteProductLogic(tenantA, p.id);

    await expect(
      restoreProductLogic(tenantA, p.id, { mappingUpdates: [upd(randomUUID())] })
    ).rejects.toBeInstanceOf(MappingNotFoundError);

    // atomic (Q4): the Step-3 undelete rolled back with the failed mapping write.
    const [still] = await withRlsBypass((tx) =>
      tx.product.findMany({ where: { id: p.id } })
    );
    expect(still.deletedAt).not.toBeNull();
  });

  it("rejects updating a closed historical orphan row → MappingNotFoundError (#4 guard)", async () => {
    const p = await makeProduct("restoreclosedword");
    const sup = await makeSupplier("closed");
    const older = await makeMapping(sup.id, p.id, {
      effectiveFrom: "2026-06-01",
      currentUnitPrice: 100,
    });
    // a later price for the SAME series supersedes `older` → older.effectiveTo set (closed).
    await makeMapping(sup.id, p.id, { effectiveFrom: "2026-06-05", currentUnitPrice: 110 });
    await deleteProductLogic(tenantA, p.id);

    // sanity: `older` is now a CLOSED (effectiveTo != null) but still-LIVE orphan row.
    const before = await rowsOf(p.id);
    const closed = before.find((r) => r.id === older.id)!;
    expect(closed.effectiveTo).not.toBeNull();
    expect(closed.deletedAt).toBeNull();

    await expect(
      restoreProductLogic(tenantA, p.id, { mappingUpdates: [upd(older.id)] })
    ).rejects.toBeInstanceOf(MappingNotFoundError);
  });

  it("treats an effectiveFrom of yesterday-Bangkok as supersede (TZ boundary)", async () => {
    const today = computeBangkokToday();
    const yesterday = new Date(today.getTime() - 86_400_000);
    const p = await makeProduct("restoreboundaryword");
    const sup = await makeSupplier("boundary");
    const m = await makeMapping(sup.id, p.id, {
      effectiveFrom: ymd(yesterday),
      currentUnitPrice: 100,
    });
    await deleteProductLogic(tenantA, p.id);

    await restoreProductLogic(tenantA, p.id, { mappingUpdates: [upd(m.id)] });

    const rows = await rowsOf(p.id);
    expect(rows).toHaveLength(2); // yesterday != today → supersede, not overwrite
    const [oldRow, newRow] = rows;
    expect(oldRow.effectiveTo!.getTime()).toBe(yesterday.getTime()); // closed at today−1
    expect(newRow.effectiveFrom.getTime()).toBe(today.getTime());
  });
});
