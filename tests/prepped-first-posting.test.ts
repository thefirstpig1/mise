// ============================================================
// Mise — a day's sales take prepped stock off the shelf first (ADR 0040 Q1)
// ============================================================
// Against the real ledger: soup made by a production, a noodle dish that uses
// soup, and days of sales posted in different orders. The rule under test is
// the one sentence of Q1 — take the soup that is there, cut the bones for the
// rest — plus D2: a day posted late never takes soup a later day already used.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { withRlsBypass, prismaBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { recipeInputSchema } from "@/lib/validations/recipe";
import { createRecipeLogic } from "@/server/recipe";
import { createStockAdjustmentLogic, getStockBalanceLogic } from "@/server/stock-movement";
import { createStockAdjustmentInputSchema } from "@/lib/validations/stock-movement";
import { postConsumptionForDayLogic } from "@/server/consumption-post";
import { createProductionInputSchema } from "@/lib/validations/production";
import { createProductionLogic } from "@/server/production";
import { createStaffMealInputSchema } from "@/lib/validations/staff-meal";
import { createStaffMealLogic } from "@/server/staff-meal";
import { sweepTestTenants } from "./support/sweep";
import { withTenantContext } from "@/lib/db";
import { departmentDemandForPeriodLogic } from "@/server/department-cost";

