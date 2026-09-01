// ============================================================
// Mise — whose demand was it, over a period (Part 32 L2b, ADR 0032)
// ============================================================
// The segmentation is the whole of option B, so it is the thing pinned hardest.
// P4 is the case that would silently produce wrong money if the boundaries were
// wrong: a recipe that changed mid-period must be exploded at BOTH versions,
// because a segment is only allowed to resolve once on the promise that nothing
// inside it changed.
//
// What comes back is DEMAND, never money — rule F2 keeps the value on the
// ledger's side of the line and this module has no access to a cost at all.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { recipeInputSchema } from "@/lib/validations/recipe";
import { createRecipeLogic, updateRecipeLogic } from "@/server/recipe";
import {
  departmentDemandForPeriodLogic,
  departmentRevenueForPeriodLogic,
  departmentBreakdownLogic,
} from "@/server/department-cost";
import { Prisma } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { getDepartmentReportLogic } from "@/server/department-read";

describe("department demand over a period (ADR 0032 Q1/Q2)", () => {
  let tenantId: string;
  let userId: string;
  let branchId: string;
  let batchId: string;
  let kitchen: string;
  let bar: string;

  let lime: ProductWithUnits;

  let yum: string; // ครัว
  let soda: string; // บาร์
  let orphan: string; // no department
  let noRecipe: string; // sells, has no recipe at all
  let sodaRecipeId: string;

  const today = computeBangkokToday();
  const FROM = addDays(today, -20);
  const TO = addDays(today, -1);
  /** Inside the period — the boundary P4 relies on. */
  const CHANGED_ON = addDays(today, -10);

  const makeProduct = (tag: string): Promise<ProductWithUnits> =>
    createProductLogic(
      tenantId,
      productInputSchema.parse({
        name: `DC-${tag}-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
      })
    );

  const baseUnitOf = (p: ProductWithUnits) =>
    p.productUnits.find((u) => u.isBase)!.id;

  const makeMenu = (name: string, departmentId: string | null) =>
    withRlsBypass((tx) =>
      tx.menu
        .create({
          data: {
            tenantId,
            source: "MISE",
            name: `${name}-${randomUUID().slice(0, 4)}`,
            primaryDepartmentId: departmentId,
          },
          select: { id: true },
        })
        .then((m) => m.id)
    );

  const recipeInput = (menuId: string, qty: number, effectiveFrom: Date) =>
    recipeInputSchema.parse({
      submitKey: randomUUID(),
      menuId,
      outputProductId: null,
      servings: 1,
      effectiveFrom,
      ingredients: [
        {
          productId: lime.id,
          componentMenuId: null,
          qty,
          productUnitId: baseUnitOf(lime),
          sortOrder: 0,
          notes: null,
        },
      ],
      notes: null,
    });

  /**
   * A NEW VERSION, not a second recipe. ADR 0021 made a recipe append +
   * supersede, and `createRecipeLogic` refuses a second central recipe for the
   * same menu — which is the rule working, not the fixture being awkward.
   */
  const reviseRecipe = (
    recipeId: string,
    menuId: string,
    qty: number,
    effectiveFrom: Date
  ) => updateRecipeLogic(tenantId, recipeId, recipeInput(menuId, qty, effectiveFrom), userId);

  const makeRecipe = (menuId: string, qty: number, effectiveFrom: Date) =>
    createRecipeLogic(
      tenantId,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId,
        outputProductId: null,
        servings: 1,
        effectiveFrom,
        ingredients: [
          {
            productId: lime.id,
            componentMenuId: null,
            qty,
            productUnitId: baseUnitOf(lime),
            sortOrder: 0,
            notes: null,
          },
        ],
        notes: null,
      }),
      userId
    );

  const sell = async (businessDate: Date, menuId: string, qty: number) => {
    await withRlsBypass(async (tx) => {
      const day = await tx.salesDay.upsert({
        where: { branchId_businessDate: { branchId, businessDate } },
        create: { tenantId, branchId, businessDate, currentBatchId: batchId },
        update: {},
        select: { id: true },
      });
      await tx.salesLine.create({
        data: {
          tenantId,
          branchId,
          businessDate,
          salesDayId: day.id,
          importBatchId: batchId,
          menuId,
          qty,
          grossAmount: qty * 100,
          discountAmount: 0,
          netAmount: qty * 100,
          serviceChargeAmount: 0,
          vatAmount: 0,
        },
      });
    });
  };

  const run = (over: Partial<{ from: Date; to: Date }> = {}) =>
    withTenantContext(tenantId, (tx) =>
      departmentDemandForPeriodLogic(tx, tenantId, {
        branchId,
        from: FROM,
        to: TO,
        cancelledSalePolicy: "TREAT_AS_COOKED",
        ...over,
      })
    );

  const limeDemand = (r: Awaited<ReturnType<typeof run>>) =>
    r.demand.get(lime.id) ?? [];

  const share = (r: Awaited<ReturnType<typeof run>>, dept: string | null) =>
    limeDemand(r)
      .find((d) => d.departmentId === dept)
      ?.qty.toString();

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Dept Cost Shop" } });
      tenantId = t.id;
      const u = await tx.user.create({
        data: { email: `dc-${randomUUID().slice(0, 8)}@example.com` },
      });
      userId = u.id;
      const b = await tx.branch.create({
        data: { tenantId, name: "ทองหล่อ", code: "DCA" },
      });
      branchId = b.id;
      kitchen = (
        await tx.department.create({
          data: { tenantId, name: "ครัว", code: "KIT" },
        })
      ).id;
      bar = (
        await tx.department.create({
          data: { tenantId, name: "บาร์", code: "BAR" },
        })
      ).id;

      const integ = await tx.posIntegration.create({
        data: { tenantId, branchId, posType: "CUSTOM", name: "POS" },
        select: { id: true },
      });
      const prof = await tx.salesImportProfile.create({
        data: {
          tenantId,
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
          data: {
            tenantId,
            branchId,
            posIntegrationId: integ.id,
            profileId: prof.id,
            status: "COMMITTED",
            fileName: "d.csv",
            uploadedBy: u.id,
            committedAt: new Date(),
          },
          select: { id: true },
        })
      ).id;
    });

    lime = await makeProduct("lime");

    yum = await makeMenu("ยำ", kitchen);
    soda = await makeMenu("โซดามะนาว", bar);
    orphan = await makeMenu("ของหวานพิเศษ", null);
    // No recipe, on purpose: the only thing that can populate `skipped`.
    noRecipe = await makeMenu("เมนูไม่มีสูตร", kitchen);

    // Effective well before the period, so the whole period resolves to them.
    await makeRecipe(yum, 0.04, addDays(today, -60));
    sodaRecipeId = (await makeRecipe(soda, 0.06, addDays(today, -60))).id;
    await makeRecipe(orphan, 0.01, addDays(today, -60));
  });

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.salesLine.deleteMany({ where: { tenantId } });
      await tx.salesDay.deleteMany({ where: { tenantId } });
      await tx.salesImportBatch.deleteMany({ where: { tenantId } });
      await tx.salesImportProfile.deleteMany({ where: { tenantId } });
      await tx.posIntegration.deleteMany({ where: { tenantId } });
      await tx.recipeIngredient.deleteMany({ where: { tenantId } });
      await tx.recipeBranch.deleteMany({ where: { tenantId } });
      await tx.recipe.deleteMany({ where: { tenantId } });
      await tx.menu.deleteMany({ where: { tenantId } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId } } });
      await tx.product.deleteMany({ where: { tenantId } });
      await tx.department.deleteMany({ where: { tenantId } });
      await tx.branch.deleteMany({ where: { tenantId } });
      await tx.tenant.deleteMany({ where: { id: tenantId } });
      await tx.user.deleteMany({ where: { id: userId } });
    });
  });

  it("P1 — a period with no recipe change is ONE segment", async () => {
    // The whole justification for option B: 30 days that resolve identically
    // should resolve once. If this ever reports more than 1 for a quiet period,
    // the report is doing thirty graph loads again and the 70 ms/day measurement
    // from L2a applies.
    await sell(addDays(today, -15), yum, 100);
    const r = await run();
    expect(r.segments).toBe(1);
  });

  it("P2 — demand is attributed to the department that sold the dish", async () => {
    // ยำ 100 จาน x 40 g = 4 kg for ครัว. Signed negative, like the ledger.
    const r = await run();
    expect(share(r, kitchen)).toBe("-4");
    expect(share(r, bar)).toBeUndefined();
  });

  it("P3 — a menu with no department is a bucket, never dropped (rule F8)", async () => {
    await sell(addDays(today, -14), orphan, 200); // 200 x 10 g = 2 kg
    const r = await run();
    expect(share(r, null)).toBe("-2");
    // and it did not disturb the kitchen's share
    expect(share(r, kitchen)).toBe("-4");
  });

  it("P4 — a recipe change mid-period cuts a boundary and BOTH versions apply", async () => {
    // The case that would silently misattribute money if segmentation were
    // wrong. โซดามะนาว uses 60 g before the change and 20 g after; the same
    // 100 servings are sold on either side of it.
    await sell(addDays(today, -12), soda, 100); // before -> 6 kg
    await reviseRecipe(sodaRecipeId, soda, 0.02, CHANGED_ON);
    await sell(addDays(today, -8), soda, 100); // after  -> 2 kg

    const r = await run();
    expect(r.segments).toBe(2);
    // 6 + 2, not 12 (both at the old recipe) and not 4 (both at the new one).
    expect(share(r, bar)).toBe("-8");
  });

  it("P5 — a period that ends before the change sees only the old recipe", async () => {
    // Pins that the boundary is applied by DATE and not merely counted: asking
    // for the earlier window alone must return the pre-change explosion.
    const r = await run({ to: addDays(CHANGED_ON, -1) });
    expect(r.segments).toBe(1);
    expect(share(r, bar)).toBe("-6");
  });

  it("P11 — a skipped menu is counted ONCE, not once per segment", async () => {
    // The page renders this length as "N เมนูที่ระเบิดสูตรไม่ได้". By now there
    // are two segments (P4 published a recipe mid-period) and this menu sells in
    // BOTH — one menu with one problem, which must not be reported as two.
    //
    // 🔴 The first version of this case asserted `length === new Set(...).size`
    // against a fixture where every menu had a recipe, so `skipped` was always
    // empty and the assertion was vacuous — it stayed green under every break
    // aimed at it. A menu with no recipe selling either side of the boundary is
    // what makes it able to fail.
    await sell(addDays(today, -13), noRecipe, 5); // segment 1
    await sell(addDays(today, -7), noRecipe, 5); // segment 2

    const r = await run();
    expect(r.segments).toBe(2);
    expect(r.skippedMenuIds.filter((id) => id === noRecipe)).toHaveLength(1);
  });

  it("P12 — onlyDates narrows demand to the days the caller names", async () => {
    // 🔴 The fix for the review's finding 3. The ratio is used to cut money the
    // ledger moved on the POSTED days; taking it over the whole period hands a
    // department a share of money for stock it never consumed. Totals still add
    // up, so nothing on screen looks wrong — which is what makes it the worse
    // of the two failures.
    const all = await run();
    const soloDay = await withTenantContext(tenantId, (tx) =>
      departmentDemandForPeriodLogic(tx, tenantId, {
        branchId,
        from: FROM,
        to: TO,
        cancelledSalePolicy: "TREAT_AS_COOKED",
        onlyDates: [addDays(today, -15)], // the day only ยำ (ครัว) sold
      })
    );

    // Over the whole period บาร์ and ไม่ระบุ both have demand for lime.
    expect(share(all, bar)).toBeDefined();
    expect(share(all, null)).toBeDefined();

    // Narrowed to one kitchen-only day, they have none — and ครัว has all of it.
    const only = (dept: string | null) =>
      (soloDay.demand.get(lime.id) ?? [])
        .find((d) => d.departmentId === dept)
        ?.qty.toString();
    expect(only(kitchen)).toBe("-4");
    expect(only(bar)).toBeUndefined();
    expect(only(null)).toBeUndefined();
  });

  it("P13 — a day list that misses a segment entirely does not read it", async () => {
    // Guards the `continue` that skips a segment with none of the caller's days
    // in it: without it the segment would fall back to its full range and pull
    // in days the caller excluded.
    const none = await withTenantContext(tenantId, (tx) =>
      departmentDemandForPeriodLogic(tx, tenantId, {
        branchId,
        from: FROM,
        to: TO,
        cancelledSalePolicy: "TREAT_AS_COOKED",
        onlyDates: [],
      })
    );
    expect(none.demand.size).toBe(0);
    expect(none.skippedMenuIds).toEqual([]);
  });

  it("P14 — the real entry point reports ZERO coverage when nothing was posted (rule F10)", async () => {
    // 🔴 The review's finding 1, and the case that made it worth fixing: this
    // fixture has sales and no consumption runs at all — every menu resolves,
    // so `skippedMenuIds` names nobody, and the old report handed the screen a
    // material cost of 0 with no signal whatsoever. The page then printed
    // gross profit = the whole revenue at a 0.0% food cost. Arithmetically
    // correct, and a lie.
    //
    // It also covers `getDepartmentReportLogic` itself, which the page calls
    // and which had no test before this.
    const report = await getDepartmentReportLogic(tenantId, {
      branchId,
      from: FROM,
      to: TO,
    });

    expect(report.postedDays).toBe(0);
    expect(report.coveredNetAmount.toFixed(2)).toBe("0.00");
    expect(report.materialCostTotal.toFixed(2)).toBe("0.00");
    // Revenue is real, which is exactly what makes a bare gross profit dangerous.
    expect(Number(report.revenueTotal)).toBeGreaterThan(0);
  });

  // ----------------------------------------------------------
  // L3 — the demand above, cut against money the ledger moved
  // ----------------------------------------------------------

  const breakdown = (values: Record<string, string>) =>
    withTenantContext(tenantId, (tx) =>
      departmentBreakdownLogic(tx, tenantId, {
        branchId,
        from: FROM,
        to: TO,
        cancelledSalePolicy: "TREAT_AS_COOKED",
        consumptionValueByProduct: new Map(
          Object.entries(values).map(([k, v]) => [k, new Prisma.Decimal(v)])
        ),
      })
    );

  const rowFor = (
    b: Awaited<ReturnType<typeof breakdown>>,
    dept: string | null
  ) => b.rows.find((r) => r.departmentId === dept);

  it("P6 — revenue is split by the menu's department, with no recipe involved", async () => {
    // Rule F4's surviving half: a shop with no recipes at all still gets this.
    const rev = await withTenantContext(tenantId, (tx) =>
      departmentRevenueForPeriodLogic(tx, tenantId, { branchId, from: FROM, to: TO })
    );
    // ยำ 100 x 100 = 10,000 plus เมนูไม่มีสูตร 10 x 100 = 1,000, both ครัว ·
    // โซดา 200 x 100 = 20,000 (บาร์) · ของหวาน 200 x 100 = 20,000 (ไม่ระบุ)
    //
    // The recipe-less menu's REVENUE counts here even though it contributes no
    // cost — which is the asymmetry rule F10 exists to make visible, and why
    // coverage is reported as money rather than as a count of dishes.
    expect(rev.get(kitchen)?.toString()).toBe("11000");
    expect(rev.get(bar)?.toString()).toBe("20000");
    expect(rev.get(null)?.toString()).toBe("20000");
  });

  it("P7 — the department columns sum to the money the ledger moved (rule F2)", async () => {
    // The end-to-end statement of F2. Lime moved ฿1,400 in total; whatever the
    // ratios work out to, the columns must add back to exactly that.
    const b = await breakdown({ [lime.id]: "1400.00" });
    const total = b.rows.reduce(
      (t, r) => t.plus(r.materialCost),
      new Prisma.Decimal(0)
    );
    expect(total.toFixed(2)).toBe("1400.00");
  });

  it("P8 — the split follows demand: ครัว 4kg, บาร์ 8kg, ไม่ระบุ 2kg of 14kg", async () => {
    // 4 + 8 + 2 = 14 kg of lime, so ฿1,400 lands as 400 / 800 / 200.
    const b = await breakdown({ [lime.id]: "1400.00" });
    expect(rowFor(b, kitchen)?.materialCost.toFixed(2)).toBe("400.00");
    expect(rowFor(b, bar)?.materialCost.toFixed(2)).toBe("800.00");
    expect(rowFor(b, null)?.materialCost.toFixed(2)).toBe("200.00");
  });

  it("P9 — a product no menu asked for lands in ไม่ระบุ, never nowhere (rule F7)", async () => {
    // 🔴 The comment here used to say "waste and manual adjustments arrive
    // exactly like this", and a review showed that is false: the caller filters
    // to SALES_CONSUMPTION, so an ADJUST_LOSS never reaches this map. What DOES
    // reach it is a product consumed on a posted day whose menus fell out of
    // the demand — a menu deleted since, or a day whose sales rows were
    // superseded. The behaviour under test is unchanged; the claim about where
    // it comes from was wrong, and a test that misnames its own case is a test
    // nobody can act on.
    const ghost = await makeProduct("ghost");
    const b = await breakdown({ [ghost.id]: "750.00" });
    expect(rowFor(b, null)?.materialCost.toFixed(2)).toBe("750.00");
    expect(rowFor(b, kitchen)?.materialCost.toFixed(2)).toBe("0.00");
  });

  it("P10 — ไม่ระบุแผนก always sorts last", async () => {
    // The bucket that means "we do not know" must never sit above the ones that
    // do, on a screen an owner reads top-down.
    const b = await breakdown({ [lime.id]: "1400.00" });
    expect(b.rows[b.rows.length - 1].departmentId).toBeNull();
  });
});
