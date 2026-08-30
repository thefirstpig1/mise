// ============================================================
// Mise — recipe cost *Logic integration tests (Sprint 5 Part 21 L3b)
// ============================================================
// The explosion is proved without a database in tests/recipe-graph, and the FIFO
// replay in tests/fifo-replay. What is proved HERE is the join between them: that
// the right raw quantities meet the right branch's money, that both divisions of
// rule R2 are applied in the right order, and that every place the answer is
// unknown SAYS SO instead of contributing a zero.
//
// Money comes from real receipts through the real Part 11/13 path (PO → send →
// receive → confirm), because a hand-built layer would prove the test right
// rather than the code. VAT is 0 throughout so that every figure below is
// exactly the price paid — the VAT uplift has its own tests in Part 16.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass } from "@/lib/db-admin";
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
import { declareStockCostInputSchema } from "@/lib/validations/stock-cost";
import { declareStockCostLogic } from "@/server/cost-declaration";
import { createStockAdjustmentInputSchema } from "@/lib/validations/stock-movement";
import { createStockAdjustmentLogic } from "@/server/stock-movement";
import { recipeInputSchema, copyRecipeToBranchesInputSchema } from "@/lib/validations/recipe";
import {
  copyRecipeToBranchesLogic,
  createRecipeLogic,
  updateRecipeLogic,
} from "@/server/recipe";
import { getRecipeCostLogic, getRecipeCostsLogic } from "@/server/recipe-cost";

