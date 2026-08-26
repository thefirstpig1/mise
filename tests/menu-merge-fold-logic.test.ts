// ============================================================
// Mise — folding merged menus (Part 25 L3b, ADR 0026)
// ============================================================
// The five reads that must fold, and the date that means two different things.
//
//   F1  coverage counts a merged dish ONCE, and the winner's recipe covers it
//   F2  coverage folds RETROACTIVELY — a merge made today fixes last month
//   F3  the sales screen shows one row, under the canonical menu's name
//   F4  a draft's dish "has sales" when the sales are under its other spelling
//   F5  the ledger folds only from effective_from — the opposite of F2
//   F6  a losing menu with its OWN recipe keeps it: merging never overwrites
//   F7  a revoked merge folds nothing, at any date
//
// Every fold in F1/F3/F4/F5 is verified by removing it and watching this file
// go red — the method ADR 0025 Q4 set for `is_draft` — because a fold that runs
// on an empty map and a fold that never runs look identical when nothing is
// merged.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withAdminContext, prisma } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { recipeInputSchema } from "@/lib/validations/recipe";
import { createRecipeLogic } from "@/server/recipe";
import { resolveRecipeIds } from "@/server/recipe-resolve";
import { mergeMenusInputSchema, revokeMergeInputSchema } from "@/lib/validations/menu-merge";
import { mergeMenusLogic, revokeMergeLogic } from "@/server/menu-merge";
import { getRecipeCoverageLogic, getDraftsLogic } from "@/server/menu-lab-read";
import { draftRecipeInputSchema } from "@/lib/validations/menu-lab";
import { createDraftLogic } from "@/server/menu-lab";
import { getSalesSummaryLogic } from "@/server/sales";

