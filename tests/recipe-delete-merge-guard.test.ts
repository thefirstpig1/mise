// ============================================================
// Mise — deleting a recipe somebody else borrows (Part 25, ADR 0026 C3)
// ============================================================
// The one second-order effect of a merge that nothing on screen showed. A menu
// merged into this dish borrows its recipe when it has none of its own — the
// last loop of `resolveRecipeIds` — so deleting the winner's recipe stops the
// LOSER's stock deduction too. It goes on selling; its ingredients stop leaving
// the ledger; nothing says a word until a stock count comes up short.
//
// The interruption is not a block. "Stop costing this dish" is a legitimate
// thing to want, and forcing a revoke of the merge first would make somebody
// undo a TRUE statement to get at a false one. So: refuse once naming the
// menus, go through on the second call carrying the acknowledgement — the shape
// `acknowledge_backdate` / `acknowledge_posted` / `acknowledge_repost` already
// use everywhere else.
//
//   D1  the winner's last central recipe is refused, NAMES the loser, and the
//       acknowledged second call goes through
//   D2  a loser with its own central recipe borrows nothing and is not named
//   D3  a branch copy deleted while central survives does not interrupt
//   D4  a REVOKED merge is not a dependency
//   D5  a loser that only ever copied to one branch still borrows everywhere
//       else, so it is named
//   D6  deleting the LOSER's own recipe lends nothing to anyone — never refuses
//   D7  a production recipe has no menu and so can be nobody's spelling
//   D8  the refusal is about something real: after the acknowledged delete the
//       loser resolves to no recipe at all
//
// D2/D5 discriminate as a PAIR. A guard that named every loser would pass D5 by
// accident, and one that asked "has any line at all" would pass D2 and fail D5.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withAdminContext, withTenantContext } from "@/lib/db";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import {
  copyRecipeToBranchesInputSchema,
  recipeInputSchema,
} from "@/lib/validations/recipe";
import {
  copyRecipeToBranchesLogic,
  createRecipeLogic,
  deleteRecipeLogic,
} from "@/server/recipe";
import { MergedMenusDependOnRecipeError } from "@/server/recipe-guards";
import { mergeMenusInputSchema, revokeMergeInputSchema } from "@/lib/validations/menu-merge";
import { mergeMenusLogic, revokeMergeLogic } from "@/server/menu-merge";
import { resolveRecipeIds } from "@/server/recipe-resolve";

