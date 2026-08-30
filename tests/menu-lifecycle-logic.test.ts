// ============================================================
// Mise — a menu's lifecycle, the writes (Part 27 L3a, ADR 0027)
// ============================================================
// Two columns that sat in the schema since Part 19 — `is_active` with no
// reader, `deleted_at` with no writer — finally get one each.
//
//   K1  retiring changes a flag, clears the stub mark, and moves nothing else
//   K2  retiring carries the state asked for, so pressing twice is not a toggle
//   K3  a POS code refuses the delete outright, and names the code
//   K4  any sale refuses it — superseded rows included
//   K5  being an ingredient of a set refuses it (assertMenuNotUsedInRecipes's
//       first call site, six Parts after it was written)
//   K6  a live merge refuses it and says which side; a revoked one does not
//   K7  a confirmed POS spelling refuses it
//   K8  the hard blockers run BEFORE the recipe interruption, so nobody
//       acknowledges their way into a refusal they can never pass
//   K9  a menu carrying a recipe refuses once naming it, then deletes both
//   K10 restore brings back ONLY what died in the same act — a recipe deleted
//       deliberately earlier stays deleted
//   K11 the Lab's offer finds a deleted menu by exact name and says how much
//       comes back with it
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { withRlsBypass } from "@/lib/db-admin";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { recipeInputSchema } from "@/lib/validations/recipe";
import { createRecipeLogic, deleteRecipeLogic } from "@/server/recipe";
import { MenuUsedInRecipeError } from "@/server/recipe-guards";
import { MenuNotFoundError } from "@/server/menu";
import {
  deleteMenuInputSchema,
  restoreMenuInputSchema,
  setMenuActiveInputSchema,
} from "@/lib/validations/menu-lifecycle";
import {
  MenuHasAliasError,
  MenuHasPosCodeError,
  MenuHasSalesError,
  MenuInLiveMergeError,
  MenuNotDeletedError,
  MenuRecipeWillBeDeletedError,
  deleteMenuLogic,
  findDeletedMenuByNameLogic,
  restoreMenuLogic,
  setMenuActiveLogic,
} from "@/server/menu-lifecycle";
import { mergeMenusInputSchema, revokeMergeInputSchema } from "@/lib/validations/menu-merge";
import { mergeMenusLogic, revokeMergeLogic } from "@/server/menu-merge";

