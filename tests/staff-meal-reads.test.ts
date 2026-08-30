// ============================================================
// Mise — staff meal reads (Sprint 5 Part 26 L3c, ADR 0028)
// ============================================================
// The two reads that exist to SAY something the writer refuses to enforce, and
// the one rule this Part inherits whole from Part 27.
//
// R3 and R4 are the pair worth reading: a quota that reports a floor as if it
// were a total is worse than no quota, and a warning that cannot say WHICH
// zero-price line is which is the blunt `net = 0` test the grill rejected.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { recipeInputSchema } from "@/lib/validations/recipe";
import { createRecipeLogic } from "@/server/recipe";
import { createStaffMealInputSchema } from "@/lib/validations/staff-meal";
import { createStaffMealLogic, createStaffMemberLogic } from "@/server/staff-meal";
import {
  getStaffMealQuotaLogic,
  getStaffMealsLogic,
  getStaffMembersLogic,
  getZeroPriceSalesWarningLogic,
} from "@/server/staff-meal-read";

describe("staff meal — reads (ADR 0028 Part 26 L3c)", () => {
  let tenantA: string;
  let userA: string;
  let branchA: string;
  let batchId: string;
  let somchai: string;
  let departed: string;

  let pork: ProductWithUnits;
  let kaphrao: { id: string; name: string };
  let noPrice: { id: string; name: string };

  const today = computeBangkokToday();
  const RECIPES_FROM = addDays(today, -60);
  const SALES_DAY = addDays(today, -1);

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
        select: { id: true, name: true },
      })
    );

  const makeRecipe = (menuId: string) =>
    createRecipeLogic(
      tenantA,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId,
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

  const eat = (over: Record<string, unknown> = {}) =>
    createStaffMealLogic(
      tenantA,
      createStaffMealInputSchema.parse({
        submitKey: randomUUID(),
        branchId: branchA,
        businessDate: today,
        staffMemberId: somchai,
        menuId: kaphrao.id,
        servings: 1,
        items: [],
        recordedByName: "",
        notes: "",
        ...over,
      }),
      userA
    );

  /** A sales line that collected nothing, carrying whatever tag the POS wrote. */
  const zeroPriceLine = async (
    menuId: string,
    gross: number,
    discountReason: string | null
  ) => {
    await withRlsBypass(async (tx) => {
      const day = await tx.salesDay.upsert({
        where: {
          branchId_businessDate: { branchId: branchA, businessDate: SALES_DAY },
        },
        create: {
          tenantId: tenantA,
          branchId: branchA,
          businessDate: SALES_DAY,
          currentBatchId: batchId,
        },
        update: {},
        select: { id: true },
      });
      await tx.salesLine.create({
        data: {
          tenantId: tenantA,
          branchId: branchA,
          businessDate: SALES_DAY,
          salesDayId: day.id,
          importBatchId: batchId,
          menuId,
          qty: 1,
          grossAmount: gross,
          discountAmount: gross,
          netAmount: 0,
          serviceChargeAmount: 0,
          vatAmount: 0,
          discountReason,
        },
      });
    });
  };

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({
        data: { name: "Staff Meal Read Tenant", staffMealDailyQuota: 100 },
      });
      tenantA = t.id;
      const b = await tx.branch.create({
        data: { tenantId: t.id, name: "ทองหล่อ", code: "SMR" },
      });
      branchA = b.id;
      const u = await tx.user.create({
        data: { email: `smr-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
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
    });

    pork = await createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `SMR-pork-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
      })
    );

    kaphrao = await makeMenu("กะเพราหมู");
    noPrice = await makeMenu("เมนูไม่มีราคา");
    await makeRecipe(kaphrao.id);
    await makeRecipe(noPrice.id);

    somchai = (
      await createStaffMemberLogic(tenantA, {
        name: "สมชาย",
        branchId: branchA,
        dailyQuotaAmount: null,
      })
    ).id;
    departed = (
      await createStaffMemberLogic(tenantA, {
        name: "คนที่ลาออกแล้ว",
        branchId: branchA,
        dailyQuotaAmount: null,
      })
    ).id;
    await withRlsBypass((tx) =>
      tx.staffMember.update({
        where: { id: departed },
        data: { isActive: false },
      })
    );

    // กะเพรา sells for ฿60 net a plate. เมนูไม่มีราคา never sells and has no
    // planned price, so it stays NONE.
    await withRlsBypass(async (tx) => {
      const day = await tx.salesDay.create({
        data: {
          tenantId: tenantA,
          branchId: branchA,
          businessDate: addDays(today, -3),
          currentBatchId: batchId,
        },
        select: { id: true },
      });
      await tx.salesLine.create({
        data: {
          tenantId: tenantA,
          branchId: branchA,
          businessDate: addDays(today, -3),
          salesDayId: day.id,
          importBatchId: batchId,
          menuId: kaphrao.id,
          qty: 10,
          grossAmount: 600,
          discountAmount: 0,
          netAmount: 600,
          serviceChargeAmount: 0,
          vatAmount: 0,
        },
      });
    });
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
      await tx.salesLine.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesDay.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportBatch.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportProfile.deleteMany({ where: { tenantId: tenantA } });
      await tx.posIntegration.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeIngredient.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeBranch.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipe.deleteMany({ where: { tenantId: tenantA } });
      await tx.menu.deleteMany({ where: { tenantId: tenantA } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId: tenantA } } });
      await tx.product.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.delete({ where: { id: tenantA } });
      await tx.user.delete({ where: { id: userA } });
    });
  }, 300_000);

  // ----------------------------------------------------------
  // The roster, and the person who left
  // ----------------------------------------------------------

  it("R1: includeInactive decides, and neither answer is the default", async () => {
    const active = await getStaffMembersLogic(tenantA, {
      branchId: branchA,
      includeInactive: false,
    });
    expect(active.map((r) => r.id)).toContain(somchai);
    expect(active.map((r) => r.id)).not.toContain(departed);

    const all = await getStaffMembersLogic(tenantA, {
      branchId: branchA,
      includeInactive: true,
    });
    expect(all.map((r) => r.id)).toEqual(
      expect.arrayContaining([somchai, departed])
    );
    expect(all.find((r) => r.id === departed)!.isActive).toBe(false);
  });

  it("R2: a person who left is LABELLED in history, never dropped from it", async () => {
    await eat({ staffMemberId: departed });

    const history = await getStaffMealsLogic(tenantA, {
      branchId: branchA,
      includeVoided: false,
    });
    const row = history.rows.find((r) => r.staffMemberId === departed);

    // Present, named, and marked. Dropping the row would move last month's
    // figure by pressing a button today — ADR 0027's L1/L3, one table across.
    expect(row).toBeDefined();
    expect(row!.staffMemberName).toBe("คนที่ลาออกแล้ว");
    expect(row!.staffMemberRetired).toBe(true);
  });

  // ----------------------------------------------------------
  // The quota, which reports and never refuses
  // ----------------------------------------------------------

  it("R3: going over the quota is RECORDED and reported, never blocked", async () => {
    // ฿60 a plate against the tenant's ฿100/day. Two plates is over.
    await eat();
    const one = await getStaffMealQuotaLogic(tenantA, {
      staffMemberId: somchai,
      businessDate: today,
    });
    expect(one.quota!.toString()).toBe("100");
    expect(one.quotaSource).toBe("TENANT");
    expect(one.used.toString()).toBe("60");
    expect(one.over).toBe(false);

    // The second plate is accepted. The food was eaten; refusing the record
    // would not put it back, it would only hide that anybody went over.
    const second = await eat();
    expect(second.replayed).toBe(false);

    const two = await getStaffMealQuotaLogic(tenantA, {
      staffMemberId: somchai,
      businessDate: today,
    });
    expect(two.used.toString()).toBe("120");
    expect(two.over).toBe(true);
  });

  it("R4: a meal with no price makes `used` a FLOOR, and the read says so", async () => {
    // เมนูไม่มีราคา has never sold and has no planned price, so the meal freezes
    // at NONE. Counting it as ฿0 would report "฿120 / ฿150 — fine" for a day
    // that might be well over.
    await eat({ menuId: noPrice.id });

    const q = await getStaffMealQuotaLogic(tenantA, {
      staffMemberId: somchai,
      businessDate: today,
    });
    expect(q.unpricedCount).toBe(1);
    // The money total is unchanged by a meal it cannot price, which is exactly
    // why the count has to travel beside it.
    expect(q.used.toString()).toBe("120");
  });

  it("R5: a shop with no quota is not a shop whose quota is zero", async () => {
    await withRlsBypass((tx) =>
      tx.tenant.update({
        where: { id: tenantA },
        data: { staffMealDailyQuota: null },
      })
    );
    const q = await getStaffMealQuotaLogic(tenantA, {
      staffMemberId: somchai,
      businessDate: today,
    });
    expect(q.quota).toBeNull();
    expect(q.quotaSource).toBe("NONE");
    // Used is still real; only the verdict is withheld.
    expect(q.used.toString()).toBe("120");
    expect(q.over).toBe(false);

    await withRlsBypass((tx) =>
      tx.tenant.update({
        where: { id: tenantA },
        data: { staffMealDailyQuota: 100 },
      })
    );
  });

  it("R6: a person's own quota beats the tenant default, and says which", async () => {
    await withRlsBypass((tx) =>
      tx.staffMember.update({
        where: { id: somchai },
        data: { dailyQuotaAmount: 500 },
      })
    );
    const q = await getStaffMealQuotaLogic(tenantA, {
      staffMemberId: somchai,
      businessDate: today,
    });
    expect(q.quota!.toString()).toBe("500");
    expect(q.quotaSource).toBe("PERSON");
    expect(q.over).toBe(false);

    await withRlsBypass((tx) =>
      tx.staffMember.update({
        where: { id: somchai },
        data: { dailyQuotaAmount: null },
      })
    );
  });

  // ----------------------------------------------------------
  // The warning that stops the food being deducted twice
  // ----------------------------------------------------------

  it("R7: the warning names the POS's own tags — it does not lump them together", async () => {
    await zeroPriceLine(kaphrao.id, 89, "อาหารพนักงาน");
    await zeroPriceLine(kaphrao.id, 89, "อาหารพนักงาน");
    await zeroPriceLine(noPrice.id, 120, "ของแถม");
    // A file that carried no tag column at all: still counted, still shown, and
    // shown as unknown rather than guessed at.
    await zeroPriceLine(noPrice.id, 45, null);

    const w = await getZeroPriceSalesWarningLogic(tenantA, {
      branchId: branchA,
      businessDate: SALES_DAY,
    });

    expect(w.totalLines).toBe(4);
    // Three groups, ordered by how many lines each covers. A blunt `net = 0`
    // count would have said "4" and left the reader to guess which were meals.
    expect(w.tags).toHaveLength(3);
    expect(w.tags[0].discountReason).toBe("อาหารพนักงาน");
    expect(w.tags[0].lines).toBe(2);
    expect(w.tags[0].grossAmount.toString()).toBe("178");
    expect(w.tags.map((t) => t.discountReason)).toContain(null);
  });

  it("R8: a cancelled bill is not a giveaway, and stays out of the warning", async () => {
    await withRlsBypass(async (tx) => {
      const day = await tx.salesDay.findFirstOrThrow({
        where: { branchId: branchA, businessDate: SALES_DAY },
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
          // A bill coming back, not a dish going out for nothing.
          qty: -1,
          grossAmount: 0,
          discountAmount: 0,
          netAmount: 0,
          serviceChargeAmount: 0,
          vatAmount: 0,
          discountReason: "ยกเลิกบิล",
        },
      });
    });

    const w = await getZeroPriceSalesWarningLogic(tenantA, {
      branchId: branchA,
      businessDate: SALES_DAY,
    });
    expect(w.totalLines).toBe(4);
    expect(w.tags.map((t) => t.discountReason)).not.toContain("ยกเลิกบิล");
  });

  it("R9: a day with nothing to warn about warns about nothing", async () => {
    const w = await getZeroPriceSalesWarningLogic(tenantA, {
      branchId: branchA,
      businessDate: addDays(today, -3),
    });
    expect(w.totalLines).toBe(0);
    expect(w.tags).toHaveLength(0);
  });

  // ----------------------------------------------------------
  // History totals
  // ----------------------------------------------------------

  it("R10: the history total is a SELLING-price figure and counts what it cannot price", async () => {
    const h = await getStaffMealsLogic(tenantA, {
      branchId: branchA,
      staffMemberId: somchai,
      includeVoided: false,
    });
    // Two กะเพรา at ฿60 = ฿120, plus one meal that has no price at all.
    expect(h.totalValue.toString()).toBe("120");
    expect(h.unpricedCount).toBe(1);
  });
});
