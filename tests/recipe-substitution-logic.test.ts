// ============================================================
// Mise — substitution + reverse-lookup *Logic tests (Part 21 L3c)
// ============================================================
// Q14 is one screen with checkboxes: replacing an ingredient everywhere is every
// box ticked, replacing it in three dishes while the signature one keeps the old
// is three boxes. What is proved here is that both come out of the same call,
// that each target gets a REAL VERSION rather than an overwrite, and that Q15's
// refusal to invent a quantity holds exactly where it should.
//
// No money is involved, so no receipts: the substitution is a write about what a
// dish is made of, not about what it cost.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withAdminContext } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import {
  copyRecipeToBranchesInputSchema,
  recipeInputSchema,
  substituteIngredientInputSchema,
} from "@/lib/validations/recipe";
import {
  RecipeUnitMismatchError,
  SubstitutionDuplicateError,
  SubstitutionTargetStaleError,
  SubstitutionTouchesBranchRecipesError,
  copyRecipeToBranchesLogic,
  createRecipeLogic,
  substituteIngredientLogic,
  updateRecipeLogic,
} from "@/server/recipe";
import { RecipeCycleError } from "@/server/recipe-guards";
import {
  getRecipeUsageLogic,
  getRecipesUsingUnitLogic,
  getSubstitutionPlanLogic,
} from "@/server/recipe-read";

