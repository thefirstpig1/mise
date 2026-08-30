// ============================================================
// Mise — par level *Logic integration tests (Sprint 3 Part 17 L3b)
// ============================================================
// Real Neon, real zod, real ledger and real purchase orders. The invariants:
//   Q5  — a par is per (product, branch), entered in any unit, stored in base
//   Q6  — the alert compares par with what is IN THE BUILDING; an open order
//         does NOT suppress the row, it explains it (three states)
//   Q6b — every row carries when its figure was last confirmed by a count, and
//         a zero-variance count still counts as having been counted
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { withRlsBypass } from "@/lib/db-admin";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { createStockAdjustmentLogic } from "@/server/stock-movement";
import { createStockAdjustmentInputSchema } from "@/lib/validations/stock-movement";
import {
  deleteParLevelInputSchema,
  getParLevelsQuerySchema,
  setParLevelInputSchema,
} from "@/lib/validations/par-level";
import {
  ParLevelNotFoundError,
  deleteParLevelLogic,
  getParLevelsLogic,
  setParLevelLogic,
} from "@/server/par-level";
import {
  closeStockCountInputSchema,
  openStockCountInputSchema,
  saveStockCountLineInputSchema,
} from "@/lib/validations/stock-count";
import {
  closeStockCountLogic,
  openStockCountLogic,
  saveStockCountLineLogic,
} from "@/server/stock-count";

const num = (d: Prisma.Decimal) => d.toNumber();
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000);

