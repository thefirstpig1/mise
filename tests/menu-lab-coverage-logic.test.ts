// ============================================================
// Mise — recipe coverage (Part 24 L3c, ADR 0025 Q5)
// ============================================================
// The list that answers "how much of my gross profit is currently guessed?".
//
//   C1  uncovered dishes rank by REVENUE, and the covered ones are absent
//   C2  a draft is not coverage — it is somebody's work in progress
//   C3  a replaced day's rows are evidence, not revenue
//   C4  "covered" means covered FOR THIS BRANCH when a branch is named
//   C5  a similar name is a HINT, and it says whether that dish has a recipe
//   C6  the list is capped, and an empty period has no percentage
//
// Every test owns its own business DATE and queries `from = to = that date`, so
// the totals it asserts on are its own and not the whole tenant's.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withAdminContext, prisma } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { recipeInputSchema } from "@/lib/validations/recipe";
import { draftRecipeInputSchema } from "@/lib/validations/menu-lab";
import { createRecipeLogic } from "@/server/recipe";
import { createDraftLogic } from "@/server/menu-lab";
import { getRecipeCoverageLogic } from "@/server/menu-lab-read";

describe("recipe coverage (ADR 0025 Q5)", () => {
  let tenantA: string;
  let branchA: string;
  let branchB: string;
  let userA: string;
  let batchA: string;
  let batchB: string;
  let flour: ProductWithUnits;

  const today = computeBangkokToday();
  // Inside the ledger's backdate window: recipeInputSchema refuses an effective
  // date more than MAX_BACKDATE_DAYS old (ADR 0021 Q4).
  const LONG_AGO = addDays(today, -80);
  /** One date per test, none of them today, none of them shared. */
  const DAY = (n: number) => addDays(today, -n);

  const makeMenu = (name: string) =>
    withAdminContext((tx) =>
      tx.menu.create({
        data: { tenantId: tenantA, source: "MISE", name },
        select: { id: true, name: true },
      })
    );

  const baseUnitOf = (p: ProductWithUnits) =>
    p.productUnits.find((u) => u.isBase)!.id;

  const ing = (p: ProductWithUnits, qty: number) => ({
    productId: p.id,
    componentMenuId: null,
    qty,
    productUnitId: baseUnitOf(p),
    sortOrder: 0,
    notes: null,
  });

  const giveRecipe = (menuId: string) =>
    createRecipeLogic(
      tenantA,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId,
        outputProductId: null,
        servings: 1,
        effectiveFrom: LONG_AGO,
        ingredients: [ing(flour, 2)],
        notes: null,
      }),
      userA
    );

  const giveDraft = (menuId: string) =>
    createDraftLogic(
      tenantA,
      draftRecipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId,
        newMenuName: null,
        menuCategoryId: null,
        servings: 1,
        plannedPrice: null,
        ingredients: [ing(flour, 2)],
        notes: null,
      }),
      userA
    );

  /** A recipe that belongs to ONE branch and never reaches the other (Q8). */
  const giveBranchOnlyRecipe = (menuId: string, branchId: string) =>
    withAdminContext(async (tx) => {
      const lineId = randomUUID();
      const r = await tx.recipe.create({
        data: {
          tenantId: tenantA,
          lineId,
          menuId,
          servings: 1,
          effectiveFrom: LONG_AGO,
          createdBy: userA,
        },
        select: { id: true },
      });
      await tx.recipeIngredient.create({
        data: {
          tenantId: tenantA,
          recipeId: r.id,
          productId: flour.id,
          productUnitId: baseUnitOf(flour),
          qty: 2,
          sortOrder: 0,
        },
      });
      await tx.recipeBranch.create({
        // `recipeId` too: resolution keys on the LINE, but the row carries one
        // version so a stray link can be traced back to what created it.
        data: {
          tenantId: tenantA,
          lineId,
          branchId,
          recipeId: r.id,
          createdBy: userA,
        },
      });
      return r;
    });

  const sell = (
    branchId: string,
    batchId: string,
    businessDate: Date,
    menuId: string,
    qty: number,
    net: number
  ) =>
    withAdminContext(async (tx) => {
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
      return tx.salesLine.create({
        data: {
          tenantId: tenantA,
          branchId,
          businessDate,
          salesDayId: day.id,
          importBatchId: batchId,
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

  const coverageOn = (branchId: string | null, day: Date, over = {}) =>
    getRecipeCoverageLogic(tenantA, {
      branchId: branchId ?? undefined,
      from: day,
      to: day,
      limit: 50,
      hideWithDrafts: false,
      ...over,
    });

  beforeAll(async () => {
    await withAdminContext(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Coverage Tenant" } });
      tenantA = t.id;
      const u = await tx.user.create({
        data: { email: `cov-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;

      const makeBranch = async (name: string, code: string) => {
        const b = await tx.branch.create({
          data: { tenantId: t.id, name, code },
          select: { id: true },
        });
        const integ = await tx.posIntegration.create({
          data: { tenantId: t.id, branchId: b.id, posType: "CUSTOM", name: "POS" },
          select: { id: true },
        });
        const prof = await tx.salesImportProfile.create({
          data: {
            tenantId: t.id,
            posIntegrationId: integ.id,
            name: `รายวัน-${code}`,
            fileKind: "DAILY_SUMMARY",
            dateFormat: "yyyy-MM-dd",
            columnMap: {},
            headerSignature: `x-${code}`,
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
        return { branchId: b.id, batchId: batch.id };
      };

      const a = await makeBranch("ทองหล่อ", "THL");
      const b = await makeBranch("อโศก", "ASK");
      branchA = a.branchId;
      batchA = a.batchId;
      branchB = b.branchId;
      batchB = b.batchId;
    });

    flour = await createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `COV-flour-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
      })
    );
  }, 120_000);

  afterAll(async () => {
    await withAdminContext(async (tx) => {
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
      await tx.productUnit.deleteMany({
        where: { product: { tenantId: tenantA } },
      });
      await tx.product.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.deleteMany({ where: { id: tenantA } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
    await prisma.$disconnect();
  }, 120_000);

  it("C1: uncovered dishes rank by revenue, covered ones are absent", async () => {
    const day = DAY(3);
    const curry = await makeMenu("C1 แกงเขียวหวาน");
    const soda = await makeMenu("C1 น้ำอัดลม");
    const rice = await makeMenu("C1 ข้าวสวย");

    await giveRecipe(rice.id);

    await sell(branchA, batchA, day, curry.id, 40, 7200); // ฿180 × 40
    await sell(branchA, batchA, day, soda.id, 400, 6000); // ฿15 × 400
    await sell(branchA, batchA, day, rice.id, 100, 1000);

    const cov = await coverageOn(branchA, day);

    expect(cov.rows.map((r) => r.menuId)).toEqual([curry.id, soda.id]);
    expect(cov.totalRevenue.toString()).toBe("14200");
    expect(cov.coveredRevenue.toString()).toBe("1000");
    expect(cov.uncoveredRevenue.toString()).toBe("13200");
    // 1000 / 14200 — printed by the serializer, kept exact here.
    expect(Number(cov.coveragePercent)).toBeCloseTo(7.042, 3);
    expect(cov.uncoveredMenuCount).toBe(2);

    const curryRow = cov.rows[0];
    expect(curryRow.revenue.toString()).toBe("7200");
    expect(curryRow.qty.toString()).toBe("40");
    expect(Number(curryRow.shareOfRevenue)).toBeCloseTo(50.704, 3);
    expect(curryRow.hasDraft).toBe(false);
    expect(curryRow.isDeleted).toBe(false);
  });

  it("C2: a draft is not coverage", async () => {
    const day = DAY(4);
    const menu = await makeMenu("C2 ผัดกะเพรา");
    await giveDraft(menu.id);
    await sell(branchA, batchA, day, menu.id, 10, 800);

    const cov = await coverageOn(branchA, day);
    const row = cov.rows.find((r) => r.menuId === menu.id);

    // It cannot cost a day and cannot consume stock, so the profit is still
    // guessed — but somebody is on it, and the row says so.
    expect(row).toBeDefined();
    expect(row!.hasDraft).toBe(true);
    expect(cov.coveredRevenue.toString()).toBe("0");

    const hidden = await coverageOn(branchA, day, { hideWithDrafts: true });
    expect(hidden.rows.find((r) => r.menuId === menu.id)).toBeUndefined();
    // Hiding a row does not pretend the money is covered.
    expect(hidden.coveredRevenue.toString()).toBe("0");
    expect(hidden.uncoveredRevenue.toString()).toBe("800");
  });

  it("C3: a replaced day's rows are evidence, not revenue", async () => {
    const day = DAY(5);
    const menu = await makeMenu("C3 ต้มยำกุ้ง");
    const replaced = await sell(branchA, batchA, day, menu.id, 5, 500);
    await sell(branchA, batchA, day, menu.id, 6, 600);

    await withAdminContext((tx) =>
      tx.salesLine.update({
        where: { id: replaced.id },
        data: { supersededAt: new Date(), supersededByBatchId: batchA },
      })
    );

    const cov = await coverageOn(branchA, day);
    const row = cov.rows.find((r) => r.menuId === menu.id);

    // 600, not 1100: a re-imported day would otherwise send its own dishes to
    // the top of the list by counting them twice.
    expect(row!.revenue.toString()).toBe("600");
    expect(row!.qty.toString()).toBe("6");
  });

  it("C4: covered means covered FOR THIS BRANCH", async () => {
    const day = DAY(6);
    const menu = await makeMenu("C4 หมูกระทะ");
    await giveBranchOnlyRecipe(menu.id, branchB);

    await sell(branchA, batchA, day, menu.id, 3, 900);
    await sell(branchB, batchB, day, menu.id, 3, 900);

    const atB = await coverageOn(branchB, day);
    expect(atB.rows.find((r) => r.menuId === menu.id)).toBeUndefined();
    expect(atB.coveredRevenue.toString()).toBe("900");

    // อโศก wrote its own recipe; ทองหล่อ still has none, and a list that called
    // this dish covered everywhere would send nobody to write it.
    const atA = await coverageOn(branchA, day);
    expect(atA.rows.find((r) => r.menuId === menu.id)).toBeDefined();
    expect(atA.coveredRevenue.toString()).toBe("0");

    // With no branch named the question is deliberately weaker: does a recipe
    // for this dish exist anywhere.
    const anywhere = await getRecipeCoverageLogic(tenantA, {
      from: day,
      to: day,
      limit: 50,
      hideWithDrafts: false,
    });
    expect(anywhere.rows.find((r) => r.menuId === menu.id)).toBeUndefined();
  });

  it("C5: a similar name is a hint, and it says whether that dish has a recipe", async () => {
    const day = DAY(7);
    const plain = await makeMenu("ข้าวผัดกุ้ง");
    const special = await makeMenu("ข้าวผัดกุ้งพิเศษ");

    await sell(branchA, batchA, day, plain.id, 10, 900);
    await sell(branchA, batchA, day, special.id, 5, 600);

    const before = await coverageOn(branchA, day);
    const plainRow = before.rows.find((r) => r.menuId === plain.id);

    expect(plainRow?.duplicateHint?.menuId).toBe(special.id);
    expect(plainRow?.duplicateHint?.score).toBeGreaterThan(0.4);
    // Nothing was grouped or merged: both dishes are still their own row.
    expect(before.rows.filter((r) => r.menuId === special.id)).toHaveLength(1);
    expect(plainRow?.duplicateHint?.hasRecipe).toBe(false);
    expect(before.hintedRowCount).toBe(before.rows.length);

    // Once the twin has a recipe the hint means something different: there is a
    // recipe to copy, not two dishes both still to write.
    await giveRecipe(special.id);
    const after = await coverageOn(branchA, day);
    expect(
      after.rows.find((r) => r.menuId === plain.id)?.duplicateHint?.hasRecipe
    ).toBe(true);
  });

  it("C6: the list is capped, and an empty period has no percentage", async () => {
    const day = DAY(8);
    const menus = await Promise.all([
      makeMenu("C6 ก๋วยเตี๋ยว"),
      makeMenu("C6 ราดหน้า"),
      makeMenu("C6 ผัดซีอิ๊ว"),
    ]);
    let net = 300;
    for (const m of menus) {
      await sell(branchA, batchA, day, m.id, 1, net);
      net -= 100;
    }

    const capped = await coverageOn(branchA, day, { limit: 2 });
    expect(capped.rows).toHaveLength(2);
    // The cap shortens the LIST, never the count — otherwise "you have two
    // dishes left" would be a lie told by a page size.
    expect(capped.uncoveredMenuCount).toBe(3);
    expect(capped.rows[0].menuId).toBe(menus[0].id);

    const quiet = await coverageOn(branchA, DAY(9));
    expect(quiet.rows).toEqual([]);
    expect(quiet.uncoveredMenuCount).toBe(0);
    // Not 0%: there is nothing to cover, which is a different sentence.
    expect(quiet.coveragePercent).toBeNull();
  });
});
