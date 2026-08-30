// ============================================================
// Mise — cost READ *Logic integration tests (Sprint 2 Part 14 L3a-2)
// ============================================================
// The replay arithmetic is proved in tests/fifo-replay.test.ts without a
// database. What is proved HERE is everything the engine cannot see: that the
// right rows reach it, in the right order, with the receipt's money and the live
// declaration attached — and that a branch, a tenant, or a superseded statement
// never leaks into someone else's answer.
//
// Fixtures go through the real Part 11/13 write path (PO → send → receive →
// confirm), because the money the engine reads is `line_total_actual`, and a
// hand-built row would prove the test right rather than the code.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { EVERY_BRANCH } from "./support/reach";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { withAdminContext, withTenantContext, prisma } from "@/lib/db";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { supplierInputSchema } from "@/lib/validations/supplier";
import { createSupplierLogic } from "@/server/supplier";
import { purchaseOrderInputSchema } from "@/lib/validations/purchase-order";
import {
  createPurchaseOrderLogic,
  sendPurchaseOrderLogic,
} from "@/server/purchase-order";
import { goodsReceiptInputSchema } from "@/lib/validations/goods-receipt";
import {
  confirmGoodsReceiptLogic,
  createGoodsReceiptLogic,
} from "@/server/goods-receipt";
import { createStockAdjustmentLogic } from "@/server/stock-movement";
import { createStockAdjustmentInputSchema } from "@/lib/validations/stock-movement";
import { createWasteLogic } from "@/server/waste";
import { createWasteInputSchema } from "@/lib/validations/waste";
import {
  getBranchCostSummaryLogic,
  getProductCostLogic,
  getProductCostsLogic,
} from "@/server/stock-cost";
import {
  CostDeclarationTargetError,
  CostUnitMismatchError,
  declareStockCostLogic,
  getCostDeclarationsLogic,
} from "@/server/cost-declaration";
import {
  declareStockCostInputSchema,
  getBranchCostSummaryQuerySchema,
  getProductCostQuerySchema,
  getProductCostsQuerySchema,
} from "@/lib/validations/stock-cost";
import { computeBangkokToday } from "@/lib/bangkok-date";

const num = (d: Prisma.Decimal) => d.toNumber();

