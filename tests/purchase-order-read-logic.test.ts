// ============================================================
// Mise — Purchase Order READ *Logic integration tests (Part 11 L3a)
// ============================================================
// Exercises src/server/purchase-order.ts against the real Neon DB through
// withTenantContext, keyed by tenantId (no auth mock) — same harness as
// tests/stock-movement-logic.test.ts.
//
// The centrepiece is resolveSupplierPriceLogic: ADR 0009's lookup rule, written
// for the first time here. Its fixtures are built with the REAL Part 8 write
// logic (createSupplierProductMappingLogic), not hand-inserted rows, so the
// resolver is tested against price series shaped exactly the way the app
// produces them — including the append+supersede pattern.
//
// Purchase orders themselves are inserted directly via admin context: L3b (the
// write path) does not exist yet, and hand-built rows let a slice pin an exact
// status/qty combination that the write path would not let it reach.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withRlsBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { supplierInputSchema } from "@/lib/validations/supplier";
import { createSupplierLogic } from "@/server/supplier";
import { supplierProductMappingInputSchema } from "@/lib/validations/supplier-product-mapping";
import { createSupplierProductMappingLogic } from "@/server/supplier-product-mapping";
import {
  getOpenOrderQtyForProductLogic,
  getPurchaseOrderByIdLogic,
  getPurchaseOrdersLogic,
  getSupplierCatalogLogic,
  resolveSupplierPriceLogic,
  suggestSuppliersForProductLogic,
} from "@/server/purchase-order";

const num = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());

