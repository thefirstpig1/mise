// ============================================================
// Mise — the live calculator (Part 24 L3d, ADR 0025 Q3/Q6)
// ============================================================
// A recipe that exists nowhere, costed by the engine that costs everything else.
// The first test is the one that matters: an unsaved what-if and the identical
// SAVED recipe must produce the same number, because ADR 0025 Q4 rejected a
// separate draft table precisely to avoid two cost engines that drift.
//
//   W1  a what-if costs exactly what the same saved recipe costs
//   W2  an empty calculator is ฿0 at LOW — never a confident zero
//   W3  an ingredient nobody has bought says so, and drags the whole thing down
//   W4  a component menu that has only a DRAFT is NO_RECIPE, here too
//   W5  no branch named = the freshest one, named out loud
//   W6  ราคาที่ตั้งใจ turns the cost into a food-cost %, and nothing without it
//
// Money comes from real receipts through the real Part 11/13 path, and VAT is 0
// throughout, so every figure below is exactly the price paid.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withAdminContext, prisma } from "@/lib/db";
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
import { recipeInputSchema } from "@/lib/validations/recipe";
import {
  draftRecipeInputSchema,
  labWhatIfQuerySchema,
} from "@/lib/validations/menu-lab";
import { createRecipeLogic } from "@/server/recipe";
import { createDraftLogic } from "@/server/menu-lab";
import { getLabWhatIfLogic } from "@/server/menu-lab-read";
import { getRecipeCostLogic } from "@/server/recipe-cost";