describe("cost read *Logic (FIFO by ledger replay, ADR 0014)", () => {
  let tenantA: string;
  let tenantB: string;
  let branchA: string;
  let branchA2: string;
  let branchB: string;
  let userA: string;
  let supA: string;
  let supB: string;

  const today = computeBangkokToday();

  /** kg base + a กระสอบ ×25 order unit — the Part 11/13 fixture shape. */
  const freshProduct = (tenant: string, tag: string): Promise<ProductWithUnits> =>
    createProductLogic(
      tenant,
      productInputSchema.parse({
        name: `COST-${tag}-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [{ unitName: "กระสอบ", toBaseRatio: 25 }],
        defaultBuyUnitName: "กระสอบ",
      })
    );

  const unitOf = (p: ProductWithUnits, name: string) =>
    p.productUnits.find((u) => u.unitName === name)!.id;

  /**
   * Receive `sacks` × 25 kg at `pricePerSack`, through the real documents, and
   * confirm it — which is what posts to the ledger (ADR 0013 Q2).
   */
  const receiveInto = async (
    branchId: string,
    product: ProductWithUnits,
    sacks: number,
    pricePerSack: number,
    receivedAt: Date = new Date()
  ) => {
    const po = await createPurchaseOrderLogic(
      tenantA,
      purchaseOrderInputSchema.parse({
        branchId,
        supplierId: supA,
        expectedDeliveryDate: "",
        vatRatePercent: 7,
        notes: null,
        lines: [
          {
            productId: product.id,
            orderUnitId: unitOf(product, "กระสอบ"),
            qtyOrdered: sacks,
            unitPrice: pricePerSack,
            supplierProductMappingId: null,
            notes: null,
          },
        ],
      }),
      userA
    );
    const sent = await sendPurchaseOrderLogic(tenantA, po.id, userA);

    const gr = await createGoodsReceiptLogic(
      tenantA,
      goodsReceiptInputSchema.parse({
        submitKey: randomUUID(),
        branchId,
        supplierId: supA,
        purchaseOrderId: sent.id,
        invoiceNo: null,
        receivedAt,
        notes: null,
        lines: [
          {
            purchaseOrderItemId: sent.items[0].id,
            productId: product.id,
            receivedUnitId: unitOf(product, "กระสอบ"),
            qtyReceivedActual: sacks,
            unitPriceActual: pricePerSack,
            notes: null,
          },
        ],
      }),
      userA
    );
    return confirmGoodsReceiptLogic(tenantA, gr.id, userA);
  };

  /**
   * `occurredAt` defaults to a real instant, NOT the Bangkok midnight the form
   * submits — see K11 for why that difference matters and what it costs.
   */
  const adjust = (
    branchId: string,
    product: ProductWithUnits,
    type: "ADJUST_GAIN" | "ADJUST_LOSS",
    qty: number,
    occurredAt: Date = new Date()
  ) =>
    createStockAdjustmentLogic(
      tenantA,
      createStockAdjustmentInputSchema.parse({
        submitKey: randomUUID(),
        productId: product.id,
        branchId,
        type,
        reason: type === "ADJUST_GAIN" ? "RECOUNT" : "SPOILAGE",
        inputQty: qty,
        inputUnitId: unitOf(product, "kg"),
        occurredAt,
        notes: null,
      }),
      userA
    );

  /** Part 17: the same loss, but WITH a waste document behind it (ADR 0017 Q1). */
  const throwAway = (
    branchId: string,
    product: ProductWithUnits,
    qty: number,
    occurredAt: Date = new Date()
  ) =>
    createWasteLogic(
      tenantA,
      createWasteInputSchema.parse({
        submitKey: randomUUID(),
        productId: product.id,
        branchId,
        reason: "SPOILED",
        inputQty: qty,
        inputUnitId: unitOf(product, "kg"),
        occurredAt,
        wastedByName: null,
        notes: null,
      }),
      userA
    );

  const costOf = (product: ProductWithUnits, branchId = branchA, asOf?: Date) =>
    getProductCostLogic(
      tenantA,
      getProductCostQuerySchema.parse({
        productId: product.id,
        branchId,
        asOf: asOf ?? "",
      })
    );

  beforeAll(async () => {
    await withAdminContext(async (tx) => {
      const a = await tx.tenant.create({ data: { name: "Cost Test Tenant A" } });
      const b = await tx.tenant.create({ data: { name: "Cost Test Tenant B" } });
      tenantA = a.id;
      tenantB = b.id;

      const [b1, b2, bb] = await Promise.all([
        tx.branch.create({ data: { tenantId: a.id, name: "ทองหล่อ", code: "THL" } }),
        tx.branch.create({ data: { tenantId: a.id, name: "อารีย์", code: "ARY" } }),
        tx.branch.create({ data: { tenantId: b.id, name: "B1", code: "MAIN" } }),
      ]);
      branchA = b1.id;
      branchA2 = b2.id;
      branchB = bb.id;

      await Promise.all([
        tx.department.create({ data: { tenantId: a.id, name: "Main", code: "MAIN" } }),
        tx.department.create({ data: { tenantId: b.id, name: "Main", code: "MAIN" } }),
      ]);

      const u = await tx.user.create({
        data: { email: `cost-test-${randomUUID()}@example.com`, name: "ผู้ทดสอบ" },
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
      await tx.stockCostDeclaration.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.wasteLog.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.stockMovement.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.stockAdjustment.deleteMany({ where: { tenantId: { in: ids } } });
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
  // K1–K3 — the money really does come off the receipt
  // ----------------------------------------------------------

  it("K1: a confirmed receipt becomes a layer priced from line_total_actual", async () => {
    const p = await freshProduct(tenantA, "K1");
    await receiveInto(branchA, p, 4, 250); // 100 kg for 1,000 ฿

    const cost = await costOf(p);
    expect(num(cost.qtyOnHand)).toBe(100);
    expect(num(cost.inventoryValue)).toBe(1000);
    expect(num(cost.costPerBaseUnit)).toBe(10); // 250 ฿ a sack ÷ 25 kg
    expect(cost.costSource).toBe("FRONT_LAYER");
    expect(cost.layers).toHaveLength(1);
  });

  it("K2: two receipts keep their own prices, and cost is the front layer's", async () => {
    const p = await freshProduct(tenantA, "K2");
    await receiveInto(branchA, p, 4, 250); // 100 kg @ 10
    await receiveInto(branchA, p, 4, 300); // 100 kg @ 12

    const cost = await costOf(p);
    expect(num(cost.qtyOnHand)).toBe(200);
    expect(num(cost.inventoryValue)).toBe(2200);
    expect(num(cost.costPerBaseUnit)).toBe(10);
    // The trap Q3b names: 10 × 200 = 2,000, which is NOT what the stock is worth.
    expect(num(cost.costPerBaseUnit.mul(cost.qtyOnHand))).toBe(2000);
  });

  it("K3: money in − money out equals the value on hand, to the satang", async () => {
    const p = await freshProduct(tenantA, "K3");
    await receiveInto(branchA, p, 3, 1000); // 75 kg for 3,000
    await adjust(branchA, p, "ADJUST_LOSS", 30);

    const cost = await costOf(p);
    expect(num(cost.totalIn.minus(cost.totalOut))).toBeCloseTo(
      num(cost.inventoryValue),
      2
    );
    expect(num(cost.qtyOnHand)).toBe(45);
  });

  // ----------------------------------------------------------
  // K4–K6 — isolation: a branch, a tenant, a superseded statement
  // ----------------------------------------------------------

  it("K4: two branches are two piles — neither pays for the other's stock (Q9)", async () => {
    const p = await freshProduct(tenantA, "K4");
    await receiveInto(branchA, p, 4, 250); // ทองหล่อ: 100 kg @ 10
    await receiveInto(branchA2, p, 4, 500); // อารีย์:  100 kg @ 20

    const atA = await costOf(p, branchA);
    const atA2 = await costOf(p, branchA2);

    expect(num(atA.costPerBaseUnit)).toBe(10);
    expect(num(atA2.costPerBaseUnit)).toBe(20);
    expect(num(atA.qtyOnHand)).toBe(100);
    expect(num(atA2.qtyOnHand)).toBe(100);
  });

  it("K5: another tenant's id yields an empty state, not an error or a leak", async () => {
    const pB = await freshProduct(tenantB, "K5");
    const cost = await getProductCostLogic(
      tenantA,
      getProductCostQuerySchema.parse({ productId: pB.id, branchId: branchA })
    );
    expect(num(cost.qtyOnHand)).toBe(0);
    expect(cost.costSource).toBe("UNPRICED");
  });

  it("K6: a live declaration prices a gain; a superseded one is ignored (Q6)", async () => {
    const p = await freshProduct(tenantA, "K6");
    const { movement } = await adjust(branchA, p, "ADJUST_GAIN", 10);

    // Nothing purchased, nothing declared: honest about not knowing.
    let cost = await costOf(p);
    expect(cost.costSource).toBe("UNPRICED");
    expect(cost.hasUnpricedLayers).toBe(true);

    await withAdminContext((tx) =>
      tx.stockCostDeclaration.create({
        data: {
          tenantId: tenantA,
          movementId: movement.id,
          inputUnitCost: new Prisma.Decimal(150),
          inputUnitId: unitOf(p, "kg"),
          unitCost: new Prisma.Decimal(150),
          declaredBy: userA,
          note: "ใบส่งของที่ลืมคีย์",
        },
      })
    );

    cost = await costOf(p);
    expect(num(cost.costPerBaseUnit)).toBe(150);
    expect(cost.costSource).toBe("DECLARED");
    expect(num(cost.inventoryValue)).toBe(1500);

    // Correct it: the old statement closes, the new one governs.
    await withAdminContext(async (tx) => {
      await tx.stockCostDeclaration.updateMany({
        where: { movementId: movement.id, supersededAt: null },
        data: { supersededAt: new Date() },
      });
      await tx.stockCostDeclaration.create({
        data: {
          tenantId: tenantA,
          movementId: movement.id,
          inputUnitCost: new Prisma.Decimal(180),
          inputUnitId: unitOf(p, "kg"),
          unitCost: new Prisma.Decimal(180),
          declaredBy: userA,
          note: "อ่านใบผิด",
        },
      });
    });

    cost = await costOf(p);
    expect(num(cost.costPerBaseUnit)).toBe(180);
    expect(num(cost.inventoryValue)).toBe(1800);
  });

  // ----------------------------------------------------------
  // K7–K8 — asOf, and the batch contract
  // ----------------------------------------------------------

  it("K7: asOf answers as of a past day, and a backdated receipt rewrites it", async () => {
    const p = await freshProduct(tenantA, "K7");
    const dayBefore = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysBefore = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);

    await receiveInto(branchA, p, 4, 250, dayBefore); // 100 kg @ 10, yesterday

    const asOfTwoDaysAgo = await costOf(p, branchA, twoDaysBefore);
    expect(num(asOfTwoDaysAgo.qtyOnHand)).toBe(0);

    const now = await costOf(p);
    expect(num(now.costPerBaseUnit)).toBe(10);

    // The forgotten delivery, keyed late with its true earlier date. A stored
    // cost history would now be wrong about a day already past; the replay is not.
    await receiveInto(branchA, p, 4, 125, twoDaysBefore); // 100 kg @ 5
    const after = await costOf(p);
    expect(num(after.costPerBaseUnit)).toBe(5);
    expect(num(after.qtyOnHand)).toBe(200);
  });

  it("K8: the batch read answers for every product asked, including silent ones", async () => {
    const withStock = await freshProduct(tenantA, "K8a");
    const untouched = await freshProduct(tenantA, "K8b");
    await receiveInto(branchA, withStock, 2, 250);

    const costs = await getProductCostsLogic(
      tenantA,
      getProductCostsQuerySchema.parse({
        productIds: [withStock.id, untouched.id],
        branchId: branchA,
      })
    );

    expect(costs.size).toBe(2);
    expect(num(costs.get(withStock.id)!.qtyOnHand)).toBe(50);
    // Present with an explicit empty state — a caller must not have to guess
    // whether a missing key means "no stock" or "no such product".
    expect(costs.get(untouched.id)).toBeDefined();
    expect(num(costs.get(untouched.id)!.qtyOnHand)).toBe(0);
    expect(costs.get(untouched.id)!.costSource).toBe("UNPRICED");
  });

  // ----------------------------------------------------------
  // K9 — the business-wide roll-up (Q9b)
  // ----------------------------------------------------------

  it("K9: the branch summary prices the loss in baht and names who overpaid", async () => {
    // The summary is TENANT-WIDE across every product, so earlier cases in this
    // file already contribute to it. Measured as a delta, which is also the only
    // honest way to assert on a figure that aggregates the whole business.
    const period = getBranchCostSummaryQuerySchema.parse({
      from: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000),
      to: today,
    });
    const before = await getBranchCostSummaryLogic(tenantA, period, EVERY_BRANCH);
    const priorOf = (branchId: string) => before.find((r) => r.branchId === branchId)!;

    const p = await freshProduct(tenantA, "K9");
    // Same goods, same week, two branches, very different prices.
    await receiveInto(branchA, p, 4, 250); // ทองหล่อ 100 kg for 1,000
    await receiveInto(branchA2, p, 4, 500); // อารีย์  100 kg for 2,000
    await adjust(branchA2, p, "ADJUST_LOSS", 10); // and อารีย์ throws 10 kg away

    const rows = await getBranchCostSummaryLogic(tenantA, period, EVERY_BRANCH);
    const thonglor = rows.find((r) => r.branchId === branchA)!;
    const aree = rows.find((r) => r.branchId === branchA2)!;

    // Reported in MONEY, which is the number that makes an owner act — and
    // since Part 17 (ADR 0017 Q4) a hand-typed ADJUST_LOSS carries no waste
    // document, so it lands in ส่วนต่าง/ปรับปรุง, not in ของเสีย. Nothing was
    // rewritten to make that true; the rule reads the source type.
    expect(num(aree.varianceValue.minus(priorOf(branchA2).varianceValue))).toBe(200); // 10 × 20
    expect(num(aree.wasteValue.minus(priorOf(branchA2).wasteValue))).toBe(0);
    expect(num(thonglor.varianceValue.minus(priorOf(branchA).varianceValue))).toBe(0);

    // อารีย์ paid 20 ฿/kg for what ทองหล่อ bought at 10 — 1,000 ฿ of pure spread,
    // invisible on either branch's own screen.
    expect(
      num(aree.excessSpend.minus(priorOf(branchA2).excessSpend))
    ).toBeGreaterThanOrEqual(1000);
    expect(num(thonglor.excessSpend.minus(priorOf(branchA).excessSpend))).toBe(0);

    // Revenue is not measurable until POS sync lands. null, never 0.
    expect(aree.revenue).toBeNull();
    expect(aree.grossProfit).toBeNull();

    // Spend now comes from the EXPENSE a confirmed receipt writes (ADR 0016 Q3),
    // and lands under COGS because that is where a stocked product's category
    // sits — or, for a product nobody categorised, where the fallback puts it.
    expect(
      num(thonglor.cogsSpend.minus(priorOf(branchA).cogsSpend))
    ).toBeGreaterThanOrEqual(1000);
  });

  it("K10: negative stock and unpriced stock are counted, not hidden", async () => {
    const p = await freshProduct(tenantA, "K10");
    await adjust(branchA, p, "ADJUST_LOSS", 5); // straight into the red

    const cost = await costOf(p);
    expect(cost.negativeStock).toBe(true);
    expect(num(cost.qtyOnHand)).toBe(-5);

    const declared = await withTenantContext(tenantA, (tx) =>
      tx.stockMovement.count({ where: { tenantId: tenantA, productId: p.id } })
    );
    expect(declared).toBe(1);
  });

  // ----------------------------------------------------------
  // K11 — a real consequence of two ADRs meeting, pinned deliberately
  // ----------------------------------------------------------

  it("K9b: a WASTE document lands in ของเสีย; the same loss typed by hand does not (ADR 0017 Q4)", async () => {
    // The whole point of Part 17's split. Both of these post an ADJUST_LOSS of
    // 10 kg at the same cost — what separates them is whether anyone wrote down
    // that the food was thrown away, which is exactly the difference between a
    // conversation with the kitchen and one with the branch manager.
    const period = getBranchCostSummaryQuerySchema.parse({
      from: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000),
      to: today,
    });
    const before = await getBranchCostSummaryLogic(tenantA, period, EVERY_BRANCH);
    const prior = before.find((r) => r.branchId === branchA)!;

    const p = await freshProduct(tenantA, "K9b");
    await receiveInto(branchA, p, 4, 500); // 100 kg @ 20/kg
    await throwAway(branchA, p, 10); // 200 ฿ with a document
    await adjust(branchA, p, "ADJUST_LOSS", 5); // 100 ฿ without one

    const row = (await getBranchCostSummaryLogic(tenantA, period, EVERY_BRANCH)).find(
      (r) => r.branchId === branchA
    )!;
    expect(num(row.wasteValue.minus(prior.wasteValue))).toBe(200);
    expect(num(row.varianceValue.minus(prior.varianceValue))).toBe(100);
  });

  it("K11: a date-only adjustment is costed at the END of its Bangkok day", async () => {
    // ADR 0011 Q5 gives an adjustment a business DATE (the form submits Bangkok
    // midnight); ADR 0013 Q4 gives a receipt a true INSTANT. Ordering by the raw
    // occurred_at would therefore put every adjustment before every receipt of
    // the same day, and waste thrown out after the morning delivery would be
    // valued at yesterday's cost — or at zero on a product's first day.
    //
    // `costSortKey` reads a date-only value as that day's end, for costing only.
    const period = getBranchCostSummaryQuerySchema.parse({
      from: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000),
      to: today,
    });
    const before = await getBranchCostSummaryLogic(tenantA, period, EVERY_BRANCH);
    const priorVariance = before.find((r) => r.branchId === branchA)!.varianceValue;

    const p = await freshProduct(tenantA, "K11");
    await adjust(branchA, p, "ADJUST_LOSS", 10, today); // exactly what the form posts
    await receiveInto(branchA, p, 4, 500); // the same day: 100 kg @ 20

    const cost = await costOf(p);
    expect(num(cost.qtyOnHand)).toBe(90);
    expect(num(cost.costPerBaseUnit)).toBe(20);
    // The pile never went negative: the delivery is costed first, then the waste.
    expect(cost.negativeStock).toBe(false);

    const rows = await getBranchCostSummaryLogic(tenantA, period, EVERY_BRANCH);
    const thonglor = rows.find((r) => r.branchId === branchA)!;
    // 10 kg valued at what the goods actually cost that day — not 0, and not
    // yesterday's price. The COLUMN is ส่วนต่าง/ปรับปรุง since Part 17 (this is
    // a hand-typed adjustment, not a waste document); the costing instant this
    // case exists to pin down is unchanged.
    expect(num(thonglor.varianceValue.minus(priorVariance))).toBe(200);
  });

  // ----------------------------------------------------------
  // K12–K15 — declaring a cost (ADR 0014 Q6, L3b)
  // ----------------------------------------------------------

  it("K12: a cost typed on the adjust form is written in the SAME transaction", async () => {
    const p = await freshProduct(tenantA, "K12");
    // "กระสอบละ 4,500" — the unit an owner actually thinks in.
    await createStockAdjustmentLogic(
      tenantA,
      createStockAdjustmentInputSchema.parse({
        submitKey: randomUUID(),
        productId: p.id,
        branchId: branchA,
        type: "ADJUST_GAIN",
        reason: "RECOUNT",
        inputQty: 50,
        inputUnitId: unitOf(p, "kg"),
        occurredAt: today,
        notes: null,
        costDeclaration: {
          unitCost: 4500,
          unitId: unitOf(p, "กระสอบ"),
          note: "ใบส่งของ 15 ส.ค. ที่ลืมคีย์",
        },
      }),
      userA
    );

    const cost = await costOf(p);
    // 4,500 ฿ a sack ÷ 25 kg = 180 ฿/kg — converted, never stored as typed.
    expect(num(cost.costPerBaseUnit)).toBe(180);
    expect(cost.costSource).toBe("DECLARED");
    expect(num(cost.inventoryValue)).toBe(9000);
    expect(cost.hasUnpricedLayers).toBe(false);
  });

  it("K13: declaring later corrects the cost and keeps the previous statement", async () => {
    const p = await freshProduct(tenantA, "K13");
    const { movement } = await adjust(branchA, p, "ADJUST_GAIN", 10);

    await declareStockCostLogic(
      tenantA,
      declareStockCostInputSchema.parse({
        movementId: movement.id,
        unitCost: 150,
        unitId: unitOf(p, "kg"),
        note: "เจอใบส่งของ",
      }),
      userA
    );
    expect(num((await costOf(p)).costPerBaseUnit)).toBe(150);

    await declareStockCostLogic(
      tenantA,
      declareStockCostInputSchema.parse({
        movementId: movement.id,
        unitCost: 180,
        unitId: unitOf(p, "kg"),
        note: "อ่านตัวเลขผิด",
      }),
      userA
    );

    const cost = await costOf(p);
    expect(num(cost.costPerBaseUnit)).toBe(180);

    // Both statements survive — that is what makes a correction defensible.
    const history = await getCostDeclarationsLogic(tenantA, movement.id);
    expect(history).toHaveLength(2);
    expect(num(history[0].unitCost)).toBe(180);
    expect(history[0].supersededAt).toBeNull();
    expect(history[1].supersededAt).not.toBeNull();
    expect(history[1].note).toBe("เจอใบส่งของ");
    expect(history[0].declaredByUser.id).toBe(userA);
  });

  it("K14: a receipt's price cannot be declared over — it belongs to its document", async () => {
    const p = await freshProduct(tenantA, "K14");
    await receiveInto(branchA, p, 2, 250);

    const movement = await withTenantContext(tenantA, (tx) =>
      tx.stockMovement.findFirst({
        where: { tenantId: tenantA, productId: p.id, type: "PO_RECEIVE" },
        select: { id: true },
      })
    );
    expect(movement).not.toBeNull();

    await expect(
      declareStockCostLogic(
        tenantA,
        declareStockCostInputSchema.parse({
          movementId: movement!.id,
          unitCost: 999,
          unitId: unitOf(p, "kg"),
          note: null,
        }),
        userA
      )
    ).rejects.toBeInstanceOf(CostDeclarationTargetError);

    // Untouched: still the receipt's own price.
    expect(num((await costOf(p)).costPerBaseUnit)).toBe(10);
  });

  it("K15: rejects a unit of another product, and another tenant's movement", async () => {
    const p = await freshProduct(tenantA, "K15a");
    const other = await freshProduct(tenantA, "K15b");
    const { movement } = await adjust(branchA, p, "ADJUST_GAIN", 5);

    await expect(
      declareStockCostLogic(
        tenantA,
        declareStockCostInputSchema.parse({
          movementId: movement.id,
          unitCost: 100,
          unitId: unitOf(other, "kg"), // a unit of a DIFFERENT product
          note: null,
        }),
        userA
      )
    ).rejects.toBeInstanceOf(CostUnitMismatchError);

    await expect(
      declareStockCostLogic(
        tenantB,
        declareStockCostInputSchema.parse({
          movementId: movement.id, // tenant A's movement
          unitCost: 100,
          unitId: unitOf(p, "kg"),
          note: null,
        }),
        userA
      )
    ).rejects.toBeInstanceOf(CostDeclarationTargetError);

    // Nothing was written by either attempt.
    expect(await getCostDeclarationsLogic(tenantA, movement.id)).toHaveLength(0);
  });
});