describe("substitution + reverse lookup *Logic (ADR 0021 Q14/Q15/Q17)", () => {
  let tenantA: string;
  let userA: string;
  let branchAsoke: string;

  /** พริกกะเหรี่ยง — the ingredient the shop stops buying. */
  let birdChilli: ProductWithUnits;
  /** พริกชี้ฟ้า — same kind of thing, same unit. The quantity carries. */
  let longChilli: ProductWithUnits;
  /** พริกผัดน้ำมัน — PREPPED. The quantity must NOT carry (Q15). */
  let friedChilli: ProductWithUnits;
  /** Same type, but sold by the gram: no `kg` unit to carry into. */
  let gramChilli: ProductWithUnits;
  let pork: ProductWithUnits;

  const today = computeBangkokToday();

  const makeProduct = (
    tag: string,
    over: Record<string, unknown> = {}
  ): Promise<ProductWithUnits> =>
    createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `SUB-${tag}-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
        ...over,
      })
    );

  const makeMenu = (name: string): Promise<{ id: string }> =>
    withAdminContext((tx) =>
      tx.menu.create({
        data: {
          tenantId: tenantA,
          source: "MISE",
          name: `${name}-${randomUUID().slice(0, 6)}`,
        },
        select: { id: true },
      })
    );

  const unitOf = (p: ProductWithUnits, name = "kg") =>
    p.productUnits.find((u) => u.unitName === name)!.id;

  const ing = (p: ProductWithUnits, qty: number, notes: string | null = null) => ({
    productId: p.id,
    componentMenuId: null,
    qty,
    productUnitId: unitOf(p),
    sortOrder: 0,
    notes,
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

  /** A recipe for a fresh menu, with the given ingredients. */
  const makeRecipe = async (
    name: string,
    ingredients: ReturnType<typeof ing>[],
    effectiveFrom: Date = today
  ) => {
    const menu = await makeMenu(name);
    const recipe = await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: menu.id, effectiveFrom, ingredients }),
      userA
    );
    return { menu, recipe };
  };

  const substitution = (over: Record<string, unknown>) =>
    substituteIngredientInputSchema.parse({
      submitKey: randomUUID(),
      fromProductId: birdChilli.id,
      toProductId: null,
      toComponentMenuId: null,
      targets: [],
      effectiveFrom: today,
      acknowledgeBranchRecipes: false,
      ...over,
    });

  beforeAll(async () => {
    await withAdminContext(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Substitution Tenant" } });
      tenantA = t.id;
      const b = await tx.branch.create({
        data: { tenantId: t.id, name: "สาขาอโศก", code: "ASK" },
      });
      branchAsoke = b.id;
      const u = await tx.user.create({
        data: { email: `sub-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;
    });

    birdChilli = await makeProduct("bird");
    longChilli = await makeProduct("long");
    pork = await makeProduct("pork");
    gramChilli = await makeProduct("gram", {
      baseUnitName: "g",
      defaultBuyUnitName: "g",
    });
    const rawParent = await makeProduct("chilli-raw");
    friedChilli = await makeProduct("fried", {
      type: "PREPPED",
      parentProductId: rawParent.id,
      yieldPercent: 70,
    });
  }, 120_000);

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
  // The write (Q14)
  // ------------------------------------------------------------

  it("S-01 changes the ticked recipes and leaves the unticked one alone", async () => {
    const a = await makeRecipe("ผัดเผ็ดหมู", [ing(birdChilli, 0.02), ing(pork, 0.1)]);
    const b = await makeRecipe("แกงป่า", [ing(birdChilli, 0.03)]);
    const signature = await makeRecipe("จานซิกเนเจอร์", [ing(birdChilli, 0.05)]);

    const written = await substituteIngredientLogic(
      tenantA,
      substitution({
        toProductId: longChilli.id,
        targets: [
          { recipeId: a.recipe.id, qty: 0.02, productUnitId: unitOf(longChilli) },
          { recipeId: b.recipe.id, qty: 0.03, productUnitId: unitOf(longChilli) },
        ],
      }),
      userA
    );

    expect(written).toHaveLength(2);
    for (const v of written) {
      expect(v.ingredients.some((i) => i.productId === longChilli.id)).toBe(true);
      expect(v.ingredients.some((i) => i.productId === birdChilli.id)).toBe(false);
    }
    // The other ingredients of a recipe are untouched by the swap.
    const swappedA = written.find((v) => v.lineId === a.recipe.lineId);
    expect(swappedA?.ingredients.some((i) => i.productId === pork.id)).toBe(true);

    // The signature dish keeps the old chilli — that is the whole point of Q14
    // being a list of checkboxes rather than a switch.
    const usage = await getRecipeUsageLogic(tenantA, { productId: birdChilli.id });
    expect(usage.map((u) => u.recipeId)).toContain(signature.recipe.id);
    expect(usage.map((u) => u.recipeId)).not.toContain(a.recipe.id);
  });

  it("S-02 appends a real VERSION, so the old one still governs its own days", async () => {
    const tenDaysAgo = addDays(today, -10);
    const { recipe } = await makeRecipe(
      "เวอร์ชันใหม่",
      [ing(birdChilli, 0.02)],
      tenDaysAgo
    );

    const [swapped] = await substituteIngredientLogic(
      tenantA,
      substitution({
        toProductId: longChilli.id,
        effectiveFrom: today,
        targets: [
          { recipeId: recipe.id, qty: 0.02, productUnitId: unitOf(longChilli) },
        ],
      }),
      userA
    );

    expect(swapped.id).not.toBe(recipe.id);
    expect(swapped.lineId).toBe(recipe.lineId);
    // A bulk swap leaves the same kind of history as a hand edit — both go
    // through `appendVersion`.
    const old = await withAdminContext((tx) =>
      tx.recipe.findUniqueOrThrow({ where: { id: recipe.id } })
    );
    expect(old.deletedAt).toBeNull();
    expect(old.supersededAt).toBeNull();
  });

  it("S-03 a swap dated to the version's own date is a CORRECTION and supersedes it", async () => {
    const { recipe } = await makeRecipe("แก้ที่พิมพ์ผิด", [ing(birdChilli, 0.02)]);

    const [swapped] = await substituteIngredientLogic(
      tenantA,
      substitution({
        toProductId: longChilli.id,
        effectiveFrom: today,
        targets: [
          { recipeId: recipe.id, qty: 0.02, productUnitId: unitOf(longChilli) },
        ],
      }),
      userA
    );

    const old = await withAdminContext((tx) =>
      tx.recipe.findUniqueOrThrow({ where: { id: recipe.id } })
    );
    expect(old.supersededById).toBe(swapped.id);
  });

  it("S-04 will not quietly include a branch's own recipe (Q8 vs Q14)", async () => {
    const { menu, recipe } = await makeRecipe("สูตรที่สาขาแยกไป", [
      ing(birdChilli, 0.02),
    ]);
    const atBranch = await copyRecipeToBranchesLogic(
      tenantA,
      copyRecipeToBranchesInputSchema.parse({
        submitKey: randomUUID(),
        sourceRecipeId: recipe.id,
        branchIds: [branchAsoke],
      }),
      userA
    );

    const targets = [
      { recipeId: atBranch.id, qty: 0.02, productUnitId: unitOf(longChilli) },
    ];

    await expect(
      substituteIngredientLogic(
        tenantA,
        substitution({ toProductId: longChilli.id, targets }),
        userA
      )
    ).rejects.toBeInstanceOf(SubstitutionTouchesBranchRecipesError);

    // A shop that has genuinely stopped buying an ingredient DOES need every
    // branch to change — the system presents that and does not decide it.
    const written = await substituteIngredientLogic(
      tenantA,
      substitution({
        toProductId: longChilli.id,
        targets,
        acknowledgeBranchRecipes: true,
      }),
      userA
    );
    expect(written).toHaveLength(1);
    expect(written[0].menuId).toBe(menu.id);
  });

  it("S-05 refuses a target that no longer contains the ingredient", async () => {
    const { recipe } = await makeRecipe("ไม่มีพริกแล้ว", [ing(pork, 0.1)]);

    // Skipping it instead would report "1 recipe changed" while changing none.
    await expect(
      substituteIngredientLogic(
        tenantA,
        substitution({
          toProductId: longChilli.id,
          targets: [
            { recipeId: recipe.id, qty: 0.02, productUnitId: unitOf(longChilli) },
          ],
        }),
        userA
      )
    ).rejects.toBeInstanceOf(SubstitutionTargetStaleError);
  });

  it("S-06 refuses to put the replacement in twice", async () => {
    const { recipe } = await makeRecipe("มีพริกสองอย่างอยู่แล้ว", [
      ing(birdChilli, 0.02),
      ing(longChilli, 0.01),
    ]);

    // Merging the two would make the cost right while the recipe on screen reads
    // wrong, and nobody asked for a merge.
    await expect(
      substituteIngredientLogic(
        tenantA,
        substitution({
          toProductId: longChilli.id,
          targets: [
            { recipeId: recipe.id, qty: 0.02, productUnitId: unitOf(longChilli) },
          ],
        }),
        userA
      )
    ).rejects.toBeInstanceOf(SubstitutionDuplicateError);
  });

  it("S-07 refuses a unit that belongs to some other product", async () => {
    const { recipe } = await makeRecipe("หน่วยผิด", [ing(birdChilli, 0.02)]);

    await expect(
      substituteIngredientLogic(
        tenantA,
        substitution({
          toProductId: longChilli.id,
          targets: [
            { recipeId: recipe.id, qty: 0.02, productUnitId: unitOf(pork) },
          ],
        }),
        userA
      )
    ).rejects.toBeInstanceOf(RecipeUnitMismatchError);
  });

  it("S-08 a swap that closes a loop is refused, and nothing is written", async () => {
    const dish = await makeRecipe("จานที่จะวน", [ing(birdChilli, 0.02)]);
    const set = await makeMenu("เซ็ทที่มีจานนั้น");
    await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: set.id, ingredients: [ingMenu(dish.menu.id, 1)] }),
      userA
    );

    // Replacing the dish's chilli with the SET that contains it closes the loop.
    await expect(
      substituteIngredientLogic(
        tenantA,
        substitution({
          toComponentMenuId: set.id,
          targets: [{ recipeId: dish.recipe.id, qty: 1, productUnitId: null }],
        }),
        userA
      )
    ).rejects.toBeInstanceOf(RecipeCycleError);

    const versions = await withAdminContext((tx) =>
      tx.recipe.count({ where: { tenantId: tenantA, lineId: dish.recipe.lineId } })
    );
    expect(versions).toBe(1);
  });

  it("S-09 is idempotent by submitKey", async () => {
    const a = await makeRecipe("ซ้ำ-ก", [ing(birdChilli, 0.02)]);
    const b = await makeRecipe("ซ้ำ-ข", [ing(birdChilli, 0.03)]);
    const input = substitution({
      toProductId: longChilli.id,
      targets: [
        { recipeId: a.recipe.id, qty: 0.02, productUnitId: unitOf(longChilli) },
        { recipeId: b.recipe.id, qty: 0.03, productUnitId: unitOf(longChilli) },
      ],
    });

    const first = await substituteIngredientLogic(tenantA, input, userA);
    const second = await substituteIngredientLogic(tenantA, input, userA);

    expect(first).toHaveLength(2);
    expect(second.map((r) => r.id).sort()).toEqual(first.map((r) => r.id).sort());
    const total = await withAdminContext((tx) =>
      tx.recipe.count({
        where: { tenantId: tenantA, lineId: { in: [a.recipe.lineId, b.recipe.lineId] } },
      })
    );
    expect(total).toBe(4); // two originals, two new versions — not six
  });

  it("S-10 drops the replaced line's note, which described the OLD ingredient", async () => {
    const { recipe } = await makeRecipe("มีหมายเหตุ", [
      ing(birdChilli, 0.02, "ซอยละเอียด"),
      ing(pork, 0.1, "หมูสับ"),
    ]);

    const [swapped] = await substituteIngredientLogic(
      tenantA,
      substitution({
        toProductId: longChilli.id,
        targets: [
          { recipeId: recipe.id, qty: 0.02, productUnitId: unitOf(longChilli) },
        ],
      }),
      userA
    );

    const replaced = swapped.ingredients.find((i) => i.productId === longChilli.id);
    expect(replaced?.notes).toBeNull();
    // Every other line keeps its own note.
    const kept = swapped.ingredients.find((i) => i.productId === pork.id);
    expect(kept?.notes).toBe("หมูสับ");
  });

  // ------------------------------------------------------------
  // The plan (Q15)
  // ------------------------------------------------------------

  it("S-11 carries the quantity when the replacement is the same kind in the same unit", async () => {
    const { recipe } = await makeRecipe("พริกต่อพริก", [ing(birdChilli, 0.02)]);

    const plan = await getSubstitutionPlanLogic(tenantA, {
      fromProductId: birdChilli.id,
      toProductId: longChilli.id,
    });
    const row = plan.central.find((r) => r.recipeId === recipe.id);
    expect(row?.carryQty?.toNumber()).toBe(0.02);
    expect(row?.carryUnitId).toBe(unitOf(longChilli));
  });

  it("S-12 refuses to carry it across product TYPE — 20 g of fried chilli is not 20 g of chilli", async () => {
    const { recipe } = await makeRecipe("พริกต่อพริกผัด", [ing(birdChilli, 0.02)]);

    const plan = await getSubstitutionPlanLogic(tenantA, {
      fromProductId: birdChilli.id,
      toProductId: friedChilli.id,
    });
    const row = plan.central.find((r) => r.recipeId === recipe.id);
    // A wrong default is a value somebody clicks past, and every plate is wrong
    // from that day with nothing on screen looking wrong.
    expect(row?.carryQty).toBeNull();
    expect(row?.carryUnitId).toBeNull();
  });

  it("S-13 refuses to carry it when the replacement has no such unit", async () => {
    const { recipe } = await makeRecipe("กิโลกับกรัม", [ing(birdChilli, 0.02)]);

    const plan = await getSubstitutionPlanLogic(tenantA, {
      fromProductId: birdChilli.id,
      toProductId: gramChilli.id,
    });
    const row = plan.central.find((r) => r.recipeId === recipe.id);
    // Same kind of thing, but "0.02" in kg is not "0.02" in g.
    expect(row?.carryQty).toBeNull();
  });

  it("S-14 never carries a quantity into a MENU replacement", async () => {
    const { recipe } = await makeRecipe("พริกเป็นเมนู", [ing(birdChilli, 0.02)]);
    const side = await makeMenu("เครื่องเคียง");

    const plan = await getSubstitutionPlanLogic(tenantA, {
      fromProductId: birdChilli.id,
      toComponentMenuId: side.id,
    });
    const row = plan.central.find((r) => r.recipeId === recipe.id);
    // A set-menu line counts dishes; the line it replaces counts a weight.
    expect(row?.carryQty).toBeNull();
  });

  it("S-15 groups central recipes separately from branch ones (Q8/Q14)", async () => {
    const { recipe } = await makeRecipe("แยกกลุ่ม", [ing(birdChilli, 0.04)]);
    const atBranch = await copyRecipeToBranchesLogic(
      tenantA,
      copyRecipeToBranchesInputSchema.parse({
        submitKey: randomUUID(),
        sourceRecipeId: recipe.id,
        branchIds: [branchAsoke],
      }),
      userA
    );

    const plan = await getSubstitutionPlanLogic(tenantA, {
      fromProductId: birdChilli.id,
      toProductId: longChilli.id,
    });
    expect(plan.central.map((r) => r.recipeId)).toContain(recipe.id);
    expect(plan.branch.map((r) => r.recipeId)).toContain(atBranch.id);
    const branchRow = plan.branch.find((r) => r.recipeId === atBranch.id);
    expect(branchRow?.branchNames).toEqual(["สาขาอโศก"]);
  });

  // ------------------------------------------------------------
  // The reverse lookup, and Q17
  // ------------------------------------------------------------

  it("S-16 excludes SUPERSEDED versions and keeps merely-past ones", async () => {
    const past = addDays(today, -8);
    const { menu, recipe } = await makeRecipe("อดีตกับที่ผิด", [ing(pork, 0.1)], past);

    // A later version: the old one is still correct for the days it covered.
    const v2 = await updateRecipeLogic(
      tenantA,
      recipe.id,
      recipeInput({
        menuId: menu.id,
        effectiveFrom: today,
        ingredients: [ing(pork, 0.2)],
      }),
      userA
    );
    // …and a correction on top of it, which marks v2 as having been WRONG.
    const v3 = await updateRecipeLogic(
      tenantA,
      v2.id,
      recipeInput({
        menuId: menu.id,
        effectiveFrom: today,
        ingredients: [ing(pork, 0.15)],
      }),
      userA
    );

    const usage = await getRecipeUsageLogic(tenantA, { productId: pork.id });
    const ids = usage.map((u) => u.recipeId);
    expect(ids).toContain(recipe.id); // past, but never wrong
    expect(ids).toContain(v3.id);
    expect(ids).not.toContain(v2.id); // superseded = this version was wrong
  });

  it("S-17 names the recipes a unit-ratio change would move (Q17)", async () => {
    const bagged = await makeProduct("bagged", {
      additionalUnits: [{ unitName: "ถุง", toBaseRatio: 0.5 }],
    });
    const menu = await makeMenu("ใส่เป็นถุง");
    await createRecipeLogic(
      tenantA,
      recipeInput({
        menuId: menu.id,
        ingredients: [
          {
            productId: bagged.id,
            componentMenuId: null,
            qty: 2,
            productUnitId: unitOf(bagged, "ถุง"),
            sortOrder: 0,
            notes: null,
          },
        ],
      }),
      userA
    );

    // Correcting what a ถุง weighs moves every recipe that says ถุง — the
    // guard ADR 0006 left open, and which recipes finally supply a reference for.
    const moved = await getRecipesUsingUnitLogic(tenantA, unitOf(bagged, "ถุง"));
    expect(moved).toHaveLength(1);
    expect(moved[0].qty.toNumber()).toBe(2);
    expect(moved[0].isCentral).toBe(true);

    // The product's OTHER unit moves nothing.
    expect(await getRecipesUsingUnitLogic(tenantA, unitOf(bagged, "kg"))).toHaveLength(0);
  });
});
