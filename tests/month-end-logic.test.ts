// ============================================================
// คิดครัว — the month-end close, against the database (Kong 2026-10-29)
// ============================================================
// Rules ME1–ME6 (docs/calculation-rules.md), through the real write paths:
// a purchase order received and confirmed (which writes the bill), a
// transfer, a waste log and an adjustment. A hand-built ledger row would
// prove the test right rather than the code.
//
// The shop is NOT VAT-registered on purpose: its stock carries the 7% it
// cannot reclaim, which is exactly where purchases-net-of-VAT would leave a
// month of deliveries with no cooking showing a NEGATIVE cost (ME2).
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass, prismaBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { supplierInputSchema } from "@/lib/validations/supplier";
import { createSupplierLogic } from "@/server/supplier";
import { purchaseOrderInputSchema } from "@/lib/validations/purchase-order";
import { createPurchaseOrderLogic, sendPurchaseOrderLogic } from "@/server/purchase-order";
import { goodsReceiptInputSchema } from "@/lib/validations/goods-receipt";
import { confirmGoodsReceiptLogic, createGoodsReceiptLogic } from "@/server/goods-receipt";
import { createStockAdjustmentLogic } from "@/server/stock-movement";
import { createStockAdjustmentInputSchema } from "@/lib/validations/stock-movement";
import { createWasteLogic } from "@/server/waste";
import { createWasteInputSchema } from "@/lib/validations/waste";
import { dispatchTransferLogic } from "@/server/transfer";
import { dispatchTransferInputSchema } from "@/lib/validations/transfer";
import { getMonthEndLogic, lastClosedMonth, monthBounds, type MonthEndBranch } from "@/server/month-end";
import { getBranchCostSummaryLogic, latestCountedMonthLogic } from "@/server/stock-cost";
import { monthEndCountDueLogic } from "@/server/stock-count";
import { getAccountingExportSettingsLogic, saveAccountingExportSettingsLogic } from "@/server/accounting-export-settings";
import { sweepTestTenants } from "./support/sweep";
import { EVERY_BRANCH, onlyBranches } from "./support/reach";

const cents = (n: number) => Math.round(n * 100);

