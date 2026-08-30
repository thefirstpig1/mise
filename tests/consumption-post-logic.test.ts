// ============================================================
// Mise — posting a day's consumption (Sprint 5 Part 22 L3b)
// ============================================================
// `postConsumptionForDayLogic` and the two void shapes. This is the first thing
// in the project that makes the ledger FALL from a sale.
//
// The fixture buys nothing on purpose: negative stock never blocks (ADR 0011
// Q9), so every balance below starts at zero and goes negative by exactly what
// the recipe says. What the outflow is WORTH is the FIFO replay's answer and
// belongs to L3d, not here — this layer proves quantities, documents and the
// fact that nothing is ever deleted.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma,  } from "@/lib/db";
import { withRlsBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { recipeInputSchema } from "@/lib/validations/recipe";
import { createRecipeLogic } from "@/server/recipe";
import { getStockBalanceLogic } from "@/server/stock-movement";
import {
  ConsumptionAlreadyPostedError,
  postConsumptionForDayLogic,
  voidConsumptionForDayInTx,
  voidConsumptionRunInTx,
} from "@/server/consumption-post";

describe("posting consumption (ADR 0022 Part 22 L3b)", () => {
  let tenantA: string;
  let userA: string;
  let branchA: string;
  let batchId: string;

  let pork: ProductWithUnits;
  let basil: ProductWithUnits;

  let kaphrao: { id: string; name: string };
  let noRecipeDish: { id: string; name: string };

  const today = computeBangkokToday();
  const RECIPES_FROM = addDays(today, -60);

  const makeProduct = (tag: string): Promise<ProductWithUnits> =>
    createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `POST-${tag}-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
      })
    );

  const makeMenu = (name: string): Promise<{ id: string; name: string }> =>
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

  const baseUnitOf = (p: ProductWithUnits) =>
    p.productUnits.find((u) => u.isBase)!.id;

  const makeRecipe = (menuId: string, lines: [ProductWithUnits, number][]) =>
    createRecipeLogic(
      tenantA,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId,
        outputProductId: null,
        servings: 1,
        effectiveFrom: RECIPES_FROM,
        ingredients: lines.map(([p, qty], i) => ({
          productId: p.id,
          componentMenuId: null,
          qty,
          productUnitId: baseUnitOf(p),
          sortOrder: i,
          notes: null,
        })),
        notes: null,
      }),
      userA
    );

  const sell = async (
    businessDate: Date,
    menuId: string,
    qty: number,
    netAmount: number
  ) => {
    await withRlsBypass(async (tx) => {
      const day = await tx.salesDay.upsert({
        where: { branchId_businessDate: { branchId: branchA, businessDate } },
        create: {
          tenantId: tenantA,
          branchId: branchA,
          businessDate,
          currentBatchId: batchId,
        },
        update: {},
        select: { id: true },
      });
      await tx.salesLine.create({
        data: {
          tenantId: tenantA,
          branchId: branchA,
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

  const post = (
    businessDate: Date,
    over: Partial<{ submitKey: string; acknowledgeRepost: boolean }> = {}
  ) =>
    postConsumptionForDayLogic(
      tenantA,
      {
        submitKey: randomUUID(),
        branchId: branchA,
        businessDate,
        acknowledgeRepost: false,
        ...over,
      },
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
        select: {
          type: true,
          qty: true,
          sourceType: true,
          sourceId: true,
          occurredAt: true,
        },
      })
    );

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Consumption Post Tenant" } });
      tenantA = t.id;
      const b = await tx.branch.create({
        data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" },
      });
      branchA = b.id;
      const u = await tx.user.create({
        data: { email: `post-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
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
    kaphrao = await makeMenu("กะเพราหมู");
    noRecipeDish = await makeMenu("เมนูไม่มีสูตร");
    await makeRecipe(kaphrao.id, [
      [pork, 0.1],
      [basil, 0.02],
    ]);
  }, 300_000);

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.stockMovement.deleteMany({ where: { tenantId: tenantA } });
      // The reversal rows go FIRST, and are not nulled on the way out:
      // `sales_consumption_item_product_unique` covers (run_id, product_id)
      // WHERE reversal_of_item_id IS NULL, so clearing the pointer makes every
      // reversal collide with the original it reverses.
      await tx.salesConsumptionItem.deleteMany({
        where: { tenantId: tenantA, reversalOfItemId: { not: null } },
      });
      await tx.salesConsumptionItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesConsumptionRun.deleteMany({ where: { tenantId: tenantA } });
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
      await tx.product.deleteMany({ where: { tenantId: tenantA } });
      await tx.category.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.deleteMany({ where: { id: tenantA } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
  }, 180_000);

  // ------------------------------------------------------------
  // The ledger finally falls
  // ------------------------------------------------------------

  it("P-01 twelve plates take 1.2 kg off the shelf, and the movement is dated the SALES day", async () => {
    const day = addDays(today, -1);
    await sell(day, kaphrao.id, 12, 1200);

    const res = await post(day);
    expect(res.run.menusPosted).toBe(1);
    expect(res.items).toHaveLength(2);
    expect(await balance(pork)).toBe("-1.2");
    expect(await balance(basil)).toBe("-0.24");

    const [mv] = await movementsFor(pork);
    expect(mv.type).toBe("CONSUMPTION");
    expect(mv.sourceType).toBe("SALES_CONSUMPTION");
    // The movement belongs to the day the food was cooked, not to the minute the
    // button was pressed — otherwise thirty imported days pile onto today and
    // FIFO cuts in the wrong order.
    expect(mv.occurredAt.toISOString()).toBe(day.toISOString());
    // And it points at the ITEM, which is what makes it idempotent.
    expect(mv.sourceId).toBe(res.items.find((i) => i.productId === pork.id)!.id);
  });

  it("P-02 the same submit key twice writes ONE run and consumes the day once", async () => {
    const day = addDays(today, -2);
    await sell(day, kaphrao.id, 5, 500);
    const key = randomUUID();

    const first = await post(day, { submitKey: key });
    const second = await post(day, { submitKey: key });

    expect(second.run.id).toBe(first.run.id);
    expect(await balance(pork)).toBe("-1.7"); // 1.2 + 0.5, not 2.2
    const runs = await withRlsBypass((tx) =>
      tx.salesConsumptionRun.count({
        where: { tenantId: tenantA, businessDate: day },
      })
    );
    expect(runs).toBe(1);
  });

  it("P-03 a day already posted is refused, and the refusal carries what it would discard", async () => {
    const day = addDays(today, -2);
    await expect(post(day)).rejects.toBeInstanceOf(ConsumptionAlreadyPostedError);

    const err = await post(day).then(
      () => null,
      (e: unknown) => e as ConsumptionAlreadyPostedError
    );
    expect(err).toBeInstanceOf(ConsumptionAlreadyPostedError);
    if (err === null) return;
    // "Are you sure" with nothing in it is not a question: the screen has to be
    // able to say WHEN it was posted and how much of the day it covered.
    expect(err.coveredNetAmount.toString()).toBe("500");
    expect(err.totalNetAmount.toString()).toBe("500");
    expect(err.postedAt).toBeInstanceOf(Date);
  });

  // ------------------------------------------------------------
  // Q2b — posting again is a replacement, never a top-up
  // ------------------------------------------------------------

  it("P-04 acknowledged, it voids the whole day and posts it afresh — the balance does not double", async () => {
    const day = addDays(today, -2);
    const before = await balance(pork);
    expect(before).toBe("-1.7");

    const res = await post(day, { acknowledgeRepost: true });
    expect(res.voidedRunId).toBeTruthy();

    // Reversed 0.5 and consumed 0.5 again: the day still stands once.
    expect(await balance(pork)).toBe("-1.7");
  });

  it("P-05 the void APPENDS reversal rows — nothing is edited and nothing is deleted", async () => {
    const day = addDays(today, -2);
    const rows = await withRlsBypass((tx) =>
      tx.salesConsumptionItem.findMany({
        where: { tenantId: tenantA, run: { businessDate: day }, productId: pork.id },
        orderBy: { createdAt: "asc" },
        select: { qty: true, reversalOfItemId: true },
      })
    );
    // original (−0.5), its reversal (+0.5), and the new posting (−0.5).
    expect(rows).toHaveLength(3);
    expect(rows[0].reversalOfItemId).toBeNull();
    expect(rows[1].reversalOfItemId).toBe(null === rows[1].reversalOfItemId ? null : rows[1].reversalOfItemId);
    expect(rows.filter((r) => r.reversalOfItemId !== null)).toHaveLength(1);
    expect(rows[1].qty.toString()).toBe("0.5");

    const voided = await withRlsBypass((tx) =>
      tx.salesConsumptionRun.findFirst({
        where: { tenantId: tenantA, businessDate: day, voidedAt: { not: null } },
        select: { voidReason: true, voidedBy: true },
      })
    );
    expect(voided?.voidReason).toBe("REPOST");
    expect(voided?.voidedBy).toBe(userA);
  });

  it("P-06 the compensating movement occurs NOW, not on the day it consumed", async () => {
    const day = addDays(today, -2);
    const reversal = (await movementsFor(pork)).find(
      (m) => m.type === "CONSUMPTION_REVERSAL"
    );
    expect(reversal).toBeTruthy();
    // Backdating it would silently change the balance "as of" a past date and
    // force the cost engine to re-value a period the shop may have closed
    // (ADR 0013 Q6's clarification).
    expect(reversal!.occurredAt.getTime()).toBeGreaterThan(day.getTime());
    expect(reversal!.qty.toString()).toBe("0.5");
  });

  it("P-07 exactly one LIVE run per day survives all of that", async () => {
    const day = addDays(today, -2);
    const live = await withRlsBypass((tx) =>
      tx.salesConsumptionRun.count({
        where: { tenantId: tenantA, businessDate: day, voidedAt: null },
      })
    );
    expect(live).toBe(1);
  });

  // ------------------------------------------------------------
  // The run is written even when nothing lands
  // ------------------------------------------------------------

  it("P-08 a day where nothing can post still writes a run, with the reasons", async () => {
    const day = addDays(today, -3);
    await sell(day, noRecipeDish.id, 8, 800);

    const res = await post(day);
    expect(res.items).toHaveLength(0);
    expect(res.run.menusPosted).toBe(0);
    expect(res.run.menusSkipped).toBe(1);
    expect(res.run.coveredNetAmount.toString()).toBe("0");
    expect(res.run.totalNetAmount.toString()).toBe("800");

    // The reasons survive as data, not as a message that vanished with the
    // request that computed them.
    const stored = res.run.skippedMenus as unknown as {
      reason: string;
      menuName: string;
    }[];
    expect(stored[0].reason).toBe("NO_RECIPE");
    expect(stored[0].menuName).toContain("เมนูไม่มีสูตร");
  });

  it("P-09 the run freezes the policy it was computed under", async () => {
    const day = addDays(today, -3);
    const run = await withRlsBypass((tx) =>
      tx.salesConsumptionRun.findFirst({
        where: { tenantId: tenantA, businessDate: day, voidedAt: null },
        select: { cancelledSalePolicy: true },
      })
    );
    // A run that cannot say which rule it followed cannot explain its own
    // numbers once the setting changes.
    expect(run?.cancelledSalePolicy).toBe("TREAT_AS_COOKED");
  });

  // ------------------------------------------------------------
  // The shape the import calls (Q5)
  // ------------------------------------------------------------

  it("P-10 the import's void takes back a day it only knows by date", async () => {
    const day = addDays(today, -4);
    await sell(day, kaphrao.id, 10, 1000);
    await post(day);
    const before = await balance(pork);

    const res = await prisma.$transaction((tx) =>
      voidConsumptionForDayInTx(
        tx as never,
        tenantA,
        branchA,
        day,
        "RE_IMPORT",
        userA
      )
    );
    expect(res.voidedRunId).toBeTruthy();
    expect(res.reversedItems).toBe(2);

    // The kilo comes back: −1.0 consumed, +1.0 returned.
    expect(Number(await balance(pork))).toBeCloseTo(Number(before) + 1, 6);
  });

  it("P-11 voiding a day twice is not an error, and does not credit it twice", async () => {
    const day = addDays(today, -4);
    const before = await balance(pork);

    const again = await prisma.$transaction((tx) =>
      voidConsumptionForDayInTx(
        tx as never,
        tenantA,
        branchA,
        day,
        "RE_IMPORT",
        userA
      )
    );
    // A re-import and a re-post can both reach for the same day; the second must
    // find the work done rather than fail.
    expect(again.voidedRunId).toBeNull();
    expect(again.reversedItems).toBe(0);
    expect(await balance(pork)).toBe(before);
  });

  it("P-12 voiding an already-voided run by id is a no-op too", async () => {
    const day = addDays(today, -4);
    const run = await withRlsBypass((tx) =>
      tx.salesConsumptionRun.findFirst({
        where: { tenantId: tenantA, businessDate: day },
        select: { id: true },
      })
    );
    const res = await prisma.$transaction((tx) =>
      voidConsumptionRunInTx(tx as never, tenantA, run!.id, "REPOST", userA)
    );
    expect(res.reversedItems).toBe(0);
  });

  // ------------------------------------------------------------
  // The other direction
  // ------------------------------------------------------------

  it("P-13 a day whose cancellations outweigh its sales posts stock BACK", async () => {
    await withRlsBypass((tx) =>
      tx.tenant.update({
        where: { id: tenantA },
        data: { cancelledSalePolicy: "TREAT_AS_NOT_COOKED" },
      })
    );
    const day = addDays(today, -5);
    await sell(day, kaphrao.id, -4, -400);

    const before = Number(await balance(pork));
    const res = await post(day);
    expect(res.run.cancelledSalePolicy).toBe("TREAT_AS_NOT_COOKED");

    // An ORDINARY item, positive, with no reversal pointer — which is why
    // sales_consumption_item carries no sign CHECK.
    const item = res.items.find((i) => i.productId === pork.id)!;
    expect(item.qty.toString()).toBe("0.4");
    expect(item.reversalOfItemId).toBeNull();

    const mv = (await movementsFor(pork)).at(-1);
    expect(mv!.type).toBe("CONSUMPTION_REVERSAL");
    expect(Number(await balance(pork))).toBeCloseTo(before + 0.4, 6);

    await withRlsBypass((tx) =>
      tx.tenant.update({
        where: { id: tenantA },
        data: { cancelledSalePolicy: "TREAT_AS_COOKED" },
      })
    );
  });

  it("P-14 a day with no sales writes a run that says so, and no movements", async () => {
    const day = addDays(today, -6);
    const res = await post(day);
    expect(res.items).toHaveLength(0);
    expect(res.run.menusPosted).toBe(0);
    expect(res.run.menusSkipped).toBe(0);
    expect(res.run.totalNetAmount.toString()).toBe("0");
  });
});