describe("Menu Lab's live calculator (ADR 0025 Q3)", () => {
  let tenantA: string;
  let userA: string;
  let branchA: string;
  let branchB: string;
  let supplierA: string;

  let pork: ProductWithUnits;
  let basil: ProductWithUnits;
  let neverBought: ProductWithUnits;

  const today = computeBangkokToday();

  const baseUnitOf = (p: ProductWithUnits) =>
    p.productUnits.find((u) => u.isBase)!.id;

  const makeProduct = (tag: string) =>
    createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `LAB-${tag}-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
      })
    );

  const makeMenu = (name: string) =>
    withAdminContext((tx) =>
      tx.menu.create({
        data: {
          tenantId: tenantA,
          source: "MISE",
          name: `${name}-${randomUUID().slice(0, 4)}`,
        },
        select: { id: true },
      })
    );

  /** Buy `qty` base units at `pricePerUnit`, through the real documents. */
  const receiveInto = async (
    branchId: string,
    product: ProductWithUnits,
    qty: number,
    pricePerUnit: number,
    receivedAt: Date
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

  const productLine = (p: ProductWithUnits, qty: number, sortOrder = 0) => ({
    productId: p.id,
    componentMenuId: null,
    qty,
    productUnitId: baseUnitOf(p),
    sortOrder,
    notes: null,
  });

  const menuLine = (menuId: string, qty: number, sortOrder = 0) => ({
    productId: null,
    componentMenuId: menuId,
    qty,
    productUnitId: null,
    sortOrder,
    notes: null,
  });

  const whatIf = (over: Record<string, unknown>) =>
    getLabWhatIfLogic(
      tenantA,
      labWhatIfQuerySchema.parse({
        servings: 1,
        plannedPrice: null,
        ingredients: [],
        ...over,
      })
    );

  beforeAll(async () => {
    await withAdminContext(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "What-If Tenant" } });
      tenantA = t.id;
      const u = await tx.user.create({
        data: { email: `whatif-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;
      const a = await tx.branch.create({
        data: { tenantId: t.id, name: "ก ทองหล่อ", code: "THL" },
        select: { id: true },
      });
      const b = await tx.branch.create({
        data: { tenantId: t.id, name: "ข อโศก", code: "ASK" },
        select: { id: true },
      });
      branchA = a.id;
      branchB = b.id;
      // A purchase order allocates its lines to a department (ADR 0012 Q2).
      await tx.department.create({
        data: { tenantId: t.id, name: "Main", code: "MAIN" },
      });
    });

    const supplier = await createSupplierLogic(
      tenantA,
      supplierInputSchema.parse({ nameFull: `ซัพ-${randomUUID().slice(0, 6)}` })
    );
    supplierA = supplier.id;

    pork = await makeProduct("pork");
    basil = await makeProduct("basil");
    neverBought = await makeProduct("truffle");

    // ทองหล่อ bought earlier and cheaper; อโศก bought today. The freshest data
    // is อโศก's, which is what W5 is about.
    await receiveInto(branchA, pork, 10, 100, addDays(today, -3));
    await receiveInto(branchA, basil, 2, 200, addDays(today, -3));
    await receiveInto(branchB, pork, 10, 150, today);
    await receiveInto(branchB, basil, 2, 200, today);
  }, 180_000);

  afterAll(async () => {
    await withAdminContext(async (tx) => {
      await tx.recipeIngredient.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeBranch.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipe.updateMany({
        where: { tenantId: tenantA },
        data: { supersededById: null, supersededAt: null },
      });
      await tx.recipe.deleteMany({ where: { tenantId: tenantA } });
      await tx.menu.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockMovement.deleteMany({ where: { tenantId: tenantA } });
      await tx.expenseItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.expense.deleteMany({ where: { tenantId: tenantA } });
      await tx.goodsReceiptItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.goodsReceipt.deleteMany({ where: { tenantId: tenantA } });
      await tx.purchaseOrderItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.purchaseOrder.deleteMany({ where: { tenantId: tenantA } });
      await tx.supplier.deleteMany({ where: { tenantId: tenantA } });
      await tx.productUnit.deleteMany({
        where: { product: { tenantId: tenantA } },
      });
      await tx.product.deleteMany({ where: { tenantId: tenantA } });
      // createProductLogic gives a product its default category; the FK is
      // RESTRICT, so the category outlives the product only until here.
      await tx.category.deleteMany({ where: { tenantId: tenantA } });
      await tx.department.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.deleteMany({ where: { id: tenantA } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
    await prisma.$disconnect();
  }, 180_000);

  it("W1: a what-if costs exactly what the same saved recipe costs", async () => {
    const menu = await makeMenu("W1 กะเพราหมู");
    const lines = [productLine(pork, 0.12), productLine(basil, 0.01, 1)];

    const saved = await createRecipeLogic(
      tenantA,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId: menu.id,
        outputProductId: null,
        servings: 2,
        effectiveFrom: today,
        ingredients: lines,
        notes: null,
      }),
      userA
    );

    const real = await getRecipeCostLogic(tenantA, {
      recipeId: saved.id,
      branchId: branchA,
      asOf: undefined,
    });
    const lab = await whatIf({
      branchId: branchA,
      servings: 2,
      ingredients: lines,
    });

    // 0.12 kg × ฿100 + 0.01 kg × ฿200 = ฿14 a batch, ฿7 a serving.
    expect(real!.costPerBatch.toString()).toBe("14");
    expect(lab.cost.costPerBatch.toString()).toBe(real!.costPerBatch.toString());
    expect(lab.cost.costPerServing.toString()).toBe(
      real!.costPerServing.toString()
    );
    expect(lab.cost.confidence).toBe(real!.confidence);

    // And line by line, so a total that happens to match by luck is not enough.
    expect(lab.cost.lines.map((l) => l.cost.toString())).toEqual(
      real!.lines.map((l) => l.cost.toString())
    );
  });

  it("W2: an empty calculator is ฿0 at LOW, never a confident zero", async () => {
    const lab = await whatIf({ branchId: branchA, ingredients: [] });

    expect(lab.cost.costPerBatch.toString()).toBe("0");
    expect(lab.cost.confidence).toBe("LOW");
    expect(lab.cost.lines).toEqual([]);
  });

  it("W3: an ingredient nobody has bought says so", async () => {
    const lab = await whatIf({
      branchId: branchA,
      ingredients: [productLine(pork, 0.1), productLine(neverBought, 0.005, 1)],
    });

    // The known half is still counted...
    expect(Number(lab.cost.costPerBatch)).toBeCloseTo(10, 6);
    // ...and the unknown half is named rather than valued at zero in silence.
    expect(lab.cost.confidence).toBe("LOW");
    expect(lab.cost.unpriced).toEqual([
      expect.objectContaining({
        kind: "product",
        id: neverBought.id,
        reason: "NEVER_PURCHASED",
      }),
    ]);
  });

  it("W4: a component menu that has only a draft is NO_RECIPE here too", async () => {
    const component = await makeMenu("W4 ไข่ดาว");
    await createDraftLogic(
      tenantA,
      draftRecipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId: component.id,
        newMenuName: null,
        menuCategoryId: null,
        servings: 1,
        plannedPrice: null,
        ingredients: [productLine(pork, 0.05)],
        notes: null,
      }),
      userA
    );

    const lab = await whatIf({
      branchId: branchA,
      ingredients: [menuLine(component.id, 1)],
    });

    // The draft is invisible to the resolver, so the set holding it is missing a
    // component recipe — not quietly cheap.
    expect(lab.cost.unpriced).toEqual([
      expect.objectContaining({
        kind: "menu",
        id: component.id,
        reason: "NO_RECIPE",
      }),
    ]);
    expect(lab.cost.confidence).toBe("LOW");
    expect(lab.cost.lines[0].confidence).toBe("LOW");
  });

  it("W5: no branch named means the freshest one, and it is named out loud", async () => {
    const lines = [productLine(pork, 1)];

    const defaulted = await whatIf({ ingredients: lines });
    expect(defaulted.branchId).toBe(branchB);
    expect(defaulted.branchName).toBe("ข อโศก");
    expect(defaulted.branchWasDefaulted).toBe(true);
    // อโศก's pork is the ฿150 one — a different branch is a different answer,
    // which is why the name has to travel with the number.
    expect(defaulted.cost.costPerServing.toString()).toBe("150");

    const named = await whatIf({ branchId: branchA, ingredients: lines });
    expect(named.branchWasDefaulted).toBe(false);
    expect(named.cost.costPerServing.toString()).toBe("100");
  });

  it("W6: ราคาที่ตั้งใจ turns cost into a food-cost %, and nothing without it", async () => {
    const lines = [productLine(pork, 0.12)];

    const priced = await whatIf({
      branchId: branchA,
      ingredients: lines,
      plannedPrice: 60,
    });
    // ฿12 of pork against a ฿60 plan = 20%, with ฿48 left over.
    expect(Number(priced.foodCostPercent)).toBeCloseTo(20, 6);
    expect(Number(priced.grossProfitPerServing)).toBeCloseTo(48, 6);

    const unpriced = await whatIf({ branchId: branchA, ingredients: lines });
    // Not 0% — there is no plan to measure against.
    expect(unpriced.foodCostPercent).toBeNull();
    expect(unpriced.grossProfitPerServing).toBeNull();
  });
});
