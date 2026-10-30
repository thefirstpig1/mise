// ============================================================
// ระบบตัดตามสูตร เทียบกับที่ใช้ไปจริงตามการนับ (Kong 2026-10-31)
// ============================================================
// The rules (docs/calculation-rules.md AC1–AC6):
//   AC1 the window is the ledger's: recipe movements WRITTEN between the
//       product's previous count line and this one — so a day posted after a
//       count belongs to the next window, and a first count is measured only
//       when something came in before it (the baseline)
//   AC2 deducted = sales + staff meals + production inputs, reversals netted
//   AC3 gap % = (used − deducted) ÷ deducted, used = deducted − variance
//   AC4 money: a shortfall is the count's own FIFO loss; baht for cost readers only
//   AC5 a product the recipes never took is not measured, only counted
//   AC6 the combined view sums per product before dividing, so a count closed
//       before its sales were posted and the next count's mirror image cancel
//
// The story below: pork and beer are bought, basil never is. Day 1 sells; the
// first count finds pork 0.2 kg and beer 2 bottles short. Day 3 sells and is
// posted; day 4 sells but is posted only AFTER the second count closes, so the
// second count reads day 4's kilo as missing and the third finds it again.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prismaBypass, withRlsBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { recipeInputSchema } from "@/lib/validations/recipe";
import { createRecipeLogic } from "@/server/recipe";
import { goodsReceiptInputSchema } from "@/lib/validations/goods-receipt";
import { confirmGoodsReceiptLogic, createGoodsReceiptLogic } from "@/server/goods-receipt";
import { closeStockCountInputSchema, openStockCountInputSchema, saveStockCountLineInputSchema } from "@/lib/validations/stock-count";
import { closeStockCountLogic, openStockCountLogic, saveStockCountLineLogic } from "@/server/stock-count";
import { postConsumptionForDayLogic } from "@/server/consumption-post";
import {
  getCountSalesReadinessLogic,
  getDeductionAccuracyDetailLogic,
  getDeductionAccuracyLogic,
  type AccuracyOverview,
  type AccuracyView,
  type CountSalesReadiness,
} from "@/server/deduction-accuracy";
import { sweepTestTenants } from "./support/sweep";

