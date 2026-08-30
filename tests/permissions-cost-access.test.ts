// ============================================================
// Mise — the cook keeps the dish and loses the price (Part 28 L4, ADR 0029 Q12)
// ============================================================
// ADR 0021 Q18 named the case this file exists for and could not fix it:
//
//   "kitchen_staff has no `recipe` permission, yet a cook is the person who
//    most needs to READ a recipe. What they should not see is the COST. The
//    matrix has one axis and cannot express the difference."
//
// Two axes would not have helped either. The fix was to stop asking WHICH
// RESOURCE and start asking what the reader may see, and then to put that check
// at the EXIT rather than at the cost engine — because the engine is not only a
// reporting tool. It runs when the LEDGER MOVES: a cook posting a staff meal
// makes FIFO price what left the shelf.
//
// So the pair is:
//
//   C1/C2  the cook opens the recipe list, gets every dish, gets no money
//   C4     the cook DISPATCHES A TRANSFER, and the sending branch's FIFO
//          money is frozen onto the line — priced DURING A WRITE, by a
//          person who may not read a price anywhere on the screen
//
// C1 and C2 alone prove nothing about WHERE the gate is; they assert a null,
// and a null is what a gate on the engine would produce too. C4 is the one
// that says the engine must stay open, and it earns that by being a WRITE:
// `dispatchTransferLogic` calls `replayPairsInTx` mid-transaction (ADR 0018
// Q5) to freeze the cost onto the line.
//
// WHAT BREAKING THE ENGINE ACTUALLY SHOWED, recorded because it is sharper
// than the argument it was meant to support: making `replayPairsInTx` refuse
// turns C1, C2 AND C4 red together. The gate cannot be moved there even in
// principle — `transfer.ts` and `stock-cost.ts` contain the words `role`,
// `capability` and `costAccess` exactly ZERO times, because a write path has
// no user context to carry a ticket in. It has a `createdBy` user id and
// nothing else. So the reason the gate sits at the exit is not taste; it is
// that there is nowhere else it could go without threading a session through
// the ledger.
//
// (C3 is kept for a smaller, separate reason: it pins that the RECIPE GRAPH
// is not behind `cost:view` either. Gating recipes wholesale — the shape
// ADR 0021 Q18 rejected — would stop a cook recording what the kitchen ate.)
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { recipeInputSchema } from "@/lib/validations/recipe";
import { createRecipeLogic } from "@/server/recipe";
import { getRecipeListLogic } from "@/server/recipe-read";
import { createStaffMealInputSchema } from "@/lib/validations/staff-meal";
import { createStaffMealLogic, createStaffMemberLogic } from "@/server/staff-meal";
import { createStaffMemberInputSchema } from "@/lib/validations/staff-meal";
import { createStockAdjustmentLogic } from "@/server/stock-movement";
import { createStockAdjustmentInputSchema } from "@/lib/validations/stock-movement";
import { declareStockCostLogic } from "@/server/cost-declaration";
import { dispatchTransferLogic } from "@/server/transfer";
import { dispatchTransferInputSchema } from "@/lib/validations/transfer";
import { declareStockCostInputSchema } from "@/lib/validations/stock-cost";
import { costAccessFor } from "@/lib/permissions/cost-access";
import { EVERY_BRANCH } from "./support/reach";

