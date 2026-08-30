// ============================================================
// Mise — Goods Receipt *Logic integration tests (Part 13 L3a/L3b; ADR 0013)
// ============================================================
// Exercises the draft → confirm → void lifecycle in src/server/goods-receipt.ts
// against the real Neon DB, through the real zod schemas.
//
// The invariants under test are the ones the Part exists to protect:
//   Q1 — a receipt may stand alone; a PO-based line inherits the PO's snapshot
//   Q2 — the ledger is written on confirm and ONLY on confirm; PO status derives
//   Q3 — an over-delivery is recorded in full, flagged, and needs a note
//   Q6 — a confirmed receipt is voided by compensating rows, never edited
//   Q8 — a short order closes by hand, with a reason
//   ADR 0012 Consequence 1 — conversion uses the PO line's FROZEN to_base_ratio
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { EVERY_BRANCH } from "./support/reach";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { withAdminContext, prisma } from "@/lib/db";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { supplierInputSchema } from "@/lib/validations/supplier";
import { createSupplierLogic } from "@/server/supplier";
import { purchaseOrderInputSchema } from "@/lib/validations/purchase-order";
import {
  closePurchaseOrderShortLogic,
  createPurchaseOrderLogic,
  getPurchaseOrderByIdLogic,
  PurchaseOrderTransitionError,
  sendPurchaseOrderLogic,
} from "@/server/purchase-order";
import {
  closePurchaseOrderShortInputSchema,
  goodsReceiptInputSchema,
  voidGoodsReceiptInputSchema,
} from "@/lib/validations/goods-receipt";
import {
  confirmGoodsReceiptLogic,
  createGoodsReceiptLogic,
  deleteGoodsReceiptDraftLogic,
  getGoodsReceiptByIdLogic,
  getGoodsReceiptsLogic,
  getReceivablePurchaseOrderLogic,
  GoodsReceiptNotEditableError,
  GoodsReceiptPoMismatchError,
  GoodsReceiptTransitionError,
  OverReceiptNoteRequiredError,
  prorateAllocations,
  PurchaseOrderNotReceivableError,
  ReceivedUnitMismatchError,
  updateGoodsReceiptLogic,
  voidGoodsReceiptLogic,
} from "@/server/goods-receipt";
import {
  getStockBalanceLogic,
  getStockMovementHistoryLogic,
} from "@/server/stock-movement";
import {
  getStockBalanceQuerySchema,
  getStockMovementHistoryQuerySchema,
} from "@/lib/validations/stock-movement";

const num = (d: Prisma.Decimal) => d.toNumber();

