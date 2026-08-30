// ============================================================
// Mise — what has been posted, and what has not (Sprint 5 Part 22 L4a)
// ============================================================
// `getConsumptionDayStatusLogic` — one read behind three screens: the posting
// panel, the coverage report and the queue.
//
// The case worth the fixture is rule N11: a recipe written AFTER a day was
// posted means that day no longer matches what the recipes say, and the shop
// has to be told. The near-miss it must avoid is a recipe written for a dish
// this branch did not sell that day — a warning that cannot be acted on is
// worse than none, because it teaches people to ignore the banner.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma,  } from "@/lib/db";
import { withRlsBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { MAX_BACKDATE_DAYS } from "@/lib/validations/stock-movement";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { recipeInputSchema } from "@/lib/validations/recipe";
import { createRecipeLogic } from "@/server/recipe";
import { getConsumptionDayStatusLogic } from "@/server/consumption-read";
import {
  postConsumptionForDayLogic,
  voidConsumptionForDayInTx,
} from "@/server/consumption-post";
import { toConsumptionDayView } from "@/app/consumption/_components/consumption-view";

describe("consumption day status (ADR 0022 Part 22 L4a)", () => {
  let tenantA: string;
  let userA: string;
  let branchA: string;
  let branchB: string;
  let batchId: string;

  let pork: ProductWithUnits;
  let kaphrao: { id: string };
  let noRecipeDish: { id: string };
  let laterDish: { id: string };
  let neverSold: { id: string };

  const today = computeBangkokToday();
  const D_PLAIN = addDays(today, -1);
  const D_PARTIAL = addDays(today, -2);
  const D_STALE = addDays(today, -3);
  const D_DECOY = addDays(today, -4);
  const D_VOIDED = addDays(today, -5);
  const D_OLD = addDays(today, -(MAX_BACKDATE_DAYS + 3));
  const FROM = addDays(today, -(MAX_BACKDATE_DAYS + 10));

  const baseUnitOf = (p: ProductWithUnits) =>
    p.productUnits.find((u) => u.isBase)!.id;

  const makeMenu = (name: string) =>
    withRlsBypass((tx) =>
      tx.menu.create({
        data: {
          tenantId: tenantA,
          source: "MISE",
          name: `${name}-${randomUUID().slice(0, 4)}`,
        },
        select: { id: true },
      })
    );

  const makeRecipe = (menuId: string, effectiveFrom: Date) =>
    createRecipeLogic(
      tenantA,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId,
        outputProductId: null,
        servings: 1,
        effectiveFrom,
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

  const sell = async (
    branchId: string,
    businessDate: Date,
    menuId: string,
    qty: number,
    netAmount: number
  ) => {
    await withRlsBypass(async (tx) => {
      const day = await tx.salesDay.upsert({
        where: { branchId_businessDate: { branchId, businessDate } },
        create: {
          tenantId: tenantA,
          branchId,
          businessDate,
          currentBatchId: batchId,
        },
        update: {},
        select: { id: true },
      });
      await tx.salesLine.create({
        data: {
          tenantId: tenantA,
          branchId,
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

  const post = (businessDate: Date, branchId = branchA) =>
    postConsumptionForDayLogic(
      tenantA,
      { submitKey: randomUUID(), branchId, businessDate, acknowledgeRepost: false },
      userA
    );

  const status = (branchId?: string) =>
    getConsumptionDayStatusLogic(tenantA, { branchId, from: FROM, to: today });

  const dayOf = async (d: Date, branchId?: string) =>
    (await status(branchId)).find(
      (r) => r.businessDate.getTime() === d.getTime()
    );

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Consumption Read Tenant" } });
      tenantA = t.id;
      const [a, b] = await Promise.all([
        tx.branch.create({ data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" } }),
        tx.branch.create({ data: { tenantId: t.id, name: "อโศก", code: "ASK" } }),
      ]);
      branchA = a.id;
      branchB = b.id;
      const u = await tx.user.create({
        data: { email: `read-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;
      const integ = await tx.posIntegration.create({
        data: { tenantId: t.id, branchId: a.id, posType: "CUSTOM", name: "POS" },
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
          branchId: a.id,
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
        name: `READ-pork-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
      })
    );

    kaphrao = await makeMenu("กะเพราหมู");
    noRecipeDish = await makeMenu("เมนูไม่มีสูตร");
    laterDish = await makeMenu("เมนูสูตรมาทีหลัง");
    neverSold = await makeMenu("เมนูที่ไม่เคยขาย");
    await makeRecipe(kaphrao.id, addDays(today, -60));
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
      await tx.productUnit.deleteMany({ where: { product: { tenantId: tenantA } } });
      await tx.product.deleteMany({ where: { tenantId: tenantA } });
      await tx.category.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.deleteMany({ where: { id: tenantA } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
  }, 180_000);

  // ------------------------------------------------------------
  // The plain cases
  // ------------------------------------------------------------

  it("R-01 a day with sales and no posting is in the queue, with its revenue", async () => {
    await sell(branchA, D_PLAIN, kaphrao.id, 10, 1000);

    const d = await dayOf(D_PLAIN);
    expect(d?.runId).toBeNull();
    expect(d?.netAmount.toString()).toBe("1000");
    expect(d?.lineCount).toBe(1);
    expect(d?.withinWindow).toBe(true);
    expect(toConsumptionDayView(d!).state).toBe("NOT_POSTED");
  });

  it("R-02 once posted it carries when, and how much of the day it covered", async () => {
    await post(D_PLAIN);

    const d = await dayOf(D_PLAIN);
    expect(d?.runId).toBeTruthy();
    expect(d?.postedAt).toBeInstanceOf(Date);
    expect(d?.coveredNetAmount?.toString()).toBe("1000");
    expect(d?.menusSkipped).toBe(0);

    const v = toConsumptionDayView(d!);
    expect(v.state).toBe("POSTED");
    expect(v.coveragePercent).toBe(100);
    expect(v.postedAtLabel).toBeTruthy();
  });

  it("R-03 a partly posted day reads its own reasons back out of the run", async () => {
    await sell(branchA, D_PARTIAL, kaphrao.id, 4, 400);
    await sell(branchA, D_PARTIAL, noRecipeDish.id, 6, 600);
    await post(D_PARTIAL);

    const d = await dayOf(D_PARTIAL);
    expect(d?.menusPosted).toBe(1);
    expect(d?.menusSkipped).toBe(1);
    // The reasons survive the request that computed them, which is why the run
    // stores them rather than the screen recomputing.
    expect(d?.skipped[0].reason).toBe("NO_RECIPE");
    expect(d?.skipped[0].menuName).toContain("เมนูไม่มีสูตร");

    const v = toConsumptionDayView(d!);
    expect(v.state).toBe("POSTED_PARTIAL");
    expect(v.coveragePercent).toBe(40);
  });

  // ------------------------------------------------------------
  // Rule N11 — the signal, and the false alarm it must not raise
  // ------------------------------------------------------------

  it("R-04 a recipe written AFTER the day was posted marks it stale", async () => {
    await sell(branchA, D_STALE, kaphrao.id, 2, 200);
    await sell(branchA, D_STALE, laterDish.id, 3, 300);
    await post(D_STALE);
    expect((await dayOf(D_STALE))?.recipeChangedSincePosting).toBe(false);

    // Written now, effective back over that day — the shop that imports a month
    // of history and then writes its recipes does exactly this.
    await makeRecipe(laterDish.id, addDays(today, -60));

    const d = await dayOf(D_STALE);
    expect(d?.recipeChangedSincePosting).toBe(true);
    const v = toConsumptionDayView(d!);
    // Stale outranks partial: both want the same press, but "the recipe changed"
    // is the reason nobody would otherwise guess.
    expect(v.state).toBe("POSTED_STALE");
  });

  it("R-05 a recipe for a dish this day did not sell raises NO alarm", async () => {
    await sell(branchA, D_DECOY, kaphrao.id, 1, 100);
    await post(D_DECOY);

    await makeRecipe(neverSold.id, addDays(today, -60));

    // A warning that cannot be acted on teaches people to ignore the banner.
    expect((await dayOf(D_DECOY))?.recipeChangedSincePosting).toBe(false);
  });

  // ------------------------------------------------------------
  // Boundaries
  // ------------------------------------------------------------

  it("R-06 a voided day looks unposted again — because it is", async () => {
    await sell(branchA, D_VOIDED, kaphrao.id, 5, 500);
    await post(D_VOIDED);
    await prisma.$transaction((tx) =>
      voidConsumptionForDayInTx(
        tx as never,
        tenantA,
        branchA,
        D_VOIDED,
        "RE_IMPORT",
        userA
      )
    );

    const d = await dayOf(D_VOIDED);
    expect(d?.runId).toBeNull();
    expect(toConsumptionDayView(d!).state).toBe("NOT_POSTED");
  });

  it("R-07 a day past the backdate window says so instead of offering a button", async () => {
    await sell(branchA, D_OLD, kaphrao.id, 8, 800);

    const d = await dayOf(D_OLD);
    expect(d?.withinWindow).toBe(false);
    expect(d?.runId).toBeNull();
    // Not "not posted yet": it can never post, and a button that cannot work is
    // worse than a sentence saying why.
    expect(toConsumptionDayView(d!).state).toBe("OUT_OF_WINDOW");
  });

  it("R-08 days with no sales are absent, not present and empty", async () => {
    const rows = await status(branchA);
    const dates = rows.map((r) => r.businessDate.getTime());
    // The shop was closed on this one. A queue padded with days off is a queue
    // nobody reads.
    expect(dates).not.toContain(addDays(today, -6).getTime());
    expect(dates).toContain(D_PLAIN.getTime());
  });

  it("R-09 one branch's days are not another's", async () => {
    await sell(branchB, D_PLAIN, kaphrao.id, 20, 2000);

    const atA = await dayOf(D_PLAIN, branchA);
    expect(atA?.netAmount.toString()).toBe("1000");

    const atB = await dayOf(D_PLAIN, branchB);
    expect(atB?.netAmount.toString()).toBe("2000");
    expect(atB?.runId).toBeNull();

    // Unfiltered, both branches' rows come back and are told apart by branchId.
    const both = (await status()).filter(
      (r) => r.businessDate.getTime() === D_PLAIN.getTime()
    );
    expect(both).toHaveLength(2);
  });

  it("R-10 the days come back oldest first", async () => {
    const rows = await status(branchA);
    const times = rows.map((r) => r.businessDate.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});