describe("posting takes prepped stock first (ADR 0040 Q1, D2)", () => {
  let tenant: string;
  let user: string;
  let branch: string;
  let batchId: string;

  const today = computeBangkokToday();
  const RECIPES_FROM = addDays(today, -60);

  const product = (tag: string, type: "RAW" | "PREPPED", base: "kg" | "l") =>
    createProductLogic(
      tenant,
      productInputSchema.parse({
        name: `PF-${tag}-${randomUUID().slice(0, 6)}`,
        type,
        primaryDimension: base === "kg" ? "WEIGHT" : "VOLUME",
        baseUnitName: base,
      })
    );
  const unit = (p: ProductWithUnits) => p.productUnits.find((u) => u.isBase)!.id;

  const menu = (name: string) =>
    withRlsBypass((tx) =>
      tx.menu.create({
        data: { tenantId: tenant, source: "MISE", name: `${name}-${randomUUID().slice(0, 4)}` },
        select: { id: true },
      })
    );

  const recipe = (
    target: { menuId: string } | { outputProductId: string; servings: number },
    lines: [ProductWithUnits, number][]
  ) =>
    createRecipeLogic(
      tenant,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId: "menuId" in target ? target.menuId : null,
        outputProductId: "outputProductId" in target ? target.outputProductId : null,
        servings: "servings" in target ? target.servings : 1,
        effectiveFrom: RECIPES_FROM,
        ingredients: lines.map(([p, qty], i) => ({
          productId: p.id,
          componentMenuId: null,
          qty,
          productUnitId: unit(p),
          sortOrder: i,
          notes: null,
        })),
        notes: null,
      }),
      user
    );

  const stock = (p: ProductWithUnits, qty: number) =>
    createStockAdjustmentLogic(
      tenant,
      createStockAdjustmentInputSchema.parse({
        submitKey: randomUUID(),
        productId: p.id,
        branchId: branch,
        type: "ADJUST_GAIN",
        reason: "RECOUNT",
        inputQty: qty,
        inputUnitId: unit(p),
        occurredAt: addDays(new Date(), -20),
        notes: null,
      }),
      user
    );

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
    postConsumptionForDayLogic(
      tenant,
      { submitKey: randomUUID(), branchId: branch, businessDate, acknowledgeRepost: false },
      user
    );

  const produce = (input: ProductWithUnits, inQty: number, output: ProductWithUnits, outQty: number, producedOn: Date) =>
    createProductionLogic(
      tenant,
      createProductionInputSchema.parse({
        submitKey: randomUUID(),
        branchId: branch,
        kind: "PRODUCE",
        producedOn,
        inputs: [{ productId: input.id, inputQty: inQty, inputUnitId: unit(input) }],
        outputs: [{ productId: output.id, inputQty: outQty, inputUnitId: unit(output) }],
      }),
      user
    );

  const balance = async (p: ProductWithUnits) =>
    (await getStockBalanceLogic(tenant, { productId: p.id, branchId: branch })).balance.toNumber();

  const shortfallsOf = (runId: string) =>
    withRlsBypass((tx) =>
      tx.preppedShortfall.findMany({ where: { salesConsumptionRunId: runId }, select: { productId: true, qty: true } })
    );

  /** A fresh soup world: bones → soup (20 L per 8 kg), and a noodle using 0.5 L. */
  const world = async (tag: string) => {
    const bones = await product(`${tag}-bones`, "RAW", "kg");
    const soup = await product(`${tag}-soup`, "PREPPED", "l");
    await recipe({ outputProductId: soup.id, servings: 20 }, [[bones, 8]]);
    const noodle = await menu(`${tag}-noodle`);
    await recipe({ menuId: noodle.id }, [[soup, 0.5]]);
    await stock(bones, 50);
    return { bones, soup, noodle };
  };

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Prepped First Tenant", staffMealStockSource: "SYSTEM" } });
      tenant = t.id;
      const b = await tx.branch.create({ data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" } });
      branch = b.id;
      const u = await tx.user.create({ data: { email: `pf-${randomUUID()}@example.com`, name: "เชฟ" } });
      user = u.id;
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
  });

  afterAll(async () => {
    await sweepTestTenants(prismaBypass, { ids: [tenant] });
    await withRlsBypass((tx) => tx.user.deleteMany({ where: { id: user } }));
  });

  it("PF1: an empty shelf cuts the bones, exactly as before ADR 0040 — and records the shortfall", async () => {
    const { bones, soup, noodle } = await world("PF1");
    const day = addDays(today, -6);
    await sell(day, noodle.id, 10); // 5 L soup → 2 kg bones
    const { run } = await post(day);
    expect(await balance(bones)).toBe(48);
    expect(await balance(soup)).toBe(0);
    const sf = await shortfallsOf(run.id);
    expect(sf).toHaveLength(1);
    expect(sf[0].productId).toBe(soup.id);
    expect(sf[0].qty.toNumber()).toBe(5);
  });

  it("PF2: soup on the shelf is taken as soup; the bones are not touched again", async () => {
    const { bones, soup, noodle } = await world("PF2");
    const day = addDays(today, -5);
    await produce(bones, 8, soup, 20, addDays(day, -1));
    await sell(day, noodle.id, 10);
    const { run } = await post(day);
    expect(await balance(soup)).toBe(15);
    expect(await balance(bones)).toBe(42); // 50 − 8 for the production, nothing for the sale
    expect(await shortfallsOf(run.id)).toHaveLength(0);
  });

  it("PF3: part from the shelf, the rest cut from the recipe", async () => {
    const { bones, soup, noodle } = await world("PF3");
    const day = addDays(today, -4);
    await produce(bones, 1.2, soup, 3, addDays(day, -1)); // 3 L on the shelf
    await sell(day, noodle.id, 10); // wants 5 L
    const { run } = await post(day);
    expect(await balance(soup)).toBe(0);
    // 50 − 1.2 (production) − 0.8 (2 L short × 0.4 kg/L)
    expect(await balance(bones)).toBeCloseTo(48, 3);
    const sf = await shortfallsOf(run.id);
    expect(sf[0].qty.toNumber()).toBe(2);
  });

  it("PF4: a day posted LATE never takes soup a later day already used (D2)", async () => {
    const { bones, soup, noodle } = await world("PF4");
    const early = addDays(today, -3);
    const later = addDays(today, -2);
    await produce(bones, 1.6, soup, 4, addDays(early, -1)); // 4 L
    await sell(later, noodle.id, 8); // later day wants 4 L — all of it
    await post(later);
    await sell(early, noodle.id, 4); // early day wants 2 L, posted afterwards
    const { run } = await post(early);
    // The shelf was 4 L at the end of the early day, but the later day used all
    // 4 — so the early day may take none of it.
    expect(await balance(soup)).toBe(0);
    expect((await shortfallsOf(run.id))[0].qty.toNumber()).toBe(2);
    expect(await balance(bones)).toBeCloseTo(50 - 1.6 - 0.8, 3);
  });

  it("PF5: a bought prepped product with no recipe is taken from the shelf (Q10); short of it, the dish is held back as before", async () => {
    const sauce = await product("PF5-sauce", "PREPPED", "kg");
    const dish = await menu("PF5-dish");
    await recipe({ menuId: dish.id }, [[sauce, 1]]);
    await stock(sauce, 5);
    // Days of its own: PF1 already posted −6 at this branch.
    const d1 = addDays(today, -12);
    await sell(d1, dish.id, 3);
    const first = await post(d1);
    expect(first.demand.menusPosted).toBe(1);
    expect(await balance(sauce)).toBe(2);

    const d2 = addDays(today, -11);
    await sell(d2, dish.id, 10);
    const second = await post(d2);
    expect(second.demand.menusPosted).toBe(0);
    expect(second.demand.skipped[0].reason).toBe("RECIPE_UNRESOLVABLE");
    expect(await balance(sauce)).toBe(2);
  });

  it("PF6: a staff meal takes soup off the shelf too, and records what it cut instead", async () => {
    const { bones, soup, noodle } = await world("PF6");
    const day = addDays(today, -1);
    await produce(bones, 0.4, soup, 1, addDays(day, -1)); // 1 L
    const eater = await withRlsBypass((tx) =>
      tx.staffMember.create({ data: { tenantId: tenant, branchId: branch, name: "ต้น" }, select: { id: true } })
    );
    const meal = await createStaffMealLogic(
      tenant,
      createStaffMealInputSchema.parse({
        submitKey: randomUUID(),
        branchId: branch,
        businessDate: day,
        staffMemberId: eater.id,
        menuId: noodle.id,
        servings: 4, // 2 L
        items: [],
        recordedByName: null,
        notes: null,
      }),
      user
    );
    expect(await balance(soup)).toBe(0);
    expect(await balance(bones)).toBeCloseTo(50 - 0.4 - 0.4, 3);
    const sf = await withRlsBypass((tx) =>
      tx.preppedShortfall.findMany({ where: { staffMealId: meal.id } })
    );
    expect(sf).toHaveLength(1);
    expect(new Prisma.Decimal(sf[0].qty).toNumber()).toBe(1);
  });

  it("PF7: soup taken off the shelf still has a department to be charged to", async () => {
    const { bones, soup, noodle } = await world("PF7");
    const dept = await withRlsBypass((tx) =>
      tx.department.create({ data: { tenantId: tenant, name: "ครัวน้ำ", code: `N${randomUUID().slice(0, 4)}` }, select: { id: true } })
    );
    await withRlsBypass((tx) => tx.menu.update({ where: { id: noodle.id }, data: { primaryDepartmentId: dept.id } }));
    // Today: every earlier day inside the 7-day production window is already
    // some other test's posted day at this branch.
    const day = today;
    await produce(bones, 8, soup, 20, day);
    await sell(day, noodle.id, 10);
    await post(day);
    const { demand } = await withTenantContext(tenant, (tx) =>
      departmentDemandForPeriodLogic(tx, tenant, {
        branchId: branch,
        from: day,
        to: day,
        cancelledSalePolicy: "TREAT_AS_COOKED",
      })
    );
    const soupDemand = demand.get(soup.id) ?? [];
    expect(soupDemand.map((x) => x.departmentId)).toEqual([dept.id]);
    expect(Math.abs(soupDemand[0].qty.toNumber())).toBe(5);
  });
});