describe("deleting a recipe that a merged menu borrows (ADR 0026 C3)", () => {
  let tenantA: string;
  let userA: string;
  /** Never diverges — the branch that keeps following central. */
  let branchCentral: string;
  /** The branch that presses the copy button. */
  let branchAsoke: string;
  let pork: ProductWithUnits;

  const today = computeBangkokToday();

  const makeMenu = (name: string): Promise<{ id: string; name: string }> =>
    withAdminContext((tx) =>
      tx.menu.create({
        data: {
          tenantId: tenantA,
          source: "MISE",
          name: `${name}-${randomUUID().slice(0, 6)}`,
        },
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

  const makeRecipe = (over: Record<string, unknown>) =>
    createRecipeLogic(
      tenantA,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId: null,
        outputProductId: null,
        servings: 1,
        effectiveFrom: today,
        ingredients: [ing(pork, 0.12)],
        notes: null,
        ...over,
      }),
      userA
    );

  const copyToAsoke = (sourceRecipeId: string) =>
    copyRecipeToBranchesLogic(
      tenantA,
      copyRecipeToBranchesInputSchema.parse({
        submitKey: randomUUID(),
        sourceRecipeId,
        branchIds: [branchAsoke],
      }),
      userA
    );

  const merge = (losingMenuId: string, winningMenuId: string) =>
    mergeMenusLogic(
      tenantA,
      mergeMenusInputSchema.parse({
        submitKey: randomUUID(),
        losingMenuId,
        winningMenuId,
        effectiveFrom: today,
      }),
      userA
    );

  /** Which recipe applies to this menu, at this branch, today. */
  const resolveFor = (menuId: string, branchId: string) =>
    withTenantContext(tenantA, (tx) =>
      resolveRecipeIds(tx, tenantA, [{ kind: "menu", id: menuId }], branchId, today)
    ).then((m) => m.get(`menu:${menuId}`) ?? null);

  beforeAll(async () => {
    await withAdminContext(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Recipe Delete Guard Tenant" } });
      tenantA = t.id;
      const u = await tx.user.create({
        data: {
          email: `del-guard-${randomUUID()}@example.com`,
          name: "เจ้าของร้าน",
        },
      });
      userA = u.id;
      const [bc, ba] = await Promise.all([
        tx.branch.create({ data: { tenantId: t.id, name: "สาขากลาง", code: "CEN" } }),
        tx.branch.create({ data: { tenantId: t.id, name: "สาขาอโศก", code: "ASK" } }),
      ]);
      branchCentral = bc.id;
      branchAsoke = ba.id;
    });

    pork = await createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `DEL-pork-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
      })
    );
  }, 120_000);

  afterAll(async () => {
    await withAdminContext(async (tx) => {
      await tx.menuMerge.deleteMany({ where: { tenantId: tenantA } });
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
  }, 120_000);

  it("D1 refuses once, names the borrowing menu, and goes through when acknowledged", async () => {
    const winner = await makeMenu("D1 ข้าวผัดกุ้ง");
    const loser = await makeMenu("D1 ข้าวผัดกุ้ง(อโศก)");
    const recipe = await makeRecipe({ menuId: winner.id });
    await merge(loser.id, winner.id);

    // The borrow is real before the delete — otherwise this test would pass
    // against a guard that fires on nothing.
    expect((await resolveFor(loser.id, branchCentral))?.id).toBe(recipe.id);

    const refused = await deleteRecipeLogic(tenantA, recipe.id).catch(
      (e: unknown) => e
    );
    expect(refused).toBeInstanceOf(MergedMenusDependOnRecipeError);
    // The NAME, not the id: whoever has to act on this is looking at a screen.
    expect((refused as MergedMenusDependOnRecipeError).menuNames).toEqual([
      loser.name,
    ]);

    // Refusing must not have half-deleted anything.
    expect((await resolveFor(winner.id, branchCentral))?.id).toBe(recipe.id);

    expect(
      await deleteRecipeLogic(tenantA, recipe.id, {
        acknowledgeMergedMenus: true,
      })
    ).toBe(true);
  });

  it("D2 a loser with its own central recipe borrows nothing and is not named", async () => {
    const winner = await makeMenu("D2 ต้มยำกุ้ง");
    const loser = await makeMenu("D2 ต้มยำกุ้ง(ทองหล่อ)");
    const winnerRecipe = await makeRecipe({ menuId: winner.id });
    const loserRecipe = await makeRecipe({ menuId: loser.id });
    await merge(loser.id, winner.id);

    // Q2: a losing menu that HAS a recipe keeps using it. The borrow never fired.
    expect((await resolveFor(loser.id, branchCentral))?.id).toBe(loserRecipe.id);

    expect(await deleteRecipeLogic(tenantA, winnerRecipe.id)).toBe(true);
    expect((await resolveFor(loser.id, branchCentral))?.id).toBe(loserRecipe.id);
  });

  it("D3 deleting a branch copy while the central line survives does not interrupt", async () => {
    const winner = await makeMenu("D3 แกงเขียวหวาน");
    const loser = await makeMenu("D3 แกงเขียวหวาน(สาขา2)");
    const central = await makeRecipe({ menuId: winner.id });
    const branchCopy = await copyToAsoke(central.id);
    await merge(loser.id, winner.id);

    // Central is still there to be borrowed, so nothing stops — at worst a cost
    // changes at อโศก, which is what editing a recipe does anyway.
    expect(await deleteRecipeLogic(tenantA, branchCopy.id)).toBe(true);
    expect((await resolveFor(loser.id, branchAsoke))?.id).toBe(central.id);
  });

  it("D4 a revoked merge is not a dependency", async () => {
    const winner = await makeMenu("D4 ผัดไทย");
    const loser = await makeMenu("D4 ผัดไท");
    const recipe = await makeRecipe({ menuId: winner.id });
    const row = await merge(loser.id, winner.id);

    await revokeMergeLogic(
      tenantA,
      revokeMergeInputSchema.parse({ submitKey: randomUUID(), mergeId: row.id }),
      userA
    );

    expect(await deleteRecipeLogic(tenantA, recipe.id)).toBe(true);
  });

  it("D5 a loser that copied to one branch still borrows everywhere else", async () => {
    const winner = await makeMenu("D5 หมูกรอบ");
    const loser = await makeMenu("D5 หมูกรอบพิเศษ");

    // Give the loser a BRANCH-ONLY line: copy to อโศก, then drop its central.
    const loserCentral = await makeRecipe({ menuId: loser.id });
    const loserAtAsoke = await copyToAsoke(loserCentral.id);
    expect(await deleteRecipeLogic(tenantA, loserCentral.id)).toBe(true);

    const winnerRecipe = await makeRecipe({ menuId: winner.id });
    await merge(loser.id, winner.id);

    // อโศก has its own; สาขากลาง is borrowing the winner's right now.
    expect((await resolveFor(loser.id, branchAsoke))?.id).toBe(loserAtAsoke.id);
    expect((await resolveFor(loser.id, branchCentral))?.id).toBe(winnerRecipe.id);

    const refused = await deleteRecipeLogic(tenantA, winnerRecipe.id).catch(
      (e: unknown) => e
    );
    expect(refused).toBeInstanceOf(MergedMenusDependOnRecipeError);
    expect((refused as MergedMenusDependOnRecipeError).menuNames).toEqual([
      loser.name,
    ]);
  });

  it("D6 deleting the loser's own recipe lends nothing to anyone", async () => {
    const winner = await makeMenu("D6 ส้มตำ");
    const loser = await makeMenu("D6 ส้มตำไทย");
    await makeRecipe({ menuId: winner.id });
    const loserRecipe = await makeRecipe({ menuId: loser.id });
    await merge(loser.id, winner.id);

    expect(await deleteRecipeLogic(tenantA, loserRecipe.id)).toBe(true);
  });

  it("D7 a production recipe has no menu and so can be nobody's spelling", async () => {
    const jam = await createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `DEL-jam-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
        type: "PREPPED",
      })
    );
    const production = await makeRecipe({ outputProductId: jam.id });

    expect(await deleteRecipeLogic(tenantA, production.id)).toBe(true);
  });

  it("D8 the refusal is about something real — the acknowledged delete does stop the loser", async () => {
    const winner = await makeMenu("D8 ข้าวมันไก่");
    const loser = await makeMenu("D8 ข้าวมันไก่ต้ม");
    const recipe = await makeRecipe({ menuId: winner.id });
    await merge(loser.id, winner.id);

    expect((await resolveFor(loser.id, branchCentral))?.id).toBe(recipe.id);

    await deleteRecipeLogic(tenantA, recipe.id, {
      acknowledgeMergedMenus: true,
    });

    // This is the silent stop the guard exists to announce: the loser still
    // sells, and now nothing costs it or takes its ingredients out.
    expect(await resolveFor(loser.id, branchCentral)).toBeNull();
    expect(await resolveFor(winner.id, branchCentral)).toBeNull();
  });
});