describe("deduction accuracy", () => {
  let tenant: string;
  let branch: string;
  let user: string;
  let supplierId: string;
  let batchId: string;
  let pork: ProductWithUnits;
  let beer: ProductWithUnits;
  let basil: ProductWithUnits;
  let salt: ProductWithUnits;
  let kaphrao: string;
  let beerMenu: string;

  const ALL = { allBranches: true, allowedBranchIds: [] as string[] };
  const today = computeBangkokToday();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const D1 = addDays(today, -6);
  const C1 = addDays(today, -5);
  const D3 = addDays(today, -4);
  const D4 = addDays(today, -3);
  const C2 = addDays(today, -2);
  const C3 = addDays(today, -1);

  let money: AccuracyOverview;
  let plain: AccuracyOverview;
  let readiness: CountSalesReadiness | null;
  const countIds: string[] = [];

  const base = (p: ProductWithUnits) => p.productUnits.find((u) => u.isBase)!.id;
  const product = (tag: string, dim: "WEIGHT" | "COUNT", unit: string) =>
    createProductLogic(
      tenant,
      productInputSchema.parse({ name: `ACC-${tag}-${randomUUID().slice(0, 6)}`, primaryDimension: dim, baseUnitName: unit, additionalUnits: [], defaultBuyUnitName: unit })
    );
  const menu = (name: string) =>
    withRlsBypass((tx) => tx.menu.create({ data: { tenantId: tenant, source: "MISE", name: `${name}-${randomUUID().slice(0, 4)}` }, select: { id: true } })).then((m) => m.id);
  const recipe = (menuId: string, lines: [ProductWithUnits, number][]) =>
    createRecipeLogic(
      tenant,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId,
        outputProductId: null,
        servings: 1,
        effectiveFrom: addDays(today, -60),
        ingredients: lines.map(([p, qty], i) => ({ productId: p.id, componentMenuId: null, qty, productUnitId: base(p), sortOrder: i, notes: null })),
        notes: null,
      }),
      user
    );
  const receive = async (p: ProductWithUnits, qty: number, price: number) => {
    const gr = await createGoodsReceiptLogic(
      tenant,
      goodsReceiptInputSchema.parse({
        submitKey: randomUUID(),
        branchId: branch,
        supplierId,
        purchaseOrderId: null,
        invoiceNo: null,
        receivedAt: addDays(today, -10),
        notes: null,
        lines: [{ purchaseOrderItemId: null, productId: p.id, receivedUnitId: base(p), qtyReceivedActual: qty, unitPriceActual: price, notes: null }],
      }),
      user
    );
    await confirmGoodsReceiptLogic(tenant, gr.id, user);
  };
  const sell = (businessDate: Date, menuId: string, qty: number) =>
    withRlsBypass(async (tx) => {
      const day = await tx.salesDay.upsert({
        where: { branchId_businessDate: { branchId: branch, businessDate } },
        create: { tenantId: tenant, branchId: branch, businessDate, currentBatchId: batchId },
        update: {},
        select: { id: true },
      });
      await tx.salesLine.create({
        data: {
          tenantId: tenant,
          branchId: branch,
          businessDate,
          salesDayId: day.id,
          importBatchId: batchId,
          menuId,
          qty,
          grossAmount: qty * 50,
          discountAmount: 0,
          netAmount: qty * 50,
          serviceChargeAmount: 0,
          vatAmount: 0,
        },
      });
    });
  const post = (businessDate: Date) =>
    postConsumptionForDayLogic(tenant, { submitKey: randomUUID(), branchId: branch, businessDate, acknowledgeRepost: false }, user);
  const openCount = async (countDate: Date, lines: [ProductWithUnits, number][]) => {
    const id = (await openStockCountLogic(tenant, openStockCountInputSchema.parse({ branchId: branch, countDate: iso(countDate), showExpected: true, notes: null }), user)).id;
    for (const [p, qty] of lines) {
      await saveStockCountLineLogic(
        tenant,
        saveStockCountLineInputSchema.parse({ stockCountId: id, productId: p.id, mode: "new", entries: [{ productUnitId: base(p), qtyInUnit: qty }], notes: null }),
        { userId: user, canCloseAny: true, reach: ALL }
      );
    }
    countIds.push(id);
    return id;
  };
  const close = (id: string) => closeStockCountLogic(tenant, closeStockCountInputSchema.parse({ id, prices: [] }), { userId: user, canCloseAny: true, reach: ALL });
  const lineOf = (v: AccuracyView, p: ProductWithUnits) => v.lines.find((l) => l.productId === p.id);

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      tenant = (await tx.tenant.create({ data: { name: "Deduction Accuracy Test" } })).id;
      branch = (await tx.branch.create({ data: { tenantId: tenant, name: "อารีย์", code: "ARY" } })).id;
      user = (await tx.user.create({ data: { email: `accuracy-${randomUUID()}@example.com`, name: "เจ้าของ" } })).id;
      supplierId = (await tx.supplier.create({ data: { tenantId: tenant, code: "S1", nameFull: "ตลาดสด" } })).id;
      await tx.department.create({ data: { tenantId: tenant, name: "ครัว", code: "MAIN" } });
      const integ = await tx.posIntegration.create({ data: { tenantId: tenant, branchId: branch, posType: "CUSTOM", name: "POS" }, select: { id: true } });
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
      batchId = (
        await tx.salesImportBatch.create({
          data: { tenantId: tenant, branchId: branch, posIntegrationId: integ.id, profileId: prof.id, status: "COMMITTED", fileName: "day.csv", uploadedBy: user, committedAt: new Date() },
          select: { id: true },
        })
      ).id;
    });
    pork = await product("pork", "WEIGHT", "kg");
    beer = await product("beer", "COUNT", "ขวด");
    basil = await product("basil", "WEIGHT", "kg");
    salt = await product("salt", "WEIGHT", "kg");
    kaphrao = await menu("กะเพราหมู");
    beerMenu = await menu("เบียร์");
    await recipe(kaphrao, [
      [pork, 0.1],
      [basil, 0.02],
    ]);
    await recipe(beerMenu, [[beer, 1]]);

    await receive(pork, 10, 100);
    await receive(beer, 50, 40);
    await receive(salt, 5, 10);

    // Day 1 sells and is posted: pork −2, basil −0.4 (never bought), beer −10.
    await sell(D1, kaphrao, 20);
    await sell(D1, beerMenu, 10);
    await post(D1);
    // Count 1: pork 0.2 short, beer 2 short, basil found (its baseline), salt untouched.
    await close(
      await openCount(C1, [
        [pork, 7.8],
        [beer, 38],
        [basil, 1],
        [salt, 5],
      ])
    );

    // Day 3 posted; day 4 imported but posted only after count 2 closes.
    await sell(D3, kaphrao, 30);
    await post(D3);
    await sell(D4, kaphrao, 10);
    // The shelf lost day 3's 3 kg AND day 4's 1 kg; the ledger knows only day 3.
    const c2 = await openCount(C2, [
      [pork, 3.8],
      [basil, 0.2],
    ]);
    readiness = await getCountSalesReadinessLogic(tenant, c2);
    await close(c2);
    await post(D4);
    // Count 3: nothing sold since; the shelf still holds 3.8, the ledger 2.8.
    await close(await openCount(C3, [[pork, 3.8]]));

    money = await getDeductionAccuracyLogic(tenant, { branchId: branch, withMoney: true });
    plain = await getDeductionAccuracyLogic(tenant, { branchId: branch, withMoney: false });
  }, 300_000);

  afterAll(async () => {
    await sweepTestTenants(prismaBypass, { ids: [tenant] });
  });

  it("AC3 the first count: used = deducted − variance, gap on what the recipes took", () => {
    const v = money.counts[0];
    expect(lineOf(v, pork)).toMatchObject({ deducted: 2, used: 2.2, gapPct: 10, band: 3, firstCompare: true });
    expect(lineOf(v, beer)).toMatchObject({ deducted: 10, used: 12, gapPct: 20, soldAsIs: true });
  });

  it("AC1 baseline: a product nothing came in for is not measured on its first count, and is on its second", () => {
    expect(lineOf(money.counts[0], basil)).toBeUndefined();
    // Count 2: ledger 1 − 0.6 = 0.4, shelf 0.2 → used 0.8 against 0.6 deducted.
    expect(lineOf(money.counts[1], basil)).toMatchObject({ deducted: 0.6, used: 0.8, firstCompare: false });
  });

  it("AC5 a product the recipes never took is counted, not measured", () => {
    expect(lineOf(money.counts[0], salt)).toBeUndefined();
    expect(money.counts[0].summary).toMatchObject({ counted: 4, measured: 2 });
  });

  it("AC1 the window is the ledger's: a day posted after the count closed belongs to the next count", () => {
    // Count 2 saw day 3 only (3 kg) and found day 4's kilo missing as well.
    expect(lineOf(money.counts[1], pork)).toMatchObject({ deducted: 3, used: 4 });
    // Count 3 carries day 4's deduction and finds the kilo again.
    expect(lineOf(money.counts[2], pork)).toMatchObject({ deducted: 1, used: 0, gapPct: -100 });
  });

  it("names the sales days a count stood on that were not deducted when it closed — never the count day itself", () => {
    expect(money.counts[1].lateSalesDays).toEqual([iso(D4)]);
    expect(money.counts[0].lateSalesDays).toEqual([]);
    expect(money.counts[2].lateSalesDays).toEqual([]);
  });

  it("AC6 combined sums per product before dividing, so the late day's pair cancels", () => {
    const c = money.combined!;
    expect(c.label).toContain("รวม 3 ใบนับ");
    // 2 + 3 + 1 deducted; 0.2 + 1 − 1 more used.
    expect(lineOf(c, pork)).toMatchObject({ deducted: 6, used: 6.2, gapPct: 3.3, band: 2 });
    expect(c.lateSalesDays).toEqual([iso(D4)]);
  });

  it("AC4 money: a shortfall is the count's FIFO loss, the headline weights by money, and only a cost reader gets baht", () => {
    const v = money.counts[0];
    expect(lineOf(v, pork)).toMatchObject({ deductedValue: 200, gapValue: 20 });
    expect(lineOf(v, beer)).toMatchObject({ deductedValue: 400, gapValue: 80 });
    expect(v.summary).toMatchObject({ gapPct: 16.7, deductedValue: 600, moreValue: 100, lessValue: 0, far: 2 });
    expect(v.summary.farShare).toMatchObject({ share: 100 });

    const p = plain.counts[0];
    expect(lineOf(p, pork)).toMatchObject({ deductedValue: null, gapValue: null, gapPct: 10 });
    expect(p.summary).toMatchObject({ gapPct: 16.7, deductedValue: null, moreValue: null });
    expect(p.summary.farShare?.value).toBeNull();
  });

  it("the detail names the menus behind the deduction, recipes as of each day", async () => {
    const l = lineOf(money.counts[0], pork)!;
    const d = await getDeductionAccuracyDetailLogic(tenant, { branchId: branch, productId: pork.id, lineIds: l.lineIds });
    expect(d?.menus.map((m) => ({ plates: m.plates, perPlate: m.perPlate, qty: m.qty }))).toEqual([{ plates: 20, perPlate: 0.1, qty: 2 }]);
    expect(d).toMatchObject({ sales: 2, staff: 0, production: 0, residual: 0, unit: "kg" });
  });

  it("the detail refuses a line from another product", async () => {
    const l = lineOf(money.counts[0], pork)!;
    expect(await getDeductionAccuracyDetailLogic(tenant, { branchId: branch, productId: beer.id, lineIds: l.lineIds })).toBeNull();
  });

  it("before a count closes: the last day sales came in, and the days imported but not deducted", () => {
    expect(readiness).toEqual({ usesDeduction: true, countDate: iso(C2), lastSalesDate: iso(D4), unposted: [iso(D4)] });
  });
});