describe("par level *Logic (knowing before you run out)", () => {
  let tenantA: string;
  let branchA: string;
  let branchA2: string;
  let userA: string;
  let supplierA: string;

  const freshProduct = (tag: string): Promise<ProductWithUnits> =>
    createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `PAR-${tag}-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [{ unitName: "กระสอบ", toBaseRatio: 25 }],
      })
    );

  const unitOf = (p: ProductWithUnits, name: string) =>
    p.productUnits.find((u) => u.unitName === name)!.id;

  const seed = (p: ProductWithUnits, qty: number, branchId = branchA) =>
    createStockAdjustmentLogic(
      tenantA,
      createStockAdjustmentInputSchema.parse({
        submitKey: randomUUID(),
        productId: p.id,
        branchId,
        type: "ADJUST_GAIN",
        reason: "RECOUNT",
        inputQty: qty,
        inputUnitId: unitOf(p, "kg"),
        occurredAt: new Date(),
        notes: null,
      }),
      userA
    );

  const setPar = (
    p: ProductWithUnits,
    qty: number,
    opts: { unit?: string; branchId?: string } = {}
  ) =>
    setParLevelLogic(
      tenantA,
      setParLevelInputSchema.parse({
        productId: p.id,
        branchId: opts.branchId ?? branchA,
        inputQty: qty,
        inputUnitId: unitOf(p, opts.unit ?? "kg"),
      })
    );

  const rowFor = async (p: ProductWithUnits, branchId = branchA) => {
    const rows = await getParLevelsLogic(
      tenantA,
      getParLevelsQuerySchema.parse({ branchId })
    );
    return rows.find((r) => r.productId === p.id)!;
  };

  /** An open order for this product at this branch, in the ordered unit. */
  const placeOrder = async (
    p: ProductWithUnits,
    qtyOrdered: number,
    opts: {
      unit?: string;
      branchId?: string;
      expectedDeliveryDate?: Date | null;
      qtyReceived?: number;
    } = {}
  ) => {
    const unitName = opts.unit ?? "kg";
    const unit = p.productUnits.find((u) => u.unitName === unitName)!;
    return withRlsBypass(async (tx) => {
      const po = await tx.purchaseOrder.create({
        data: {
          tenantId: tenantA,
          branchId: opts.branchId ?? branchA,
          supplierId: supplierA,
          poNumber: `THL-PO-${randomUUID().slice(0, 8)}`,
          status: "SENT",
          expectedDeliveryDate: opts.expectedDeliveryDate ?? null,
          createdBy: userA,
          sentAt: new Date(),
          sentBy: userA,
        },
      });
      await tx.purchaseOrderItem.create({
        data: {
          tenantId: tenantA,
          purchaseOrderId: po.id,
          productId: p.id,
          lineNo: 1,
          qtyOrdered: new Prisma.Decimal(qtyOrdered),
          orderUnitId: unit.id,
          orderUnitName: unit.unitName,
          toBaseRatio: unit.toBaseRatio,
          unitPrice: new Prisma.Decimal(100),
          lineTotal: new Prisma.Decimal(qtyOrdered * 100),
          qtyReceived: new Prisma.Decimal(opts.qtyReceived ?? 0),
        },
      });
      return po;
    });
  };

  /** Count one product at one branch and close the sheet. */
  const countAndClose = async (p: ProductWithUnits, qty: number, branchId = branchA) => {
    const sheet = await openStockCountLogic(
      tenantA,
      openStockCountInputSchema.parse({
        branchId,
        countDate: new Date().toISOString().slice(0, 10),
        notes: null,
      }),
      userA
    );
    await saveStockCountLineLogic(
      tenantA,
      saveStockCountLineInputSchema.parse({
        stockCountId: sheet.id,
        productId: p.id,
        entries: [{ productUnitId: unitOf(p, "kg"), qtyInUnit: qty }],
        countedByName: null,
        notes: null,
      }),
      userA
    );
    return closeStockCountLogic(
      tenantA,
      closeStockCountInputSchema.parse({ id: sheet.id }),
      userA
    );
  };

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Par Test Tenant" } });
      tenantA = t.id;
      const [b1, b2] = await Promise.all([
        tx.branch.create({ data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" } }),
        tx.branch.create({ data: { tenantId: t.id, name: "อารีย์", code: "ARY" } }),
      ]);
      branchA = b1.id;
      branchA2 = b2.id;
      const u = await tx.user.create({
        data: { email: `par-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;
      const s = await tx.supplier.create({
        data: { tenantId: t.id, code: "SUP1", nameFull: "เจ๊หมูเนื้อสด" },
      });
      supplierA = s.id;
    });
  });

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.parLevel.deleteMany({ where: { tenantId: tenantA } });
      await tx.purchaseOrderItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.purchaseOrder.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockCountEntry.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockCountItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockCount.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockMovement.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockAdjustment.deleteMany({ where: { tenantId: tenantA } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId: tenantA } } });
      await tx.product.deleteMany({ where: { tenantId: tenantA } });
      await tx.supplier.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.deleteMany({ where: { id: tenantA } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
  });

  it("R1: a par is entered in any unit and stored in base (Q5)", async () => {
    const p = await freshProduct("R1");
    const par = await setPar(p, 2, { unit: "กระสอบ" });

    expect(num(par.parQty)).toBe(50);
    // As entered, so the form re-opens in the unit the user chose.
    expect(num(par.inputQty)).toBe(2);
  });

  it("R2: setting a par twice UPDATES — it is a setting, not a document", async () => {
    const p = await freshProduct("R2");
    const first = await setPar(p, 10);
    const second = await setPar(p, 15);

    expect(second.id).toBe(first.id);
    expect(num(second.parQty)).toBe(15);

    const live = await withRlsBypass((tx) =>
      tx.parLevel.findMany({ where: { tenantId: tenantA, productId: p.id } })
    );
    expect(live).toHaveLength(1);
  });

  it("R3: a par is per BRANCH — one branch short does not implicate the other (Q5)", async () => {
    const p = await freshProduct("R3");
    await setPar(p, 10);
    await setPar(p, 10, { branchId: branchA2 });
    await seed(p, 4); // short here
    await seed(p, 40, branchA2); // plenty there

    expect((await rowFor(p)).isBelow).toBe(true);
    expect((await rowFor(p, branchA2)).isBelow).toBe(false);
  });

  it("R4: below par with nothing on order is ต้องสั่ง, and shows the gap", async () => {
    const p = await freshProduct("R4");
    await setPar(p, 20);
    await seed(p, 8);

    const row = await rowFor(p);
    expect(row.state).toBe("NEEDS_ORDER");
    expect(num(row.onHand)).toBe(8);
    expect(num(row.gap)).toBe(12);
    expect(row.openOrder).toBeNull();
  });

  it("R5: an open order does NOT suppress the row — it explains it (Q6)", async () => {
    const p = await freshProduct("R5");
    await setPar(p, 20);
    await seed(p, 5);
    await placeOrder(p, 1, { unit: "กระสอบ", expectedDeliveryDate: daysFromNow(3) });

    const row = await rowFor(p);
    // Kong's reason, and the right one: an order placed and never chased is the
    // failure nobody notices until service. Subtracting it would go silent here.
    expect(row.isBelow).toBe(true);
    expect(row.state).toBe("ON_ORDER");
    expect(num(row.openOrder!.qtyOutstanding)).toBe(25); // base units, frozen ratio
    expect(row.openOrder!.supplierName).toBe("เจ๊หมูเนื้อสด");
  });

  it("R6: an open order past its expected date is ตามของ", async () => {
    const p = await freshProduct("R6");
    await setPar(p, 20);
    await seed(p, 5);
    await placeOrder(p, 10, { expectedDeliveryDate: daysFromNow(-2) });

    const row = await rowFor(p);
    // The case that has no home in the system today.
    expect(row.state).toBe("OVERDUE");
  });

  it("R7: an order with NO expected date can never be overdue (Consequence 7)", async () => {
    const p = await freshProduct("R7");
    await setPar(p, 20);
    await seed(p, 5);
    await placeOrder(p, 10, { expectedDeliveryDate: null });

    const row = await rowFor(p);
    expect(row.state).toBe("ON_ORDER");
    expect(row.openOrder!.expectedDeliveryDate).toBeNull();
  });

  it("R8: a fully received order is not outstanding, so the row is ต้องสั่ง again", async () => {
    const p = await freshProduct("R8");
    await setPar(p, 20);
    await seed(p, 5);
    await placeOrder(p, 10, { qtyReceived: 10, expectedDeliveryDate: daysFromNow(1) });

    const row = await rowFor(p);
    expect(row.state).toBe("NEEDS_ORDER");
    expect(row.openOrder).toBeNull();
  });

  it("R9: two open orders are summed, and the EARLIEST date represents them", async () => {
    const p = await freshProduct("R9");
    await setPar(p, 100);
    await seed(p, 5);
    await placeOrder(p, 10, { expectedDeliveryDate: daysFromNow(5) });
    await placeOrder(p, 4, { expectedDeliveryDate: daysFromNow(-1) });

    const row = await rowFor(p);
    expect(num(row.openOrder!.qtyOutstanding)).toBe(14);
    expect(row.openOrder!.orderCount).toBe(2);
    // The one already late is the one worth naming.
    expect(row.state).toBe("OVERDUE");
  });

  it("R10: a product never counted says so; counting it sets the freshness (Q6b)", async () => {
    const p = await freshProduct("R10");
    await setPar(p, 20);
    await seed(p, 30);

    expect((await rowFor(p)).lastCountedAt).toBeNull();

    await countAndClose(p, 12);
    const counted = await rowFor(p);
    expect(counted.lastCountedAt).not.toBeNull();
    // The count also corrected the balance, which is the drift resetting to zero.
    expect(num(counted.onHand)).toBe(12);
  });

  it("R11: a count that finds NO variance still counts as having been counted", async () => {
    const p = await freshProduct("R11");
    await setPar(p, 20);
    await seed(p, 30);

    // Closing posts nothing for a zero-variance line, so the LEDGER cannot see
    // this count. Reading freshness from stock_movement would report "never
    // counted" for the best-managed stock in the shop.
    await countAndClose(p, 30);

    const row = await rowFor(p);
    expect(row.lastCountedAt).not.toBeNull();
    expect(num(row.onHand)).toBe(30);
  });

  it("R12: below-par sorts first, and the stalest figure sorts above the fresher", async () => {
    const fresh = await freshProduct("R12a");
    const stale = await freshProduct("R12b");
    const fine = await freshProduct("R12c");
    await Promise.all([setPar(fresh, 50), setPar(stale, 50), setPar(fine, 1)]);
    await Promise.all([seed(fresh, 10), seed(stale, 10), seed(fine, 500)]);
    await countAndClose(fresh, 10); // only this one has ever been counted

    const rows = await getParLevelsLogic(
      tenantA,
      getParLevelsQuerySchema.parse({ branchId: branchA })
    );
    const ids = rows.map((r) => r.productId);
    // Never counted is the stalest thing there is.
    expect(ids.indexOf(stale.id)).toBeLessThan(ids.indexOf(fresh.id));
    // And anything below par outranks anything that is fine.
    expect(ids.indexOf(fresh.id)).toBeLessThan(ids.indexOf(fine.id));
  });

  it("R13: belowOnly hides the products that are fine", async () => {
    const p = await freshProduct("R13");
    await setPar(p, 5);
    await seed(p, 500);

    const all = await getParLevelsLogic(
      tenantA,
      getParLevelsQuerySchema.parse({ branchId: branchA })
    );
    const below = await getParLevelsLogic(
      tenantA,
      getParLevelsQuerySchema.parse({ branchId: branchA, belowOnly: "true" })
    );
    expect(all.some((r) => r.productId === p.id)).toBe(true);
    expect(below.some((r) => r.productId === p.id)).toBe(false);
    expect(below.every((r) => r.isBelow)).toBe(true);
  });

  it("R14: removing a par drops the product from the list entirely", async () => {
    const p = await freshProduct("R14");
    const par = await setPar(p, 10);
    await seed(p, 1);
    expect(await rowFor(p)).toBeTruthy();

    await deleteParLevelLogic(
      tenantA,
      deleteParLevelInputSchema.parse({ id: par.id })
    );

    const rows = await getParLevelsLogic(
      tenantA,
      getParLevelsQuerySchema.parse({ branchId: branchA })
    );
    // "No par" is the absence of a row, not a par of zero that would report the
    // product short forever.
    expect(rows.some((r) => r.productId === p.id)).toBe(false);

    // And re-setting it revives the same row rather than leaving a dead one.
    const revived = await setPar(p, 12);
    expect(revived.id).toBe(par.id);
    const live = await withRlsBypass((tx) =>
      tx.parLevel.findMany({ where: { tenantId: tenantA, productId: p.id } })
    );
    expect(live).toHaveLength(1);
  });

  it("R15: removing a par that is already gone is a not-found", async () => {
    await expect(
      deleteParLevelLogic(
        tenantA,
        deleteParLevelInputSchema.parse({ id: randomUUID() })
      )
    ).rejects.toBeInstanceOf(ParLevelNotFoundError);
  });
});
