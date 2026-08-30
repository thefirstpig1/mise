// ============================================================
// Mise — Purchase Order WRITE *Logic integration tests (Part 11 L3b)
// ============================================================
// Exercises the create → send → cancel lifecycle in src/server/purchase-order.ts
// against the real Neon DB, through the real zod schemas.
//
// The invariants under test are the ones ADR 0012 exists to protect:
//   Q3 — the line freezes unit name + ratio + price, and a later edit to the
//        ProductUnit cannot reach back and change what the order meant
//   Q4 — a DRAFT is the only writable thing; SENT refuses every edit path
//   Q2 — allocations sum to their line (the invariant H.2's trigger would hold)
//   Q8 — {BRANCH_CODE}-PO-#### runs per branch
//   Q9 — a DRAFT can be discarded; a sent order can only be cancelled
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withRlsBypass } from "@/lib/db-admin";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { supplierInputSchema } from "@/lib/validations/supplier";
import { createSupplierLogic } from "@/server/supplier";
import {
  cancelPurchaseOrderInputSchema,
  purchaseOrderInputSchema,
} from "@/lib/validations/purchase-order";
import {
  AllocationSumMismatchError,
  cancelPurchaseOrderLogic,
  createPurchaseOrderLogic,
  deletePurchaseOrderDraftLogic,
  getPurchaseOrderByIdLogic,
  MappingProvenanceMismatchError,
  OrderUnitMismatchError,
  PurchaseOrderNotEditableError,
  PurchaseOrderNotFoundError,
  PurchaseOrderTransitionError,
  sendPurchaseOrderLogic,
  updatePurchaseOrderLogic,
} from "@/server/purchase-order";
import { CrossTenantReferenceError } from "@/server/product";

const num = (d: Prisma.Decimal) => d.toNumber();

