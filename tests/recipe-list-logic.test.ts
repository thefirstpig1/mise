// ============================================================
// Mise — the list-shaped recipe reads (Sprint 5 Part 21 L5a)
// ============================================================
// `getRecipeListLogic`, `getRecipeBranchComparisonLogic` and
// `getRecipeHistoryLogic` — the three reads the screens need and L3 did not have.
//
// They get their OWN tenant rather than joining `recipe-cost-logic`'s. A list
// read returns everything in the tenant, so sharing a fixture with eighteen
// tests that each create a menu makes every assertion here depend on how many
// tests ran before it. The arithmetic is proved next door; what is proved here
// is what lands in the list and in what order.
//
// One receipt per product, VAT 0, so every baht figure below is the price paid.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { costAccessFor } from "@/lib/permissions/cost-access";

/** The ticket an owner carries. Minted through the single real door,
 *  so a role that loses `cost:view` makes these fixtures null too. */
const SEES_COST = costAccessFor("owner");
import { EVERY_BRANCH } from "./support/reach";
import { randomUUID } from "node:crypto";
import { withAdminContext } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { supplierInputSchema } from "@/lib/validations/supplier";
import { createSupplierLogic } from "@/server/supplier";
import { purchaseOrderInputSchema } from "@/lib/validations/purchase-order";
import {
  createPurchaseOrderLogic,
  sendPurchaseOrderLogic,
} from "@/server/purchase-order";
import { goodsReceiptInputSchema } from "@/lib/validations/goods-receipt";
import {
  confirmGoodsReceiptLogic,
  createGoodsReceiptLogic,
} from "@/server/goods-receipt";
import {
  copyRecipeToBranchesInputSchema,
  recipeInputSchema,
} from "@/lib/validations/recipe";
import {
  copyRecipeToBranchesLogic,
  createRecipeLogic,
  updateRecipeLogic,
} from "@/server/recipe";
import {
  getRecipeBranchComparisonLogic,
  getRecipeHistoryLogic,
  getRecipeListLogic,
} from "@/server/recipe-read";