describe("menu lifecycle writes (ADR 0027 L3a)", () => {
  let tenantA: string;
  let userA: string;
  let branchA: string;
  let batchA: string;
  let posIntegrationA: string;
  let pork: ProductWithUnits;

  const today = computeBangkokToday();

  /** A menu Mise owns — the only kind that is ever deletable. */
  const makeMenu = (name: string): Promise<{ id: string; name: string }> =>
    withRlsBypass((tx) =>
      tx.menu.create({
        data: {
          tenantId: tenantA,
          source: "MISE",
          name: `${name}-${randomUUID().slice(0, 6)}`,
        },
        select: { id: true, name: true },
      })
    );

  /** A menu the POS reported, holding a code it can never give back. */
  const makePosMenu = (name: string): Promise<{ id: string; posMenuId: string }> =>
    withRlsBypass(async (tx) => {
      const code = randomUUID().slice(0, 8);
      const m = await tx.menu.create({
        data: {
          tenantId: tenantA,
          source: "POS",
          posIntegrationId: posIntegrationA,
          posMenuId: code,
          name: `${name}-${randomUUID().slice(0, 4)}`,
        },
        select: { id: true },
      });
      return { id: m.id, posMenuId: code };
    });

  const sell = (menuId: string, opts: { superseded?: boolean } = {}) =>
    withRlsBypass(async (tx) => {
      const day = await tx.salesDay.upsert({
        where: { branchId_businessDate: { branchId: branchA, businessDate: today } },
        create: {
          tenantId: tenantA,
          branchId: branchA,
          businessDate: today,
          currentBatchId: batchA,
        },
        update: {},
        select: { id: true },
      });
      return tx.salesLine.create({
        data: {
          tenantId: tenantA,
          branchId: branchA,
          businessDate: today,
          salesDayId: day.id,
          importBatchId: batchA,
          menuId,
          qty: 1,
          grossAmount: 100,
          discountAmount: 0,
          netAmount: 100,
          serviceChargeAmount: 0,
          vatAmount: 0,
          // The pair check: a superseded row that cannot say what corrected
          // it is an audit trail with the answer torn out (Part 19).
          ...(opts.superseded
            ? { supersededAt: new Date(), supersededByBatchId: batchA }
            : {}),
        },
        select: { id: true },
      });
    });

  const baseUnitOf = (p: ProductWithUnits) =>
    p.productUnits.find((u) => u.isBase)!.id;

  const makeRecipe = (over: Record<string, unknown>) =>
    createRecipeLogic(
      tenantA,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId: null,
        outputProductId: null,
        servings: 1,
        effectiveFrom: today,
        ingredients: [
          {
            productId: pork.id,
            componentMenuId: null,
            qty: 0.12,
            productUnitId: baseUnitOf(pork),
            sortOrder: 0,
            notes: null,
          },
        ],
        notes: null,
        ...over,
      }),
      userA
    );

  const del = (menuId: string, acknowledgeRecipe = false) =>
    deleteMenuLogic(
      tenantA,
      deleteMenuInputSchema.parse({ menuId, acknowledgeRecipe })
    );

  const menuRow = (id: string) =>
    withRlsBypass((tx) =>
      tx.menu.findUnique({
        where: { id },
        select: { isActive: true, isPosStub: true, deletedAt: true },
      })
    );

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Menu Lifecycle Tenant" } });
      tenantA = t.id;
      const u = await tx.user.create({
        data: {
          email: `lifecycle-${randomUUID()}@example.com`,
          name: "เจ้าของร้าน",
        },
      });
      userA = u.id;
      const b = await tx.branch.create({
        data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" },
        select: { id: true },
      });
      branchA = b.id;
      const integ = await tx.posIntegration.create({
        data: { tenantId: t.id, branchId: b.id, posType: "CUSTOM", name: "POS" },
        select: { id: true },
      });
      posIntegrationA = integ.id;
      const prof = await tx.salesImportProfile.create({
        data: {
          tenantId: t.id,
          posIntegrationId: integ.id,
          name: "รายวัน",
          fileKind: "DAILY_SUMMARY",
          dateFormat: "yyyy-MM-dd",
          columnMap: {},
          headerSignature: `x-${randomUUID().slice(0, 6)}`,
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
      batchA = batch.id;
    });

    pork = await createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `LIFE-pork-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
      })
    );
  }, 120_000);

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.menuMerge.deleteMany({ where: { tenantId: tenantA } });
      await tx.menuAlias.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeBranch.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeIngredient.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipe.updateMany({
        where: { tenantId: tenantA },
        data: { supersededAt: null, supersededById: null },
      });
      await tx.recipe.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesLine.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesDay.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportBatch.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportProfile.deleteMany({ where: { tenantId: tenantA } });
      await tx.menu.deleteMany({ where: { tenantId: tenantA } });
      await tx.posIntegration.deleteMany({ where: { tenantId: tenantA } });
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
    await prisma.$disconnect();
  }, 120_000);

  // ------------------------------------------------------------
  // เลิกขาย
  // ------------------------------------------------------------

  it("K1 retiring sets the flag, clears the stub mark, and deletes nothing", async () => {
    const { id } = await makePosMenu("K1 ข้าวผัด");
    await withRlsBypass((tx) =>
      tx.menu.update({ where: { id }, data: { isPosStub: true } })
    );

    await setMenuActiveLogic(
      tenantA,
      setMenuActiveInputSchema.parse({ menuId: id, isActive: false })
    );

    const row = await menuRow(id);
    expect(row?.isActive).toBe(false);
    // Pressing a lifecycle button IS looking at the dish, which is the whole
    // meaning of the stub mark — otherwise a retired stub queues for ever.
    expect(row?.isPosStub).toBe(false);
    // Retiring is available to a menu that can never be deleted. That is the
    // point of having two states rather than two grades of one.
    expect(row?.deletedAt).toBeNull();
  });

  it("K2 carries the state asked for, so pressing twice is not a toggle", async () => {
    const { id } = await makeMenu("K2 ต้มยำ");
    const off = setMenuActiveInputSchema.parse({ menuId: id, isActive: false });

    await setMenuActiveLogic(tenantA, off);
    await setMenuActiveLogic(tenantA, off);
    expect((await menuRow(id))?.isActive).toBe(false);

    await setMenuActiveLogic(
      tenantA,
      setMenuActiveInputSchema.parse({ menuId: id, isActive: true })
    );
    expect((await menuRow(id))?.isActive).toBe(true);
  });

  // ------------------------------------------------------------
  // The five hard blockers
  // ------------------------------------------------------------

  it("K3 a POS code refuses the delete outright and names the code", async () => {
    const { id, posMenuId } = await makePosMenu("K3 กะเพรา");

    const e = await del(id).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(MenuHasPosCodeError);
    expect((e as MenuHasPosCodeError).posMenuId).toBe(posMenuId);

    expect((await menuRow(id))?.deletedAt).toBeNull();
  });

  it("K4 any sale refuses it — a superseded row is still evidence", async () => {
    const live = await makeMenu("K4 ผัดไทย");
    await sell(live.id);
    await expect(del(live.id)).rejects.toBeInstanceOf(MenuHasSalesError);

    // A replaced day's rows are KEPT on purpose (ADR 0019 Q5). Evidence
    // pointing at a menu no screen will show is not evidence.
    const superseded = await makeMenu("K4 ผัดซีอิ๊ว");
    await sell(superseded.id, { superseded: true });
    await expect(del(superseded.id)).rejects.toBeInstanceOf(MenuHasSalesError);
  });

  it("K5 being an ingredient of a set refuses it", async () => {
    const component = await makeMenu("K5 สเต็ก");
    const set = await makeMenu("K5 เซ็ตสเต็ก");
    await makeRecipe({
      menuId: set.id,
      ingredients: [
        {
          productId: null,
          componentMenuId: component.id,
          qty: 1,
          productUnitId: null,
          sortOrder: 0,
          notes: null,
        },
      ],
    });

    const e = await del(component.id).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(MenuUsedInRecipeError);
    expect((e as MenuUsedInRecipeError).recipeNames.length).toBeGreaterThan(0);
  });

  it("K6 a live merge refuses it and says which side; a revoked one does not", async () => {
    const winner = await makeMenu("K6 ข้าวมันไก่");
    const loser = await makeMenu("K6 ข้าวมันไก่ต้ม");
    const row = await mergeMenusLogic(
      tenantA,
      mergeMenusInputSchema.parse({
        submitKey: randomUUID(),
        losingMenuId: loser.id,
        winningMenuId: winner.id,
        effectiveFrom: today,
      }),
      userA
    );

    const asLoser = await del(loser.id).catch((x: unknown) => x);
    expect(asLoser).toBeInstanceOf(MenuInLiveMergeError);
    expect((asLoser as MenuInLiveMergeError).side).toBe("loser");

    const asWinner = await del(winner.id).catch((x: unknown) => x);
    expect(asWinner).toBeInstanceOf(MenuInLiveMergeError);
    expect((asWinner as MenuInLiveMergeError).side).toBe("winner");

    // Revoking is the way past it — the row stays, but it no longer applies.
    await revokeMergeLogic(
      tenantA,
      revokeMergeInputSchema.parse({ submitKey: randomUUID(), mergeId: row.id }),
      userA
    );
    expect((await del(loser.id)).id).toBe(loser.id);
  });

  it("K7 a confirmed POS spelling refuses it", async () => {
    const menu = await makeMenu("K7 ส้มตำ");
    await withRlsBypass((tx) =>
      tx.menuAlias.create({
        data: {
          tenantId: tenantA,
          posIntegrationId: posIntegrationA,
          normalizedName: `somtam-${randomUUID().slice(0, 6)}`,
          rawName: "ส้ม ตำ",
          menuId: menu.id,
          confirmedBy: userA,
        },
      })
    );

    // ALIAS outranks NAME (menu.ts:196), so a dangling one would send real
    // money to a deleted row and beat a live menu of the same name.
    await expect(del(menu.id)).rejects.toBeInstanceOf(MenuHasAliasError);
  });

  // ------------------------------------------------------------
  // Order, and the one soft interruption
  // ------------------------------------------------------------

  it("K8 the hard blockers run before the recipe interruption", async () => {
    // This menu would trip BOTH: it has a recipe of its own AND a sale. If the
    // recipe interruption came first, somebody would confirm the loss of a
    // recipe and only then be told the menu was never deletable.
    const menu = await makeMenu("K8 แกงเขียวหวาน");
    await makeRecipe({ menuId: menu.id });
    await sell(menu.id);

    await expect(del(menu.id)).rejects.toBeInstanceOf(MenuHasSalesError);
    // And the acknowledgement buys nothing, because it was never the blocker.
    await expect(del(menu.id, true)).rejects.toBeInstanceOf(MenuHasSalesError);
  });

  it("K9 a menu carrying a recipe refuses once naming it, then deletes both", async () => {
    const menu = await makeMenu("K9 หมูกรอบ");
    const recipe = await makeRecipe({ menuId: menu.id });

    const e = await del(menu.id).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(MenuRecipeWillBeDeletedError);
    expect((e as MenuRecipeWillBeDeletedError).recipeIds).toContain(recipe.id);
    // Refusing must not have half-deleted anything.
    expect((await menuRow(menu.id))?.deletedAt).toBeNull();

    const done = await del(menu.id, true);
    expect(done.deletedRecipeIds).toContain(recipe.id);

    const after = await menuRow(menu.id);
    expect(after?.deletedAt).not.toBeNull();
    const recipeRow = await withRlsBypass((tx) =>
      tx.recipe.findUnique({ where: { id: recipe.id }, select: { deletedAt: true } })
    );
    // ONE value in both tables — the fact the restore reads.
    expect(recipeRow?.deletedAt?.getTime()).toBe(after?.deletedAt?.getTime());
  });

  // ------------------------------------------------------------
  // กู้คืน
  // ------------------------------------------------------------

  it("K10 restore brings back only what died in the same act", async () => {
    const menu = await makeMenu("K10 ยำแซลมอน");
    const abandoned = await makeRecipe({ menuId: menu.id });
    // Deleted deliberately, EARLIER, and on its own. Nobody asked for it back.
    await deleteRecipeLogic(tenantA, abandoned.id);

    const kept = await makeRecipe({ menuId: menu.id });
    await del(menu.id, true);

    const restored = await restoreMenuLogic(
      tenantA,
      restoreMenuInputSchema.parse({ menuId: menu.id })
    );

    expect(restored.restoredRecipeIds).toEqual([kept.id]);
    const rows = await withRlsBypass((tx) =>
      tx.recipe.findMany({
        where: { id: { in: [abandoned.id, kept.id] } },
        select: { id: true, deletedAt: true },
      })
    );
    const byId = new Map(rows.map((r) => [r.id, r.deletedAt]));
    expect(byId.get(kept.id)).toBeNull();
    expect(byId.get(abandoned.id)).not.toBeNull();

    // A restored menu comes back SELLING — it was deleted, not retired.
    const after = await menuRow(menu.id);
    expect(after?.deletedAt).toBeNull();
    expect(after?.isActive).toBe(true);

    await expect(
      restoreMenuLogic(tenantA, restoreMenuInputSchema.parse({ menuId: menu.id }))
    ).rejects.toBeInstanceOf(MenuNotDeletedError);
  });

  it("K11 the Lab's offer finds it by exact name and says what comes back", async () => {
    const menu = await makeMenu("K11 ลาบหมู");
    await makeRecipe({ menuId: menu.id });
    await del(menu.id, true);

    const found = await findDeletedMenuByNameLogic(tenantA, menu.name);
    expect(found?.id).toBe(menu.id);
    expect(found?.recipeCount).toBe(1);

    // Exact, never fuzzy: this result arms a button that brings a recipe back,
    // so it has to be the dish rather than something that scored well
    // (ADR 0019 Q7's rule, applied where it matters most).
    expect(await findDeletedMenuByNameLogic(tenantA, `${menu.name} พิเศษ`)).toBeNull();
    expect(await findDeletedMenuByNameLogic(tenantA, "   ")).toBeNull();

    // A LIVE menu is not an offer to restore anything.
    const live = await makeMenu("K11 ลาบไก่");
    expect(await findDeletedMenuByNameLogic(tenantA, live.name)).toBeNull();
  });

  it("K12 every write refuses a menu that is not this tenant's live menu", async () => {
    const gone = randomUUID();
    await expect(
      setMenuActiveLogic(
        tenantA,
        setMenuActiveInputSchema.parse({ menuId: gone, isActive: false })
      )
    ).rejects.toBeInstanceOf(MenuNotFoundError);
    await expect(del(gone)).rejects.toBeInstanceOf(MenuNotFoundError);
    await expect(
      restoreMenuLogic(tenantA, restoreMenuInputSchema.parse({ menuId: gone }))
    ).rejects.toBeInstanceOf(MenuNotDeletedError);
  });
});
