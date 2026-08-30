// ============================================================
// Mise — gross profit by สูตรอาหาร (Sprint 5 Part 22 L3d)
// ============================================================
// The cell ADR 0019 left showing "—" since Sprint 4.
//
// Deliberately simple arithmetic, all of it checkable by hand: pork at ฿100/kg,
// one kilo per plate. Five plates cost ฿500, and that is the whole point —
// what is under test is WHICH days count, not FIFO, which fifo-replay.test.ts
// and consumption-reversal-logic.test.ts already prove.
//
// The rule being tested is N10: a period posted in part prints its figure WITH
// its coverage, and only a period with nothing posted at all prints "—".
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { EVERY_BRANCH } from "./support/reach";
import { randomUUID } from "node:crypto";
import { prisma, withTenantContext} from "@/lib/db";
import { withRlsBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
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
import { recipeInputSchema } from "@/lib/validations/recipe";
import { createRecipeLogic } from "@/server/recipe";
import { getBranchCostSummaryLogic } from "@/server/stock-cost";
import { toBranchCostSummaryView } from "@/app/cost/_components/cost-view";
import {
  postConsumptionForDayLogic,
  voidConsumptionForDayInTx,
} from "@/server/consumption-post";

describe("gross profit by สูตรอาหาร (ADR 0022 Part 22 L3d)", () => {
  let tenantA: string;
  let userA: string;
  let branchA: string;
  let supplierA: string;
  let batchId: string;
  let menuId: string;

  let pork: ProductWithUnits;

  const today = computeBangkokToday();
  const D_A = addDays(today, -2);
  const D_B = addDays(today, -1);
  const FROM = addDays(today, -7);

  const baseUnitOf = (p: ProductWithUnits) =>
    p.productUnits.find((u) => u.isBase)!.id;

  const summary = () =>
    getBranchCostSummaryLogic(tenantA, { from: FROM, to: today }, EVERY_BRANCH).then(
      (rows) => rows.find((r) => r.branchId === branchA)!
    );

  const view = async () => toBranchCostSummaryView(await summary());

  const setMethod = (method: "PERIODIC_INVENTORY" | "RECIPE_CONSUMPTION") =>
    withRlsBypass((tx) =>
      tx.tenant.update({
        where: { id: tenantA },
        data: { grossProfitMethod: method },
      })
    );

  const sell = async (businessDate: Date, qty: number, netAmount: number) => {
    await withRlsBypass(async (tx) => {
      const day = await tx.salesDay.upsert({
        where: { branchId_businessDate: { branchId: branchA, businessDate } },
        create: {
          tenantId: tenantA,
          branchId: branchA,
          businessDate,
          currentBatchId: batchId,
        },
        update: {},
        select: { id: true },
      });
      await tx.salesLine.create({
        data: {
          tenantId: tenantA,
          branchId: branchA,
          businessDate,
          salesDayId: day.id,
          importBatchId: batchId,
          menuId,
          qty,
          grossAmount: netAmount,
          discountAmount: 0,
          netAmount,
          serviceChargeAmount: 0,
          vatAmount: 0,
        },
      });
    });
  };

  const post = (businessDate: Date) =>
    postConsumptionForDayLogic(
      tenantA,
      {
        submitKey: randomUUID(),
        branchId: branchA,
        businessDate,
        acknowledgeRepost: false,
      },
      userA
    );

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Consumption GP Tenant" } });
      tenantA = t.id;
      const b = await tx.branch.create({
        data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" },
      });
      branchA = b.id;
      await tx.department.create({
        data: { tenantId: t.id, name: "Main", code: "MAIN" },
      });
      const u = await tx.user.create({
        data: { email: `gp-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;
      const integ = await tx.posIntegration.create({
        data: { tenantId: t.id, branchId: b.id, posType: "CUSTOM", name: "POS" },
        select: { id: true },
      });
      const prof = await tx.salesImportProfile.create({
        data: {
          tenantId: t.id,
          posIntegrationId: integ.id,
          name: "รายวัน",
          fileKind: "DAILY_SUMMARY",
          dateFormat: "yyyy-MM-dd",
          columnMap: {},
          headerSignature: "x",
          amountsIncludeVat: false,
          amountsIncludeServiceCharge: false,
        },
        select: { id: true },
      });
      const batch = await tx.salesImportBatch.create({
        data: {
          tenantId: t.id,
          branchId: b.id,
          posIntegrationId: integ.id,
          profileId: prof.id,
          status: "COMMITTED",
          fileName: "day.csv",
          uploadedBy: u.id,
          committedAt: new Date(),
        },
        select: { id: true },
      });
      batchId = batch.id;
      const menu = await tx.menu.create({
        data: { tenantId: t.id, source: "MISE", name: "กะเพราหมู" },
        select: { id: true },
      });
      menuId = menu.id;
    });

    const sup = await createSupplierLogic(
      tenantA,
      supplierInputSchema.parse({ nameFull: `ซัพ-${randomUUID().slice(0, 6)}` })
    );
    supplierA = sup.id;

    pork = await createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `GP-pork-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
      })
    );

    // 20 kg at a flat ฿100, received before the period so the layer is in place.
    const po = await createPurchaseOrderLogic(
      tenantA,
      purchaseOrderInputSchema.parse({
        branchId: branchA,
        supplierId: supplierA,
        expectedDeliveryDate: "",
        vatRatePercent: 0,
        notes: null,
        lines: [
          {
            productId: pork.id,
            orderUnitId: baseUnitOf(pork),
            qtyOrdered: 20,
            unitPrice: 100,
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
        branchId: branchA,
        supplierId: supplierA,
        purchaseOrderId: sent.id,
        invoiceNo: null,
        receivedAt: addDays(today, -20),
        notes: null,
        lines: [
          {
            purchaseOrderItemId: sent.items[0].id,
            productId: pork.id,
            receivedUnitId: baseUnitOf(pork),
            qtyReceivedActual: 20,
            unitPriceActual: 100,
            notes: null,
          },
        ],
      }),
      userA
    );
    await confirmGoodsReceiptLogic(tenantA, gr.id, userA);

    await createRecipeLogic(
      tenantA,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId,
        outputProductId: null,
        servings: 1,
        effectiveFrom: addDays(today, -60),
        ingredients: [
          {
            productId: pork.id,
            componentMenuId: null,
            qty: 1,
            productUnitId: baseUnitOf(pork),
            sortOrder: 0,
            notes: null,
          },
        ],
        notes: null,
      }),
      userA
    );

    // Two selling days, ฿200 a plate.
    await sell(D_A, 5, 1000);
    await sell(D_B, 3, 600);
    await setMethod("RECIPE_CONSUMPTION");
  }, 300_000);

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.stockMovement.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesConsumptionItem.deleteMany({
        where: { tenantId: tenantA, reversalOfItemId: { not: null } },
      });
      await tx.salesConsumptionItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesConsumptionRun.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesLine.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesDay.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportBatch.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportProfile.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeIngredient.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipe.deleteMany({ where: { tenantId: tenantA } });
      await tx.menu.deleteMany({ where: { tenantId: tenantA } });
      await tx.posIntegration.deleteMany({ where: { tenantId: tenantA } });
      await tx.expenseItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.expense.deleteMany({ where: { tenantId: tenantA } });
      await tx.goodsReceiptItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.goodsReceipt.deleteMany({ where: { tenantId: tenantA } });
      await tx.purchaseOrderItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.purchaseOrder.deleteMany({ where: { tenantId: tenantA } });
      await tx.supplierProductMapping.deleteMany({ where: { tenantId: tenantA } });
      await tx.supplier.deleteMany({ where: { tenantId: tenantA } });
      await tx.department.deleteMany({ where: { tenantId: tenantA } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId: tenantA } } });
      await tx.product.deleteMany({ where: { tenantId: tenantA } });
      await tx.category.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.deleteMany({ where: { id: tenantA } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
  }, 180_000);

  // ------------------------------------------------------------
  // Nothing posted
  // ------------------------------------------------------------

  it("G-01 with nothing posted the figure is '—', not zero", async () => {
    const s = await summary();
    expect(s.revenue?.toString()).toBe("1600");
    // 0.00 would read as "cost of goods sold was nothing", which is a different
    // claim from "nothing has been posted" (Q9).
    expect(s.cogsSold).toBeNull();
    expect(s.grossProfit).toBeNull();
    expect(s.consumptionDaysPosted).toBe(0);
    expect(s.salesDaysInPeriod).toBe(2);
  });

  it("G-02 and the note says what to do about it", async () => {
    const v = await view();
    expect(v.grossProfit).toBeNull();
    expect(v.grossProfitNote).toContain("ยังไม่ได้ตัดสต๊อก");
    expect(v.grossProfitNote).toContain("2 วัน");
  });

  // ------------------------------------------------------------
  // Rule N10 — a partly posted period prints its figure WITH its coverage
  // ------------------------------------------------------------

  it("G-03 one day posted gives a real figure, and the coverage that qualifies it", async () => {
    await post(D_A);

    const s = await summary();
    // 5 plates × 1 kg × ฿100.
    expect(s.cogsSold?.toString()).toBe("500");
    expect(s.grossProfit?.toString()).toBe("1100");
    expect(s.consumptionDaysPosted).toBe(1);
    expect(s.salesDaysInPeriod).toBe(2);
    // Coverage is MONEY (rule N3): ฿1,000 of ฿1,600.
    expect(s.consumptionCoveredNetAmount.toString()).toBe("1000");
  });

  it("G-04 the note prints the figure's coverage rather than hiding the figure", async () => {
    const v = await view();
    expect(v.consumptionCoveragePercent).toBe(62.5);
    expect(v.grossProfitNote).toContain("1 จาก 2 วัน");
    expect(v.grossProfitNote).toContain("62.5%");
    // And it says which way the error runs, because a partial figure always
    // flatters: the unposted days' cost is simply missing.
    expect(v.grossProfitNote).toContain("ดูดีเกินจริง");
  });

  it("G-05 posting the rest completes it, and the note stops apologising", async () => {
    await post(D_B);

    const s = await summary();
    expect(s.cogsSold?.toString()).toBe("800");
    expect(s.grossProfit?.toString()).toBe("800");
    expect(s.consumptionDaysPosted).toBe(2);

    const v = await view();
    expect(v.consumptionCoveragePercent).toBe(100);
    expect(v.grossProfitNote).toContain("ครบทุกวัน");
    expect(v.grossProfitNote).not.toContain("ดูดีเกินจริง");
  });

  // ------------------------------------------------------------
  // A voided day stops counting — which is why this is asked of the DOCUMENTS
  // ------------------------------------------------------------

  it("G-06 a day taken back by a re-import drops out of the cost entirely", async () => {
    await withTenantContext(tenantA, (tx) =>
      voidConsumptionForDayInTx(
        tx as never,
        tenantA,
        branchA,
        D_A,
        "RE_IMPORT",
        userA
      )
    );

    const s = await summary();
    // Only D_B's three plates remain posted. Summing CONSUMPTION movements by
    // date would still have counted D_A's five — its reversal is dated NOW and
    // would fall outside a past period — which is exactly why the figure is
    // taken from the runs that still stand.
    expect(s.cogsSold?.toString()).toBe("300");
    expect(s.grossProfit?.toString()).toBe("1300");
    expect(s.consumptionDaysPosted).toBe(1);
    expect(s.consumptionCoveredNetAmount.toString()).toBe("600");
  });

  it("G-07 re-posting the day counts it ONCE, not twice", async () => {
    await post(D_A);

    const s = await summary();
    // 500 + 300. The voided run's consumption and its reversal both belong to a
    // run that no longer stands, so neither is netted — they simply drop out.
    expect(s.cogsSold?.toString()).toBe("800");
    expect(s.consumptionDaysPosted).toBe(2);
  });

  // ------------------------------------------------------------
  // The other method is untouched
  // ------------------------------------------------------------

  it("G-08 นับสต๊อก still answers its own way, and ignores the postings", async () => {
    await setMethod("PERIODIC_INVENTORY");
    const s = await summary();

    // opening (20 kg × ฿100 = 2,000) + purchases in period (0) − closing.
    // Twelve kilos are left, so closing is ฿1,200 and cogsSold is ฿800 — the
    // same answer by a different road, because this fixture has no waste and no
    // count variance to make the two disagree.
    expect(s.cogsSold?.toString()).toBe("800");
    expect(s.grossProfitMethod).toBe("PERIODIC_INVENTORY");

    const v = await view();
    // The นับสต๊อก note this branch gets is the harsher one, and rightly: it has
    // never closed a count, so its closing inventory is a belief rather than a
    // measurement (ADR 0019's freshness rule). The สูตรอาหาร path never depends
    // on a count, which is the whole reason a shop chooses it.
    expect(v.grossProfitNote).toContain("ยังไม่เคยปิดการนับสต๊อก");
    await setMethod("RECIPE_CONSUMPTION");
  });
});