describe("goods-receipt *Logic (PO → รับของ → ledger)", () => {
  let tenantA: string;
  let tenantB: string;
  let branchA: string;
  let branchB: string;
  let deptA: string;
  let userA: string;
  let supA: string;
  let supB: string;

  /** A product with base unit `kg` plus a `กระสอบ` ×25 order unit. */
  const freshProduct = (tenant: string, tag: string): Promise<ProductWithUnits> =>
    createProductLogic(
      tenant,
      productInputSchema.parse({
        name: `GR-${tag}-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [{ unitName: "กระสอบ", toBaseRatio: 25 }],
        defaultBuyUnitName: "กระสอบ",
      })
    );

  const unitOf = (p: ProductWithUnits, name: string) =>
    p.productUnits.find((u) => u.unitName === name)!.id;

  /** A SENT order for `product`, `qty` sacks at `price` each. */
  const sentPo = async (
    product: ProductWithUnits,
    qty = 4,
    price = 250
  ): Promise<Awaited<ReturnType<typeof getPurchaseOrderByIdLogic>>> => {
    const po = await createPurchaseOrderLogic(
      tenantA,
      purchaseOrderInputSchema.parse({
        branchId: branchA,
        supplierId: supA,
        expectedDeliveryDate: "",
        vatRatePercent: 7,
        notes: null,
        lines: [
          {
            productId: product.id,
            orderUnitId: unitOf(product, "กระสอบ"),
            qtyOrdered: qty,
            unitPrice: price,
            supplierProductMappingId: null,
            notes: null,
          },
        ],
      }),
      userA
    );
    return sendPurchaseOrderLogic(tenantA, po.id, userA);
  };

  const receipt = (over: Record<string, unknown> = {}) =>
    goodsReceiptInputSchema.parse({
      submitKey: randomUUID(),
      branchId: branchA,
      supplierId: supA,
      purchaseOrderId: null,
      invoiceNo: null,
      receivedAt: new Date(),
      notes: null,
      lines: [],
      ...over,
    });

  const balanceOf = async (productId: string) =>
    num(
      (
        await getStockBalanceLogic(
          tenantA,
          getStockBalanceQuerySchema.parse({ productId, branchId: branchA })
        )
      ).balance
    );

  beforeAll(async () => {
    await withAdminContext(async (tx) => {
      const a = await tx.tenant.create({ data: { name: "GR Test Tenant A" } });
      const b = await tx.tenant.create({ data: { name: "GR Test Tenant B" } });
      tenantA = a.id;
      tenantB = b.id;

      const [b1, bb] = await Promise.all([
        tx.branch.create({ data: { tenantId: a.id, name: "ครัวกลาง", code: "KRUA" } }),
        tx.branch.create({ data: { tenantId: b.id, name: "B1", code: "MAIN" } }),
      ]);
      branchA = b1.id;
      branchB = bb.id;

      const [d1] = await Promise.all([
        tx.department.create({ data: { tenantId: a.id, name: "Main", code: "MAIN" } }),
        tx.department.create({ data: { tenantId: b.id, name: "Main", code: "MAIN" } }),
      ]);
      deptA = d1.id;

      const u = await tx.user.create({
        data: { email: `gr-test-${randomUUID()}@example.com`, name: "คนรับของ" },
      });
      userA = u.id;
    });

    supA = (
      await createSupplierLogic(
        tenantA,
        supplierInputSchema.parse({ nameFull: "ร้านวัตถุดิบ A" })
      )
    ).id;
    supB = (
      await createSupplierLogic(
        tenantB,
        supplierInputSchema.parse({ nameFull: "ร้านวัตถุดิบ B" })
      )
    ).id;
  });

  afterAll(async () => {
    const ids = [tenantA, tenantB];
    await withAdminContext(async (tx) => {
      await tx.stockMovement.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.goodsReceiptItemAllocation.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.goodsReceiptItem.deleteMany({ where: { tenantId: { in: ids } } });
      // Before the receipts themselves: confirming one writes an expense whose
      // FK is ON DELETE SET NULL, and `expense_source_gr_check` forbids a row
      // claiming FROM_GOODS_RECEIPT while pointing at nothing (ADR 0016 L1).
      await tx.expenseItem.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.expense.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.goodsReceipt.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.purchaseOrderItemAllocation.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.purchaseOrderItem.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.purchaseOrder.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.supplierProductMapping.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.supplier.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId: { in: ids } } } });
      await tx.product.deleteMany({ where: { tenantId: { in: ids } } });
      // The GR→expense hook creates COGS/Food/ไม่ระบุหมวด on demand for products
      // nobody categorised, so a suite that never made a category still has one.
      await tx.category.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.department.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.branch.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.tenant.deleteMany({ where: { id: { in: ids } } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
    await prisma.$disconnect();
  });

  // ----------------------------------------------------------
  // R1–R3 — reads
  // ----------------------------------------------------------

  it("R1: the receivable read hands the form the PO's FROZEN snapshot + outstanding", async () => {
    const p = await freshProduct(tenantA, "R1");
    const po = await sentPo(p, 4, 250);

    const view = await getReceivablePurchaseOrderLogic(tenantA, po!.id);
    expect(view).not.toBeNull();
    expect(view!.status).toBe("SENT");
    expect(view!.lines.length).toBe(1);

    const l = view!.lines[0];
    expect(l.orderUnitName).toBe("กระสอบ");
    expect(num(l.toBaseRatio)).toBe(25);
    expect(num(l.unitPrice)).toBe(250);
    expect(num(l.qtyOrdered)).toBe(4);
    expect(num(l.qtyReceived)).toBe(0);
    expect(num(l.qtyOutstanding)).toBe(4);
  });

  it("R2: an unknown or foreign order reads as not-found, not as a leak", async () => {
    expect(await getReceivablePurchaseOrderLogic(tenantA, randomUUID())).toBeNull();

    const p = await freshProduct(tenantA, "R2");
    const po = await sentPo(p);
    expect(await getReceivablePurchaseOrderLogic(tenantB, po!.id)).toBeNull();
  });

  it("R3: pro-rating hands out every thousandth (H.3 largest-remainder)", () => {
    // 1 unit across three equal departments: 333 + 333 + 334 thousandths.
    const allocs = [
      { id: "a", departmentId: "d1", qtyAllocated: new Prisma.Decimal(1) },
      { id: "b", departmentId: "d2", qtyAllocated: new Prisma.Decimal(1) },
      { id: "c", departmentId: "d3", qtyAllocated: new Prisma.Decimal(1) },
    ];
    const out = prorateAllocations(
      allocs,
      new Prisma.Decimal(3),
      new Prisma.Decimal(1)
    );
    const total = out.reduce((s, o) => s.plus(o.qty), new Prisma.Decimal(0));
    expect(num(total)).toBe(1);
    expect(out.map((o) => num(o.qty)).sort()).toEqual([0.333, 0.333, 0.334]);
  });

  // ----------------------------------------------------------
  // C1–C5 — create
  // ----------------------------------------------------------

  it("C1: a PO-based draft copies the order's snapshot and posts NOTHING", async () => {
    const p = await freshProduct(tenantA, "C1");
    const po = await sentPo(p, 4, 250);

    const gr = await createGoodsReceiptLogic(
      tenantA,
      receipt({
        purchaseOrderId: po!.id,
        invoiceNo: "INV-C1",
        lines: [
          {
            purchaseOrderItemId: po!.items[0].id,
            productId: p.id,
            receivedUnitId: unitOf(p, "กระสอบ"),
            qtyReceivedActual: 4,
            unitPriceActual: 250,
            notes: null,
          },
        ],
      }),
      userA
    );

    expect(gr.status).toBe("DRAFT");
    expect(gr.grNumber).toMatch(/^KRUA-GR-\d{4}$/);
    expect(gr.items.length).toBe(1);
    expect(gr.items[0].receivedUnitName).toBe("กระสอบ");
    expect(num(gr.items[0].toBaseRatio)).toBe(25);
    expect(num(gr.items[0].lineTotalActual)).toBe(1000);
    // One "Main" allocation, carrying its PO provenance.
    expect(gr.items[0].allocations.length).toBe(1);
    expect(gr.items[0].allocations[0].departmentId).toBe(deptA);
    expect(num(gr.items[0].allocations[0].qtyAllocatedActual)).toBe(4);
    expect(gr.items[0].allocations[0].sourcePoAllocationId).not.toBeNull();

    // A DRAFT posts nothing (Q2).
    expect(await balanceOf(p.id)).toBe(0);
    const poAfter = await getPurchaseOrderByIdLogic(tenantA, po!.id);
    expect(poAfter!.status).toBe("SENT");
    expect(num(poAfter!.items[0].qtyReceived)).toBe(0);
  });

  it("C2: the submitKey makes create idempotent — a double POST is one receipt", async () => {
    const p = await freshProduct(tenantA, "C2");
    const po = await sentPo(p);
    const key = randomUUID();

    const body = receipt({
      submitKey: key,
      purchaseOrderId: po!.id,
      lines: [
        {
          purchaseOrderItemId: po!.items[0].id,
          productId: p.id,
          receivedUnitId: unitOf(p, "กระสอบ"),
          qtyReceivedActual: 4,
          unitPriceActual: 250,
          notes: null,
        },
      ],
    });

    const first = await createGoodsReceiptLogic(tenantA, body, userA);
    const second = await createGoodsReceiptLogic(tenantA, body, userA);

    expect(second.id).toBe(first.id);
    expect(second.grNumber).toBe(first.grNumber);
    const count = await withAdminContext((tx) =>
      tx.goodsReceipt.count({ where: { tenantId: tenantA, purchaseOrderId: po!.id } })
    );
    expect(count).toBe(1);
  });

  it("C3: a standalone receipt needs no order and snapshots the live unit (Q1)", async () => {
    const p = await freshProduct(tenantA, "C3");

    const gr = await createGoodsReceiptLogic(
      tenantA,
      receipt({
        purchaseOrderId: null,
        lines: [
          {
            purchaseOrderItemId: null,
            productId: p.id,
            receivedUnitId: unitOf(p, "kg"),
            qtyReceivedActual: 3,
            unitPriceActual: 12,
            notes: null,
          },
        ],
      }),
      userA
    );

    expect(gr.purchaseOrderId).toBeNull();
    expect(gr.items[0].receivedUnitName).toBe("kg");
    expect(num(gr.items[0].toBaseRatio)).toBe(1);
    expect(num(gr.items[0].lineTotalActual)).toBe(36);
    expect(gr.items[0].allocations[0].sourcePoAllocationId).toBeNull();
  });

  it("C4: over-receipt is accepted but demands a note (Q3)", async () => {
    const p = await freshProduct(tenantA, "C4");
    const po = await sentPo(p, 4, 250);

    const overLine = (notes: string | null) => ({
      purchaseOrderItemId: po!.items[0].id,
      productId: p.id,
      receivedUnitId: unitOf(p, "กระสอบ"),
      qtyReceivedActual: 6, // 2 more than ordered
      unitPriceActual: 250,
      notes,
    });

    await expect(
      createGoodsReceiptLogic(
        tenantA,
        receipt({ purchaseOrderId: po!.id, lines: [overLine(null)] }),
        userA
      )
    ).rejects.toThrow(OverReceiptNoteRequiredError);

    const gr = await createGoodsReceiptLogic(
      tenantA,
      receipt({
        purchaseOrderId: po!.id,
        lines: [overLine("ซัพส่งเกินมา 2 กระสอบ")],
      }),
      userA
    );
    expect(num(gr.items[0].qtyReceivedActual)).toBe(6);
  });

  it("C5: a receipt cannot borrow another order's line, unit or header", async () => {
    const p = await freshProduct(tenantA, "C5a");
    const other = await freshProduct(tenantA, "C5b");
    const po = await sentPo(p);
    const poOther = await sentPo(other);

    const base = {
      purchaseOrderItemId: po!.items[0].id,
      productId: p.id,
      receivedUnitId: unitOf(p, "กระสอบ"),
      qtyReceivedActual: 1,
      unitPriceActual: 250,
      notes: null,
    };

    // A line from a different order.
    await expect(
      createGoodsReceiptLogic(
        tenantA,
        receipt({
          purchaseOrderId: po!.id,
          lines: [{ ...base, purchaseOrderItemId: poOther!.items[0].id }],
        }),
        userA
      )
    ).rejects.toThrow(GoodsReceiptPoMismatchError);

    // A unit the order was not placed in — that would convert at a ratio the
    // order never agreed to (ADR 0012 Q3).
    await expect(
      createGoodsReceiptLogic(
        tenantA,
        receipt({
          purchaseOrderId: po!.id,
          lines: [{ ...base, receivedUnitId: unitOf(p, "kg") }],
        }),
        userA
      )
    ).rejects.toThrow(GoodsReceiptPoMismatchError);

    // A header supplier that is not the order's.
    await expect(
      createGoodsReceiptLogic(
        tenantA,
        receipt({ purchaseOrderId: po!.id, supplierId: supB, lines: [base] }),
        userA
      )
    ).rejects.toThrow();

    // A standalone line whose unit belongs to a different product.
    await expect(
      createGoodsReceiptLogic(
        tenantA,
        receipt({
          lines: [
            {
              purchaseOrderItemId: null,
              productId: p.id,
              receivedUnitId: unitOf(other, "kg"),
              qtyReceivedActual: 1,
              unitPriceActual: 1,
              notes: null,
            },
          ],
        }),
        userA
      )
    ).rejects.toThrow(ReceivedUnitMismatchError);
  });

  it("C6: a DRAFT order cannot be received against", async () => {
    const p = await freshProduct(tenantA, "C6");
    const draftPo = await createPurchaseOrderLogic(
      tenantA,
      purchaseOrderInputSchema.parse({
        branchId: branchA,
        supplierId: supA,
        expectedDeliveryDate: "",
        vatRatePercent: 7,
        notes: null,
        lines: [
          {
            productId: p.id,
            orderUnitId: unitOf(p, "กระสอบ"),
            qtyOrdered: 1,
            unitPrice: 10,
            supplierProductMappingId: null,
            notes: null,
          },
        ],
      }),
      userA
    );

    await expect(
      createGoodsReceiptLogic(
        tenantA,
        receipt({
          purchaseOrderId: draftPo.id,
          lines: [
            {
              purchaseOrderItemId: draftPo.items[0].id,
              productId: p.id,
              receivedUnitId: unitOf(p, "กระสอบ"),
              qtyReceivedActual: 1,
              unitPriceActual: 10,
              notes: null,
            },
          ],
        }),
        userA
      )
    ).rejects.toThrow(PurchaseOrderNotReceivableError);
  });

  // ----------------------------------------------------------
  // F1–F5 — confirm
  // ----------------------------------------------------------

  it("F1: confirm posts the ledger, fills the PO line, and closes the order", async () => {
    const p = await freshProduct(tenantA, "F1");
    const po = await sentPo(p, 4, 250);

    const gr = await createGoodsReceiptLogic(
      tenantA,
      receipt({
        purchaseOrderId: po!.id,
        lines: [
          {
            purchaseOrderItemId: po!.items[0].id,
            productId: p.id,
            receivedUnitId: unitOf(p, "กระสอบ"),
            qtyReceivedActual: 4,
            unitPriceActual: 250,
            notes: null,
          },
        ],
      }),
      userA
    );

    const { receipt: confirmed, postBalances } = await confirmGoodsReceiptLogic(
      tenantA,
      gr.id,
      userA
    );

    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.confirmedAt).not.toBeNull();
    expect(confirmed.hasDiscrepancy).toBe(false);

    // 4 กระสอบ × 25 kg = 100 kg in the base unit.
    expect(await balanceOf(p.id)).toBe(100);
    expect(num(postBalances[0].balance)).toBe(100);

    const movements = await withAdminContext((tx) =>
      tx.stockMovement.findMany({
        where: { tenantId: tenantA, productId: p.id },
      })
    );
    expect(movements.length).toBe(1);
    expect(movements[0].type).toBe("PO_RECEIVE");
    expect(movements[0].sourceType).toBe("GR_LINE");
    expect(movements[0].sourceId).toBe(confirmed.items[0].id);
    expect(movements[0].occurredAt.getTime()).toBe(confirmed.receivedAt.getTime());

    const poAfter = await getPurchaseOrderByIdLogic(tenantA, po!.id);
    expect(num(poAfter!.items[0].qtyReceived)).toBe(4);
    expect(poAfter!.status).toBe("RECEIVED");
  });

  it("F2: conversion uses the PO line's FROZEN ratio, not the live ProductUnit", async () => {
    // The bug ADR 0012 Q3 exists to prevent: order 4 sacks × 25 kg, someone
    // "corrects" the sack to 30 before the goods arrive, and the receipt lands
    // 120 kg against an order that meant 100.
    const p = await freshProduct(tenantA, "F2");
    const po = await sentPo(p, 4, 250);

    await withAdminContext((tx) =>
      tx.productUnit.update({
        where: { id: unitOf(p, "กระสอบ") },
        data: { toBaseRatio: new Prisma.Decimal(30) },
      })
    );

    const gr = await createGoodsReceiptLogic(
      tenantA,
      receipt({
        purchaseOrderId: po!.id,
        lines: [
          {
            purchaseOrderItemId: po!.items[0].id,
            productId: p.id,
            receivedUnitId: unitOf(p, "กระสอบ"),
            qtyReceivedActual: 4,
            unitPriceActual: 250,
            notes: null,
          },
        ],
      }),
      userA
    );
    await confirmGoodsReceiptLogic(tenantA, gr.id, userA);

    expect(await balanceOf(p.id)).toBe(100); // NOT 120
  });

  it("F3: two partial receipts walk the order SENT → PARTIALLY_RECEIVED → RECEIVED", async () => {
    const p = await freshProduct(tenantA, "F3");
    const po = await sentPo(p, 4, 250);

    const receiveSacks = async (qty: number) => {
      const gr = await createGoodsReceiptLogic(
        tenantA,
        receipt({
          purchaseOrderId: po!.id,
          lines: [
            {
              purchaseOrderItemId: po!.items[0].id,
              productId: p.id,
              receivedUnitId: unitOf(p, "กระสอบ"),
              qtyReceivedActual: qty,
              unitPriceActual: 250,
              notes: null,
            },
          ],
        }),
        userA
      );
      return confirmGoodsReceiptLogic(tenantA, gr.id, userA);
    };

    await receiveSacks(1);
    let poAfter = await getPurchaseOrderByIdLogic(tenantA, po!.id);
    expect(poAfter!.status).toBe("PARTIALLY_RECEIVED");
    expect(num(poAfter!.items[0].qtyReceived)).toBe(1);
    // The first receipt is short of the outstanding 4 → flagged for review (Q3).
    expect(await balanceOf(p.id)).toBe(25);

    await receiveSacks(3);
    poAfter = await getPurchaseOrderByIdLogic(tenantA, po!.id);
    expect(poAfter!.status).toBe("RECEIVED");
    expect(num(poAfter!.items[0].qtyReceived)).toBe(4);
    expect(await balanceOf(p.id)).toBe(100);
  });

  it("F4: a price that differs from the order flags the receipt (Q7)", async () => {
    const p = await freshProduct(tenantA, "F4");
    const po = await sentPo(p, 2, 250);

    const gr = await createGoodsReceiptLogic(
      tenantA,
      receipt({
        purchaseOrderId: po!.id,
        lines: [
          {
            purchaseOrderItemId: po!.items[0].id,
            productId: p.id,
            receivedUnitId: unitOf(p, "กระสอบ"),
            qtyReceivedActual: 2,
            unitPriceActual: 275, // the invoice says otherwise
            notes: null,
          },
        ],
      }),
      userA
    );
    const { receipt: confirmed } = await confirmGoodsReceiptLogic(tenantA, gr.id, userA);

    expect(confirmed.hasDiscrepancy).toBe(true);
    expect(num(confirmed.items[0].unitPriceActual)).toBe(275);
    expect(num(confirmed.items[0].lineTotalActual)).toBe(550);
  });

  it("F5: a confirmed receipt refuses a second confirm and every edit", async () => {
    const p = await freshProduct(tenantA, "F5");
    const gr = await createGoodsReceiptLogic(
      tenantA,
      receipt({
        lines: [
          {
            purchaseOrderItemId: null,
            productId: p.id,
            receivedUnitId: unitOf(p, "kg"),
            qtyReceivedActual: 5,
            unitPriceActual: 10,
            notes: null,
          },
        ],
      }),
      userA
    );
    await confirmGoodsReceiptLogic(tenantA, gr.id, userA);

    await expect(confirmGoodsReceiptLogic(tenantA, gr.id, userA)).rejects.toThrow(
      GoodsReceiptTransitionError
    );
    await expect(deleteGoodsReceiptDraftLogic(tenantA, gr.id)).rejects.toThrow(
      GoodsReceiptNotEditableError
    );
    await expect(
      updateGoodsReceiptLogic(
        tenantA,
        gr.id,
        receipt({
          lines: [
            {
              purchaseOrderItemId: null,
              productId: p.id,
              receivedUnitId: unitOf(p, "kg"),
              qtyReceivedActual: 99,
              unitPriceActual: 10,
              notes: null,
            },
          ],
        })
      )
    ).rejects.toThrow(GoodsReceiptNotEditableError);

    // The ledger still says 5 — nothing above got through.
    expect(await balanceOf(p.id)).toBe(5);
  });

  // ----------------------------------------------------------
  // V1–V2 — void
  // ----------------------------------------------------------

  it("V1: voiding nets the ledger back with compensating rows, touching nothing", async () => {
    const p = await freshProduct(tenantA, "V1");
    const po = await sentPo(p, 4, 250);

    const gr = await createGoodsReceiptLogic(
      tenantA,
      receipt({
        purchaseOrderId: po!.id,
        lines: [
          {
            purchaseOrderItemId: po!.items[0].id,
            productId: p.id,
            receivedUnitId: unitOf(p, "กระสอบ"),
            qtyReceivedActual: 4,
            unitPriceActual: 250,
            notes: null,
          },
        ],
      }),
      userA
    );
    const { receipt: confirmed } = await confirmGoodsReceiptLogic(tenantA, gr.id, userA);
    const originalMovementId = (
      await withAdminContext((tx) =>
        tx.stockMovement.findFirst({
          where: { sourceType: "GR_LINE", sourceId: confirmed.items[0].id },
        })
      )
    )!.id;

    const { receipt: voided } = await voidGoodsReceiptLogic(
      tenantA,
      voidGoodsReceiptInputSchema.parse({
        id: gr.id,
        voidReason: "ของไม่ตรงสเปก ส่งคืนทั้งหมด",
      }),
      userA
    );

    expect(voided.status).toBe("VOIDED");
    expect(voided.voidReason).toContain("ส่งคืน");
    // The reversal line lives in the SAME document, negative, pointing back.
    expect(voided.items.length).toBe(2);
    const rev = voided.items.find((i) => i.reversalOfItemId !== null)!;
    expect(rev.reversalOfItemId).toBe(confirmed.items[0].id);
    expect(num(rev.qtyReceivedActual)).toBe(-4);
    expect(num(rev.lineTotalActual)).toBe(-1000);
    expect(num(rev.allocations[0].qtyAllocatedActual)).toBe(-4);

    // Balance nets to zero, and the original ledger row is untouched.
    expect(await balanceOf(p.id)).toBe(0);
    const movements = await withAdminContext((tx) =>
      tx.stockMovement.findMany({
        where: { tenantId: tenantA, productId: p.id },
        orderBy: { createdAt: "asc" },
      })
    );
    expect(movements.length).toBe(2);
    expect(movements[0].id).toBe(originalMovementId);
    expect(num(movements[0].qty)).toBe(100);
    expect(movements[1].type).toBe("PO_RECEIVE_REVERSAL");
    expect(num(movements[1].qty)).toBe(-100);

    // The order is owed its goods again.
    const poAfter = await getPurchaseOrderByIdLogic(tenantA, po!.id);
    expect(num(poAfter!.items[0].qtyReceived)).toBe(0);
    expect(poAfter!.status).toBe("SENT");
  });

  it("V2: only a CONFIRMED receipt can be voided", async () => {
    const p = await freshProduct(tenantA, "V2");
    const gr = await createGoodsReceiptLogic(
      tenantA,
      receipt({
        lines: [
          {
            purchaseOrderItemId: null,
            productId: p.id,
            receivedUnitId: unitOf(p, "kg"),
            qtyReceivedActual: 2,
            unitPriceActual: 5,
            notes: null,
          },
        ],
      }),
      userA
    );

    const input = voidGoodsReceiptInputSchema.parse({
      id: gr.id,
      voidReason: "กดผิด",
    });
    await expect(voidGoodsReceiptLogic(tenantA, input, userA)).rejects.toThrow(
      GoodsReceiptTransitionError
    );

    await confirmGoodsReceiptLogic(tenantA, gr.id, userA);
    await voidGoodsReceiptLogic(tenantA, input, userA);
    // A second void has nothing left to reverse.
    await expect(voidGoodsReceiptLogic(tenantA, input, userA)).rejects.toThrow(
      GoodsReceiptTransitionError
    );
    expect(await balanceOf(p.id)).toBe(0);
  });

  // ----------------------------------------------------------
  // D1, S1, H1 — draft edits, short-close, history
  // ----------------------------------------------------------

  it("D1: a draft's lines are replaced wholesale, and a discard hides it", async () => {
    const p = await freshProduct(tenantA, "D1");
    const gr = await createGoodsReceiptLogic(
      tenantA,
      receipt({
        lines: [
          {
            purchaseOrderItemId: null,
            productId: p.id,
            receivedUnitId: unitOf(p, "kg"),
            qtyReceivedActual: 1,
            unitPriceActual: 10,
            notes: null,
          },
        ],
      }),
      userA
    );

    const updated = await updateGoodsReceiptLogic(
      tenantA,
      gr.id,
      receipt({
        submitKey: gr.id,
        invoiceNo: "INV-D1",
        lines: [
          {
            purchaseOrderItemId: null,
            productId: p.id,
            receivedUnitId: unitOf(p, "kg"),
            qtyReceivedActual: 7,
            unitPriceActual: 11,
            notes: null,
          },
        ],
      })
    );
    expect(updated.grNumber).toBe(gr.grNumber);
    expect(updated.items.length).toBe(1);
    expect(num(updated.items[0].qtyReceivedActual)).toBe(7);
    expect(updated.invoiceNo).toBe("INV-D1");

    await deleteGoodsReceiptDraftLogic(tenantA, gr.id);
    expect(await getGoodsReceiptByIdLogic(tenantA, gr.id)).toBeNull();
    const list = await getGoodsReceiptsLogic(tenantA, {});
    expect(list.some((r) => r.id === gr.id)).toBe(false);
  });

  it("S1: a short-delivered order closes by hand, with a reason (Q8)", async () => {
    const p = await freshProduct(tenantA, "S1");
    const po = await sentPo(p, 4, 250);

    // A SENT order with nothing received is cancelled, not closed.
    const input = closePurchaseOrderShortInputSchema.parse({
      id: po!.id,
      closedShortReason: "ซัพแจ้งของหมด ไม่ส่งส่วนที่เหลือ",
    });
    await expect(
      closePurchaseOrderShortLogic(tenantA, input, userA)
    ).rejects.toThrow(PurchaseOrderTransitionError);

    const gr = await createGoodsReceiptLogic(
      tenantA,
      receipt({
        purchaseOrderId: po!.id,
        lines: [
          {
            purchaseOrderItemId: po!.items[0].id,
            productId: p.id,
            receivedUnitId: unitOf(p, "กระสอบ"),
            qtyReceivedActual: 3,
            unitPriceActual: 250,
            notes: null,
          },
        ],
      }),
      userA
    );
    await confirmGoodsReceiptLogic(tenantA, gr.id, userA);

    const closed = await closePurchaseOrderShortLogic(tenantA, input, userA);
    expect(closed.status).toBe("RECEIVED");
    expect(closed.closedShortAt).not.toBeNull();
    expect(closed.closedShortBy).toBe(userA);
    expect(closed.closedShortReason).toContain("ของหมด");
    // Still short — the quantities are honest, the status is a decision.
    expect(num(closed.items[0].qtyReceived)).toBe(3);

    // Voiding the receipt un-makes the decision it was based on.
    await voidGoodsReceiptLogic(
      tenantA,
      voidGoodsReceiptInputSchema.parse({ id: gr.id, voidReason: "รับผิดใบ" }),
      userA
    );
    const reopened = await getPurchaseOrderByIdLogic(tenantA, po!.id);
    expect(reopened!.status).toBe("SENT");
    expect(reopened!.closedShortAt).toBeNull();
  });

  it("H1: the ledger feed resolves a GR_LINE row back to its document", async () => {
    const p = await freshProduct(tenantA, "H1");
    const po = await sentPo(p, 2, 100);

    const gr = await createGoodsReceiptLogic(
      tenantA,
      receipt({
        purchaseOrderId: po!.id,
        invoiceNo: "INV-H1",
        lines: [
          {
            purchaseOrderItemId: po!.items[0].id,
            productId: p.id,
            receivedUnitId: unitOf(p, "กระสอบ"),
            qtyReceivedActual: 2,
            unitPriceActual: 100,
            notes: null,
          },
        ],
      }),
      userA
    );
    await confirmGoodsReceiptLogic(tenantA, gr.id, userA);

    const feed = await getStockMovementHistoryLogic(
      tenantA,
      getStockMovementHistoryQuerySchema.parse({
        productId: p.id,
        sourceType: "GR_LINE",
      })
    , EVERY_BRANCH);
    expect(feed.rows.length).toBe(1);
    const src = feed.rows[0].goodsReceipt!;
    expect(src).not.toBeNull();
    expect(src.grNumber).toBe(gr.grNumber);
    expect(src.invoiceNo).toBe("INV-H1");
    expect(src.poNumber).toBe(po!.poNumber);
    expect(src.receivedUnitName).toBe("กระสอบ");
    expect(num(src.qtyReceivedActual)).toBe(2);
    expect(src.isReversal).toBe(false);
    expect(feed.rows[0].adjustment).toBeNull();
  });

  // Part 13.5 (Pitfall #25) — the third generator on the same lock. C2 covers
  // the SAME key twice (one document); this covers DIFFERENT keys at the same
  // instant, which is what raced the {CODE}-GR-#### counter.
  it("C12: concurrent receipts on one branch get distinct consecutive gr_numbers", async () => {
    const p = await freshProduct(tenantA, "C12");
    const N = 3;

    const receipts = await Promise.all(
      Array.from({ length: N }, () =>
        createGoodsReceiptLogic(
          tenantA,
          receipt({
            purchaseOrderId: null,
            lines: [
              {
                purchaseOrderItemId: null,
                productId: p.id,
                receivedUnitId: unitOf(p, "kg"),
                qtyReceivedActual: 1,
                unitPriceActual: 10,
                notes: null,
              },
            ],
          }),
          userA
        )
      )
    );

    const seq = receipts
      .map((gr) => {
        const m = /-GR-(\d{4})$/.exec(gr.grNumber);
        expect(m, gr.grNumber).not.toBeNull();
        return parseInt(m![1], 10);
      })
      .sort((a, b) => a - b);

    expect(new Set(seq).size).toBe(N);
    expect(seq[N - 1] - seq[0]).toBe(N - 1);
  });
});