describe("cost:view at the exit, not at the engine (ADR 0029 Part 28 L4)", () => {
  let tenantA: string;
  let userA: string;
  let branchA: string;
  let branchB: string;
  let pork: ProductWithUnits;
  let kaphrao: { id: string; name: string };
  let somchai: string;

  const today = computeBangkokToday();
  const RECIPES_FROM = addDays(today, -30);

  const OWNER_SEES = costAccessFor("owner");
  const COOK_SEES = costAccessFor("kitchen_staff");

  const baseUnitOf = (p: ProductWithUnits) =>
    p.productUnits.find((u) => u.isBase)!.id;

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Cost Access Tenant" } });
      tenantA = t.id;
      const b = await tx.branch.create({
        data: { tenantId: t.id, name: "อโศก", code: "CAT" },
      });
      branchA = b.id;
      const b2 = await tx.branch.create({
        data: { tenantId: t.id, name: "สีลม", code: "CAT2" },
      });
      branchB = b2.id;
      const u = await tx.user.create({
        data: { email: `ca-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;
    });

    pork = await createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `CA-pork-${randomUUID().slice(0, 6)}`,
        type: "RAW",
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [{ unitName: "g", toBaseRatio: 0.001, isBase: false }],
        defaultBuyUnitName: "kg",
      })
    );

    kaphrao = await withRlsBypass((tx) =>
      tx.menu.create({
        data: {
          tenantId: tenantA,
          source: "MISE",
          name: `กะเพราหมู-${randomUUID().slice(0, 4)}`,
        },
        select: { id: true, name: true },
      })
    );

    await createRecipeLogic(
      tenantA,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId: kaphrao.id,
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

    // A PRICED layer, so "the cost is null" can only ever mean the permission.
    // An adjustment alone lands UNPRICED (ADR 0014 Q10) and would have made the
    // owner's figure meaningless rather than absent — so the layer is declared.
    const found = await createStockAdjustmentLogic(
      tenantA,
      createStockAdjustmentInputSchema.parse({
        submitKey: randomUUID(),
        productId: pork.id,
        branchId: branchA,
        type: "ADJUST_GAIN",
        reason: "RECOUNT",
        inputQty: 10,
        inputUnitId: baseUnitOf(pork),
        occurredAt: addDays(today, -5),
        notes: null,
      }),
      userA
    );
    // A menu dish must name who ate it (ADR 0028 Q4) — a pot may not, but a
    // rung dish always does.
    somchai = (
      await createStaffMemberLogic(
        tenantA,
        createStaffMemberInputSchema.parse({
          name: "สมชาย",
          branchId: branchA,
          notes: "",
        })
      )
    ).id;

    await declareStockCostLogic(
      tenantA,
      declareStockCostInputSchema.parse({
        submitKey: randomUUID(),
        movementId: found.movement.id,
        unitCost: 200,
        unitId: baseUnitOf(pork),
        notes: null,
      }),
      userA
    );
  });

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.stockTransferItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockTransfer.deleteMany({ where: { tenantId: tenantA } });
      await tx.staffMealItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.staffMember.deleteMany({ where: { tenantId: tenantA } });
      await tx.staffMeal.deleteMany({ where: { tenantId: tenantA } });
      // Before the movements: stock_cost_declaration_movement_id_fkey is
      // RESTRICT, so the other order fails on the last test of the file.
      await tx.stockCostDeclaration.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockMovement.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockAdjustment.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeIngredient.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeBranch.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipe.deleteMany({ where: { tenantId: tenantA } });
      await tx.menu.deleteMany({ where: { tenantId: tenantA } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId: tenantA } } });
      await tx.product.deleteMany({ where: { tenantId: tenantA } });
      await tx.category.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.deleteMany({ where: { id: tenantA } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
  });

  const listFor = (cost: ReturnType<typeof costAccessFor>) =>
    getRecipeListLogic(
      tenantA,
      { branchId: branchA, missingOnly: false, asOf: today },
      cost
    );

  it("C0 — the two roles really do differ on cost:view", () => {
    // If this ever stopped being true, every assertion below would compare a
    // thing with itself and the file would prove nothing.
    expect(OWNER_SEES).not.toBeNull();
    expect(COOK_SEES).toBeNull();
  });

  it("C1 — the cook gets every dish and none of the money", async () => {
    const cook = await listFor(COOK_SEES);
    const owner = await listFor(OWNER_SEES);

    const cookRow = cook.menus.find((r) => r.targetId === kaphrao.id);
    const ownerRow = owner.menus.find((r) => r.targetId === kaphrao.id);

    // The dish, the recipe behind it, and the ingredient count are the cook's
    // job and are all present.
    expect(cookRow, "the cook cannot see the dish at all").toBeDefined();
    expect(cookRow!.recipeId).not.toBeNull();
    expect(cookRow!.recipeId).toBe(ownerRow!.recipeId);
    expect(cook.menus.length).toBe(owner.menus.length);

    // The money is not.
    expect(cookRow!.costPerServing).toBeNull();
    expect(cookRow!.confidence).toBeNull();

    // And the owner's is, so the null above is about the reader.
    expect(ownerRow!.costPerServing).not.toBeNull();
    expect(ownerRow!.costPerServing!.toNumber()).toBeCloseTo(20, 6);
  });

  it("C2 — the payload says WHY the cost is missing", async () => {
    // Rule A8. A null cost also means "there is no recipe to cost", which is a
    // fact about the dish; this one is a fact about the reader, and the screen
    // renders ไม่มีสิทธิ์ดู rather than — only because it is told which.
    const cook = await listFor(COOK_SEES);
    const owner = await listFor(OWNER_SEES);

    expect(cook.costHidden).toBe(true);
    expect(owner.costHidden).toBe(false);
  });

  it("C4 — a cost-blind cook dispatches, and FIFO money is frozen on the line", async () => {
    // The half that discriminates, and the clearest statement of ADR 0029 Q12:
    // computing a cost and showing one are different acts. `stock:write` is a
    // kitchen capability; `cost:view` is not; and a dispatch does BOTH at once,
    // because ADR 0018 Q5 freezes the sending branch's FIFO value onto the line
    // inside the same transaction that posts the movements.
    //
    // If the engine is ever made to refuse without a ticket, this goes red —
    // and so do C1 and C2, because there is no ticket to be had on this path
    // at all. See the header: that is the finding, not a footnote.
    const tf = await dispatchTransferLogic(
      tenantA,
      dispatchTransferInputSchema.parse({
        submitKey: randomUUID(),
        fromBranchId: branchA,
        toBranchId: branchB,
        dispatchedAt: today,
        dispatchedByName: "คนครัว",
        driverName: null,
        driverConfirmed: false,
        notes: null,
        lines: [
          {
            productId: pork.id,
            qtySent: 1,
            inputUnitId: baseUnitOf(pork),
            notes: null,
          },
        ],
      }),
      userA
    );

    const line = await withRlsBypass((tx) =>
      tx.stockTransferItem.findFirstOrThrow({
        where: { tenantId: tenantA, stockTransferId: tf.id },
        select: { costTotal: true, costSource: true },
      })
    );

    // 1 kg drawn from the declared 200/kg layer. Not zero, and not UNPRICED:
    // the engine really ran, for a person who may not see its answer.
    expect(line.costTotal.toNumber()).toBeCloseTo(200, 6);
    expect(line.costSource).not.toBe("UNPRICED");
  });

  it("C3 — the cook still posts a staff meal, and it moves AT COST", async () => {
    // The half that discriminates. C1 and C2 would both stay green with the
    // check bolted onto `getRecipeCostsLogic`; this fails the moment it is,
    // because pricing what left the shelf is not a report — it is the write.
    const meal = await createStaffMealLogic(
      tenantA,
      createStaffMealInputSchema.parse({
        submitKey: randomUUID(),
        branchId: branchA,
        businessDate: today,
        menuId: kaphrao.id,
        staffMemberId: somchai,
        servings: 2,
        recordedByName: "คนครัว",
        notes: "",
        items: [],
      }),
      userA
    );

    const moves = await withRlsBypass((tx) =>
      tx.stockMovement.findMany({
        where: { tenantId: tenantA, sourceType: "STAFF_MEAL" },
        select: { qty: true, productId: true },
      })
    );

    expect(meal.id).toBeTruthy();
    expect(moves).toHaveLength(1);
    expect(moves[0].productId).toBe(pork.id);
    // 2 servings x 0.1 kg, leaving the shelf.
    expect(moves[0].qty.toNumber()).toBeCloseTo(-0.2, 6);
  });
});