describe("month-end close (rules ME1–ME6)", () => {
  let tenant: string;
  let thonglor: string;
  let ari: string;
  let user: string;
  let supplier: string;
  let rice: ProductWithUnits;

  // Last month and the one before, so every date sits inside the 90-day backdate window.
  const month = lastClosedMonth(computeBangkokToday());
  const [y, m] = month.split("-").map(Number);
  const prevMonth = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
  /** Noon Bangkok on day `d` of `ym` — far from either midnight. */
  const on = (ym: string, d: number) => {
    const [yy, mm] = ym.split("-").map(Number);
    return new Date(Date.UTC(yy, mm - 1, d, 5));
  };

  const unitOf = (p: ProductWithUnits, name: string) => p.productUnits.find((u) => u.unitName === name)!.id;

  const receive = async (branchId: string, sacks: number, pricePerSack: number, at: Date) => {
    const po = await createPurchaseOrderLogic(
      tenant,
      purchaseOrderInputSchema.parse({
        branchId,
        supplierId: supplier,
        expectedDeliveryDate: "",
        vatRatePercent: 7,
        notes: null,
        lines: [
          {
            productId: rice.id,
            orderUnitId: unitOf(rice, "กระสอบ"),
            qtyOrdered: sacks,
            unitPrice: pricePerSack,
            supplierProductMappingId: null,
            notes: null,
          },
        ],
      }),
      user
    );
    const sent = await sendPurchaseOrderLogic(tenant, po.id, user);
    const gr = await createGoodsReceiptLogic(
      tenant,
      goodsReceiptInputSchema.parse({
        submitKey: randomUUID(),
        branchId,
        supplierId: supplier,
        purchaseOrderId: sent.id,
        invoiceNo: null,
        receivedAt: at,
        // The tax invoice that came with the delivery: 7% on top (ADR 0016 Q2).
        vatRatePercent: 7,
        notes: null,
        lines: [
          {
            purchaseOrderItemId: sent.items[0].id,
            productId: rice.id,
            receivedUnitId: unitOf(rice, "กระสอบ"),
            qtyReceivedActual: sacks,
            unitPriceActual: pricePerSack,
            notes: null,
          },
        ],
      }),
      user
    );
    return confirmGoodsReceiptLogic(tenant, gr.id, user);
  };

  let sep: { thonglor: MonthEndBranch; ari: MonthEndBranch };

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Month-end Test" } });
      tenant = t.id;
      const [a, b] = await Promise.all([
        tx.branch.create({ data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" } }),
        tx.branch.create({ data: { tenantId: t.id, name: "อารีย์", code: "ARY" } }),
      ]);
      thonglor = a.id;
      ari = b.id;
      await tx.department.create({ data: { tenantId: t.id, name: "Main", code: "MAIN" } });
      user = (await tx.user.create({ data: { email: `month-end-${randomUUID()}@example.com`, name: "ผู้ทดสอบ" } })).id;
    });
    supplier = (await createSupplierLogic(tenant, supplierInputSchema.parse({ nameFull: "ร้านข้าวสาร" }))).id;
    rice = await createProductLogic(
      tenant,
      productInputSchema.parse({
        name: `ข้าว-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [{ unitName: "กระสอบ", toBaseRatio: 25 }],
        defaultBuyUnitName: "กระสอบ",
      })
    );

    // Previous month: 2 sacks at ฿1,000 + 7% the shop cannot reclaim → ฿2,140 of stock, nothing used.
    await receive(thonglor, 2, 1000, on(prevMonth, 20));
    // This month: 1 sack at ฿1,200 (+7% = ฿1,284), then 10 kg sent to อารีย์,
    // 5 kg thrown away with a waste log, 3 kg found missing.
    await receive(thonglor, 1, 1200, on(month, 5));
    await dispatchTransferLogic(
      tenant,
      dispatchTransferInputSchema.parse({
        submitKey: randomUUID(),
        fromBranchId: thonglor,
        toBranchId: ari,
        dispatchedAt: on(month, 10),
        dispatchedByName: null,
        driverName: null,
        driverConfirmed: false,
        notes: null,
        lines: [{ productId: rice.id, qtySent: 10, inputUnitId: unitOf(rice, "kg"), notes: null }],
      }),
      user
    );
    await createWasteLogic(
      tenant,
      createWasteInputSchema.parse({
        submitKey: randomUUID(),
        productId: rice.id,
        branchId: thonglor,
        reason: "SPOILED",
        inputQty: 5,
        inputUnitId: unitOf(rice, "kg"),
        occurredAt: on(month, 12),
        wastedByName: null,
        notes: null,
      }),
      user
    );
    await createStockAdjustmentLogic(
      tenant,
      createStockAdjustmentInputSchema.parse({
        submitKey: randomUUID(),
        productId: rice.id,
        branchId: thonglor,
        type: "ADJUST_LOSS",
        reason: "SPOILAGE",
        inputQty: 3,
        inputUnitId: unitOf(rice, "kg"),
        occurredAt: on(month, 15),
        notes: null,
      }),
      user
    );

    const close = await getMonthEndLogic(tenant, month, EVERY_BRANCH, { withBills: true });
    sep = {
      thonglor: close!.branches.find((b) => b.branchId === thonglor)!,
      ari: close!.branches.find((b) => b.branchId === ari)!,
    };
  }, 120_000);

  // The sweep walks every tenant-scoped table; under a full parallel run it
  // passed the default 10 s (2026-10-30), as the other ledger specs' do.
  afterAll(async () => {
    await sweepTestTenants(prismaBypass, { ids: [tenant] });
  }, 180_000);

  it("ME2 a month of deliveries with nothing used costs nothing — purchases carry the VAT the stock carries", async () => {
    const prev = await getMonthEndLogic(tenant, prevMonth, EVERY_BRANCH);
    const t = prev!.branches.find((b) => b.branchId === thonglor)!;
    expect(t.purchases).toBe(2140);
    expect(t.closing).toBe(2140);
    expect(t.cogs).toBe(0);
  });

  it("ME2 on /cost: a shop that cannot reclaim VAT does not see it as profit (นับสต๊อก gross profit, Kong 2026-10-29)", async () => {
    // A day of sales last month, so the summary prints a gross profit at all.
    await withRlsBypass(async (tx) => {
      const integ = await tx.posIntegration.create({ data: { tenantId: tenant, branchId: thonglor, posType: "CUSTOM", name: "POS" }, select: { id: true } });
      const prof = await tx.salesImportProfile.create({
        data: {
          tenantId: tenant,
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
        data: { tenantId: tenant, branchId: thonglor, posIntegrationId: integ.id, profileId: prof.id, status: "COMMITTED", fileName: "day.csv", uploadedBy: user, committedAt: new Date() },
        select: { id: true },
      });
      const menu = await tx.menu.create({ data: { tenantId: tenant, source: "MISE", name: "ข้าวผัด" }, select: { id: true } });
      const businessDate = monthBounds(prevMonth).to;
      const day = await tx.salesDay.create({ data: { tenantId: tenant, branchId: thonglor, businessDate, currentBatchId: batch.id }, select: { id: true } });
      await tx.salesLine.create({
        data: {
          tenantId: tenant,
          branchId: thonglor,
          businessDate,
          salesDayId: day.id,
          importBatchId: batch.id,
          menuId: menu.id,
          qty: 10,
          grossAmount: 500,
          discountAmount: 0,
          netAmount: 500,
          serviceChargeAmount: 0,
          vatAmount: 0,
        },
      });
      // Rule PG1: นับสต๊อก answers only for a period whose opening was counted.
      // The shelf was empty the day before and somebody looked — no variance,
      // so no movement; only the fact of the count.
      const before = new Date(on(prevMonth, 1).getTime() - 86_400_000);
      const sc = await tx.stockCount.create({
        data: { tenantId: tenant, branchId: thonglor, scNumber: "THL-SC-9001", countDate: before, status: "CLOSED", startedBy: user, closedAt: before, closedBy: user },
        select: { id: true },
      });
      await tx.stockCountItem.create({
        data: { tenantId: tenant, stockCountId: sc.id, productId: rice.id, lineNo: 1, qtyCounted: 0, qtyExpected: 0, countedAt: before, countedBy: user },
      });
      // Rule PG2: and its end — the month's last day, 50 kg on the shelf, as the ledger says.
      const last = monthBounds(prevMonth).to;
      const close = await tx.stockCount.create({
        data: { tenantId: tenant, branchId: thonglor, scNumber: "THL-SC-9002", countDate: last, status: "CLOSED", startedBy: user, closedAt: last, closedBy: user },
        select: { id: true },
      });
      await tx.stockCountItem.create({
        data: { tenantId: tenant, stockCountId: close.id, productId: rice.id, lineNo: 1, qtyCounted: 50, qtyExpected: 50, countedAt: last, countedBy: user },
      });
    });
    const rows = await getBranchCostSummaryLogic(tenant, monthBounds(prevMonth), EVERY_BRANCH);
    const t = rows.find((r) => r.branchId === thonglor)!;
    expect(t.grossProfitMethod).toBe("PERIODIC_INVENTORY");
    expect(t.grossProfitBlocker).toBeNull();
    expect(Number(t.cogsSpend)).toBe(2000); // spend before tax — unchanged (H8)
    expect(Number(t.purchasesAtCost)).toBe(2140); // what the stock carries
    // Nothing was used: cost of sales is 0, not −140, and gross profit is the whole ฿500.
    expect(Number(t.cogsSold)).toBe(0);
    expect(Number(t.grossProfit)).toBe(500);
  });

  it("PG2 fallback: the dashboard names the latest month counted at both ends — and only while both counts stand", async () => {
    // Ari sold nothing that month, so only Thonglor needs its two counts.
    const m = await latestCountedMonthLogic(tenant, EVERY_BRANCH);
    expect(m).toEqual(monthBounds(prevMonth));

    // The closing count moved nine days before the month's last day no longer closes it.
    const last = monthBounds(prevMonth).to;
    const where = { tenantId: tenant, stockCount: { scNumber: "THL-SC-9002" } };
    await withRlsBypass((tx) => tx.stockCountItem.updateMany({ where, data: { countedAt: addDays(last, -9) } }));
    try {
      expect(await latestCountedMonthLogic(tenant, EVERY_BRANCH)).toBeNull();
    } finally {
      await withRlsBypass((tx) => tx.stockCountItem.updateMany({ where, data: { countedAt: last } }));
    }
  });

  it("PG2 reminder: the month's last two days name the branches still to count, and no other day does", async () => {
    const last = monthBounds(prevMonth).to;
    // Thonglor counted on the last day; Ari never did.
    const onLast = await monthEndCountDueLogic(tenant, EVERY_BRANCH, last);
    expect(onLast?.lastDay).toEqual(last);
    expect(onLast?.branches.map((b) => b.id)).toEqual([ari]);
    expect((await monthEndCountDueLogic(tenant, EVERY_BRANCH, addDays(last, -1)))?.branches.map((b) => b.id)).toEqual([ari]);
    expect(await monthEndCountDueLogic(tenant, EVERY_BRANCH, addDays(last, -2))).toBeNull();
  });

  it("ME1 this month's opening stock is last month's closing, to the satang", async () => {
    const prev = await getMonthEndLogic(tenant, prevMonth, EVERY_BRANCH);
    expect(sep.thonglor.opening).toBe(prev!.branches.find((b) => b.branchId === thonglor)!.closing);
    expect(sep.thonglor.opening).toBe(2140);
  });

  it("ME4 a transfer leaves one branch and arrives at the other at the same money, so the shop's total nets to nothing", () => {
    // FIFO: the 10 kg come out of the ฿42.80/kg layer.
    expect(sep.thonglor.transfersOut).toBe(428);
    expect(sep.ari.transfersIn).toBe(428);
    expect(sep.thonglor.transfersIn).toBe(0);
    expect(sep.ari.transfersOut).toBe(0);
  });

  it("ME3 every branch ties: opening + purchases + in − out − closing = cost, and the parts sum to the cost", () => {
    for (const b of [sep.thonglor, sep.ari]) {
      expect(cents(b.opening) + cents(b.purchases) + cents(b.transfersIn) - cents(b.transfersOut) - cents(b.closing)).toBe(cents(b.cogs));
      expect(cents(b.sold ?? 0) + cents(b.waste) + cents(b.staffMeals) + cents(b.shortage) + cents(b.other)).toBe(cents(b.cogs));
    }
    // ทองหล่อ: 2,140 + 1,284 − 428 − closing; what left was the waste (5 kg) and the shortage (3 kg).
    expect(sep.thonglor.purchases).toBe(1284);
    expect(sep.thonglor.waste).toBe(214);
    expect(sep.thonglor.shortage).toBe(128.4);
    expect(sep.thonglor.closing).toBe(2653.6);
    expect(sep.thonglor.cogs).toBe(342.4);
    expect(sep.thonglor.other).toBe(0);
    expect(sep.ari.cogs).toBe(0);
  });

  it("lists closing stock product by product, and the list adds up to the closing value", async () => {
    const close = await getMonthEndLogic(tenant, month, EVERY_BRANCH);
    const total = close!.stock.reduce((s, r) => s + cents(r.value), 0);
    expect(total).toBe(cents(sep.thonglor.closing) + cents(sep.ari.closing));
    expect(close!.stock.map((r) => r.branchName).sort()).toEqual(["ทองหล่อ", "อารีย์"]);
    expect(close!.stock.every((r) => r.unitName === "kg")).toBe(true);
  });

  it("carries the month's bills for the accountant", async () => {
    const close = await getMonthEndLogic(tenant, month, EVERY_BRANCH, { withBills: true });
    expect(close!.billCount).toBe(1);
    expect(close!.bills[0]).toMatchObject({ supplierName: "ร้านข้าวสาร", subtotal: 1200, vat: 84, total: 1284, kind: "วัตถุดิบ", paid: false });
  });

  it("ME6 someone who runs one branch sees, and exports, that branch alone", async () => {
    const close = await getMonthEndLogic(tenant, month, onlyBranches(ari));
    expect(close!.branches.map((b) => b.branchId)).toEqual([ari]);
    expect(close!.stock.every((r) => r.branchName === "อารีย์")).toBe(true);
    expect(close!.billCount).toBe(0);
  });

  it("ME1 holds under the recipe method too — the cost summary skips opening stock there, the close must not", async () => {
    await withRlsBypass((tx) => tx.tenant.update({ where: { id: tenant }, data: { grossProfitMethod: "RECIPE_CONSUMPTION" } }));
    try {
      const close = await getMonthEndLogic(tenant, month, EVERY_BRANCH);
      expect(close!.branches.find((b) => b.branchId === thonglor)!.opening).toBe(2140);
    } finally {
      await withRlsBypass((tx) => tx.tenant.update({ where: { id: tenant }, data: { grossProfitMethod: "PERIODIC_INVENTORY" } }));
    }
  });

  it("the shop's export choices are saved into tenant.settings without disturbing anything else there", async () => {
    await withRlsBypass((tx) => tx.tenant.update({ where: { id: tenant }, data: { settings: { someoneElse: 1 } } }));
    expect((await getAccountingExportSettingsLogic(tenant)).program).toBe("excel");
    const saved = await saveAccountingExportSettingsLogic(tenant, { program: "peak", accounts: { inventory: { code: "113101" } } });
    expect(saved.accounts.inventory).toEqual({ code: "113101", name: "สินค้าคงเหลือ-วัตถุดิบ" });
    expect(saved.accounts.cogs).toEqual({ code: "", name: "ต้นทุนขาย" });
    expect((await getAccountingExportSettingsLogic(tenant)).program).toBe("peak");
    const row = await withRlsBypass((tx) => tx.tenant.findUniqueOrThrow({ where: { id: tenant }, select: { settings: true } }));
    expect((row.settings as Record<string, unknown>).someoneElse).toBe(1);
  });

  it("a month before anything happened is empty, not an error", async () => {
    const early = await getMonthEndLogic(tenant, "2020-01", EVERY_BRANCH);
    expect(early!.branches.every((b) => b.opening === 0 && b.closing === 0 && b.cogs === 0)).toBe(true);
    expect(addDays(early!.to, 1).getUTCDate()).toBe(1);
  });
});
