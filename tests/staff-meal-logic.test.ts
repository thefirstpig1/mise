// ============================================================
// Mise — staff meal write logic (Sprint 5 Part 26 L3, ADR 0028)
// ============================================================
// The document, both of its shapes, and the four ways a menu can refuse.
//
// The fixture buys nothing: negative stock never blocks (ADR 0011 Q9), so every
// balance starts at zero and goes negative by exactly what the recipe says.
// What the outflow is WORTH belongs to staff-meal-cost.test.ts, which is where
// the two defects ADR 0028 found are pinned.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { recipeInputSchema } from "@/lib/validations/recipe";
import { createRecipeLogic } from "@/server/recipe";
import { getStockBalanceLogic } from "@/server/stock-movement";
import { createStaffMealInputSchema } from "@/lib/validations/staff-meal";
import {
  createStaffMealLogic,
  createStaffMemberLogic,
  staffMealItemIdFor,
  StaffMealAlreadyVoidedError,
  StaffMealComponentNoRecipeError,
  StaffMealNoRecipeError,
  StaffMealPreppedIngredientError,
  voidStaffMealLogic,
} from "@/server/staff-meal";

describe("staff meal — writing (ADR 0028 Part 26 L3)", () => {
  let tenantA: string;
  let userA: string;
  let branchA: string;
  let batchId: string;
  let somchai: string;
  let departed: string;

  let pork: ProductWithUnits;
  let basil: ProductWithUnits;
  let prepped: ProductWithUnits;

  let kaphrao: { id: string; name: string };
  let noRecipeDish: { id: string; name: string };
  let setMenu: { id: string; name: string };
  let preppedDish: { id: string; name: string };
  let neverSold: { id: string; name: string };

  const today = computeBangkokToday();
  const RECIPES_FROM = addDays(today, -60);
  const YESTERDAY = addDays(today, -1);

  const baseUnitOf = (p: ProductWithUnits) =>
    p.productUnits.find((u) => u.isBase)!.id;

  const makeProduct = (tag: string, type: "RAW" | "PREPPED" = "RAW") =>
    createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `SM-${tag}-${randomUUID().slice(0, 6)}`,
        type,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [{ unitName: "g", toBaseRatio: 0.001, isBase: false }],
        defaultBuyUnitName: "kg",
      })
    );

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

  const makeRecipe = (
    menuId: string,
    products: [ProductWithUnits, number][],
    componentMenus: [string, number][] = []
  ) =>
    createRecipeLogic(
      tenantA,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId,
        outputProductId: null,
        servings: 1,
        effectiveFrom: RECIPES_FROM,
        ingredients: [
          ...products.map(([p, qty], i) => ({
            productId: p.id,
            componentMenuId: null,
            qty,
            productUnitId: baseUnitOf(p),
            sortOrder: i,
            notes: null,
          })),
          ...componentMenus.map(([id, qty], i) => ({
            productId: null,
            componentMenuId: id,
            qty,
            productUnitId: null,
            sortOrder: products.length + i,
            notes: null,
          })),
        ],
        notes: null,
      }),
      userA
    );

  const sell = async (menuId: string, qty: number, netAmount: number) => {
    await withRlsBypass(async (tx) => {
      const day = await tx.salesDay.upsert({
        where: {
          branchId_businessDate: { branchId: branchA, businessDate: YESTERDAY },
        },
        create: {
          tenantId: tenantA,
          branchId: branchA,
          businessDate: YESTERDAY,
          currentBatchId: batchId,
        },
        update: {},
        select: { id: true },
      });
      await tx.salesLine.create({
        data: {
          tenantId: tenantA,
          branchId: branchA,
          businessDate: YESTERDAY,
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

  const balance = (p: ProductWithUnits) =>
    getStockBalanceLogic(tenantA, { productId: p.id, branchId: branchA }).then(
      (b) => b.balance.toString()
    );

  const movementsFor = (p: ProductWithUnits) =>
    withRlsBypass((tx) =>
      tx.stockMovement.findMany({
        where: { tenantId: tenantA, productId: p.id },
        orderBy: { createdAt: "asc" },
        select: { type: true, qty: true, sourceType: true, sourceId: true },
      })
    );

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Staff Meal Tenant" } });
      tenantA = t.id;
      const b = await tx.branch.create({
        data: { tenantId: t.id, name: "ทองหล่อ", code: "SMT" },
      });
      branchA = b.id;
      const u = await tx.user.create({
        data: { email: `sm-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
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

    pork = await makeProduct("pork");
    basil = await makeProduct("basil");
    prepped = await makeProduct("sauce", "PREPPED");

    kaphrao = await makeMenu("กะเพราหมู");
    noRecipeDish = await makeMenu("เมนูไม่มีสูตร");
    setMenu = await makeMenu("ชุดพนักงาน");
    preppedDish = await makeMenu("เมนูมีของทำเอง");
    neverSold = await makeMenu("เมนูที่ไม่เคยขาย");

    await makeRecipe(kaphrao.id, [
      [pork, 0.1],
      [basil, 0.02],
    ]);
    // A set menu one level up, whose component has NO recipe of its own.
    await makeRecipe(setMenu.id, [[pork, 0.05]], [[noRecipeDish.id, 1]]);
    await makeRecipe(preppedDish.id, [[prepped, 0.2]]);
    await makeRecipe(neverSold.id, [[pork, 0.1]]);
    // planned_price is written by Menu Lab, not by createRecipeLogic — the
    // fixture arranges the state rather than driving the lab to reach it.
    await withRlsBypass((tx) =>
      tx.recipe.updateMany({
        where: { tenantId: tenantA, menuId: neverSold.id },
        data: { plannedPrice: 45 },
      })
    );

    somchai = (await createStaffMemberLogic(tenantA, {
      name: "สมชาย",
      branchId: branchA,
      dailyQuotaAmount: null,
    })).id;
    departed = (await createStaffMemberLogic(tenantA, {
      name: "คนที่ลาออกแล้ว",
      branchId: branchA,
      dailyQuotaAmount: null,
    })).id;
    await withRlsBypass((tx) =>
      tx.staffMember.update({
        where: { id: departed },
        data: { isActive: false },
      })
    );

    // 3 plates at ฿249 net → ฿83 a plate, so K7 has a SOLD price to freeze.
    await sell(kaphrao.id, 3, 249);
  }, 300_000);

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.stockMovement.deleteMany({ where: { tenantId: tenantA } });
      // Reversal rows first, and their pointers are NOT nulled on the way out:
      // staff_meal_item_product_unique covers (staff_meal_id, product_id) WHERE
      // reversal_of_item_id IS NULL, so clearing the pointer makes every
      // reversal collide with the original it reverses.
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
      await tx.productUnit.deleteMany({
        where: { product: { tenantId: tenantA } },
      });
      await tx.product.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.delete({ where: { id: tenantA } });
      await tx.user.delete({ where: { id: userA } });
    });
  }, 300_000);

  // ----------------------------------------------------------
  // The two shapes
  // ----------------------------------------------------------

  it("K1: a menu meal explodes the recipe and posts CONSUMPTION from STAFF_MEAL", async () => {
    const before = await balance(pork);
    const res = await eat({ servings: 2 });

    expect(res.itemCount).toBe(2);
    expect(res.replayed).toBe(false);

    // 2 servings × 100 g
    expect(Number(await balance(pork))).toBeCloseTo(Number(before) - 0.2, 5);

    const moves = await movementsFor(pork);
    const mine = moves.filter((m) => m.sourceType === "STAFF_MEAL");
    expect(mine).toHaveLength(1);
    // The type is CONSUMPTION — no movement type of its own. Who ate it is what
    // the source type is for (ADR 0028 Q8).
    expect(mine[0].type).toBe("CONSUMPTION");
    expect(mine[0].qty.toString()).toBe("-0.2");
  });

  it("K2: a pot meal deducts what was typed, converted from the unit typed", async () => {
    const before = await balance(basil);
    const gram = basil.productUnits.find((u) => !u.isBase)!;

    const res = await createStaffMealLogic(
      tenantA,
      createStaffMealInputSchema.parse({
        submitKey: randomUUID(),
        branchId: branchA,
        businessDate: today,
        staffMemberId: "",
        menuId: "",
        servings: 1,
        items: [{ productId: basil.id, inputQty: 500, inputUnitId: gram.id }],
        recordedByName: "หัวหน้าครัว",
        notes: "แกงหม้อใหญ่",
      }),
      userA
    );

    expect(res.itemCount).toBe(1);
    // No menu, so nothing to price. NONE, and the price is null — not 0.00,
    // which would read as "the meal was free" (rule S3).
    expect(res.priceSource).toBe("NONE");
    expect(res.unitPrice).toBeNull();

    expect(Number(await balance(basil))).toBeCloseTo(Number(before) - 0.5, 5);

    // The unit the person typed is kept, so re-opening shows 500 g and not 0.5 kg.
    const item = await withRlsBypass((tx) =>
      tx.staffMealItem.findFirst({
        where: { staffMealId: res.id },
        select: { inputQty: true, inputUnitId: true, qty: true },
      })
    );
    expect(item?.inputQty?.toString()).toBe("500");
    expect(item?.inputUnitId).toBe(gram.id);
    expect(item?.qty.toString()).toBe("-0.5");
  });

  // ----------------------------------------------------------
  // The replay, which is the whole reason the item ids are derived
  // ----------------------------------------------------------

  it("K3: the same submit key twice deducts once, items included", async () => {
    const submitKey = randomUUID();
    const before = await balance(pork);

    const first = await eat({ submitKey });
    const second = await eat({ submitKey });

    expect(first.id).toBe(second.id);
    expect(second.replayed).toBe(true);

    // ONE serving deducted, not two.
    expect(Number(await balance(pork))).toBeCloseTo(Number(before) - 0.1, 5);

    // And the item's id is the DERIVED one, which is what makes the ledger's
    // UNIQUE(source_type, source_id) reachable from a re-press that somehow got
    // past the document check.
    const items = await withRlsBypass((tx) =>
      tx.staffMealItem.findMany({
        where: { staffMealId: first.id },
        select: { id: true, productId: true },
      })
    );
    expect(items).toHaveLength(2);
    for (const i of items) {
      expect(i.id).toBe(staffMealItemIdFor(submitKey, i.productId));
    }
  });

  // ----------------------------------------------------------
  // Voiding
  // ----------------------------------------------------------

  it("K4: a void appends reversal items and leaves the original standing", async () => {
    const before = await balance(pork);
    const meal = await eat();
    expect(Number(await balance(pork))).toBeCloseTo(Number(before) - 0.1, 5);

    const voided = await voidStaffMealLogic(
      tenantA,
      { id: meal.id, voidReason: "คีย์ผิดคน" },
      userA
    );
    expect(voided.reversedItems).toBe(2);

    // Stock is back where it started.
    expect(Number(await balance(pork))).toBeCloseTo(Number(before), 5);

    const doc = await withRlsBypass((tx) =>
      tx.staffMeal.findUnique({
        where: { id: meal.id },
        select: {
          voidedAt: true,
          voidReason: true,
          items: { select: { qty: true, reversalOfItemId: true } },
        },
      })
    );
    // Nothing is deleted and nothing is edited: four items, two of them
    // reversals pointing at the two originals.
    expect(doc?.voidedAt).not.toBeNull();
    expect(doc?.voidReason).toBe("คีย์ผิดคน");
    expect(doc?.items).toHaveLength(4);
    expect(doc?.items.filter((i) => i.reversalOfItemId !== null)).toHaveLength(2);

    const moves = await movementsFor(pork);
    expect(
      moves.filter((m) => m.type === "CONSUMPTION_REVERSAL")
    ).not.toHaveLength(0);
  });

  it("K5: voiding twice is refused — the second would credit the stock back again", async () => {
    const meal = await eat();
    await voidStaffMealLogic(tenantA, { id: meal.id, voidReason: "ผิด" }, userA);
    const after = await balance(pork);

    await expect(
      voidStaffMealLogic(tenantA, { id: meal.id, voidReason: "ผิดอีก" }, userA)
    ).rejects.toBeInstanceOf(StaffMealAlreadyVoidedError);

    expect(await balance(pork)).toBe(after);
  });

  // ----------------------------------------------------------
  // Whole or not at all — the four refusals
  // ----------------------------------------------------------

  it("K6: a dish with no recipe writes NOTHING, rather than a meal that deducts nothing", async () => {
    const before = await balance(pork);
    const countBefore = await withRlsBypass((tx) =>
      tx.staffMeal.count({ where: { tenantId: tenantA } })
    );

    await expect(eat({ menuId: noRecipeDish.id })).rejects.toBeInstanceOf(
      StaffMealNoRecipeError
    );

    expect(await balance(pork)).toBe(before);
    expect(
      await withRlsBypass((tx) =>
        tx.staffMeal.count({ where: { tenantId: tenantA } })
      )
    ).toBe(countBefore);
  });

  it("K7: a set menu whose component has no recipe is refused BEFORE the walk", async () => {
    const before = await balance(pork);

    // This is the dangerous one: explodeToRaw returns SILENTLY for a recipeless
    // component, so without the pre-scan the meal would deduct 50 g of pork —
    // a real number, a real document, and short by the whole component.
    const err = await eat({ menuId: setMenu.id }).catch((e) => e);
    expect(err).toBeInstanceOf(StaffMealComponentNoRecipeError);
    expect((err as StaffMealComponentNoRecipeError).componentMenuId).toBe(
      noRecipeDish.id
    );

    expect(await balance(pork)).toBe(before);
  });

  it("K8: a PREPPED ingredient is refused — nothing can ever raise its balance back", async () => {
    const before = await balance(prepped);

    await expect(eat({ menuId: preppedDish.id })).rejects.toBeInstanceOf(
      StaffMealPreppedIngredientError
    );

    // Not driven negative for ever on a product nobody can restock
    // (ADR 0021 Q11).
    expect(await balance(prepped)).toBe(before);
  });

  // ----------------------------------------------------------
  // The price that is frozen, and is not a cost
  // ----------------------------------------------------------

  it("K9: a dish that has sold freezes the SOLD price, net of VAT and service charge", async () => {
    const res = await eat();
    expect(res.priceSource).toBe("SOLD");
    // 249 / 3 — the net figure, which is what ADR 0025 Q2 calls the price.
    expect(res.unitPrice?.toString()).toBe("83");
  });

  it("K10: a dish nobody has bought falls back to ราคาที่ตั้งใจ, and says so", async () => {
    const res = await eat({ menuId: neverSold.id });
    expect(res.priceSource).toBe("PLANNED");
    expect(res.unitPrice?.toString()).toBe("45");
  });

  it("K11: the frozen price does not move when later sales change it", async () => {
    const meal = await eat();
    expect(meal.unitPrice?.toString()).toBe("83");

    // The shop puts the price up. Last month's quota check must not follow it —
    // this is the whole reason the number is frozen rather than derived on read
    // (rule S2).
    await sell(kaphrao.id, 1, 200);

    const stored = await withRlsBypass((tx) =>
      tx.staffMeal.findUnique({
        where: { id: meal.id },
        select: { frozenUnitPrice: true },
      })
    );
    expect(stored?.frozenUnitPrice?.toString()).toBe("83");

    // A meal recorded AFTER the change gets the new figure, which is the other
    // half of the same rule.
    const later = await eat();
    expect(later.unitPrice?.toString()).toBe("112.25");
  });

  // ----------------------------------------------------------
  // Someone who has left
  // ----------------------------------------------------------

  it("K12: a meal can still be recorded against someone who no longer works here", async () => {
    // is_active is a claim about the FUTURE (rule S7). Refusing here would make
    // a backdated correction impossible for exactly the person most likely to
    // need one — and the food left the shelf either way.
    const res = await eat({ staffMemberId: departed, businessDate: YESTERDAY });
    expect(res.itemCount).toBe(2);
  });
});