describe("recipe cost *Logic (ADR 0021 Part 21 L3b)", () => {
  let tenantA: string;
  let userA: string;
  let branchA: string;
  let branchB: string;
  let supplierA: string;

  let pork: ProductWithUnits;
  let basil: ProductWithUnits;
  let chilli: ProductWithUnits;
  let oil: ProductWithUnits;
  let salmonWhole: ProductWithUnits;
  let salmonFillet: ProductWithUnits;
  let chilliJam: ProductWithUnits;
  let neverBought: ProductWithUnits;

  const today = computeBangkokToday();

  // ------------------------------------------------------------
  // Fixtures
  // ------------------------------------------------------------

  const makeProduct = (
    tag: string,
    over: Record<string, unknown> = {}
  ): Promise<ProductWithUnits> =>
    createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `COST-${tag}-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
        ...over,
      })
    );

  const makeMenu = (name: string): Promise<{ id: string }> =>
    withRlsBypass((tx) =>
      tx.menu.create({
        data: {
          tenantId: tenantA,
          source: "MISE",
          name: `${name}-${randomUUID().slice(0, 6)}`,
        },
        select: { id: true },
      })
    );

  const baseUnitOf = (p: ProductWithUnits) =>
    p.productUnits.find((u) => u.isBase)!.id;

  /** Buy `qty` base units at `pricePerUnit`, through the real documents. */
  const receiveInto = async (
    branchId: string,
    product: ProductWithUnits,
    qty: number,
    pricePerUnit: number,
    receivedAt: Date = new Date()
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
        receivedAt,
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
    return confirmGoodsReceiptLogic(tenantA, gr.id, userA);
  };

  const ing = (p: ProductWithUnits, qty: number) => ({
    productId: p.id,
    componentMenuId: null,
    qty,
    productUnitId: baseUnitOf(p),
    sortOrder: 0,
    notes: null,
  });

  const ingMenu = (menuId: string, qty: number) => ({
    productId: null,
    componentMenuId: menuId,
    qty,
    productUnitId: null,
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

  const costOf = (recipeId: string, branchId: string, asOf?: Date) =>
    getRecipeCostLogic(tenantA, { recipeId, branchId, asOf });

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Recipe Cost Tenant" } });
      tenantA = t.id;
      const [a, b] = await Promise.all([
        tx.branch.create({ data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" } }),
        tx.branch.create({ data: { tenantId: t.id, name: "อโศก", code: "ASK" } }),
      ]);
      branchA = a.id;
      branchB = b.id;
      // A purchase order allocates its lines to a department (ADR 0012 Q2), and
      // resolving the default one is what the real write path does.
      await tx.department.create({
        data: { tenantId: t.id, name: "Main", code: "MAIN" },
      });
      const u = await tx.user.create({
        data: { email: `rcost-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
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
    chilli = await makeProduct("chilli");
    oil = await makeProduct("oil", {
      primaryDimension: "VOLUME",
      baseUnitName: "ml",
      defaultBuyUnitName: "ml",
    });
    salmonWhole = await makeProduct("salmon");
    salmonFillet = await makeProduct("fillet", {
      type: "PREPPED",
      parentProductId: salmonWhole.id,
      yieldPercent: 50,
    });
    chilliJam = await makeProduct("jam", { type: "PREPPED" });
    neverBought = await makeProduct("unbought");

    // ทองหล่อ's prices.
    await receiveInto(branchA, pork, 10, 100);
    await receiveInto(branchA, basil, 2, 200);
    await receiveInto(branchA, chilli, 5, 50);
    await receiveInto(branchA, oil, 1000, 0.4);
    await receiveInto(branchA, salmonWhole, 5, 400);
    // อโศก buys the same pork dearer — Q5's whole point.
    await receiveInto(branchB, pork, 10, 150);
    await receiveInto(branchB, basil, 2, 200);
  }, 180_000);

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.recipeBranch.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeIngredient.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipe.updateMany({
        where: { tenantId: tenantA },
        data: { supersededAt: null, supersededById: null },
      });
      await tx.recipe.deleteMany({ where: { tenantId: tenantA } });
      await tx.menu.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockCostDeclaration.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockAdjustment.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockMovement.deleteMany({ where: { tenantId: tenantA } });
      // Part 16: a confirmed receipt writes its own expense, and
      // `expense_source_gr_check` refuses the row once its receipt is gone — so
      // the expense goes first, not the other way round.
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
  }, 120_000);

  // ------------------------------------------------------------
  // The arithmetic
  // ------------------------------------------------------------

  it("C-01 prices a plain recipe from the branch's own ledger", async () => {
    const menu = await makeMenu("กะเพราหมู");
    const recipe = await createRecipeLogic(
      tenantA,
      recipeInput({
        menuId: menu.id,
        ingredients: [ing(pork, 0.12), ing(basil, 0.01)],
      }),
      userA
    );

    const cost = await costOf(recipe.id, branchA);
    // 0.12 kg × 100 + 0.01 kg × 200 = 12 + 2
    expect(cost?.costPerServing.toNumber()).toBeCloseTo(14, 6);
    expect(cost?.confidence).toBe("HIGH");
    expect(cost?.problem).toBeNull();
    expect(cost?.unpriced).toHaveLength(0);
  });

  it("C-02 divides a pot into plates — `servings` is the first division of rule R2", async () => {
    const menu = await makeMenu("แกงหม้อใหญ่");
    const recipe = await createRecipeLogic(
      tenantA,
      recipeInput({
        menuId: menu.id,
        // Twenty servings out of twenty times the ingredients: the same plate.
        servings: 20,
        ingredients: [ing(pork, 2.4), ing(basil, 0.2)],
      }),
      userA
    );

    const cost = await costOf(recipe.id, branchA);
    // The pot is what the walk computes; the plate is a division of MONEY.
    expect(cost?.costPerBatch.toNumber()).toBeCloseTo(280, 6);
    expect(cost?.costPerServing.toNumber()).toBeCloseTo(14, 6);
  });

  it("C-03 yield is a DIVISION — 0.1 kg of fillet at 50% needs 0.2 kg of fish, not 0.15", async () => {
    const menu = await makeMenu("สเต็กแซลมอน");
    const recipe = await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: menu.id, ingredients: [ing(salmonFillet, 0.1)] }),
      userA
    );

    const cost = await costOf(recipe.id, branchA);
    // 0.1 ÷ 0.5 = 0.2 kg of whole salmon × 400 = 80. The wrong formula,
    // 0.1 × (1 + 0.5), gives 0.15 kg and 60 — smaller every time (Decision #59).
    expect(cost?.costPerServing.toNumber()).toBeCloseTo(80, 6);
    // The walk goes straight through the prepped product to RAW (Q11).
    expect(cost?.leaves.map((l) => l.productId)).toEqual([salmonWhole.id]);
  });

  it("C-04 recurses through a PRODUCTION recipe (Q1's many-input half)", async () => {
    // One batch of jam: 0.3 kg of chilli in, 0.25 kg of jam out.
    const jamRecipe = await createRecipeLogic(
      tenantA,
      recipeInput({
        outputProductId: chilliJam.id,
        servings: 0.25,
        ingredients: [ing(chilli, 0.3)],
      }),
      userA
    );
    const jamCost = await costOf(jamRecipe.id, branchA);
    // 0.3 × 50 = 15 for the batch; per base unit of output, 15 ÷ 0.25 = 60 ฿/kg.
    expect(jamCost?.costPerBatch.toNumber()).toBeCloseTo(15, 6);
    expect(jamCost?.costPerServing.toNumber()).toBeCloseTo(60, 6);

    const menu = await makeMenu("ผัดน้ำพริกเผา");
    const dish = await createRecipeLogic(
      tenantA,
      recipeInput({
        menuId: menu.id,
        ingredients: [ing(chilliJam, 0.05), ing(pork, 0.1)],
      }),
      userA
    );
    const cost = await costOf(dish.id, branchA);
    // 0.05 kg of jam = 0.06 kg of chilli = 3 ฿; plus 0.1 kg pork = 10 ฿.
    expect(cost?.costPerServing.toNumber()).toBeCloseTo(13, 6);
    expect(cost?.confidence).toBe("HIGH");
  });

  it("C-05 a SET MENU is an ordinary recipe one level up (Q3)", async () => {
    const dishMenu = await makeMenu("กะเพราในเซ็ท");
    const setMenu = await makeMenu("เซ็ทมื้อเที่ยง");
    await createRecipeLogic(
      tenantA,
      recipeInput({
        menuId: dishMenu.id,
        ingredients: [ing(pork, 0.12), ing(basil, 0.01)],
      }),
      userA
    );
    const set = await createRecipeLogic(
      tenantA,
      recipeInput({
        menuId: setMenu.id,
        ingredients: [ingMenu(dishMenu.id, 1), ing(chilli, 0.02)],
      }),
      userA
    );

    const cost = await costOf(set.id, branchA);
    // 14 for the dish + 0.02 × 50 = 1 for the chilli.
    expect(cost?.costPerServing.toNumber()).toBeCloseTo(15, 6);
    // Nothing was copied: the set's leaves are the dish's raw materials.
    expect(cost?.leaves.map((l) => l.productId).sort()).toEqual(
      [pork.id, basil.id, chilli.id].sort()
    );
  });

  // ------------------------------------------------------------
  // Where the answer is unknown (Q6)
  // ------------------------------------------------------------

  it("C-06 an ingredient this branch never bought makes the WHOLE recipe LOW, and is named", async () => {
    const menu = await makeMenu("ใส่ของที่ไม่เคยซื้อ");
    const recipe = await createRecipeLogic(
      tenantA,
      recipeInput({
        menuId: menu.id,
        ingredients: [ing(pork, 0.12), ing(neverBought, 0.01)],
      }),
      userA
    );

    const cost = await costOf(recipe.id, branchA);
    // Five ingredients resolving and one free is exactly the failure Q6 exists
    // to catch: the total looks plausible.
    expect(cost?.confidence).toBe("LOW");
    expect(cost?.unpriced).toHaveLength(1);
    expect(cost?.unpriced[0]).toMatchObject({
      kind: "product",
      id: neverBought.id,
      reason: "NEVER_PURCHASED",
    });
    // The pork is still priced — an unknown ingredient does not void the rest.
    expect(cost?.costPerServing.toNumber()).toBeCloseTo(12, 6);
  });

  it("C-07 a component menu with NO recipe is named, not silently free", async () => {
    // The hole L3a found: the walk returns nothing for a menu it cannot expand,
    // so the set holding it simply looks cheaper. A leaf is a productId, so this
    // case cannot be expressed in the explosion and is found by scanning.
    const empty = await makeMenu("เมนูที่ยังไม่มีสูตร");
    const setMenu = await makeMenu("เซ็ทที่มีของว่าง");
    const set = await createRecipeLogic(
      tenantA,
      recipeInput({
        menuId: setMenu.id,
        ingredients: [ingMenu(empty.id, 1), ing(pork, 0.1)],
      }),
      userA
    );

    const cost = await costOf(set.id, branchA);
    expect(cost?.confidence).toBe("LOW");
    expect(cost?.unpriced).toContainEqual(
      expect.objectContaining({ kind: "menu", id: empty.id, reason: "NO_RECIPE" })
    );
    // And the LINE says so too, so the screen can mark the row rather than
    // printing a confident 0.00 beside it.
    const line = cost?.lines.find((l) => l.componentMenuId === empty.id);
    expect(line?.confidence).toBe("LOW");
  });

  it("C-08 a prepped product nothing says how to make is LOW for a DIFFERENT reason", async () => {
    const orphan = await makeProduct("orphan-prep", { type: "PREPPED" });
    const menu = await makeMenu("ใช้ของแปรรูปที่ยังไม่มีสูตร");
    const recipe = await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: menu.id, ingredients: [ing(orphan, 0.1)] }),
      userA
    );

    const cost = await costOf(recipe.id, branchA);
    expect(cost?.confidence).toBe("LOW");
    expect(cost?.unpriced).toContainEqual(
      expect.objectContaining({ kind: "product", id: orphan.id, reason: "NO_RECIPE" })
    );
  });

  it("C-09 a DECLARED cost is MEDIUM — real, but not the price of the goods in the pot", async () => {
    const gift = await makeProduct("gift");
    const adjustment = await createStockAdjustmentLogic(
      tenantA,
      createStockAdjustmentInputSchema.parse({
        submitKey: randomUUID(),
        productId: gift.id,
        branchId: branchA,
        type: "ADJUST_GAIN",
        reason: "RECOUNT",
        inputQty: 5,
        inputUnitId: baseUnitOf(gift),
        occurredAt: new Date(),
        notes: null,
      }),
      userA
    );
    await declareStockCostLogic(
      tenantA,
      declareStockCostInputSchema.parse({
        submitKey: randomUUID(),
        movementId: adjustment.movement.id,
        unitCost: 20,
        unitId: baseUnitOf(gift),
        notes: null,
      }),
      userA
    );

    const menu = await makeMenu("ของที่มีคนระบุราคา");
    const recipe = await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: menu.id, ingredients: [ing(gift, 0.5)] }),
      userA
    );

    const cost = await costOf(recipe.id, branchA);
    expect(cost?.costPerServing.toNumber()).toBeCloseTo(10, 6);
    expect(cost?.confidence).toBe("MEDIUM");
    // MEDIUM is not a complaint: nothing is missing, so nothing is named.
    expect(cost?.unpriced).toHaveLength(0);
  });

  // ------------------------------------------------------------
  // Branch and date (Q5, Q4)
  // ------------------------------------------------------------

  it("C-10 one recipe is as many numbers as there are branches (Q5)", async () => {
    const menu = await makeMenu("กะเพราสองสาขา");
    const recipe = await createRecipeLogic(
      tenantA,
      recipeInput({
        menuId: menu.id,
        ingredients: [ing(pork, 0.12), ing(basil, 0.01)],
      }),
      userA
    );

    expect((await costOf(recipe.id, branchA))?.costPerServing.toNumber()).toBeCloseTo(
      14,
      6
    );
    // อโศก paid 150 for the same pork: 0.12 × 150 + 0.01 × 200 = 20.
    expect((await costOf(recipe.id, branchB))?.costPerServing.toNumber()).toBeCloseTo(
      20,
      6
    );
  });

  it("C-11 `asOf` costs the version that was true THEN, not today's", async () => {
    const menu = await makeMenu("สูตรเปลี่ยนกลางเดือน");
    const tenDaysAgo = addDays(today, -10);
    const v1 = await createRecipeLogic(
      tenantA,
      recipeInput({
        menuId: menu.id,
        effectiveFrom: tenDaysAgo,
        ingredients: [ing(pork, 0.1)],
      }),
      userA
    );
    const v2 = await updateRecipeLogic(
      tenantA,
      v1.id,
      recipeInput({
        menuId: menu.id,
        effectiveFrom: today,
        ingredients: [ing(pork, 0.2)],
      }),
      userA
    );

    // Part 22 posts thirty past days in one pass; each has to meet the recipe
    // that was true then, or a fortnight of pork is overstated by 20 g a plate.
    expect((await costOf(v1.id, branchA))?.costPerServing.toNumber()).toBeCloseTo(10, 6);
    expect((await costOf(v2.id, branchA))?.costPerServing.toNumber()).toBeCloseTo(20, 6);
  });

  it("C-12 the NAMED version is costed even where the branch keeps its own recipe", async () => {
    const menu = await makeMenu("เทียบข้ามสาขา");
    const central = await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: menu.id, ingredients: [ing(pork, 0.12)] }),
      userA
    );
    const atB = await copyRecipeToBranchesLogic(
      tenantA,
      copyRecipeToBranchesInputSchema.parse({
        submitKey: randomUUID(),
        sourceRecipeId: central.id,
        branchIds: [branchB],
      }),
      userA
    );
    await updateRecipeLogic(
      tenantA,
      atB.id,
      recipeInput({ menuId: menu.id, ingredients: [ing(pork, 0.2)] }),
      userA
    );

    // Asking for the CENTRAL recipe at อโศก means "what would this recipe cost
    // there" — Q5's comparison. Resolving the root instead would answer อโศก's
    // own recipe at อโศก's prices, and the comparison would be a different dish.
    const centralAtB = await costOf(central.id, branchB);
    expect(centralAtB?.costPerServing.toNumber()).toBeCloseTo(18, 6); // 0.12 × 150
  });

  // ------------------------------------------------------------
  // The lines, the percentage, and the batch
  // ------------------------------------------------------------

  it("C-13 each line carries its whole subtree, and the lines add up to the total", async () => {
    const menu = await makeMenu("แจกแจงรายบรรทัด");
    const recipe = await createRecipeLogic(
      tenantA,
      recipeInput({
        menuId: menu.id,
        ingredients: [ing(salmonFillet, 0.1), ing(basil, 0.01)],
      }),
      userA
    );

    const cost = await costOf(recipe.id, branchA);
    expect(cost?.lines).toHaveLength(2);
    const fillet = cost?.lines.find((l) => l.productId === salmonFillet.id);
    // The line names the fillet, and carries what the whole salmon under it cost.
    expect(fillet?.cost.toNumber()).toBeCloseTo(80, 6);
    expect(fillet?.unitName).toBe("kg");

    const summed = cost!.lines.reduce((a, l) => a + l.cost.toNumber(), 0);
    expect(summed).toBeCloseTo(cost!.costPerBatch.toNumber(), 6);
  });

  it("C-14 a production recipe reads BACKWARDS as a yield percentage (Q16)", async () => {
    const jam = await makeProduct("jam2", { type: "PREPPED" });
    const recipe = await createRecipeLogic(
      tenantA,
      recipeInput({
        outputProductId: jam.id,
        servings: 0.25,
        ingredients: [ing(chilli, 0.3)],
      }),
      userA
    );

    const cost = await costOf(recipe.id, branchA);
    // 0.25 kg out of 0.3 kg in — the same fact its parent-and-yield twin states.
    expect(cost?.yieldPercentComputed?.toNumber()).toBeCloseTo(83.3, 1);
  });

  it("C-15 …and says nothing rather than inventing one when the dimensions differ", async () => {
    const paste = await makeProduct("paste", { type: "PREPPED" });
    const recipe = await createRecipeLogic(
      tenantA,
      recipeInput({
        outputProductId: paste.id,
        servings: 0.3,
        // 0.25 kg of chilli and 100 ml of oil do not add up to anything.
        ingredients: [ing(chilli, 0.25), ing(oil, 100)],
      }),
      userA
    );

    const cost = await costOf(recipe.id, branchA);
    expect(cost?.yieldPercentComputed).toBeNull();
    // The COST is unaffected — 0.25 × 50 + 100 × 0.4 = 52.5 for the batch.
    expect(cost?.costPerBatch.toNumber()).toBeCloseTo(52.5, 6);
  });

  it("C-16 a menu recipe never reports a yield percentage — portions are not a weight", async () => {
    const menu = await makeMenu("จานเดียว");
    const recipe = await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: menu.id, ingredients: [ing(pork, 0.1)] }),
      userA
    );
    expect((await costOf(recipe.id, branchA))?.yieldPercentComputed).toBeNull();
  });

  it("C-17 the batch read answers for every recipe asked, off ONE walk", async () => {
    const menus = await Promise.all([makeMenu("ก"), makeMenu("ข"), makeMenu("ค")]);
    // Written out, never `0.1 * (i + 1)`: that is 0.30000000000000004 in binary
    // float and the three-decimal guard rejects it, correctly.
    const quantities = [0.1, 0.2, 0.3];
    const recipes = await Promise.all(
      menus.map((m, i) =>
        createRecipeLogic(
          tenantA,
          recipeInput({ menuId: m.id, ingredients: [ing(pork, quantities[i])] }),
          userA
        )
      )
    );

    const costs = await getRecipeCostsLogic(tenantA, {
      recipeIds: recipes.map((r) => r.id),
      branchId: branchA,
    });
    expect(costs.size).toBe(3);
    recipes.forEach((r, i) => {
      expect(costs.get(r.id)!.costPerServing.toNumber()).toBeCloseTo(
        quantities[i] * 100,
        6
      );
    });
  });

  it("C-18 a recipe id from nowhere is absent, not an error", async () => {
    expect(await costOf(randomUUID(), branchA)).toBeNull();
  });
});
