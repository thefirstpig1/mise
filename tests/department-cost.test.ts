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
import { departmentDemandForPeriodLogic } from "@/server/department-cost";
import { withTenantContext } from "@/lib/db";

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
});