describe("folding merged menus (ADR 0026 Q5)", () => {
  let tenantA: string;
  let userA: string;
  let branchA: string;
  let batchA: string;
  let posIntegrationA: string;
  let flour: ProductWithUnits;

  const today = computeBangkokToday();
  // Inside recipeInputSchema's 90-day backdate cap — the recipes here have to
  // be written through the real write path, and that path refuses more.
  const LONG_AGO = addDays(today, -60);

  const makeMenu = (name: string) =>
    withAdminContext((tx) =>
      tx.menu.create({
        data: {
          tenantId: tenantA,
          source: "POS",
          posIntegrationId: posIntegrationA,
          posMenuId: randomUUID().slice(0, 8),
          name: `${name}-${randomUUID().slice(0, 4)}`,
        },
        select: { id: true, name: true },
      })
    );

  const sell = (businessDate: Date, menuId: string, net: number, qty = 1) =>
    withAdminContext(async (tx) => {
      const day = await tx.salesDay.upsert({
        where: { branchId_businessDate: { branchId: branchA, businessDate } },
        create: {
          tenantId: tenantA,
          branchId: branchA,
          businessDate,
          currentBatchId: batchA,
        },
        update: {},
        select: { id: true },
      });
      return tx.salesLine.create({
        data: {
          tenantId: tenantA,
          branchId: branchA,
          businessDate,
          salesDayId: day.id,
          importBatchId: batchA,
          menuId,
          qty,
          grossAmount: net,
          discountAmount: 0,
          netAmount: net,
          serviceChargeAmount: 0,
          vatAmount: 0,
        },
        select: { id: true },
      });
    });

  const ing = (p: ProductWithUnits, qty: number) => ({
    productId: p.id,
    componentMenuId: null,
    qty,
    productUnitId: p.productUnits.find((u) => u.isBase)!.id,
    sortOrder: 0,
    notes: null,
  });

  const giveRecipe = (menuId: string, qty = 2) =>
    createRecipeLogic(
      tenantA,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId,
        outputProductId: null,
        servings: 1,
        effectiveFrom: LONG_AGO,
        ingredients: [ing(flour, qty)],
        notes: null,
      }),
      userA
    );

  const mergeOn = (loser: string, winner: string, effectiveFrom?: Date) =>
    mergeMenusLogic(
      tenantA,
      mergeMenusInputSchema.parse({
        submitKey: randomUUID(),
        losingMenuId: loser,
        winningMenuId: winner,
        ...(effectiveFrom === undefined ? {} : { effectiveFrom }),
        acknowledgeBackdate: "on",
      }),
      userA
    );

  const coverageOn = (day: Date) =>
    getRecipeCoverageLogic(tenantA, {
      branchId: branchA,
      from: day,
      to: day,
      limit: 50,
      hideWithDrafts: false,
    });

  const recipeFor = (menuId: string, asOf: Date) =>
    resolveRecipeIds(prisma, tenantA, [{ kind: "menu", id: menuId }], branchA, asOf);

  beforeAll(async () => {
    await withAdminContext(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Merge Fold Tenant" } });
      tenantA = t.id;
      const u = await tx.user.create({
        data: { email: `fold-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;
      const b = await tx.branch.create({
        data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" },
        select: { id: true },
      });
      branchA = b.id;
      const integ = await tx.posIntegration.create({
        data: { tenantId: t.id, branchId: b.id, posType: "CUSTOM", name: "POS" },
        select: { id: true },
      });
      posIntegrationA = integ.id;
      const prof = await tx.salesImportProfile.create({
        data: {
          tenantId: t.id,
          posIntegrationId: integ.id,
          name: "รายวัน",
          fileKind: "DAILY_SUMMARY",
          dateFormat: "yyyy-MM-dd",
          columnMap: {},
          headerSignature: `x-${randomUUID().slice(0, 6)}`,
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
      batchA = batch.id;
    });

    flour = await createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `FOLD-flour-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
      })
    );
  }, 180_000);

  afterAll(async () => {
    await withAdminContext(async (tx) => {
      await tx.menuMerge.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeIngredient.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeBranch.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipe.updateMany({
        where: { tenantId: tenantA },
        data: { supersededById: null, supersededAt: null },
      });
      await tx.recipe.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesLine.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesDay.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportBatch.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportProfile.deleteMany({ where: { tenantId: tenantA } });
      await tx.menu.deleteMany({ where: { tenantId: tenantA } });
      await tx.posIntegration.deleteMany({ where: { tenantId: tenantA } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId: tenantA } } });
      await tx.product.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.deleteMany({ where: { id: tenantA } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
    await prisma.$disconnect();
  }, 180_000);

  it("F1: coverage counts a merged dish once, covered by the winner's recipe", async () => {
    const day = addDays(today, -3);
    const dish = await makeMenu("F1 ข้าวผัดกุ้ง");
    const spelling = await makeMenu("F1 ขาวผัดกุ้ง");
    await giveRecipe(dish.id);

    await sell(day, dish.id, 1000);
    await sell(day, spelling.id, 500);

    // Before the merge: half the day's revenue has no recipe.
    const before = await coverageOn(day);
    expect(before.rows).toHaveLength(1);
    expect(before.rows[0].menuId).toBe(spelling.id);
    expect(Number(before.coveragePercent)).toBeCloseTo(66.67, 1);

    await mergeOn(spelling.id, dish.id);

    const after = await coverageOn(day);
    // One dish, fully covered — and the uncovered list is empty rather than
    // holding a row with ฿0.
    expect(after.rows).toHaveLength(0);
    expect(after.uncoveredMenuCount).toBe(0);
    expect(Number(after.coveragePercent)).toBeCloseTo(100, 6);
    expect(after.totalRevenue.toString()).toBe("1500");
  });

  it("F2: coverage folds RETROACTIVELY — today's merge fixes last month", async () => {
    const day = addDays(today, -45);
    const dish = await makeMenu("F2 ต้มยำกุ้ง");
    const spelling = await makeMenu("F2 ต้มยํากุ้ง");
    await giveRecipe(dish.id);
    await sell(day, dish.id, 300);
    await sell(day, spelling.id, 200);

    // Effective TODAY — the ledger will not fold that day at all (F5), and
    // reporting folds it anyway. That difference is the whole of Q5.
    await mergeOn(spelling.id, dish.id, today);

    const cov = await coverageOn(day);
    expect(cov.rows).toHaveLength(0);
    expect(Number(cov.coveragePercent)).toBeCloseTo(100, 6);
    expect(cov.totalRevenue.toString()).toBe("500");
  });

  it("F3: the sales screen shows one row, under the canonical name", async () => {
    const day = addDays(today, -6);
    const dish = await makeMenu("F3 ผัดกะเพราหมู");
    const spelling = await makeMenu("F3 กะเพราหมู");
    await sell(day, dish.id, 400, 4);
    await sell(day, spelling.id, 100, 1);

    await mergeOn(spelling.id, dish.id);

    const summary = await getSalesSummaryLogic(tenantA, {
      branchId: branchA,
      from: day,
      to: day,
      includeSuperseded: false,
    });
    const rows = summary.topMenus.filter(
      (m) => m.menuId === dish.id || m.menuId === spelling.id
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].menuId).toBe(dish.id);
    expect(rows[0].name).toBe(dish.name);
    expect(rows[0].net.toString()).toBe("500");
    expect(rows[0].qty.toString()).toBe("5");
  });

  it("F4: a dish has sales when they are filed under its other spelling", async () => {
    const dish = await makeMenu("F4 คอหมูย่าง");
    const spelling = await makeMenu("F4 คอหมู");
    // The dish itself has never sold under its canonical name.
    await sell(addDays(today, -8), spelling.id, 260);

    const draft = await createDraftLogic(
      tenantA,
      draftRecipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId: dish.id,
        newMenuName: null,
        menuCategoryId: null,
        servings: 1,
        plannedPrice: null,
        ingredients: [ing(flour, 1)],
        notes: null,
      }),
      userA
    );

    const before = (await getDraftsLogic(tenantA)).find(
      (d) => d.recipeId === draft.id
    );
    expect(before?.hasSales).toBe(false);

    await mergeOn(spelling.id, dish.id);

    const after = (await getDraftsLogic(tenantA)).find(
      (d) => d.recipeId === draft.id
    );
    // Q2's hint depends on this: once the dish sells, the sold price is the
    // price — and it sells under a name nobody typed into the lab.
    expect(after?.hasSales).toBe(true);
  });

  it("F5: the ledger folds ONLY from effective_from", async () => {
    const dish = await makeMenu("F5 แกงเขียวหวาน");
    const spelling = await makeMenu("F5 เขียวหวาน");
    const live = await giveRecipe(dish.id);
    const cutover = addDays(today, -10);

    await mergeOn(spelling.id, dish.id, cutover);

    // On and after the cutover the spelling borrows the dish's recipe.
    const on = await recipeFor(spelling.id, cutover);
    expect(on.get(`menu:${spelling.id}`)?.id).toBe(live.id);
    const after = await recipeFor(spelling.id, today);
    expect(after.get(`menu:${spelling.id}`)?.id).toBe(live.id);

    // The day before it, nothing — which is what keeps a re-post of that day
    // deducting exactly what it deducted the first time.
    const dayBefore = await recipeFor(spelling.id, addDays(cutover, -1));
    expect(dayBefore.has(`menu:${spelling.id}`)).toBe(false);
  });

  it("F6: a losing menu with its own recipe keeps it — a merge never overwrites", async () => {
    const dish = await makeMenu("F6 พะแนงเนื้อ");
    const spelling = await makeMenu("F6 พแนงเนื้อ");
    const dishRecipe = await giveRecipe(dish.id, 2);
    const ownRecipe = await giveRecipe(spelling.id, 5);

    await mergeOn(spelling.id, dish.id, LONG_AGO);

    const resolved = await recipeFor(spelling.id, today);
    // Its own, not the dish's — so every day this menu was ever posted against
    // deducts the same 5 kg it always did.
    expect(resolved.get(`menu:${spelling.id}`)?.id).toBe(ownRecipe.id);
    expect(resolved.get(`menu:${spelling.id}`)?.id).not.toBe(dishRecipe.id);
  });

  it("F7: a revoked merge folds nothing, at any date", async () => {
    const day = addDays(today, -4);
    const dish = await makeMenu("F7 ข้าวมันไก่");
    const spelling = await makeMenu("F7 ขาวมันไก่");
    await giveRecipe(dish.id);
    await sell(day, dish.id, 700);
    await sell(day, spelling.id, 300);

    const merged = await mergeOn(spelling.id, dish.id, LONG_AGO);
    expect((await coverageOn(day)).rows).toHaveLength(0);

    await revokeMergeLogic(
      tenantA,
      revokeMergeInputSchema.parse({ mergeId: merged.id, acknowledgePosted: "on" }),
      userA
    );

    // Reporting splits again immediately — nothing was overwritten, so nothing
    // has to be undone.
    const cov = await coverageOn(day);
    expect(cov.rows).toHaveLength(1);
    expect(cov.rows[0].menuId).toBe(spelling.id);

    // And the ledger stops borrowing, even before the effective date's reach.
    const resolved = await recipeFor(spelling.id, today);
    expect(resolved.has(`menu:${spelling.id}`)).toBe(false);
  });
});