describe("purchase-order read *Logic (tenant-scoped, app-layer isolation)", () => {
  const today = computeBangkokToday();
  const day = (offset: number) => addDays(today, offset);

  let tenantA: string;
  let tenantB: string;
  let branchA1: string;
  let branchA2: string;
  let branchB: string;
  let userA: string;

  let supMain: string; // has both a tenant-default and a branch override
  let supAlt: string; // tenant-default only, marked preferred
  let supExpired: string; // price window already closed
  let supB: string; // tenant B

  let prod: ProductWithUnits;
  let prodNoPrice: ProductWithUnits;
  let prodB: ProductWithUnits;

  const freshProduct = (tenant: string, tag: string): Promise<ProductWithUnits> =>
    createProductLogic(
      tenant,
      productInputSchema.parse({
        name: `PO-${tag}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
      })
    );

  const freshSupplier = async (tenant: string, name: string): Promise<string> => {
    const s = await createSupplierLogic(
      tenant,
      supplierInputSchema.parse({ nameFull: name })
    );
    return s.id;
  };

  const mapping = (
    tenant: string,
    input: {
      supplierId: string;
      productId: string;
      branchId: string | null;
      orderUnitId: string;
      currentUnitPrice: number;
      effectiveFrom: Date;
      effectiveTo?: Date | null;
      isPreferred?: boolean;
      minOrderQty?: number | null;
      leadTimeDays?: number | null;
    }
  ) =>
    createSupplierProductMappingLogic(
      tenant,
      supplierProductMappingInputSchema.parse({
        supplierItemCode: null,
        supplierItemName: null,
        minOrderQty: null,
        leadTimeDays: null,
        isPreferred: false,
        effectiveTo: null,
        ...input,
      })
    );

  /** Insert a PO + one line directly (no L3b yet). */
  const po = async (opts: {
    tenantId: string;
    branchId: string;
    supplierId: string;
    poNumber: string;
    status: "DRAFT" | "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
    productId: string;
    orderUnitId: string;
    qtyOrdered: number;
    qtyReceived?: number;
    toBaseRatio?: number;
    deletedAt?: Date | null;
  }) =>
    withRlsBypass((tx) =>
      tx.purchaseOrder.create({
        data: {
          tenantId: opts.tenantId,
          branchId: opts.branchId,
          supplierId: opts.supplierId,
          poNumber: opts.poNumber,
          status: opts.status,
          // purchase_order_sent_at_check: anything past DRAFT records when it left
          sentAt: opts.status === "DRAFT" || opts.status === "CANCELLED" ? null : new Date(),
          createdBy: userA,
          deletedAt: opts.deletedAt ?? null,
          subtotalExclVat: new Prisma.Decimal(100),
          vatAmount: new Prisma.Decimal(7),
          totalAmount: new Prisma.Decimal(107),
          vatRatePercent: new Prisma.Decimal(7),
          items: {
            create: [
              {
                tenantId: opts.tenantId,
                productId: opts.productId,
                lineNo: 1,
                qtyOrdered: new Prisma.Decimal(opts.qtyOrdered),
                qtyReceived: new Prisma.Decimal(opts.qtyReceived ?? 0),
                orderUnitId: opts.orderUnitId,
                orderUnitName: "kg",
                toBaseRatio: new Prisma.Decimal(opts.toBaseRatio ?? 1),
                unitPrice: new Prisma.Decimal(10),
                lineTotal: new Prisma.Decimal(100),
              },
            ],
          },
        },
      })
    );

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const a = await tx.tenant.create({ data: { name: "PO Test Tenant A" } });
      const b = await tx.tenant.create({ data: { name: "PO Test Tenant B" } });
      tenantA = a.id;
      tenantB = b.id;

      const [a1, a2, bb] = await Promise.all([
        tx.branch.create({ data: { tenantId: a.id, name: "A1", code: "A1" } }),
        tx.branch.create({ data: { tenantId: a.id, name: "A2", code: "A2" } }),
        tx.branch.create({ data: { tenantId: b.id, name: "B1", code: "MAIN" } }),
      ]);
      branchA1 = a1.id;
      branchA2 = a2.id;
      branchB = bb.id;

      const u = await tx.user.create({
        data: { email: `po-test-${randomUUID()}@example.com`, name: "ผู้ทดสอบ" },
      });
      userA = u.id;
    });

    prod = await freshProduct(tenantA, "1-main");
    prodNoPrice = await freshProduct(tenantA, "2-noprice");
    prodB = await freshProduct(tenantB, "B-cross");

    supMain = await freshSupplier(tenantA, "ผู้ขายหลัก");
    supAlt = await freshSupplier(tenantA, "ผู้ขายสำรอง");
    supExpired = await freshSupplier(tenantA, "ผู้ขายหมดสัญญา");
    supB = await freshSupplier(tenantB, "ผู้ขายของ B");

    const unit = prod.productUnits[0].id;

    // supMain: tenant default 100, branch-A1 override 90 (ADR 0009 Q7)
    await mapping(tenantA, {
      supplierId: supMain,
      productId: prod.id,
      branchId: null,
      orderUnitId: unit,
      currentUnitPrice: 100,
      effectiveFrom: day(-30),
      minOrderQty: 5,
      leadTimeDays: 2,
    });
    await mapping(tenantA, {
      supplierId: supMain,
      productId: prod.id,
      branchId: branchA1,
      orderUnitId: unit,
      currentUnitPrice: 90,
      effectiveFrom: day(-10),
    });

    // supAlt: tenant default only, preferred
    await mapping(tenantA, {
      supplierId: supAlt,
      productId: prod.id,
      branchId: null,
      orderUnitId: unit,
      currentUnitPrice: 120,
      effectiveFrom: day(-20),
      isPreferred: true,
    });

    // supExpired: window closed yesterday
    await mapping(tenantA, {
      supplierId: supExpired,
      productId: prod.id,
      branchId: null,
      orderUnitId: unit,
      currentUnitPrice: 50,
      effectiveFrom: day(-40),
      effectiveTo: day(-1),
    });

    // tenant B — same product name, different tenant
    await mapping(tenantB, {
      supplierId: supB,
      productId: prodB.id,
      branchId: null,
      orderUnitId: prodB.productUnits[0].id,
      currentUnitPrice: 999,
      effectiveFrom: day(-5),
    });
  });

  afterAll(async () => {
    const ids = [tenantA, tenantB];
    await withRlsBypass(async (tx) => {
      // C7–C9 receipts; reversal lines point at their originals, so they go first.
      await tx.goodsReceiptItem.deleteMany({
        where: { tenantId: { in: ids }, reversalOfItemId: { not: null } },
      });
      await tx.goodsReceiptItem.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.goodsReceipt.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.purchaseOrderItemAllocation.deleteMany({
        where: { tenantId: { in: ids } },
      });
      await tx.purchaseOrderItem.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.purchaseOrder.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.supplierProductMapping.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.supplier.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId: { in: ids } } } });
      await tx.product.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.branch.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.tenant.deleteMany({ where: { id: { in: ids } } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
    await prisma.$disconnect();
  });

  // ----------------------------------------------------------
  // P1–P7 — resolveSupplierPriceLogic (ADR 0009's lookup rule)
  // ----------------------------------------------------------

  it("P1: branch override wins over the tenant default at that branch", async () => {
    const r = await resolveSupplierPriceLogic(tenantA, prod.id, supMain, branchA1);
    expect(r).not.toBeNull();
    expect(num(r!.unitPrice)).toBe(90);
    expect(r!.scope).toBe("branch");
  });

  it("P2: a branch with no override falls back to the tenant default", async () => {
    const r = await resolveSupplierPriceLogic(tenantA, prod.id, supMain, branchA2);
    expect(num(r!.unitPrice)).toBe(100);
    expect(r!.scope).toBe("tenant");
  });

  it("P3: carries the order unit + ratio the line will freeze, and the terms", async () => {
    const r = await resolveSupplierPriceLogic(tenantA, prod.id, supMain, branchA2);
    expect(r!.orderUnitId).toBe(prod.productUnits[0].id);
    expect(r!.orderUnitName).toBe("kg");
    expect(num(r!.toBaseRatio)).toBe(1);
    expect(num(r!.minOrderQty)).toBe(5);
    expect(r!.leadTimeDays).toBe(2);
    expect(r!.mappingId).toBeTruthy();
  });

  it("P4: an expired window resolves to null — not to the stale price", async () => {
    const r = await resolveSupplierPriceLogic(tenantA, prod.id, supExpired, branchA1);
    expect(r).toBeNull();
  });

  it("P5: a product with no mapping at all resolves to null (Q5 hand-typed path)", async () => {
    const r = await resolveSupplierPriceLogic(
      tenantA,
      prodNoPrice.id,
      supMain,
      branchA1
    );
    expect(r).toBeNull();
  });

  it("P6: a future-dated price is not current yet, and becomes current on its day", async () => {
    const future = await freshSupplier(tenantA, "ผู้ขายราคาอนาคต");
    await mapping(tenantA, {
      supplierId: future,
      productId: prod.id,
      branchId: null,
      orderUnitId: prod.productUnits[0].id,
      currentUnitPrice: 77,
      effectiveFrom: day(3),
    });

    expect(
      await resolveSupplierPriceLogic(tenantA, prod.id, future, branchA1)
    ).toBeNull();

    const later = await resolveSupplierPriceLogic(
      tenantA,
      prod.id,
      future,
      branchA1,
      day(3)
    );
    expect(num(later!.unitPrice)).toBe(77);
  });

  it("P7: another tenant's price is invisible, even with valid ids", async () => {
    expect(
      await resolveSupplierPriceLogic(tenantA, prodB.id, supB, branchA1)
    ).toBeNull();
    expect(
      await resolveSupplierPriceLogic(tenantB, prod.id, supMain, branchB)
    ).toBeNull();
  });

  // ----------------------------------------------------------
  // P8–P9 — suggestSuppliersForProductLogic
  // ----------------------------------------------------------

  it("P8: suggests one entry per supplier, preferred first", async () => {
    const s = await suggestSuppliersForProductLogic(tenantA, prod.id, branchA1);
    const ids = s.map((x) => x.supplierId);
    expect(ids).toContain(supMain);
    expect(ids).toContain(supAlt);
    // the expired window is not a current option
    expect(ids).not.toContain(supExpired);
    // supMain has BOTH a default and a branch row — it must appear once
    expect(ids.filter((i) => i === supMain)).toHaveLength(1);
    expect(s[0].isPreferred).toBe(true);
    expect(s.find((x) => x.supplierId === supMain)!.scope).toBe("branch");
  });

  it("P9: a soft-deleted supplier drops out of the suggestions", async () => {
    const doomed = await freshSupplier(tenantA, "ผู้ขายที่จะถูกลบ");
    await mapping(tenantA, {
      supplierId: doomed,
      productId: prod.id,
      branchId: null,
      orderUnitId: prod.productUnits[0].id,
      currentUnitPrice: 60,
      effectiveFrom: day(-2),
    });
    expect(
      (await suggestSuppliersForProductLogic(tenantA, prod.id, branchA1)).map(
        (x) => x.supplierId
      )
    ).toContain(doomed);

    await withRlsBypass((tx) =>
      tx.supplier.update({ where: { id: doomed }, data: { deletedAt: new Date() } })
    );

    expect(
      (await suggestSuppliersForProductLogic(tenantA, prod.id, branchA1)).map(
        (x) => x.supplierId
      )
    ).not.toContain(doomed);
  });

  // ----------------------------------------------------------
  // P10–P13 — order reads
  // ----------------------------------------------------------

  it("P10: lists live orders newest-first and filters by status/branch/supplier", async () => {
    await po({
      tenantId: tenantA,
      branchId: branchA1,
      supplierId: supMain,
      poNumber: "A1-PO-0001",
      status: "DRAFT",
      productId: prod.id,
      orderUnitId: prod.productUnits[0].id,
      qtyOrdered: 5,
    });
    await po({
      tenantId: tenantA,
      branchId: branchA2,
      supplierId: supAlt,
      poNumber: "A2-PO-0001",
      status: "SENT",
      productId: prod.id,
      orderUnitId: prod.productUnits[0].id,
      qtyOrdered: 8,
    });

    const all = await getPurchaseOrdersLogic(tenantA);
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all[0].createdAt.getTime()).toBeGreaterThanOrEqual(
      all[all.length - 1].createdAt.getTime()
    );
    expect(all[0]._count.items).toBe(1);

    const sent = await getPurchaseOrdersLogic(tenantA, { status: "SENT" });
    expect(sent.every((p) => p.status === "SENT")).toBe(true);

    const byBranch = await getPurchaseOrdersLogic(tenantA, { branchId: branchA1 });
    expect(byBranch.every((p) => p.branchId === branchA1)).toBe(true);

    const bySupplier = await getPurchaseOrdersLogic(tenantA, { supplierId: supAlt });
    expect(bySupplier.every((p) => p.supplierId === supAlt)).toBe(true);
  });

  it("P11: a soft-deleted DRAFT disappears from the list and from getById", async () => {
    const dead = await po({
      tenantId: tenantA,
      branchId: branchA1,
      supplierId: supMain,
      poNumber: "A1-PO-9999",
      status: "DRAFT",
      productId: prod.id,
      orderUnitId: prod.productUnits[0].id,
      qtyOrdered: 1,
      deletedAt: new Date(),
    });

    const list = await getPurchaseOrdersLogic(tenantA);
    expect(list.map((p) => p.id)).not.toContain(dead.id);
    expect(await getPurchaseOrderByIdLogic(tenantA, dead.id)).toBeNull();
  });

  it("P12: getById returns lines ordered by lineNo with product + allocations", async () => {
    const created = await po({
      tenantId: tenantA,
      branchId: branchA1,
      supplierId: supMain,
      poNumber: "A1-PO-0002",
      status: "SENT",
      productId: prod.id,
      orderUnitId: prod.productUnits[0].id,
      qtyOrdered: 3,
    });

    const detail = await getPurchaseOrderByIdLogic(tenantA, created.id);
    expect(detail).not.toBeNull();
    expect(detail!.items).toHaveLength(1);
    expect(detail!.items[0].lineNo).toBe(1);
    expect(detail!.items[0].product.sku).toBe(prod.sku);
    expect(detail!.supplier.nameFull).toBe("ผู้ขายหลัก");
    expect(detail!.createdByUser.id).toBe(userA);
  });

  it("P13: another tenant's order is 'not found', never a leak", async () => {
    const mine = await po({
      tenantId: tenantA,
      branchId: branchA1,
      supplierId: supMain,
      poNumber: "A1-PO-0003",
      status: "SENT",
      productId: prod.id,
      orderUnitId: prod.productUnits[0].id,
      qtyOrdered: 2,
    });
    expect(await getPurchaseOrderByIdLogic(tenantB, mine.id)).toBeNull();
    expect(
      (await getPurchaseOrdersLogic(tenantB)).map((p) => p.id)
    ).not.toContain(mine.id);
  });

  // ----------------------------------------------------------
  // P14–P15 — open order quantity
  // ----------------------------------------------------------

  it("P14: counts only placed orders, net of what has already arrived", async () => {
    const openProd = await freshProduct(tenantA, "3-open");
    const unit = openProd.productUnits[0].id;

    // DRAFT — not placed with anyone yet, must not count
    await po({
      tenantId: tenantA,
      branchId: branchA1,
      supplierId: supMain,
      poNumber: "A1-PO-1001",
      status: "DRAFT",
      productId: openProd.id,
      orderUnitId: unit,
      qtyOrdered: 100,
    });
    // SENT, 10 ordered in a ×25 unit, 2 already received → (10−2)×25 = 200 base
    await po({
      tenantId: tenantA,
      branchId: branchA1,
      supplierId: supMain,
      poNumber: "A1-PO-1002",
      status: "SENT",
      productId: openProd.id,
      orderUnitId: unit,
      qtyOrdered: 10,
      qtyReceived: 2,
      toBaseRatio: 25,
    });
    // RECEIVED — finished, must not count
    await po({
      tenantId: tenantA,
      branchId: branchA1,
      supplierId: supMain,
      poNumber: "A1-PO-1003",
      status: "RECEIVED",
      productId: openProd.id,
      orderUnitId: unit,
      qtyOrdered: 50,
    });

    const open = await getOpenOrderQtyForProductLogic(
      tenantA,
      openProd.id,
      branchA1
    );
    expect(open.lineCount).toBe(1);
    expect(num(open.qtyOrderedBase)).toBe(200);
  });

  it("P15: nothing on order reads as zero lines, not an error", async () => {
    const quiet = await freshProduct(tenantA, "4-quiet");
    const open = await getOpenOrderQtyForProductLogic(tenantA, quiet.id, branchA1);
    expect(open.lineCount).toBe(0);
    expect(open.qtyOrderedBase).toBeNull();
  });

  // ----------------------------------------------------------
  // C1–C6 — getSupplierCatalogLogic (the supplier's order catalog)
  // ----------------------------------------------------------

  it("C1: lists what the supplier sells, priced by the branch override at that branch", async () => {
    const items = await getSupplierCatalogLogic(tenantA, supMain, branchA1);
    const ids = items.map((i) => i.productId);
    expect(ids).toContain(prod.id);
    // prodNoPrice has no mapping with this supplier — not in its catalog
    expect(ids).not.toContain(prodNoPrice.id);
    const item = items.find((i) => i.productId === prod.id)!;
    expect(num(item.price!.unitPrice)).toBe(90);
    expect(item.price!.scope).toBe("branch");
    expect(item.defaultUnitId).toBe(prod.productUnits[0].id);
  });

  it("C2: another branch falls back to the tenant default price", async () => {
    const items = await getSupplierCatalogLogic(tenantA, supMain, branchA2);
    const item = items.find((i) => i.productId === prod.id)!;
    expect(num(item.price!.unitPrice)).toBe(100);
    expect(item.price!.scope).toBe("tenant");
  });

  it("C3: a closed price window keeps the product listed, with no price to prefill", async () => {
    const items = await getSupplierCatalogLogic(tenantA, supExpired, branchA1);
    const item = items.find((i) => i.productId === prod.id)!;
    expect(item).toBeDefined();
    expect(item.price).toBeNull();
    expect(item.defaultUnitId).toBe(prod.productUnits[0].id);
  });

  it("C4: a mapping for ANOTHER branch does not put the product in this branch's catalog", async () => {
    const onlyA1 = await freshProduct(tenantA, "5-only-a1");
    await mapping(tenantA, {
      supplierId: supAlt,
      productId: onlyA1.id,
      branchId: branchA1,
      orderUnitId: onlyA1.productUnits[0].id,
      currentUnitPrice: 70,
      effectiveFrom: day(-3),
    });
    const atA1 = await getSupplierCatalogLogic(tenantA, supAlt, branchA1);
    const atA2 = await getSupplierCatalogLogic(tenantA, supAlt, branchA2);
    expect(atA1.map((i) => i.productId)).toContain(onlyA1.id);
    expect(atA2.map((i) => i.productId)).not.toContain(onlyA1.id);
  });

  it("C5: another tenant's supplier yields an empty catalog, never its rows", async () => {
    const items = await getSupplierCatalogLogic(tenantA, supB, branchA1);
    expect(items).toEqual([]);
  });

  /** A goods receipt with lines, built directly (the receipt write path is not under test). */
  let grSeq = 0;
  const gr = (opts: {
    supplierId: string;
    branchId: string;
    status: "DRAFT" | "CONFIRMED" | "VOIDED";
    receivedAt: Date;
    lines: { productId: string; unitId: string; price: number; reverse?: boolean }[];
  }) =>
    withRlsBypass(async (tx) => {
      const doc = await tx.goodsReceipt.create({
        data: {
          tenantId: tenantA,
          branchId: opts.branchId,
          supplierId: opts.supplierId,
          grNumber: `CAT-GR-${++grSeq}`,
          status: opts.status,
          receivedAt: opts.receivedAt,
          receivedBy: userA,
          confirmedAt: opts.status === "DRAFT" ? null : opts.receivedAt,
          voidedAt: opts.status === "VOIDED" ? opts.receivedAt : null,
        },
      });
      let lineNo = 0;
      for (const l of opts.lines) {
        const line = await tx.goodsReceiptItem.create({
          data: {
            tenantId: tenantA,
            goodsReceiptId: doc.id,
            productId: l.productId,
            lineNo: ++lineNo,
            qtyReceivedActual: new Prisma.Decimal(2),
            receivedUnitId: l.unitId,
            receivedUnitName: "kg",
            toBaseRatio: new Prisma.Decimal(1),
            unitPriceActual: new Prisma.Decimal(l.price),
            lineTotalActual: new Prisma.Decimal(l.price * 2),
          },
        });
        if (l.reverse) {
          await tx.goodsReceiptItem.create({
            data: {
              tenantId: tenantA,
              goodsReceiptId: doc.id,
              productId: l.productId,
              lineNo: ++lineNo,
              qtyReceivedActual: new Prisma.Decimal(-2),
              receivedUnitId: l.unitId,
              receivedUnitName: "kg",
              toBaseRatio: new Prisma.Decimal(1),
              unitPriceActual: new Prisma.Decimal(l.price),
              lineTotalActual: new Prisma.Decimal(-l.price * 2),
              reversalOfItemId: line.id,
            },
          });
        }
      }
    });
  const at = (offset: number) => new Date(day(offset).getTime() + 5 * 3600_000);

  it("C7: a product only ever DELIVERED is listed, prefilled with what was last paid on a confirmed receipt", async () => {
    const sup = await freshSupplier(tenantA, "ผู้ขายไม่มีรายการราคา");
    const bought = await freshProduct(tenantA, "6-bought");
    const draftOnly = await freshProduct(tenantA, "7-draft-only");
    const unit = bought.productUnits[0].id;
    await gr({ supplierId: sup, branchId: branchA1, status: "CONFIRMED", receivedAt: at(-9), lines: [{ productId: bought.id, unitId: unit, price: 40 }] });
    await gr({ supplierId: sup, branchId: branchA1, status: "CONFIRMED", receivedAt: at(-5), lines: [{ productId: bought.id, unitId: unit, price: 44 }] });
    // Newer, but none of these is a delivery that stood:
    await gr({ supplierId: sup, branchId: branchA1, status: "VOIDED", receivedAt: at(-3), lines: [{ productId: bought.id, unitId: unit, price: 99 }] });
    await gr({ supplierId: sup, branchId: branchA1, status: "CONFIRMED", receivedAt: at(-2), lines: [{ productId: bought.id, unitId: unit, price: 77, reverse: true }] });
    await gr({ supplierId: sup, branchId: branchA1, status: "DRAFT", receivedAt: at(-1), lines: [{ productId: draftOnly.id, unitId: draftOnly.productUnits[0].id, price: 10 }] });

    const items = await getSupplierCatalogLogic(tenantA, sup, branchA1);
    expect(items.map((i) => i.productId)).toEqual([bought.id]);
    const item = items[0];
    expect(item.price).toBeNull();
    expect(num(item.lastPaid!.unitPrice)).toBe(44);
    expect(item.lastPaid!.unitId).toBe(unit);
    expect(item.defaultUnitId).toBe(unit);
  });

  it("C8: this branch's last price beats a newer one paid at another branch", async () => {
    const sup = await freshSupplier(tenantA, "ผู้ขายสองสาขา");
    const p = await freshProduct(tenantA, "8-two-branches");
    const unit = p.productUnits[0].id;
    await gr({ supplierId: sup, branchId: branchA1, status: "CONFIRMED", receivedAt: at(-6), lines: [{ productId: p.id, unitId: unit, price: 30 }] });
    await gr({ supplierId: sup, branchId: branchA2, status: "CONFIRMED", receivedAt: at(-1), lines: [{ productId: p.id, unitId: unit, price: 35 }] });

    const atA1 = (await getSupplierCatalogLogic(tenantA, sup, branchA1))[0];
    expect(num(atA1.lastPaid!.unitPrice)).toBe(30);
    expect(atA1.lastPaid!.branchId).toBe(branchA1);

    // A branch that never took a delivery still sees the product, at the latest price anywhere.
    const fresh = await withRlsBypass((tx) =>
      tx.branch.create({ data: { tenantId: tenantA, name: "A3", code: "A3" } })
    );
    const atA3 = (await getSupplierCatalogLogic(tenantA, sup, fresh.id))[0];
    expect(num(atA3.lastPaid!.unitPrice)).toBe(35);
    expect(atA3.lastPaid!.branchName).toBe("A2");
  });

  it("C9: a price-list price and a delivery history for one product make ONE row, and the price list sets the price", async () => {
    const unit = prod.productUnits[0].id;
    await gr({ supplierId: supMain, branchId: branchA1, status: "CONFIRMED", receivedAt: at(-1), lines: [{ productId: prod.id, unitId: unit, price: 12 }] });
    const items = await getSupplierCatalogLogic(tenantA, supMain, branchA1);
    const rows = items.filter((i) => i.productId === prod.id);
    expect(rows).toHaveLength(1);
    expect(num(rows[0].price!.unitPrice)).toBe(90);
    expect(num(rows[0].lastPaid!.unitPrice)).toBe(12);
  });

  it("C6: every catalog price agrees with the order form's resolver, to the satang", async () => {
    for (const [sup, branch] of [
      [supMain, branchA1],
      [supMain, branchA2],
      [supAlt, branchA1],
      [supExpired, branchA2],
    ] as const) {
      const items = await getSupplierCatalogLogic(tenantA, sup, branch);
      for (const item of items) {
        const r = await resolveSupplierPriceLogic(tenantA, item.productId, sup, branch);
        expect(item.price?.mappingId ?? null).toBe(r?.mappingId ?? null);
        expect(num(item.price?.unitPrice ?? null)).toBe(num(r?.unitPrice ?? null));
      }
    }
  });
});
