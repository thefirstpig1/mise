// ============================================================
// Mise — what a day's sales actually ate (Sprint 5 Part 22 L3a)
// ============================================================
// `computeConsumptionForDayLogic`. It writes nothing: it reads sales, resolves
// the recipe that applied ON THAT DAY, explodes it, and reports what it could
// not do. The money is deliberately absent — posting needs quantities, and cost
// is the FIFO replay's business at read time (ADR 0014) — so this fixture buys
// NOTHING. No supplier, no PO, no receipt.
//
// Its own tenant, for the reason recipe-list-logic.test.ts gives: a read that
// answers for a whole day depends on everything in the tenant, so sharing a
// fixture would make every assertion depend on how many tests ran first.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withAdminContext } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { recipeInputSchema } from "@/lib/validations/recipe";
import { createRecipeLogic, updateRecipeLogic } from "@/server/recipe";
import { MAX_BACKDATE_DAYS } from "@/lib/validations/stock-movement";
import {
  computeConsumptionForDayLogic,
  isWithinBackdateWindow,
} from "@/server/consumption";
import { prisma } from "@/lib/db";

describe("consumption demand (ADR 0022 Part 22 L3a)", () => {
  let tenantA: string;
  let userA: string;
  let branchA: string;
  let branchB: string;
  let integrationId: string;
  let profileId: string;
  let batchId: string;

  let pork: ProductWithUnits;
  let basil: ProductWithUnits;
  let chilli: ProductWithUnits;
  let riceRaw: ProductWithUnits;
  /** PREPPED by one parent + yield (ADR 0007) — the walk divides by it. */
  let riceCooked: ProductWithUnits;
  /** PREPPED with NEITHER method — the walker refuses to guess at it. */
  let mystery: ProductWithUnits;

  let kaphrao: { id: string; name: string };
  let omelette: { id: string; name: string };
  let noRecipeDish: { id: string; name: string };
  let setMenu: { id: string; name: string };
  let brokenDish: { id: string; name: string };

  const today = computeBangkokToday();
  /**
   * Every recipe here is effective from LONG before the days under test.
   *
   * Not a convenience — it is what ADR 0021 Q4 actually requires. A recipe is a
   * statement about a PERIOD, so one written today (`effectiveFrom = today`)
   * covers today and says nothing about yesterday. A shop that imports a month
   * of history and then writes its recipes must date them back over that month
   * or the days resolve to "no recipe", which is exactly what the first draft of
   * this fixture did.
   */
  const RECIPES_FROM = addDays(today, -60);
  const D1 = addDays(today, -1);
  const D2 = addDays(today, -2);
  const ANCIENT = addDays(today, -(MAX_BACKDATE_DAYS + 5));

  const makeProduct = (
    tag: string,
    over: Record<string, unknown> = {}
  ): Promise<ProductWithUnits> =>
    createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `CONS-${tag}-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
        ...over,
      })
    );

  const makeMenu = (name: string): Promise<{ id: string; name: string }> =>
    withAdminContext((tx) =>
      tx.menu.create({
        data: { tenantId: tenantA, source: "MISE", name: `${name}-${randomUUID().slice(0, 4)}` },
        select: { id: true, name: true },
      })
    );

  const baseUnitOf = (p: ProductWithUnits) =>
    p.productUnits.find((u) => u.isBase)!.id;

  const ing = (p: ProductWithUnits, qty: number, sortOrder = 0) => ({
    productId: p.id,
    componentMenuId: null,
    qty,
    productUnitId: baseUnitOf(p),
    sortOrder,
    notes: null,
  });

  const component = (menuId: string, qty: number, sortOrder = 0) => ({
    productId: null,
    componentMenuId: menuId,
    qty,
    productUnitId: null,
    sortOrder,
    notes: null,
  });

  const makeRecipe = (over: Record<string, unknown>) =>
    createRecipeLogic(
      tenantA,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId: null,
        outputProductId: null,
        servings: 1,
        effectiveFrom: RECIPES_FROM,
        ingredients: [],
        notes: null,
        ...over,
      }),
      userA
    );

  /**
   * A sales line, written straight in. Going through the import would prove
   * Part 19 all over again; what matters here is the grain the reader sees.
   */
  const sell = async (
    branchId: string,
    businessDate: Date,
    menuId: string,
    qty: number,
    netAmount: number
  ) => {
    await withAdminContext(async (tx) => {
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

  const demand = (
    over: Partial<{
      branchId: string;
      businessDate: Date;
      cancelledSalePolicy: "TREAT_AS_COOKED" | "TREAT_AS_NOT_COOKED";
    }> = {}
  ) =>
    computeConsumptionForDayLogic(prisma, tenantA, {
      branchId: branchA,
      businessDate: D1,
      cancelledSalePolicy: "TREAT_AS_COOKED",
      ...over,
    });

  const qtyOf = (
    d: { lines: { productId: string; qty: { toString(): string } }[] },
    p: ProductWithUnits
  ) => d.lines.find((l) => l.productId === p.id)?.qty.toString();

  beforeAll(async () => {
    await withAdminContext(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Consumption Tenant" } });
      tenantA = t.id;
      const [a, b] = await Promise.all([
        tx.branch.create({ data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" } }),
        tx.branch.create({ data: { tenantId: t.id, name: "อโศก", code: "ASK" } }),
      ]);
      branchA = a.id;
      branchB = b.id;
      const u = await tx.user.create({
        data: { email: `cons-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;

      // sales_line's FKs to a batch and a day are NOT NULL, so the chain has to
      // exist even though nothing here reads it.
      const integ = await tx.posIntegration.create({
        data: { tenantId: t.id, branchId: a.id, posType: "CUSTOM", name: "POS" },
        select: { id: true },
      });
      integrationId = integ.id;
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
      profileId = prof.id;
      const batch = await tx.salesImportBatch.create({
        data: {
          tenantId: t.id,
          branchId: a.id,
          posIntegrationId: integ.id,
          profileId: prof.id,
          status: "COMMITTED",
          fileName: "day.csv",
          uploadedBy: u.id,
          // sales_import_batch_committed_check: a batch claiming COMMITTED must
          // carry the moment it was.
          committedAt: new Date(),
        },
        select: { id: true },
      });
      batchId = batch.id;
    });

    pork = await makeProduct("pork");
    basil = await makeProduct("basil");
    chilli = await makeProduct("chilli");
    riceRaw = await makeProduct("rice");
    riceCooked = await makeProduct("ricecooked", {
      type: "PREPPED",
      parentProductId: riceRaw.id,
      // 1 kg raw rice yields 2.5 kg cooked, so cooked rice divides by 250%.
      yieldPercent: 250,
    });
    mystery = await makeProduct("mystery", { type: "PREPPED" });

    kaphrao = await makeMenu("กะเพราหมู");
    omelette = await makeMenu("ไข่เจียว");
    noRecipeDish = await makeMenu("เมนูไม่มีสูตร");
    setMenu = await makeMenu("ชุดสองอย่าง");
    brokenDish = await makeMenu("เมนูสูตรพัง");
  }, 300_000);

  afterAll(async () => {
    await withAdminContext(async (tx) => {
      await tx.salesLine.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesDay.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportBatch.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportProfile.deleteMany({ where: { tenantId: tenantA } });
      await tx.posIntegration.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeBranch.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeIngredient.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipe.updateMany({
        where: { tenantId: tenantA },
        data: { supersededAt: null, supersededById: null },
      });
      await tx.recipe.deleteMany({ where: { tenantId: tenantA } });
      await tx.menu.deleteMany({ where: { tenantId: tenantA } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId: tenantA } } });
      await tx.product.updateMany({
        where: { tenantId: tenantA },
        data: { parentProductId: null },
      });
      await tx.product.deleteMany({ where: { tenantId: tenantA } });
      await tx.category.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.deleteMany({ where: { id: tenantA } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
  }, 180_000);

  // ------------------------------------------------------------
  // The arithmetic
  // ------------------------------------------------------------

  it("N-01 twelve plates take twelve plates' worth off the shelf", async () => {
    // 2 servings per writing of the recipe: 0.24 kg pork per pot, 0.12 per plate.
    await makeRecipe({
      menuId: kaphrao.id,
      servings: 2,
      ingredients: [ing(pork, 0.24), ing(basil, 0.04, 1)],
    });
    await sell(branchA, D1, kaphrao.id, 12, 1200);

    const d = await demand();
    expect(d.menusPosted).toBe(1);
    expect(d.menusSkipped).toBe(0);
    // 0.24 / 2 servings × 12 plates = 1.44 kg — and NEGATIVE, because this is
    // what the ledger records, not what the recipe asks for.
    expect(qtyOf(d, pork)).toBe("-1.44");
    expect(qtyOf(d, basil)).toBe("-0.24");
    expect(d.coveredNetAmount.toString()).toBe("1200");
    expect(d.totalNetAmount.toString()).toBe("1200");
  });

  it("N-02 yield is a DIVISION all the way down to the raw product", async () => {
    // 0.3 kg of COOKED rice per plate, at 250% yield → 0.12 kg of raw rice.
    // The wrong formula (qty × (1 + loss)) would give a bigger number and no
    // cooked rice would ever appear in the ledger, because it has no stock.
    await makeRecipe({
      menuId: omelette.id,
      servings: 1,
      ingredients: [ing(riceCooked, 0.3)],
    });
    await sell(branchA, D2, omelette.id, 10, 500);

    const d = await demand({ businessDate: D2 });
    expect(qtyOf(d, riceRaw)).toBe("-1.2");
    // The PREPPED product itself never reaches the ledger: nothing can raise its
    // balance, so the walk goes straight through it (ADR 0021 Q11).
    expect(qtyOf(d, riceCooked)).toBeUndefined();
  });

  it("N-03 the day is resolved against the recipe that was true THEN", async () => {
    // A later version, effective today, must not reach back and re-write what
    // yesterday's plates ate (ADR 0021 Q4 — the reason Part 22 exists in this
    // shape at all).
    const dish = await makeMenu("ต้มยำ");
    const v1 = await makeRecipe({
      menuId: dish.id,
      servings: 1,
      effectiveFrom: D2,
      ingredients: [ing(chilli, 0.01)],
    });
    // A LATER effective date appends a version to the same line; a second
    // createRecipeLogic would be refused as a duplicate central recipe.
    await updateRecipeLogic(
      tenantA,
      v1.id,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId: dish.id,
        outputProductId: null,
        servings: 1,
        effectiveFrom: today,
        ingredients: [ing(chilli, 0.05)],
        notes: null,
      }),
      userA
    );
    await sell(branchA, D1, dish.id, 100, 5000);

    const d = await demand();
    // 100 × 0.01 from the version that governed D1 — not 5 kg from today's.
    const line = d.lines.find((l) => l.productId === chilli.id);
    expect(line?.qty.toString()).toBe("-1");
  });

  // ------------------------------------------------------------
  // Rule N4 — what a cancelled bill did to the stock
  // ------------------------------------------------------------

  it("N-04 TREAT_AS_COOKED ignores the cancelled bill: 12 sold, 12 consumed", async () => {
    const dish = await makeMenu("ผัดไทย");
    await makeRecipe({
      menuId: dish.id,
      servings: 1,
      ingredients: [ing(pork, 0.1)],
    });
    const day = addDays(today, -3);
    await sell(branchA, day, dish.id, 12, 1200);
    await sell(branchA, day, dish.id, -1, -100);

    const d = await demand({ businessDate: day });
    expect(qtyOf(d, pork)).toBe("-1.2");
    // Revenue is NOT the policy's business: the till kept 1,100 either way.
    expect(d.totalNetAmount.toString()).toBe("1100");
  });

  it("N-05 TREAT_AS_NOT_COOKED subtracts it: the same day consumes 11", async () => {
    const d = await demand({
      businessDate: addDays(today, -3),
      cancelledSalePolicy: "TREAT_AS_NOT_COOKED",
    });
    expect(qtyOf(d, pork)).toBe("-1.1");
    expect(d.totalNetAmount.toString()).toBe("1100");
  });

  it("N-06 a day whose cancellations outweigh its sales RETURNS stock", async () => {
    // Yesterday's bill, voided today, exported into today's file. Rare, and the
    // one case where an ordinary (non-reversal) item is positive — which is why
    // sales_consumption_item carries no sign CHECK.
    const dish = await makeMenu("ข้าวมันไก่");
    await makeRecipe({
      menuId: dish.id,
      servings: 1,
      ingredients: [ing(pork, 0.2)],
    });
    const day = addDays(today, -4);
    await sell(branchA, day, dish.id, -3, -300);

    const d = await demand({
      businessDate: day,
      cancelledSalePolicy: "TREAT_AS_NOT_COOKED",
    });
    expect(qtyOf(d, pork)).toBe("0.6");
  });

  it("N-07 the same day under TREAT_AS_COOKED consumes nothing at all", async () => {
    // Every row is negative, so ignoring them leaves zero servings — nothing to
    // consume, and nothing to report as a gap either.
    const d = await demand({ businessDate: addDays(today, -4) });
    expect(d.lines).toHaveLength(0);
    expect(d.menusPosted).toBe(0);
    expect(d.menusSkipped).toBe(0);
  });

  // ------------------------------------------------------------
  // Rule N2 — whole or not at all
  // ------------------------------------------------------------

  it("N-08 a dish with no recipe is named, and does not stop the rest", async () => {
    const day = addDays(today, -5);
    const dish = await makeMenu("ข้าวผัด");
    await makeRecipe({
      menuId: dish.id,
      servings: 1,
      ingredients: [ing(pork, 0.15)],
    });
    await sell(branchA, day, dish.id, 4, 400);
    await sell(branchA, day, noRecipeDish.id, 6, 600);

    const d = await demand({ businessDate: day });
    expect(d.menusPosted).toBe(1);
    expect(d.menusSkipped).toBe(1);
    expect(d.skipped[0].reason).toBe("NO_RECIPE");
    expect(d.skipped[0].menuName).toContain("เมนูไม่มีสูตร");
    // Coverage is MONEY (rule N3): 400 of 1,000, not "one dish of two".
    expect(d.coveredNetAmount.toString()).toBe("400");
    expect(d.totalNetAmount.toString()).toBe("1000");
  });

  it("N-09 a set menu whose component has no recipe is held back WHOLE", async () => {
    // The silent one. `explodeToRaw` returns nothing for the recipe-less
    // component and walks on, so the set would post the pork it knows about and
    // silently miss the rest — rule R16 in stock's clothing.
    const day = addDays(today, -6);
    await makeRecipe({
      menuId: setMenu.id,
      servings: 1,
      ingredients: [ing(pork, 0.2), component(noRecipeDish.id, 1, 1)],
    });
    await sell(branchA, day, setMenu.id, 5, 1495);

    const d = await demand({ businessDate: day });
    expect(d.menusPosted).toBe(0);
    expect(d.lines).toHaveLength(0);
    expect(d.skipped[0].reason).toBe("COMPONENT_MENU_NO_RECIPE");
    // The report NAMES the component — otherwise the reader hunts the tree.
    expect(d.skipped[0].detail).toContain("เมนูไม่มีสูตร");
    expect(d.coveredNetAmount.toString()).toBe("0");
  });

  it("N-10 a set menu whose components all have recipes posts through both levels", async () => {
    const day = addDays(today, -7);
    const drink = await makeMenu("ชาเย็น");
    await makeRecipe({
      menuId: drink.id,
      servings: 1,
      ingredients: [ing(basil, 0.02)],
    });
    const combo = await makeMenu("ชุดกะเพรา+ชา");
    await makeRecipe({
      menuId: combo.id,
      servings: 1,
      ingredients: [component(kaphrao.id, 1), component(drink.id, 1, 1)],
    });
    await sell(branchA, day, combo.id, 10, 2000);

    const d = await demand({ businessDate: day });
    expect(d.menusPosted).toBe(1);
    // กะเพรา is 2 servings per writing: 0.24/2 × 10 = 1.2 kg pork.
    expect(qtyOf(d, pork)).toBe("-1.2");
    // basil from BOTH levels: 0.04/2 × 10 from กะเพรา + 0.02 × 10 from the tea.
    expect(qtyOf(d, basil)).toBe("-0.4");
  });

  it("N-11 a recipe the walker cannot resolve is reported, not thrown", async () => {
    // A PREPPED product with neither a parent+yield nor a production recipe:
    // the walk cannot divide, and refuses rather than reading it as 100%.
    const day = addDays(today, -8);
    await makeRecipe({
      menuId: brokenDish.id,
      servings: 1,
      ingredients: [ing(mystery, 0.1)],
    });
    const fine = await makeMenu("ไข่ดาว");
    await makeRecipe({
      menuId: fine.id,
      servings: 1,
      ingredients: [ing(pork, 0.05)],
    });
    await sell(branchA, day, brokenDish.id, 3, 300);
    await sell(branchA, day, fine.id, 3, 150);

    const d = await demand({ businessDate: day });
    // One bad recipe must not stop the shop posting the other dish.
    expect(d.menusPosted).toBe(1);
    expect(qtyOf(d, pork)).toBe("-0.15");
    const skip = d.skipped.find((s) => s.menuId === brokenDish.id);
    expect(skip?.reason).toBe("RECIPE_UNRESOLVABLE");
    // The detail NAMES the product, not its uuid. `explodeToRaw` emits a
    // method-less PREPPED as a leaf rather than throwing — right for cost (it
    // comes back UNPRICED) and wrong for stock, because nothing can raise a
    // prepped balance, so posting would drive it negative for ever.
    expect(skip?.detail).toBe(mystery.name);
  });

  // ------------------------------------------------------------
  // Rule N9 — the ledger's window
  // ------------------------------------------------------------

  it("N-12 a day older than the backdate window posts nothing and says why", async () => {
    await sell(branchA, ANCIENT, kaphrao.id, 5, 500);

    const d = await demand({ businessDate: ANCIENT });
    expect(d.lines).toHaveLength(0);
    expect(d.menusPosted).toBe(0);
    expect(d.skipped[0].reason).toBe("OUTSIDE_BACKDATE_WINDOW");
    // The revenue is still counted, so coverage reads 0 of 500 rather than 0 of 0
    // — "we posted none of this day" is the true statement.
    expect(d.totalNetAmount.toString()).toBe("500");
    expect(d.coveredNetAmount.toString()).toBe("0");
  });

  it("N-13 the window helper agrees with every other document's rule", async () => {
    expect(isWithinBackdateWindow(today)).toBe(true);
    expect(isWithinBackdateWindow(addDays(today, -MAX_BACKDATE_DAYS))).toBe(true);
    expect(isWithinBackdateWindow(addDays(today, -MAX_BACKDATE_DAYS - 1))).toBe(false);
    expect(isWithinBackdateWindow(addDays(today, 1))).toBe(false);
  });

  // ------------------------------------------------------------
  // Boundaries
  // ------------------------------------------------------------

  it("N-14 a day with no sales at all is empty, not an error", async () => {
    const d = await demand({ businessDate: addDays(today, -9) });
    expect(d.lines).toHaveLength(0);
    expect(d.menusPosted).toBe(0);
    expect(d.menusSkipped).toBe(0);
    expect(d.totalNetAmount.toString()).toBe("0");
  });

  it("N-15 another branch's sales are not this branch's consumption", async () => {
    const day = addDays(today, -10);
    await sell(branchB, day, kaphrao.id, 20, 2000);

    const atA = await demand({ businessDate: day });
    expect(atA.lines).toHaveLength(0);

    const atB = await demand({ businessDate: day, branchId: branchB });
    expect(qtyOf(atB, pork)).toBe("-2.4");
  });

  it("N-16 a superseded sales row is not consumed twice", async () => {
    // Re-importing a day supersedes the old rows and keeps them (ADR 0019 Q4).
    // If the reader took them too, every re-imported day would eat double.
    const day = addDays(today, -11);
    await sell(branchA, day, kaphrao.id, 10, 1000);
    await withAdminContext((tx) =>
      tx.salesLine.updateMany({
        where: { tenantId: tenantA, businessDate: day },
        data: { supersededAt: new Date(), supersededByBatchId: batchId },
      })
    );
    await sell(branchA, day, kaphrao.id, 4, 400);

    const d = await demand({ businessDate: day });
    expect(qtyOf(d, pork)).toBe("-0.48");
    expect(d.totalNetAmount.toString()).toBe("400");
  });

  it("N-17 two dishes sharing an ingredient produce ONE line for it", async () => {
    // The item grain is product × day (Q1). Two lines for one product would be
    // two movements against one product on one day, and the second would look
    // like a duplicate to anyone reading the ledger.
    const day = addDays(today, -12);
    const a = await makeMenu("หมูทอด");
    const b = await makeMenu("หมูย่าง");
    await makeRecipe({ menuId: a.id, servings: 1, ingredients: [ing(pork, 0.1)] });
    await makeRecipe({ menuId: b.id, servings: 1, ingredients: [ing(pork, 0.2)] });
    await sell(branchA, day, a.id, 3, 300);
    await sell(branchA, day, b.id, 2, 300);

    const d = await demand({ businessDate: day });
    expect(d.lines.filter((l) => l.productId === pork.id)).toHaveLength(1);
    expect(qtyOf(d, pork)).toBe("-0.7");
    expect(d.menusPosted).toBe(2);
  });

  it("N-18 the answer carries the policy it was computed under", async () => {
    const d = await demand({ cancelledSalePolicy: "TREAT_AS_NOT_COOKED" });
    expect(d.cancelledSalePolicy).toBe("TREAT_AS_NOT_COOKED");
  });
});
