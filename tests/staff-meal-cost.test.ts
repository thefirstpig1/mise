// ============================================================
// Mise — what a staff meal does to money (Sprint 5 Part 26 L3, ADR 0028)
// ============================================================
// The two defects ADR 0028's grill found, and neither of them was new code.
//
// `fifo-replay.ts` collects consumption by MOVEMENT type; `stock-cost.ts` read
// it back by SOURCE type. While `CONSUMPTION` had exactly one source that gap
// could not show. `STAFF_MEAL` is the second, and it lands on both sides:
//
//   C1 — the reversal lookup. Without it a voided meal returns its stock at
//        LAST-KNOWN cost instead of the cost it left at, so voiding one after a
//        price rise conjures inventory value out of nothing. This is exactly
//        what ADR 0022 Q6 built CONSUMPTION_REVERSAL to prevent.
//
//   C2 — cost of goods SOLD. A staff meal must not be in it: nobody sold it.
//        That was already true before Part 26 — by accident, because the id was
//        looked up in sales_consumption_item and not found. Right answer, no
//        rule. C2 is the rule.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { EVERY_BRANCH } from "./support/reach";
import { randomUUID } from "node:crypto";
import { withRlsBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { recipeInputSchema } from "@/lib/validations/recipe";
import { createRecipeLogic } from "@/server/recipe";
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
import { getProductCostLogic, getBranchCostSummaryLogic } from "@/server/stock-cost";
import { postConsumptionForDayLogic } from "@/server/consumption-post";
import { createStaffMealInputSchema } from "@/lib/validations/staff-meal";
import {
  createStaffMealLogic,
  createStaffMemberLogic,
  voidStaffMealLogic,
} from "@/server/staff-meal";

describe("staff meal — money (ADR 0028 Consequences 1 & 2)", () => {
  let tenantA: string;
  let userA: string;
  let branchA: string;
  let supplierA: string;
  let batchId: string;
  let somchai: string;

  let pork: ProductWithUnits;
  let kaphrao: { id: string; name: string };

  const today = computeBangkokToday();
  const RECIPES_FROM = addDays(today, -60);
  const RECEIVED_EARLY = addDays(today, -30);
  const SALES_DAY = addDays(today, -2);

  const baseUnitOf = (p: ProductWithUnits) =>
    p.productUnits.find((u) => u.isBase)!.id;

  const receive = async (qty: number, pricePerUnit: number, at: Date) => {
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
            qtyOrdered: qty,
            unitPrice: pricePerUnit,
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
        receivedAt: at,
        notes: null,
        lines: [
          {
            purchaseOrderItemId: sent.items[0].id,
            productId: pork.id,
            receivedUnitId: baseUnitOf(pork),
            qtyReceivedActual: qty,
            unitPriceActual: pricePerUnit,
            notes: null,
          },
        ],
      }),
      userA
    );
    await confirmGoodsReceiptLogic(tenantA, gr.id, userA);
  };

  const inventoryValue = () =>
    getProductCostLogic(tenantA, {
      productId: pork.id,
      branchId: branchA,
      asOf: undefined,
    }).then((c) => c.inventoryValue.toString());

  /** A pot, so the quantity is exactly what the test asks for. */
  const eatRaw = (kg: number) =>
    createStaffMealLogic(
      tenantA,
      createStaffMealInputSchema.parse({
        submitKey: randomUUID(),
        branchId: branchA,
        businessDate: today,
        staffMemberId: somchai,
        menuId: "",
        servings: 1,
        items: [{ productId: pork.id, inputQty: kg, inputUnitId: baseUnitOf(pork) }],
        recordedByName: "",
        notes: "",
      }),
      userA
    );

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({
        data: { name: "Staff Meal Cost Tenant", grossProfitMethod: "RECIPE_CONSUMPTION" },
      });
      tenantA = t.id;
      const b = await tx.branch.create({
        data: { tenantId: t.id, name: "ทองหล่อ", code: "SMC" },
      });
      branchA = b.id;
      await tx.department.create({
        data: { tenantId: t.id, name: "Main", code: "MAIN" },
      });
      const u = await tx.user.create({
        data: { email: `smc-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;
      const sup = await tx.supplier.create({
        data: { tenantId: t.id, nameFull: "เจ้าประจำ", code: "SUP1" },
      });
      supplierA = sup.id;

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
    });

    pork = await createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `SMC-pork-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
      })
    );

    kaphrao = await withRlsBypass((tx) =>
      tx.menu.create({
        data: {
          tenantId: tenantA,
          source: "MISE",
          name: `กะเพรา-${randomUUID().slice(0, 4)}`,
        },
        select: { id: true, name: true },
      })
    );

    await createRecipeLogic(
      tenantA,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId: kaphrao.id,
        outputProductId: null,
        servings: 1,
        effectiveFrom: RECIPES_FROM,
        ingredients: [
          {
            productId: pork.id,
            componentMenuId: null,
            qty: 0.1,
            productUnitId: baseUnitOf(pork),
            sortOrder: 0,
            notes: null,
          },
        ],
        notes: null,
      }),
      userA
    );

    somchai = (
      await createStaffMemberLogic(tenantA, {
        name: "สมชาย",
        branchId: branchA,
        dailyQuotaAmount: null,
      })
    ).id;

    // ONE layer to begin with: 10 kg at ฿100.
    await receive(10, 100, RECEIVED_EARLY);
  }, 300_000);

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.stockMovement.deleteMany({ where: { tenantId: tenantA } });
      await tx.staffMealItem.deleteMany({
        where: { tenantId: tenantA, reversalOfItemId: { not: null } },
      });
      await tx.staffMealItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.staffMeal.deleteMany({ where: { tenantId: tenantA } });
      await tx.staffMember.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesConsumptionItem.deleteMany({
        where: { tenantId: tenantA, reversalOfItemId: { not: null } },
      });
      await tx.salesConsumptionItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesConsumptionRun.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesLine.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesDay.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportBatch.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportProfile.deleteMany({ where: { tenantId: tenantA } });
      await tx.posIntegration.deleteMany({ where: { tenantId: tenantA } });
      await tx.expenseItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.expense.deleteMany({ where: { tenantId: tenantA } });
      await tx.goodsReceiptItemAllocation.deleteMany({ where: { tenantId: tenantA } });
      await tx.goodsReceiptItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.goodsReceipt.deleteMany({ where: { tenantId: tenantA } });
      await tx.purchaseOrderItemAllocation.deleteMany({ where: { tenantId: tenantA } });
      await tx.purchaseOrderItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.purchaseOrder.deleteMany({ where: { tenantId: tenantA } });
      await tx.department.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeIngredient.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeBranch.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipe.deleteMany({ where: { tenantId: tenantA } });
      await tx.menu.deleteMany({ where: { tenantId: tenantA } });
      await tx.supplier.deleteMany({ where: { tenantId: tenantA } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId: tenantA } } });
      await tx.product.deleteMany({ where: { tenantId: tenantA } });
      await tx.category.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.delete({ where: { id: tenantA } });
      await tx.user.delete({ where: { id: userA } });
    });
  }, 300_000);

  // ----------------------------------------------------------
  // C1 — the reversal returns what it took, at what it took it for
  // ----------------------------------------------------------

  it("C1: voiding a meal gives back the value it took, not today's price", async () => {
    // 10 kg at ฿100 = ฿1,000.
    expect(await inventoryValue()).toBe("1000");

    const meal = await eatRaw(2);
    // FIFO takes 2 kg out of the ฿100 layer: ฿200 leaves.
    expect(await inventoryValue()).toBe("800");

    // The price goes UP. This is the whole point: after this, "last known" and
    // "what it actually cost" are different numbers, and only one of them is
    // allowed to come back.
    await receive(10, 200, addDays(today, -1));
    expect(await inventoryValue()).toBe("2800");

    await voidStaffMealLogic(
      tenantA,
      { id: meal.id, voidReason: "บันทึกผิด" },
      userA
    );

    // ฿200 back — the money that left with the meal.
    //
    // If stock-cost.ts could not resolve reversal_of_item_id for a STAFF_MEAL
    // source (which it could not before this Part), the walk would fall through
    // to lastKnownUnitCost = ฿200/kg and credit ฿400, landing on 3200: ฿200 of
    // inventory value conjured by voiding a form.
    expect(await inventoryValue()).toBe("3000");
  });

  // ----------------------------------------------------------
  // C2 — a staff meal is not cost of goods SOLD
  // ----------------------------------------------------------

  it("C2: a staff meal stays out of cogsSold, by rule and not by a query missing", async () => {
    // A real sale on its own day, posted. 5 plates × 100 g = 0.5 kg.
    await withRlsBypass(async (tx) => {
      const day = await tx.salesDay.create({
        data: {
          tenantId: tenantA,
          branchId: branchA,
          businessDate: SALES_DAY,
          currentBatchId: batchId,
        },
        select: { id: true },
      });
      await tx.salesLine.create({
        data: {
          tenantId: tenantA,
          branchId: branchA,
          businessDate: SALES_DAY,
          salesDayId: day.id,
          importBatchId: batchId,
          menuId: kaphrao.id,
          qty: 5,
          grossAmount: 500,
          discountAmount: 0,
          netAmount: 500,
          serviceChargeAmount: 0,
          vatAmount: 0,
        },
      });
    });

    await postConsumptionForDayLogic(
      tenantA,
      {
        submitKey: randomUUID(),
        branchId: branchA,
        businessDate: SALES_DAY,
        acknowledgeRepost: false,
      },
      userA
    );

    const period = {
      from: addDays(today, -40),
      to: today,
      branchId: undefined,
    };

    const before = await getBranchCostSummaryLogic(tenantA, period as never, EVERY_BRANCH);
    const soldOnly = before.find((b) => b.branchId === branchA)!.cogsSold;
    expect(soldOnly).not.toBeNull();

    // Now eat 3 kg of the same pork as staff. That is thirty times the sale, so
    // if it leaked into cogsSold there would be no mistaking it.
    await eatRaw(3);

    const after = await getBranchCostSummaryLogic(tenantA, period as never, EVERY_BRANCH);
    const row = after.find((b) => b.branchId === branchA)!;

    // Cost of goods SOLD is unmoved: nobody sold the staff their lunch.
    expect(row.cogsSold!.toString()).toBe(soldOnly!.toString());
    // And gross profit with it — revenue was untouched too.
    expect(row.grossProfit!.toString()).toBe(
      before.find((b) => b.branchId === branchA)!.grossProfit!.toString()
    );

    // The stock really did leave, though. This is the pair that discriminates:
    // a filter that dropped the movements entirely would pass the line above
    // and fail this one.
    expect(Number(await inventoryValue())).toBeLessThan(3000);

    // And the walk LABELS it, which is the half that can be broken on its own.
    // The assertion above is right today even with no rule at all — the id is
    // simply not found in sales_consumption_item — so on its own it proves
    // nothing about intent. This one fails the moment the walk stops saying
    // which document a consumption came from, which is what turns the
    // exclusion above from an accident into a decision.
    const cost = await getProductCostLogic(tenantA, {
      productId: pork.id,
      branchId: branchA,
      asOf: undefined,
    });
    const kinds = new Set(cost.consumptionMoves.map((m) => m.sourceType));
    expect(kinds.has("STAFF_MEAL")).toBe(true);
    expect(kinds.has("SALES_CONSUMPTION")).toBe(true);
  });
});