describe("purchase-order write *Logic (lifecycle + snapshot invariants)", () => {
  let tenantA: string;
  let tenantB: string;
  let branchA: string;
  let branchA2: string;
  let branchB: string;
  let deptA: string;
  let deptA2: string;
  let deptB: string;
  let userA: string;

  let supA: string;
  let supB: string;
  let prod: ProductWithUnits;
  let prodOther: ProductWithUnits;
  let prodB: ProductWithUnits;

  /** A product with a base unit `kg` plus a `กระสอบ` ×25 order unit. */
  const freshProduct = async (tenant: string, tag: string) => {
    const p = await createProductLogic(
      tenant,
      productInputSchema.parse({
        name: `POW-${tag}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [{ unitName: "กระสอบ", toBaseRatio: 25 }],
        defaultBuyUnitName: "กระสอบ",
      })
    );
    return p;
  };

  const unitOf = (p: ProductWithUnits, name: string) =>
    p.productUnits.find((u) => u.unitName === name)!.id;

  const draft = (over: Record<string, unknown> = {}) =>
    purchaseOrderInputSchema.parse({
      branchId: branchA,
      supplierId: supA,
      expectedDeliveryDate: "",
      vatRatePercent: 7,
      notes: null,
      lines: [
        {
          productId: prod.id,
          orderUnitId: unitOf(prod, "กระสอบ"),
          qtyOrdered: 4,
          unitPrice: 250,
          supplierProductMappingId: null,
          notes: null,
        },
      ],
      ...over,
    });

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const a = await tx.tenant.create({ data: { name: "POW Test Tenant A" } });
      const b = await tx.tenant.create({ data: { name: "POW Test Tenant B" } });
      tenantA = a.id;
      tenantB = b.id;

      const [b1, b2, bb] = await Promise.all([
        tx.branch.create({ data: { tenantId: a.id, name: "ครัวกลาง", code: "KRUA" } }),
        tx.branch.create({ data: { tenantId: a.id, name: "สาขาสอง", code: "TWO" } }),
        tx.branch.create({ data: { tenantId: b.id, name: "B1", code: "MAIN" } }),
      ]);
      branchA = b1.id;
      branchA2 = b2.id;
      branchB = bb.id;

      const [d1, d2, db] = await Promise.all([
        tx.department.create({ data: { tenantId: a.id, name: "Main", code: "MAIN" } }),
        tx.department.create({ data: { tenantId: a.id, name: "บาร์", code: "BAR" } }),
        tx.department.create({ data: { tenantId: b.id, name: "Main", code: "MAIN" } }),
      ]);
      deptA = d1.id;
      deptA2 = d2.id;
      deptB = db.id;

      const u = await tx.user.create({
        data: { email: `pow-test-${randomUUID()}@example.com`, name: "ผู้สั่งซื้อ" },
      });
      userA = u.id;
    });

    prod = await freshProduct(tenantA, "1");
    prodOther = await freshProduct(tenantA, "2");
    prodB = await freshProduct(tenantB, "B");

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
    await withRlsBypass(async (tx) => {
      await tx.purchaseOrderItemAllocation.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.purchaseOrderItem.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.purchaseOrder.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.supplierProductMapping.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.supplier.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId: { in: ids } } } });
      await tx.product.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.department.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.branch.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.tenant.deleteMany({ where: { id: { in: ids } } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
    await prisma.$disconnect();
  });

  // ----------------------------------------------------------
  // W1–W5 — create
  // ----------------------------------------------------------

  it("W1: creates a DRAFT with a per-branch number, snapshot and totals", async () => {
    const po = await createPurchaseOrderLogic(tenantA, draft(), userA);

    expect(po.status).toBe("DRAFT");
    expect(po.poNumber).toBe("KRUA-PO-0001");
    expect(po.sentAt).toBeNull();

    // Q3 snapshot: the unit's name and ratio are copied onto the line
    expect(po.items).toHaveLength(1);
    expect(po.items[0].orderUnitName).toBe("กระสอบ");
    expect(num(po.items[0].toBaseRatio)).toBe(25);
    expect(num(po.items[0].qtyOrdered)).toBe(4);
    expect(num(po.items[0].unitPrice)).toBe(250);
    expect(num(po.items[0].lineTotal)).toBe(1000);

    // Q6 money: subtotal → VAT rounded once → total
    expect(num(po.subtotalExclVat)).toBe(1000);
    expect(num(po.vatAmount)).toBe(70);
    expect(num(po.totalAmount)).toBe(1070);
  });

  it("W2: the number runs per branch, not per tenant (Q8)", async () => {
    const second = await createPurchaseOrderLogic(tenantA, draft(), userA);
    expect(second.poNumber).toBe("KRUA-PO-0002");

    const otherBranch = await createPurchaseOrderLogic(
      tenantA,
      draft({ branchId: branchA2 }),
      userA
    );
    expect(otherBranch.poNumber).toBe("TWO-PO-0001");
  });

  it("W3: with no split supplied, the whole line falls to the default department (Q2)", async () => {
    const po = await createPurchaseOrderLogic(tenantA, draft(), userA);
    const allocs = po.items[0].allocations;
    expect(allocs).toHaveLength(1);
    expect(allocs[0].departmentId).toBe(deptA); // code MAIN wins
    expect(num(allocs[0].qtyAllocated)).toBe(num(po.items[0].qtyOrdered));
  });

  it("W4: an explicit split is stored per department and must sum to the line", async () => {
    const po = await createPurchaseOrderLogic(
      tenantA,
      draft({
        lines: [
          {
            productId: prod.id,
            orderUnitId: unitOf(prod, "กระสอบ"),
            qtyOrdered: 10,
            unitPrice: 100,
            supplierProductMappingId: null,
            notes: null,
            allocations: [
              { departmentId: deptA, qtyAllocated: 7 },
              { departmentId: deptA2, qtyAllocated: 3 },
            ],
          },
        ],
      }),
      userA
    );
    const byDept = Object.fromEntries(
      po.items[0].allocations.map((a) => [a.departmentId, num(a.qtyAllocated)])
    );
    expect(byDept[deptA]).toBe(7);
    expect(byDept[deptA2]).toBe(3);
  });

  it("W5: blank VAT means no VAT — total equals subtotal (Q6)", async () => {
    const po = await createPurchaseOrderLogic(
      tenantA,
      draft({ vatRatePercent: "" }),
      userA
    );
    expect(po.vatRatePercent).toBeNull();
    expect(num(po.vatAmount)).toBe(0);
    expect(num(po.totalAmount)).toBe(num(po.subtotalExclVat));
  });

  // ----------------------------------------------------------
  // W6–W9 — write-path guards
  // ----------------------------------------------------------

  it("W6: refuses a unit that belongs to another product", async () => {
    await expect(
      createPurchaseOrderLogic(
        tenantA,
        draft({
          lines: [
            {
              productId: prod.id,
              orderUnitId: unitOf(prodOther, "กระสอบ"),
              qtyOrdered: 1,
              unitPrice: 10,
              supplierProductMappingId: null,
              notes: null,
            },
          ],
        }),
        userA
      )
    ).rejects.toBeInstanceOf(OrderUnitMismatchError);
  });

  it("W7: refuses cross-tenant refs — supplier, branch, product, department", async () => {
    await expect(
      createPurchaseOrderLogic(tenantA, draft({ supplierId: supB }), userA)
    ).rejects.toBeInstanceOf(CrossTenantReferenceError);

    await expect(
      createPurchaseOrderLogic(tenantA, draft({ branchId: branchB }), userA)
    ).rejects.toBeInstanceOf(CrossTenantReferenceError);

    await expect(
      createPurchaseOrderLogic(
        tenantA,
        draft({
          lines: [
            {
              productId: prodB.id,
              orderUnitId: unitOf(prodB, "กระสอบ"),
              qtyOrdered: 1,
              unitPrice: 10,
              supplierProductMappingId: null,
              notes: null,
            },
          ],
        }),
        userA
      )
    ).rejects.toBeInstanceOf(CrossTenantReferenceError);

    await expect(
      createPurchaseOrderLogic(
        tenantA,
        draft({
          lines: [
            {
              productId: prod.id,
              orderUnitId: unitOf(prod, "กระสอบ"),
              qtyOrdered: 5,
              unitPrice: 10,
              supplierProductMappingId: null,
              notes: null,
              allocations: [{ departmentId: deptB, qtyAllocated: 5 }],
            },
          ],
        }),
        userA
      )
    ).rejects.toBeInstanceOf(CrossTenantReferenceError);
  });

  it("W8: refuses provenance pointing at another product's or supplier's price", async () => {
    const foreign = await withRlsBypass((tx) =>
      tx.supplierProductMapping.create({
        data: {
          tenantId: tenantA,
          supplierId: supA,
          productId: prodOther.id, // NOT the product on the line
          branchId: null,
          orderUnitId: unitOf(prodOther, "กระสอบ"),
          currentUnitPrice: new Prisma.Decimal(1),
          effectiveFrom: new Date(),
        },
      })
    );

    await expect(
      createPurchaseOrderLogic(
        tenantA,
        draft({
          lines: [
            {
              productId: prod.id,
              orderUnitId: unitOf(prod, "กระสอบ"),
              qtyOrdered: 1,
              unitPrice: 10,
              supplierProductMappingId: foreign.id,
              notes: null,
            },
          ],
        }),
        userA
      )
    ).rejects.toBeInstanceOf(MappingProvenanceMismatchError);
  });

  it("W9: the allocation sum rule holds at the write layer, not just in zod", async () => {
    // Bypass zod's superRefine by handing *Logic a hand-built input — this is the
    // path a future importer or Part 13 would take.
    const parsed = draft();
    const bad = {
      ...parsed,
      lines: [
        {
          ...parsed.lines[0],
          qtyOrdered: 10,
          allocations: [{ departmentId: deptA, qtyAllocated: 9 }],
        },
      ],
    };
    await expect(
      createPurchaseOrderLogic(tenantA, bad, userA)
    ).rejects.toBeInstanceOf(AllocationSumMismatchError);
  });

  // ----------------------------------------------------------
  // W10–W12 — update (DRAFT only)
  // ----------------------------------------------------------

  it("W10: replaces lines wholesale and recomputes the totals", async () => {
    const po = await createPurchaseOrderLogic(tenantA, draft(), userA);
    const firstLineId = po.items[0].id;

    const updated = await updatePurchaseOrderLogic(
      tenantA,
      po.id,
      draft({
        vatRatePercent: 0,
        lines: [
          {
            productId: prod.id,
            orderUnitId: unitOf(prod, "kg"),
            qtyOrdered: 3,
            unitPrice: 12.5,
            supplierProductMappingId: null,
            notes: "เปลี่ยนเป็นกิโล",
          },
        ],
      })
    );

    expect(updated.poNumber).toBe(po.poNumber); // the number is already issued
    expect(updated.items).toHaveLength(1);
    expect(updated.items[0].id).not.toBe(firstLineId); // replaced, not patched
    expect(updated.items[0].orderUnitName).toBe("kg");
    expect(num(updated.items[0].toBaseRatio)).toBe(1);
    expect(num(updated.subtotalExclVat)).toBe(37.5);
    expect(num(updated.vatAmount)).toBe(0);

    // the replaced line's allocations went with it (FK cascade)
    const orphans = await withRlsBypass((tx) =>
      tx.purchaseOrderItemAllocation.count({
        where: { purchaseOrderItemId: firstLineId },
      })
    );
    expect(orphans).toBe(0);
  });

  it("W11: refuses to edit anything that is not a DRAFT (Q4)", async () => {
    const po = await createPurchaseOrderLogic(tenantA, draft(), userA);
    await sendPurchaseOrderLogic(tenantA, po.id, userA);

    await expect(
      updatePurchaseOrderLogic(tenantA, po.id, draft())
    ).rejects.toBeInstanceOf(PurchaseOrderNotEditableError);
    await expect(
      deletePurchaseOrderDraftLogic(tenantA, po.id)
    ).rejects.toBeInstanceOf(PurchaseOrderNotEditableError);
  });

  it("W12: an unknown or foreign id is 'not found', never someone else's order", async () => {
    const mine = await createPurchaseOrderLogic(tenantA, draft(), userA);
    await expect(
      updatePurchaseOrderLogic(tenantB, mine.id, draft())
    ).rejects.toBeInstanceOf(PurchaseOrderNotFoundError);
    await expect(
      deletePurchaseOrderDraftLogic(tenantA, randomUUID())
    ).rejects.toBeInstanceOf(PurchaseOrderNotFoundError);
  });

  // ----------------------------------------------------------
  // W13–W16 — send / cancel / discard
  // ----------------------------------------------------------

  it("W13: send stamps sent_at + sentBy and freezes the document", async () => {
    const po = await createPurchaseOrderLogic(tenantA, draft(), userA);
    const sent = await sendPurchaseOrderLogic(tenantA, po.id, userA);

    expect(sent.status).toBe("SENT");
    expect(sent.sentAt).toBeInstanceOf(Date);
    expect(sent.sentBy).toBe(userA);
    // nothing about the order's content changed on the way out
    expect(num(sent.totalAmount)).toBe(num(po.totalAmount));
    expect(sent.items[0].orderUnitName).toBe(po.items[0].orderUnitName);

    await expect(
      sendPurchaseOrderLogic(tenantA, po.id, userA)
    ).rejects.toBeInstanceOf(PurchaseOrderTransitionError);
  });

  it("W14: a sent line is immune to a later edit of the ProductUnit (Q3)", async () => {
    const po = await createPurchaseOrderLogic(tenantA, draft(), userA);
    await sendPurchaseOrderLogic(tenantA, po.id, userA);

    // someone "corrects" the sack from 25 kg to 30 kg, after the order went out
    await withRlsBypass((tx) =>
      tx.productUnit.update({
        where: { id: unitOf(prod, "กระสอบ") },
        data: { toBaseRatio: new Prisma.Decimal(30), unitName: "กระสอบใหญ่" },
      })
    );

    const after = await getPurchaseOrderByIdLogic(tenantA, po.id);
    expect(num(after!.items[0].toBaseRatio)).toBe(25);
    expect(after!.items[0].orderUnitName).toBe("กระสอบ");

    // put it back for the remaining slices
    await withRlsBypass((tx) =>
      tx.productUnit.update({
        where: { id: unitOf(prod, "กระสอบ") },
        data: { toBaseRatio: new Prisma.Decimal(25), unitName: "กระสอบ" },
      })
    );
  });

  it("W15: cancel works from DRAFT and SENT, and records who + why", async () => {
    const fromDraft = await createPurchaseOrderLogic(tenantA, draft(), userA);
    const cancelled = await cancelPurchaseOrderLogic(
      tenantA,
      cancelPurchaseOrderInputSchema.parse({
        id: fromDraft.id,
        cancelReason: "สั่งผิดร้าน",
      }),
      userA
    );
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelReason).toBe("สั่งผิดร้าน");
    expect(cancelled.cancelledBy).toBe(userA);

    const sent = await createPurchaseOrderLogic(tenantA, draft(), userA);
    await sendPurchaseOrderLogic(tenantA, sent.id, userA);
    const cancelledSent = await cancelPurchaseOrderLogic(
      tenantA,
      cancelPurchaseOrderInputSchema.parse({ id: sent.id, cancelReason: "" }),
      userA
    );
    expect(cancelledSent.status).toBe("CANCELLED");
    expect(cancelledSent.sentAt).toBeInstanceOf(Date); // history is kept

    // terminal
    await expect(
      cancelPurchaseOrderLogic(
        tenantA,
        cancelPurchaseOrderInputSchema.parse({ id: sent.id, cancelReason: null }),
        userA
      )
    ).rejects.toBeInstanceOf(PurchaseOrderTransitionError);
  });

  it("W16: a DRAFT can be discarded; goods already arriving cannot be cancelled", async () => {
    const po = await createPurchaseOrderLogic(tenantA, draft(), userA);
    const gone = await deletePurchaseOrderDraftLogic(tenantA, po.id);
    expect(gone.deletedAt).toBeInstanceOf(Date);
    expect(await getPurchaseOrderByIdLogic(tenantA, po.id)).toBeNull();

    // PARTIALLY_RECEIVED is Part 13's state; cancelling it needs a reversal story
    const partial = await createPurchaseOrderLogic(tenantA, draft(), userA);
    await sendPurchaseOrderLogic(tenantA, partial.id, userA);
    await withRlsBypass((tx) =>
      tx.purchaseOrder.update({
        where: { id: partial.id },
        data: { status: "PARTIALLY_RECEIVED" },
      })
    );
    await expect(
      cancelPurchaseOrderLogic(
        tenantA,
        cancelPurchaseOrderInputSchema.parse({ id: partial.id, cancelReason: null }),
        userA
      )
    ).rejects.toBeInstanceOf(PurchaseOrderTransitionError);
  });

  // W17 (Part 13.5, Pitfall #25) — Q8's per-branch counter under concurrency.
  // Before the advisory lock in generatePoNumber, three simultaneous orders on
  // one branch all scanned the same max and two of them died on
  // purchase_order_number_unique, surfacing as "กดบันทึกอีกครั้ง".
  it("W17: concurrent orders on one branch get distinct consecutive po_numbers", async () => {
    const N = 3;
    const orders = await Promise.all(
      Array.from({ length: N }, () =>
        createPurchaseOrderLogic(tenantA, draft(), userA)
      )
    );

    const seq = orders
      .map((o) => {
        const m = /^KRUA-PO-(\d{4})$/.exec(o.poNumber);
        expect(m, o.poNumber).not.toBeNull();
        return parseInt(m![1], 10);
      })
      .sort((a, b) => a - b);

    expect(new Set(seq).size).toBe(N); // no duplicates
    expect(seq[N - 1] - seq[0]).toBe(N - 1); // and no gaps — one run, not a scramble
  });
});
