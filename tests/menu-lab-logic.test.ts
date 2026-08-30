// ============================================================
// Mise — Menu Lab writes (Part 24 L3a, ADR 0025)
// ============================================================
// L3b proved what a draft may NOT do. This is the other side: what the four
// writes actually do, and the four places they deliberately part company with
// Part 21's recipe CRUD.
//
//   D1  a draft for a dish that does not exist creates a MISE menu (Q3)
//   D2  a draft does not collide with the live recipe of the same dish
//   D3  saving twice with one submitKey writes one row (Part 13.5's pattern)
//   D4  editing a draft writes NO version — a draft covers no day
//   D5  publishing makes it resolvable, and only then
//   D6  publishing over a live recipe needs the acknowledgement, adopts the
//       line, and leaves yesterday costed by yesterday's recipe
//   D7  the lab's doors refuse a published recipe
//   D8  publishing re-checks the references the draft was saved with
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, withTenantContext} from "@/lib/db";
import { withRlsBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import {
  CrossTenantReferenceError,
  createProductLogic,
  type ProductWithUnits,
} from "@/server/product";
import { recipeInputSchema } from "@/lib/validations/recipe";
import { draftRecipeInputSchema } from "@/lib/validations/menu-lab";
import {
  RecipeNotFoundError,
  RecipeTargetImmutableError,
  createRecipeLogic,
} from "@/server/recipe";
import {
  DraftReplacesLiveRecipeError,
  NotADraftError,
  createDraftLogic,
  discardDraftLogic,
  publishDraftLogic,
  updateDraftLogic,
} from "@/server/menu-lab";
import { resolveRecipeIds } from "@/server/recipe-resolve";

describe("Menu Lab writes (ADR 0025)", () => {
  let tenantA: string;
  let branchA: string;
  let userA: string;
  let categoryA: string;
  let flour: ProductWithUnits;
  let sugar: ProductWithUnits;

  const today = computeBangkokToday();
  const LONG_AGO = addDays(today, -60);
  const YESTERDAY = addDays(today, -1);

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

  const draftInput = (over: Record<string, unknown> = {}) =>
    draftRecipeInputSchema.parse({
      submitKey: randomUUID(),
      menuId: null,
      newMenuName: null,
      menuCategoryId: null,
      servings: 1,
      plannedPrice: null,
      ingredients: [ing(flour, 5)],
      notes: null,
      ...over,
    });

  /** A published recipe, through Part 21's real write path. */
  const publishReal = (menuId: string, qty: number, effectiveFrom: Date) =>
    createRecipeLogic(
      tenantA,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId,
        outputProductId: null,
        servings: 1,
        effectiveFrom,
        ingredients: [ing(flour, qty)],
        notes: null,
      }),
      userA
    );

  const resolveOn = (menuId: string, asOf: Date) =>
    withTenantContext(tenantA, (tx) =>
      resolveRecipeIds(tx, tenantA, [{ kind: "menu", id: menuId }], branchA, asOf)
    );

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Menu Lab Tenant" } });
      tenantA = t.id;
      const b = await tx.branch.create({
        data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" },
      });
      branchA = b.id;
      const u = await tx.user.create({
        data: { email: `lab-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;
      const c = await tx.menuCategory.create({
        data: { tenantId: t.id, name: `ของหวาน-${randomUUID().slice(0, 4)}` },
        select: { id: true },
      });
      categoryA = c.id;
    });

    flour = await createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `LAB-flour-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
      })
    );
    sugar = await createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `LAB-sugar-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
      })
    );
  }, 120_000);

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.recipeIngredient.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeBranch.deleteMany({ where: { tenantId: tenantA } });
      // BOTH halves, or `recipe_superseded_pair_check` refuses the row: the pair
      // is all-or-nothing, and D6c leaves a real supersede behind.
      await tx.recipe.updateMany({
        where: { tenantId: tenantA },
        data: { supersededById: null, supersededAt: null },
      });
      await tx.recipe.deleteMany({ where: { tenantId: tenantA } });
      await tx.menu.deleteMany({ where: { tenantId: tenantA } });
      await tx.menuCategory.deleteMany({ where: { tenantId: tenantA } });
      await tx.productUnit.deleteMany({
        where: { product: { tenantId: tenantA } },
      });
      await tx.product.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.deleteMany({ where: { id: tenantA } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
    await prisma.$disconnect();
  }, 120_000);

  // ----------------------------------------------------------
  // Saving
  // ----------------------------------------------------------

  it("D1: a draft for a dish that does not exist creates a MISE menu for it", async () => {
    const name = `ข้าวผัดปูใหม่-${randomUUID().slice(0, 4)}`;
    const draft = await createDraftLogic(
      tenantA,
      draftInput({
        newMenuName: name,
        menuCategoryId: categoryA,
        plannedPrice: 89,
      }),
      userA
    );

    expect(draft.isDraft).toBe(true);
    expect(draft.menuId).not.toBeNull();
    expect(draft.plannedPrice?.toString()).toBe("89");

    const menu = await withRlsBypass((tx) =>
      tx.menu.findUniqueOrThrow({ where: { id: draft.menuId! } })
    );
    // A menu Mise owns, with no POS identity to collide on.
    expect(menu.source).toBe("MISE");
    expect(menu.posIntegrationId).toBeNull();
    expect(menu.posMenuId).toBeNull();
    expect(menu.name).toBe(name);
    expect(menu.menuCategoryId).toBe(categoryA);

    // And it is invisible to the ledger's route in, exactly as L3b requires.
    expect((await resolveOn(menu.id, today)).has(`menu:${menu.id}`)).toBe(false);
  });

  it("D2: a draft may be written for a dish that already has a live recipe", async () => {
    const menu = await makeMenu("D2");
    const live = await publishReal(menu.id, 2, LONG_AGO);

    // Part 21 refuses a second central line for the same dish. A draft is not a
    // line — and drafting a change to a dish that sells is half of what the lab
    // is for, so this must not throw.
    const draft = await createDraftLogic(
      tenantA,
      draftInput({ menuId: menu.id, ingredients: [ing(flour, 9)] }),
      userA
    );
    expect(draft.isDraft).toBe(true);
    expect(draft.lineId).not.toBe(live.lineId);

    // The live recipe is still the one that resolves.
    expect((await resolveOn(menu.id, today)).get(`menu:${menu.id}`)?.id).toBe(
      live.id
    );
  });

  it("D3: saving twice with one submitKey writes one row", async () => {
    const menu = await makeMenu("D3");
    const input = draftInput({ menuId: menu.id });

    const first = await createDraftLogic(tenantA, input, userA);
    const second = await createDraftLogic(tenantA, input, userA);

    expect(second.id).toBe(first.id);
    const rows = await withRlsBypass((tx) =>
      tx.recipe.count({ where: { tenantId: tenantA, menuId: menu.id } })
    );
    expect(rows).toBe(1);
  });

  it("D4: editing a draft rewrites it in place — no version, no history", async () => {
    const menu = await makeMenu("D4");
    const draft = await createDraftLogic(
      tenantA,
      draftInput({ menuId: menu.id, plannedPrice: 89 }),
      userA
    );

    const edited = await updateDraftLogic(
      tenantA,
      draft.id,
      draftInput({
        menuId: menu.id,
        plannedPrice: 99,
        servings: 4,
        ingredients: [ing(flour, 12), ing(sugar, 3)],
      }),
      userA
    );

    expect(edited.id).toBe(draft.id);
    expect(edited.plannedPrice?.toString()).toBe("99");
    expect(edited.servings.toString()).toBe("4");
    expect(edited.ingredients).toHaveLength(2);
    expect(edited.supersededAt).toBeNull();

    // A draft is true on no day, so there is no past to preserve: one row, not
    // a stack of versions of what somebody typed while thinking.
    const rows = await withRlsBypass((tx) =>
      tx.recipe.count({ where: { tenantId: tenantA, menuId: menu.id } })
    );
    expect(rows).toBe(1);

    const lines = await withRlsBypass((tx) =>
      tx.recipeIngredient.count({ where: { recipeId: draft.id } })
    );
    expect(lines).toBe(2);
  });

  it("D4b: an edit cannot re-point the draft at another dish", async () => {
    const menu = await makeMenu("D4b");
    const other = await makeMenu("D4b-other");
    const draft = await createDraftLogic(
      tenantA,
      draftInput({ menuId: menu.id }),
      userA
    );

    await expect(
      updateDraftLogic(
        tenantA,
        draft.id,
        draftInput({ menuId: other.id }),
        userA
      )
    ).rejects.toBeInstanceOf(RecipeTargetImmutableError);
  });

  // ----------------------------------------------------------
  // Publishing
  // ----------------------------------------------------------

  it("D5: publishing is what makes a draft resolvable", async () => {
    const menu = await makeMenu("D5");
    const draft = await createDraftLogic(
      tenantA,
      draftInput({ menuId: menu.id, plannedPrice: 120 }),
      userA
    );

    expect((await resolveOn(menu.id, today)).has(`menu:${menu.id}`)).toBe(false);

    const published = await publishDraftLogic(tenantA, {
      recipeId: draft.id,
      acknowledgeReplace: false,
    });

    expect(published.isDraft).toBe(false);
    expect(published.effectiveFrom.getTime()).toBe(today.getTime());
    // The planned price survives publication: "planned ฿120, selling at ฿115"
    // is worth knowing (Q2).
    expect(published.plannedPrice?.toString()).toBe("120");

    expect((await resolveOn(menu.id, today)).get(`menu:${menu.id}`)?.id).toBe(
      draft.id
    );

    // Idempotent: the same button cannot acquire a second, quieter meaning.
    const again = await publishDraftLogic(tenantA, {
      recipeId: draft.id,
      acknowledgeReplace: false,
    });
    expect(again.id).toBe(draft.id);
  });

  it("D6: publishing over a live recipe needs the acknowledgement", async () => {
    const menu = await makeMenu("D6");
    const live = await publishReal(menu.id, 2, LONG_AGO);
    const draft = await createDraftLogic(
      tenantA,
      draftInput({ menuId: menu.id, ingredients: [ing(flour, 9)] }),
      userA
    );

    await expect(
      publishDraftLogic(tenantA, {
        recipeId: draft.id,
        acknowledgeReplace: false,
      })
    ).rejects.toBeInstanceOf(DraftReplacesLiveRecipeError);

    // Nothing moved: the refusal is a refusal, not a half-write.
    const untouched = await withRlsBypass((tx) =>
      tx.recipe.findUniqueOrThrow({ where: { id: draft.id } })
    );
    expect(untouched.isDraft).toBe(true);
    expect((await resolveOn(menu.id, today)).get(`menu:${menu.id}`)?.id).toBe(
      live.id
    );
  });

  it("D6b: acknowledged, it adopts the line and leaves yesterday alone", async () => {
    const menu = await makeMenu("D6b");
    const live = await publishReal(menu.id, 2, LONG_AGO);
    const draft = await createDraftLogic(
      tenantA,
      draftInput({ menuId: menu.id, ingredients: [ing(flour, 9)] }),
      userA
    );

    const published = await publishDraftLogic(tenantA, {
      recipeId: draft.id,
      acknowledgeReplace: true,
    });

    // One line, two versions — so `recipe_branch` links (if any) keep pointing
    // at the same thing, which is why the line is adopted rather than replaced.
    expect(published.lineId).toBe(live.lineId);
    expect(published.effectiveFrom.getTime()).toBe(today.getTime());

    // Today is the new recipe...
    expect((await resolveOn(menu.id, today)).get(`menu:${menu.id}`)?.id).toBe(
      draft.id
    );
    // ...and yesterday is still yesterday's, which is the whole reason a
    // published recipe is never edited in place.
    expect((await resolveOn(menu.id, YESTERDAY)).get(`menu:${menu.id}`)?.id).toBe(
      live.id
    );

    const old = await withRlsBypass((tx) =>
      tx.recipe.findUniqueOrThrow({ where: { id: live.id } })
    );
    expect(old.supersededAt).toBeNull();
  });

  it("D6c: replacing a version that itself starts today is a correction", async () => {
    const menu = await makeMenu("D6c");
    const live = await publishReal(menu.id, 2, today);
    const draft = await createDraftLogic(
      tenantA,
      draftInput({ menuId: menu.id, ingredients: [ing(flour, 9)] }),
      userA
    );

    const published = await publishDraftLogic(tenantA, {
      recipeId: draft.id,
      acknowledgeReplace: true,
    });

    // Both would apply on the same day, so the older one is marked WRONG rather
    // than left to be resolved by a tiebreak nobody chose.
    const old = await withRlsBypass((tx) =>
      tx.recipe.findUniqueOrThrow({ where: { id: live.id } })
    );
    expect(old.supersededAt).not.toBeNull();
    expect(old.supersededById).toBe(published.id);

    expect((await resolveOn(menu.id, today)).get(`menu:${menu.id}`)?.id).toBe(
      published.id
    );
  });

  it("D8: publishing re-checks the references the draft was saved with", async () => {
    const menu = await makeMenu("D8");
    const gone = await createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `LAB-gone-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
      })
    );
    const draft = await createDraftLogic(
      tenantA,
      draftInput({ menuId: menu.id, ingredients: [ing(gone, 4)] }),
      userA
    );

    // The draft was valid when it was saved; the ingredient stopped existing
    // afterwards, which is the whole reason publish checks again.
    await withRlsBypass((tx) =>
      tx.product.update({
        where: { id: gone.id },
        data: { deletedAt: new Date() },
      })
    );

    await expect(
      publishDraftLogic(tenantA, {
        recipeId: draft.id,
        acknowledgeReplace: true,
      })
    ).rejects.toBeInstanceOf(CrossTenantReferenceError);

    const still = await withRlsBypass((tx) =>
      tx.recipe.findUniqueOrThrow({ where: { id: draft.id } })
    );
    expect(still.isDraft).toBe(true);
  });

  // ----------------------------------------------------------
  // Discarding, and the doors
  // ----------------------------------------------------------

  it("D7: the lab's doors refuse a published recipe", async () => {
    const menu = await makeMenu("D7");
    const live = await publishReal(menu.id, 2, LONG_AGO);

    await expect(
      updateDraftLogic(tenantA, live.id, draftInput({ menuId: menu.id }), userA)
    ).rejects.toBeInstanceOf(NotADraftError);

    await expect(
      discardDraftLogic(tenantA, { recipeId: live.id })
    ).rejects.toBeInstanceOf(NotADraftError);

    await expect(
      discardDraftLogic(tenantA, { recipeId: randomUUID() })
    ).rejects.toBeInstanceOf(RecipeNotFoundError);
  });

  it("D7b: discarding leaves the menu it created behind", async () => {
    const draft = await createDraftLogic(
      tenantA,
      draftInput({ newMenuName: `ทดลอง-${randomUUID().slice(0, 4)}` }),
      userA
    );
    const menuId = draft.menuId!;

    await discardDraftLogic(tenantA, { recipeId: draft.id });

    const row = await withRlsBypass((tx) =>
      tx.recipe.findUniqueOrThrow({ where: { id: draft.id } })
    );
    expect(row.deletedAt).not.toBeNull();

    // Kept on purpose: a MISE menu carries no sales, so it moves no revenue and
    // no consumption, and Part 25 is where it gets reconciled with the POS.
    const menu = await withRlsBypass((tx) =>
      tx.menu.findUnique({ where: { id: menuId } })
    );
    expect(menu).not.toBeNull();
  });
});