describe("recipe list reads (ADR 0021 Part 21 L5a)", () => {
  let tenantA: string;
  let userA: string;
  let branchA: string;
  let branchB: string;
  let branchC: string;
  let supplierA: string;

  let pork: ProductWithUnits;
  let basil: ProductWithUnits;
  let salmonWhole: ProductWithUnits;
  let salmonFillet: ProductWithUnits;
  let chilliJam: ProductWithUnits;

  /** The dishes. Named per test so the assertions can be exact. */
  let kaphrao: { id: string; name: string };
  let tomYum: { id: string; name: string };
  let plainRice: { id: string; name: string };

  const today = computeBangkokToday();

  const makeProduct = (
    tag: string,
    over: Record<string, unknown> = {}
  ): Promise<ProductWithUnits> =>
    createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `LIST-${tag}-${randomUUID().slice(0, 6)}`,
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
        data: { tenantId: tenantA, source: "MISE", name },
        select: { id: true, name: true },
      })
    );

  const baseUnitOf = (p: ProductWithUnits) =>
    p.productUnits.find((u) => u.isBase)!.id;

  const receiveInto = async (
    branchId: string,
    product: ProductWithUnits,
    qty: number,
    pricePerUnit: number
  ) => {
    const po = await createPurchaseOrderLogic(
      tenantA,
      purchaseOrderInputSchema.parse({
        branchId,
        supplierId: supplierA,
        expectedDeliveryDate: "",
        vatRatePercent: 0,
        notes: null,
        lines: [
          {
            productId: product.id,
            orderUnitId: baseUnitOf(product),
            qtyOrdered: qty,
            unitPrice: pricePerUnit,
            supplierProductMappingId: null,
            notes: null,
          },
        ],
      }),
      userA
    );
    const sent = await sendPurchaseOrderLogic(tenantA, po.id, userA);
    const gr = await createGoodsReceiptLogic(
      tenantA,
      goodsReceiptInputSchema.parse({
        submitKey: randomUUID(),
        branchId,
        supplierId: supplierA,
        purchaseOrderId: sent.id,
        invoiceNo: null,
        receivedAt: new Date(),
        notes: null,
        lines: [
          {
            purchaseOrderItemId: sent.items[0].id,
            productId: product.id,
            receivedUnitId: baseUnitOf(product),
            qtyReceivedActual: qty,
            unitPriceActual: pricePerUnit,
            notes: null,
          },
        ],
      }),
      userA
    );
    await confirmGoodsReceiptLogic(tenantA, gr.id, userA);
  };

  const ing = (p: ProductWithUnits, qty: number) => ({
    productId: p.id,
    componentMenuId: null,
    qty,
    productUnitId: baseUnitOf(p),
    sortOrder: 0,
    notes: null,
  });

  const recipeInput = (over: Record<string, unknown>) =>
    recipeInputSchema.parse({
      submitKey: randomUUID(),
      menuId: null,
      outputProductId: null,
      servings: 1,
      effectiveFrom: today,
      ingredients: [],
      notes: null,
      ...over,
    });

  const list = (over: Record<string, unknown> = {}) =>
    getRecipeListLogic(tenantA, {
      branchId: branchA,
      missingOnly: false,
      ...over,
    }, SEES_COST);

  beforeAll(async () => {
    await withAdminContext(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Recipe List Tenant" } });
      tenantA = t.id;
      const [a, b, c] = await Promise.all([
        tx.branch.create({ data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" } }),
        tx.branch.create({ data: { tenantId: t.id, name: "อโศก", code: "ASK" } }),
        tx.branch.create({ data: { tenantId: t.id, name: "ภูเก็ต", code: "PKT" } }),
      ]);
      branchA = a.id;
      branchB = b.id;
      branchC = c.id;
      await tx.department.create({
        data: { tenantId: t.id, name: "Main", code: "MAIN" },
      });
      const u = await tx.user.create({
        data: { email: `rlist-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;
    });

    const sup = await createSupplierLogic(
      tenantA,
      supplierInputSchema.parse({ nameFull: `ซัพ-${randomUUID().slice(0, 6)}` })
    );
    supplierA = sup.id;

    pork = await makeProduct("pork");
    basil = await makeProduct("basil");
    salmonWhole = await makeProduct("salmon");
    // Q1's OTHER half: a PREPPED product made by one parent and a yield.
    salmonFillet = await makeProduct("fillet", {
      type: "PREPPED",
      parentProductId: salmonWhole.id,
      yieldPercent: 50,
    });
    // A PREPPED product with NEITHER method yet — the queue row.
    chilliJam = await makeProduct("jam", { type: "PREPPED" });

    await receiveInto(branchA, pork, 10, 100);
    await receiveInto(branchA, basil, 2, 200);
    await receiveInto(branchA, salmonWhole, 5, 400);
    // อโศก pays more for the same pork — the reason a comparison prints a branch
    // name beside every figure.
    await receiveInto(branchB, pork, 10, 150);

    // Three dishes, deliberately: one with a recipe, one that will get a branch
    // exception, one with nothing at all.
    kaphrao = await makeMenu(`LIST-กะเพราหมู-${randomUUID().slice(0, 6)}`);
    tomYum = await makeMenu(`LIST-ต้มยำ-${randomUUID().slice(0, 6)}`);
    plainRice = await makeMenu(`LIST-ข้าวเปล่า-${randomUUID().slice(0, 6)}`);
  }, 240_000);

  afterAll(async () => {
    await withAdminContext(async (tx) => {
      await tx.recipeBranch.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeIngredient.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipe.updateMany({
        where: { tenantId: tenantA },
        data: { supersededAt: null, supersededById: null },
      });
      await tx.recipe.deleteMany({ where: { tenantId: tenantA } });
      await tx.menu.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockMovement.deleteMany({ where: { tenantId: tenantA } });
      // Part 16: `expense_source_gr_check` refuses the expense row once its
      // receipt is gone, so the expense goes FIRST.
      await tx.expenseItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.expense.deleteMany({ where: { tenantId: tenantA } });
      await tx.goodsReceiptItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.goodsReceipt.deleteMany({ where: { tenantId: tenantA } });
      await tx.purchaseOrderItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.purchaseOrder.deleteMany({ where: { tenantId: tenantA } });
      await tx.supplierProductMapping.deleteMany({ where: { tenantId: tenantA } });
      await tx.supplier.deleteMany({ where: { tenantId: tenantA } });
      await tx.department.deleteMany({ where: { tenantId: tenantA } });
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
  // The list
  // ------------------------------------------------------------

  it("L-01 lists every menu, INCLUDING the ones with no recipe", async () => {
    await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: kaphrao.id, ingredients: [ing(pork, 0.12)] }),
      userA
    );

    const res = await list();
    const names = res.menus.map((m) => m.name);
    expect(names).toContain(plainRice.name);

    const withRecipe = res.menus.find((m) => m.targetId === kaphrao.id)!;
    const without = res.menus.find((m) => m.targetId === plainRice.id)!;

    expect(withRecipe.recipeId).not.toBeNull();
    // 0.12 kg of pork at 100/kg.
    expect(withRecipe.costPerServing?.toString()).toBe("12");
    expect(withRecipe.confidence).toBe("HIGH");

    // The whole reason menus are the axis: this row exists and is visibly empty.
    expect(without.recipeId).toBeNull();
    expect(without.costPerServing).toBeNull();
    expect(without.confidence).toBeNull();
  });

  it("L-02 a cost never travels without its confidence, and vice versa", async () => {
    const res = await list();
    for (const row of [...res.menus, ...res.prepped]) {
      expect(row.costPerServing === null).toBe(row.confidence === null);
    }
  });

  it("L-03 `missingOnly` is the queue — only the dishes nobody has written down", async () => {
    const res = await list({ missingOnly: true });
    expect(res.menus.every((m) => m.recipeId === null)).toBe(true);
    expect(res.menus.map((m) => m.targetId)).not.toContain(kaphrao.id);
    expect(res.menus.map((m) => m.targetId)).toContain(plainRice.id);
    // The count is of the WHOLE list, not of the filtered page.
    expect(res.missingCount).toBeGreaterThanOrEqual(res.menus.length);
  });

  it("L-04 says สูตรสาขา only where the branch decided for itself (Q8)", async () => {
    const central = await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: tomYum.id, ingredients: [ing(pork, 0.1)] }),
      userA
    );
    await copyRecipeToBranchesLogic(
      tenantA,
      copyRecipeToBranchesInputSchema.parse({
        submitKey: randomUUID(),
        sourceRecipeId: central.id,
        branchIds: [branchB],
        acknowledgeOverwrite: false,
      }),
      userA
    );

    const atA = await list();
    const atB = await list({ branchId: branchB });

    // ทองหล่อ never diverged: it still follows central.
    expect(atA.menus.find((m) => m.targetId === tomYum.id)!.isBranchOwn).toBe(false);
    // อโศก has its own copy now — same ingredients, its own decision.
    expect(atB.menus.find((m) => m.targetId === tomYum.id)!.isBranchOwn).toBe(true);
  });

  it("L-05 the same dish is a different number at a different branch (rule R4)", async () => {
    const atA = await list();
    const atB = await list({ branchId: branchB });

    const a = atA.menus.find((m) => m.targetId === kaphrao.id)!;
    const b = atB.menus.find((m) => m.targetId === kaphrao.id)!;

    expect(a.costPerServing?.toString()).toBe("12");
    // อโศก pays 150/kg for the same pork.
    expect(b.costPerServing?.toString()).toBe("18");
  });

  it("L-06 PREPPED products get their own section, and name their method (Q1)", async () => {
    const res = await list();
    const fillet = res.prepped.find((p) => p.targetId === salmonFillet.id)!;
    const jam = res.prepped.find((p) => p.targetId === chilliJam.id)!;

    expect(fillet.preppedMethod).toBe("PARENT_YIELD");
    // Nothing says how the jam is made yet. That is a queue row, not an error.
    expect(jam.preppedMethod).toBe("NONE");
    expect(jam.recipeId).toBeNull();

    await createRecipeLogic(
      tenantA,
      recipeInput({
        outputProductId: chilliJam.id,
        servings: 1,
        ingredients: [ing(pork, 0.2), ing(basil, 0.05)],
      }),
      userA
    );

    const after = await list();
    const jamAfter = after.prepped.find((p) => p.targetId === chilliJam.id)!;
    expect(jamAfter.preppedMethod).toBe("RECIPE");
    // 0.2 × 100 + 0.05 × 200 = 30.
    expect(jamAfter.costPerServing?.toString()).toBe("30");
  });

  it("L-07 `asOf` lists the recipe that was true THEN", async () => {
    const menu = await makeMenu(`LIST-เปลี่ยนสูตร-${randomUUID().slice(0, 6)}`);
    const v1 = await createRecipeLogic(
      tenantA,
      recipeInput({
        menuId: menu.id,
        effectiveFrom: addDays(today, -10),
        ingredients: [ing(pork, 0.1)],
      }),
      userA
    );
    const v2 = await updateRecipeLogic(
      tenantA,
      v1.id,
      recipeInput({
        menuId: menu.id,
        effectiveFrom: addDays(today, -2),
        ingredients: [ing(pork, 0.3)],
      }),
      userA
    );

    const now = await list();
    const then = await list({ asOf: addDays(today, -5) });

    // What the list is responsible for is WHICH VERSION applies on the day
    // asked about. The money on a past day is the ledger's answer, not the
    // list's, and it is proved in recipe-cost-logic C-11 — here the stock was
    // bought today, so a cost dated ten days ago is honestly nothing.
    expect(now.menus.find((m) => m.targetId === menu.id)!.recipeId).toBe(v2.id);
    expect(then.menus.find((m) => m.targetId === menu.id)!.recipeId).toBe(v1.id);
    expect(now.menus.find((m) => m.targetId === menu.id)!.costPerServing?.toString()).toBe("30");
  });

  it("L-08 search narrows the list without breaking the cost", async () => {
    const res = await list({ search: "กะเพราหมู" });
    expect(res.menus.length).toBe(1);
    expect(res.menus[0].targetId).toBe(kaphrao.id);
    expect(res.menus[0].costPerServing?.toString()).toBe("12");
  });

  // ------------------------------------------------------------
  // Q9 — the branch comparison
  // ------------------------------------------------------------

  it("L-09 groups BY RECIPE and counts the branches (Q9)", async () => {
    // ต้มยำ: central, which ทองหล่อ and ภูเก็ต follow, plus อโศก's own copy.
    const cmp = (await getRecipeBranchComparisonLogic(tenantA, {
      target: { kind: "menu", id: tomYum.id },
    }, SEES_COST, EVERY_BRANCH))!;

    expect(cmp.groups.length).toBe(2);
    // Central first, always.
    expect(cmp.groups[0].isCentral).toBe(true);
    expect(cmp.groups[0].branchCount).toBe(2);
    expect(cmp.groups[0].branchNames).toEqual([]);

    const own = cmp.groups[1];
    expect(own.isCentral).toBe(false);
    expect(own.branchNames).toEqual(["อโศก"]);
    expect(own.branchCount).toBe(1);
  });

  it("L-10 every figure names the branch it was priced at (rule R4)", async () => {
    const cmp = (await getRecipeBranchComparisonLogic(tenantA, {
      target: { kind: "menu", id: tomYum.id },
    }, SEES_COST, EVERY_BRANCH))!;

    const central = cmp.groups.find((g) => g.isCentral)!;
    const own = cmp.groups.find((g) => !g.isCentral)!;

    // Same ingredients on both sides — the copy changed nothing but who owns it.
    // The two numbers differ ONLY because อโศก pays more, which is exactly why
    // the branch name has to be printed beside each one.
    expect(central.pricedAtBranchName).toBe("ทองหล่อ");
    expect(central.costPerServing?.toString()).toBe("10");
    expect(own.pricedAtBranchName).toBe("อโศก");
    expect(own.costPerServing?.toString()).toBe("15");
  });

  it("L-11 a dish nobody has a recipe for compares to nothing, not to zero", async () => {
    const cmp = await getRecipeBranchComparisonLogic(tenantA, {
      target: { kind: "menu", id: plainRice.id },
    }, SEES_COST, EVERY_BRANCH);
    expect(cmp).toBeNull();
  });

  it("L-12 when every branch diverged, the central recipe is priced NOWHERE", async () => {
    const menu = await makeMenu(`LIST-แยกทุกสาขา-${randomUUID().slice(0, 6)}`);
    const central = await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: menu.id, ingredients: [ing(pork, 0.1)] }),
      userA
    );
    await copyRecipeToBranchesLogic(
      tenantA,
      copyRecipeToBranchesInputSchema.parse({
        submitKey: randomUUID(),
        sourceRecipeId: central.id,
        branchIds: [branchA, branchB, branchC],
        acknowledgeOverwrite: false,
      }),
      userA
    );

    const cmp = (await getRecipeBranchComparisonLogic(tenantA, {
      target: { kind: "menu", id: menu.id },
    }, SEES_COST, EVERY_BRANCH))!;
    const centralGroup = cmp.groups.find((g) => g.isCentral)!;

    // It still exists and it still governs no branch. Inventing a branch to
    // price it at would put a number on screen that describes nobody's kitchen.
    expect(centralGroup.branchCount).toBe(0);
    expect(centralGroup.pricedAtBranchName).toBeNull();
    expect(centralGroup.costPerServing).toBeNull();
    expect(centralGroup.confidence).toBeNull();
  });

  // ------------------------------------------------------------
  // The history (rule R8)
  // ------------------------------------------------------------

  it("L-13 the history is every version of the line, newest first", async () => {
    const menu = await makeMenu(`LIST-ประวัติ-${randomUUID().slice(0, 6)}`);
    const v1 = await createRecipeLogic(
      tenantA,
      recipeInput({
        menuId: menu.id,
        effectiveFrom: addDays(today, -20),
        ingredients: [ing(pork, 0.1)],
      }),
      userA
    );
    const v2 = await updateRecipeLogic(
      tenantA,
      v1.id,
      recipeInput({
        menuId: menu.id,
        effectiveFrom: addDays(today, -5),
        ingredients: [ing(pork, 0.2)],
      }),
      userA
    );

    const history = await getRecipeHistoryLogic(tenantA, v1.lineId);
    expect(history.length).toBe(2);
    expect(history[0].recipeId).toBe(v2.id);
    expect(history[0].isCurrent).toBe(true);
    // A merely-past version is NOT superseded: it still governs the days it
    // covered, and Part 22 posts those days against it.
    expect(history[1].recipeId).toBe(v1.id);
    expect(history[1].isSuperseded).toBe(false);
    expect(history[1].isCurrent).toBe(false);
  });

  it("L-14 a version that was WRONG is kept and flagged, not hidden", async () => {
    const menu = await makeMenu(`LIST-แก้ผิด-${randomUUID().slice(0, 6)}`);
    const v1 = await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: menu.id, ingredients: [ing(pork, 0.1)] }),
      userA
    );
    // Same effective date = a correction, not a change of dish (Q4).
    const v2 = await updateRecipeLogic(
      tenantA,
      v1.id,
      recipeInput({
        menuId: menu.id,
        effectiveFrom: today,
        ingredients: [ing(pork, 0.15)],
      }),
      userA
    );

    const history = await getRecipeHistoryLogic(tenantA, v1.lineId);
    const superseded = history.find((h) => h.recipeId === v1.id)!;
    const current = history.find((h) => h.recipeId === v2.id)!;

    expect(superseded.isSuperseded).toBe(true);
    expect(superseded.isCurrent).toBe(false);
    expect(current.isCurrent).toBe(true);
  });

  it("L-15 a line id from nowhere is an empty history, not an error", async () => {
    await expect(getRecipeHistoryLogic(tenantA, randomUUID())).resolves.toEqual([]);
  });
});
