// ============================================================
// Mise — recipe write *Logic integration tests (Sprint 5 Part 21 L3a)
// ============================================================
// The walker's arithmetic is proved without a database in tests/recipe-graph.
// What is proved HERE is everything a pure function cannot see: that a version
// is appended rather than overwritten, that a correction removes the version it
// corrects from every date, that a branch copy stops following central from that
// moment, and that the guards which span two tables actually fire.
//
// Products go through the REAL Part 7 write path (`createProductLogic`), because
// the guards read `type`, `parentProductId` and the unit's owning product, and a
// hand-built row would prove the test right rather than the code.
//
// Menus are created directly: Part 19 gave menus a POS-import path and a stub
// path, and no plain "create a Mise menu" logic exists to go through yet.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenantContext } from "@/lib/db";
import { withRlsBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import {
  CrossTenantReferenceError,
  createProductLogic,
  deleteProductLogic,
  updateProductLogic,
  type ProductWithUnits,
} from "@/server/product";
import {
  copyRecipeToBranchesInputSchema,
  recipeInputSchema,
} from "@/lib/validations/recipe";
import {
  RecipeAlreadyExistsError,
  RecipeBranchAlreadyDecidedError,
  RecipeNotFoundError,
  RecipeSupersededError,
  RecipeTargetImmutableError,
  RecipeUnitMismatchError,
  copyRecipeToBranchesLogic,
  createRecipeLogic,
  deleteRecipeLogic,
  updateRecipeLogic,
} from "@/server/recipe";
import {
  ProductTypeChangeBlockedError,
  ProductUsedInRecipeError,
  RecipeCycleError,
  RecipeDepthExceededError,
  RecipeMethodConflictError,
  RecipeOutputNotPreppedError,
} from "@/server/recipe-guards";
import { resolveRecipeIds } from "@/server/recipe-resolve";

describe("recipe write *Logic (ADR 0021 Part 21 L3a)", () => {
  let tenantA: string;
  let tenantB: string;
  let userA: string;
  /** Never diverges — it is the branch that keeps following central. */
  let branchCentral: string;
  /** The branch that presses the copy button. */
  let branchAsoke: string;
  let branchB: string;

  let pork: ProductWithUnits;
  let basil: ProductWithUnits;
  let chilli: ProductWithUnits;
  let salmonWhole: ProductWithUnits;
  let salmonFillet: ProductWithUnits;
  let chilliJam: ProductWithUnits;
  let foreignProduct: ProductWithUnits;

  const today = computeBangkokToday();

  // ------------------------------------------------------------
  // Fixtures
  // ------------------------------------------------------------

  const makeProduct = (
    tenant: string,
    tag: string,
    over: Record<string, unknown> = {}
  ): Promise<ProductWithUnits> =>
    createProductLogic(
      tenant,
      productInputSchema.parse({
        name: `REC-${tag}-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
        ...over,
      })
    );

  const makeMenu = (tenant: string, name: string): Promise<{ id: string }> =>
    withRlsBypass((tx) =>
      tx.menu.create({
        data: { tenantId: tenant, source: "MISE", name: `${name}-${randomUUID().slice(0, 6)}` },
        select: { id: true },
      })
    );

  const baseUnitOf = (p: ProductWithUnits) =>
    p.productUnits.find((u) => u.isBase)!.id;

  /** One ingredient line naming a product, in its base unit. */
  const ing = (p: ProductWithUnits, qty: number) => ({
    productId: p.id,
    componentMenuId: null,
    qty,
    productUnitId: baseUnitOf(p),
    sortOrder: 0,
    notes: null,
  });

  /** One ingredient line naming another menu — Q3's set-menu shape. */
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

  /** Which recipe applies to this menu, at this branch, on this day. */
  const resolveFor = (menuId: string, branchId: string, asOf: Date = today) =>
    withTenantContext(tenantA, (tx) =>
      resolveRecipeIds(tx, tenantA, [{ kind: "menu", id: menuId }], branchId, asOf)
    ).then((m) => m.get(`menu:${menuId}`) ?? null);

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const [a, b] = await Promise.all([
        tx.tenant.create({ data: { name: "Recipe Test Tenant A" } }),
        tx.tenant.create({ data: { name: "Recipe Test Tenant B" } }),
      ]);
      tenantA = a.id;
      tenantB = b.id;

      const [bc, ba, bb] = await Promise.all([
        tx.branch.create({ data: { tenantId: a.id, name: "สาขากลาง", code: "CEN" } }),
        tx.branch.create({ data: { tenantId: a.id, name: "สาขาอโศก", code: "ASK" } }),
        tx.branch.create({ data: { tenantId: b.id, name: "อีกเจ้า", code: "OTH" } }),
      ]);
      branchCentral = bc.id;
      branchAsoke = ba.id;
      branchB = bb.id;

      const u = await tx.user.create({
        data: { email: `recipe-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;
    });

    pork = await makeProduct(tenantA, "pork");
    basil = await makeProduct(tenantA, "basil");
    chilli = await makeProduct(tenantA, "chilli");
    salmonWhole = await makeProduct(tenantA, "salmon");
    salmonFillet = await makeProduct(tenantA, "fillet", {
      type: "PREPPED",
      parentProductId: salmonWhole.id,
      yieldPercent: 60,
    });
    // ADR 0021 Q1's other half: a PREPPED product with NO parent, made by a
    // production recipe. This shape was impossible before Part 21.
    chilliJam = await makeProduct(tenantA, "jam", { type: "PREPPED" });
    foreignProduct = await makeProduct(tenantB, "foreign");
  });

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      for (const t of [tenantA, tenantB]) {
        await tx.recipeBranch.deleteMany({ where: { tenantId: t } });
        await tx.recipeIngredient.deleteMany({ where: { tenantId: t } });
        // Versions point at the version that superseded them, so the FK has to
        // be broken before the rows can go.
        await tx.recipe.updateMany({
          where: { tenantId: t },
          data: { supersededAt: null, supersededById: null },
        });
        await tx.recipe.deleteMany({ where: { tenantId: t } });
        await tx.menu.deleteMany({ where: { tenantId: t } });
        await tx.productUnit.deleteMany({ where: { product: { tenantId: t } } });
        await tx.product.updateMany({
          where: { tenantId: t },
          data: { parentProductId: null },
        });
        await tx.product.deleteMany({ where: { tenantId: t } });
        await tx.category.deleteMany({ where: { tenantId: t } });
        await tx.branch.deleteMany({ where: { tenantId: t } });
        await tx.tenant.deleteMany({ where: { id: t } });
      }
      await tx.user.deleteMany({ where: { id: userA } });
    });
  });

  // ------------------------------------------------------------
  // Create
  // ------------------------------------------------------------

  it("R-01 writes a central recipe, and a branch that has decided nothing resolves to it", async () => {
    const menu = await makeMenu(tenantA, "กะเพราหมู");
    const recipe = await createRecipeLogic(
      tenantA,
      recipeInput({
        menuId: menu.id,
        servings: 1,
        ingredients: [ing(pork, 0.12), ing(basil, 0.01)],
      }),
      userA
    );

    expect(recipe.menuId).toBe(menu.id);
    expect(recipe.ingredients).toHaveLength(2);
    expect(recipe.supersededAt).toBeNull();

    // No `recipe_branch` rows at all = central, and central serves every branch
    // that has not decided otherwise (Q8).
    for (const branch of [branchCentral, branchAsoke]) {
      const applies = await resolveFor(menu.id, branch);
      expect(applies?.id).toBe(recipe.id);
    }
  });

  it("R-02 is idempotent by submitKey — a double POST writes one recipe", async () => {
    const menu = await makeMenu(tenantA, "ผัดกะเพรา");
    const input = recipeInput({ menuId: menu.id, ingredients: [ing(pork, 0.1)] });

    const first = await createRecipeLogic(tenantA, input, userA);
    const second = await createRecipeLogic(tenantA, input, userA);

    expect(second.id).toBe(first.id);
    const count = await withRlsBypass((tx) =>
      tx.recipe.count({ where: { tenantId: tenantA, menuId: menu.id } })
    );
    expect(count).toBe(1);
  });

  it("R-03 refuses a SECOND central line for the same menu", async () => {
    const menu = await makeMenu(tenantA, "ต้มยำ");
    await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: menu.id, ingredients: [ing(pork, 0.1)] }),
      userA
    );

    await expect(
      createRecipeLogic(
        tenantA,
        recipeInput({ menuId: menu.id, ingredients: [ing(basil, 0.1)] }),
        userA
      )
    ).rejects.toBeInstanceOf(RecipeAlreadyExistsError);
  });

  it("R-04 refuses a menu belonging to another tenant", async () => {
    const foreignMenu = await makeMenu(tenantB, "ของเจ้าอื่น");
    await expect(
      createRecipeLogic(
        tenantA,
        recipeInput({ menuId: foreignMenu.id, ingredients: [ing(pork, 0.1)] }),
        userA
      )
    ).rejects.toBeInstanceOf(CrossTenantReferenceError);
  });

  it("R-05 refuses an ingredient belonging to another tenant", async () => {
    const menu = await makeMenu(tenantA, "ข้ามร้าน");
    await expect(
      createRecipeLogic(
        tenantA,
        recipeInput({ menuId: menu.id, ingredients: [ing(foreignProduct, 0.1)] }),
        userA
      )
    ).rejects.toBeInstanceOf(CrossTenantReferenceError);
  });

  it("R-06 refuses a unit that belongs to a DIFFERENT product", async () => {
    const menu = await makeMenu(tenantA, "หน่วยผิด");
    await expect(
      createRecipeLogic(
        tenantA,
        recipeInput({
          menuId: menu.id,
          ingredients: [{ ...ing(pork, 0.1), productUnitId: baseUnitOf(basil) }],
        }),
        userA
      )
    ).rejects.toBeInstanceOf(RecipeUnitMismatchError);
  });

  // ------------------------------------------------------------
  // Q1 — one method, never two
  // ------------------------------------------------------------

  it("R-07 accepts a production recipe for a PREPPED product with no parent (น้ำพริกเผา)", async () => {
    const recipe = await createRecipeLogic(
      tenantA,
      recipeInput({
        outputProductId: chilliJam.id,
        // `servings` on a production recipe is the OUTPUT'S BASE UNITS: one
        // batch makes 0.25 kg of jam (Q16).
        servings: 0.25,
        ingredients: [ing(chilli, 0.2), ing(pork, 0.05)],
      }),
      userA
    );
    expect(recipe.outputProductId).toBe(chilliJam.id);
    expect(recipe.menuId).toBeNull();
  });

  it("R-08 refuses a production recipe whose output is RAW", async () => {
    await expect(
      createRecipeLogic(
        tenantA,
        recipeInput({ outputProductId: pork.id, ingredients: [ing(basil, 0.1)] }),
        userA
      )
    ).rejects.toBeInstanceOf(RecipeOutputNotPreppedError);
  });

  it("R-09 refuses a production recipe for a product already made by a parent + yield", async () => {
    await expect(
      createRecipeLogic(
        tenantA,
        recipeInput({
          outputProductId: salmonFillet.id,
          ingredients: [ing(salmonWhole, 1)],
        }),
        userA
      )
    ).rejects.toBeInstanceOf(RecipeMethodConflictError);
  });

  it("R-10 refuses setting a parent on a product a production recipe already outputs", async () => {
    // The mirror of R-09, approached from the product form. R-07 gave chilliJam
    // its production recipe; giving it a parent as well would leave two
    // notations on the table with nothing choosing between them.
    await expect(
      updateProductLogic(
        tenantA,
        chilliJam.id,
        productInputSchema.parse({
          name: chilliJam.name,
          primaryDimension: "WEIGHT",
          baseUnitName: "kg",
          additionalUnits: [],
          defaultBuyUnitName: "kg",
          type: "PREPPED",
          parentProductId: chilli.id,
          yieldPercent: 80,
        })
      )
    ).rejects.toBeInstanceOf(RecipeMethodConflictError);
  });

  // ------------------------------------------------------------
  // Update — append, correct, or neither (Q4)
  // ------------------------------------------------------------

  it("R-11 a change on a LATER date appends a version; the old one still governs its own days", async () => {
    const menu = await makeMenu(tenantA, "เปลี่ยนวันหลัง");
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
        ingredients: [ing(pork, 0.12)],
      }),
      userA
    );

    expect(v2.id).not.toBe(v1.id);
    // The line is what survives a version, and `recipe_branch` hangs off it.
    expect(v2.lineId).toBe(v1.lineId);

    // The reason time travel is mandatory: Part 22 posts thirty past days in one
    // pass, and each has to meet the recipe that was true then.
    expect((await resolveFor(menu.id, branchCentral, today))?.id).toBe(v2.id);
    expect((await resolveFor(menu.id, branchCentral, addDays(today, -5)))?.id).toBe(
      v1.id
    );
  });

  it("R-12 a change on the SAME date is a correction: the old version is superseded and vanishes from every date", async () => {
    const menu = await makeMenu(tenantA, "แก้ที่พิมพ์ผิด");
    const fiveDaysAgo = addDays(today, -5);

    const wrong = await createRecipeLogic(
      tenantA,
      recipeInput({
        menuId: menu.id,
        effectiveFrom: fiveDaysAgo,
        ingredients: [ing(pork, 1.2)],
      }),
      userA
    );
    const right = await updateRecipeLogic(
      tenantA,
      wrong.id,
      recipeInput({
        menuId: menu.id,
        effectiveFrom: fiveDaysAgo,
        ingredients: [ing(pork, 0.12)],
      }),
      userA
    );

    const stored = await withRlsBypass((tx) =>
      tx.recipe.findUniqueOrThrow({ where: { id: wrong.id } })
    );
    expect(stored.supersededAt).not.toBeNull();
    expect(stored.supersededById).toBe(right.id);

    // Superseded means THIS VERSION WAS WRONG, so it is unreachable at every
    // date — not merely after the correction.
    expect((await resolveFor(menu.id, branchCentral, fiveDaysAgo))?.id).toBe(right.id);
    expect((await resolveFor(menu.id, branchCentral, addDays(today, -4)))?.id).toBe(
      right.id
    );
  });

  it("R-13 editing only the notes does NOT write a version", async () => {
    const menu = await makeMenu(tenantA, "แก้หมายเหตุ");
    const v1 = await createRecipeLogic(
      tenantA,
      recipeInput({
        menuId: menu.id,
        ingredients: [ing(pork, 0.1), ing(basil, 0.01)],
        notes: "เดิม",
      }),
      userA
    );

    const same = await updateRecipeLogic(
      tenantA,
      v1.id,
      recipeInput({
        menuId: menu.id,
        // Same numbers, listed in the other order — reordering is not a change
        // to what the dish consumes.
        ingredients: [ing(basil, 0.01), ing(pork, 0.1)],
        notes: "ใหม่",
      }),
      userA
    );

    expect(same.id).toBe(v1.id);
    expect(same.notes).toBe("ใหม่");
    const versions = await withRlsBypass((tx) =>
      tx.recipe.count({ where: { tenantId: tenantA, lineId: v1.lineId } })
    );
    expect(versions).toBe(1);
  });

  it("R-14 refuses re-pointing a recipe at a different menu", async () => {
    const menu = await makeMenu(tenantA, "เมนูเดิม");
    const other = await makeMenu(tenantA, "เมนูใหม่");
    const v1 = await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: menu.id, ingredients: [ing(pork, 0.1)] }),
      userA
    );

    await expect(
      updateRecipeLogic(
        tenantA,
        v1.id,
        recipeInput({ menuId: other.id, ingredients: [ing(pork, 0.2)] }),
        userA
      )
    ).rejects.toBeInstanceOf(RecipeTargetImmutableError);
  });

  it("R-15 refuses editing a version that was already corrected away", async () => {
    const menu = await makeMenu(tenantA, "แก้ซ้อน");
    const wrong = await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: menu.id, ingredients: [ing(pork, 1.2)] }),
      userA
    );
    await updateRecipeLogic(
      tenantA,
      wrong.id,
      recipeInput({ menuId: menu.id, ingredients: [ing(pork, 0.12)] }),
      userA
    );

    await expect(
      updateRecipeLogic(
        tenantA,
        wrong.id,
        recipeInput({ menuId: menu.id, ingredients: [ing(pork, 0.13)] }),
        userA
      )
    ).rejects.toBeInstanceOf(RecipeSupersededError);
  });

  it("R-16 another tenant cannot edit this recipe", async () => {
    const menu = await makeMenu(tenantA, "ข้ามร้านแก้");
    const v1 = await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: menu.id, ingredients: [ing(pork, 0.1)] }),
      userA
    );

    await expect(
      updateRecipeLogic(
        tenantB,
        v1.id,
        recipeInput({ menuId: menu.id, ingredients: [ing(pork, 0.2)] }),
        userA
      )
    ).rejects.toBeInstanceOf(RecipeNotFoundError);
  });

  // ------------------------------------------------------------
  // Delete
  // ------------------------------------------------------------

  it("R-17 deleting takes the whole LINE, every version of it", async () => {
    const menu = await makeMenu(tenantA, "ลบทั้งสาย");
    const v1 = await createRecipeLogic(
      tenantA,
      recipeInput({
        menuId: menu.id,
        effectiveFrom: addDays(today, -3),
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

    expect(await deleteRecipeLogic(tenantA, v2.id)).toBe(true);

    const live = await withRlsBypass((tx) =>
      tx.recipe.count({
        where: { tenantId: tenantA, lineId: v1.lineId, deletedAt: null },
      })
    );
    expect(live).toBe(0);
    // Deleting one version would leave the days it covered pointing at nothing.
    expect(await resolveFor(menu.id, branchCentral, addDays(today, -2))).toBeNull();
  });

  // ------------------------------------------------------------
  // Q8 — copying to a branch is a declaration of independence
  // ------------------------------------------------------------

  it("R-18 a branch copy serves that branch only, and stops following central", async () => {
    const menu = await makeMenu(tenantA, "กะเพราสาขา");
    const central = await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: menu.id, ingredients: [ing(pork, 0.12)] }),
      userA
    );

    const copy = await copyRecipeToBranchesLogic(
      tenantA,
      copyRecipeToBranchesInputSchema.parse({
        submitKey: randomUUID(),
        sourceRecipeId: central.id,
        branchIds: [branchAsoke],
      }),
      userA
    );

    expect(copy.lineId).not.toBe(central.lineId);
    expect((await resolveFor(menu.id, branchAsoke))?.id).toBe(copy.id);
    expect((await resolveFor(menu.id, branchCentral))?.id).toBe(central.id);

    // The point of the copy: head office editing central no longer reaches
    // อโศก, because อโศก's cooks may not have been retrained.
    const v2 = await updateRecipeLogic(
      tenantA,
      central.id,
      recipeInput({ menuId: menu.id, ingredients: [ing(pork, 0.1)] }),
      userA
    );
    expect((await resolveFor(menu.id, branchCentral))?.id).toBe(v2.id);
    expect((await resolveFor(menu.id, branchAsoke))?.id).toBe(copy.id);
  });

  it("R-19 refuses to copy over a branch that already decided, unless told twice", async () => {
    const menu = await makeMenu(tenantA, "ทับของสาขา");
    const central = await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: menu.id, ingredients: [ing(pork, 0.12)] }),
      userA
    );
    const first = await copyRecipeToBranchesLogic(
      tenantA,
      copyRecipeToBranchesInputSchema.parse({
        submitKey: randomUUID(),
        sourceRecipeId: central.id,
        branchIds: [branchAsoke],
      }),
      userA
    );

    await expect(
      copyRecipeToBranchesLogic(
        tenantA,
        copyRecipeToBranchesInputSchema.parse({
          submitKey: randomUUID(),
          sourceRecipeId: central.id,
          branchIds: [branchAsoke],
        }),
        userA
      )
    ).rejects.toBeInstanceOf(RecipeBranchAlreadyDecidedError);

    const second = await copyRecipeToBranchesLogic(
      tenantA,
      copyRecipeToBranchesInputSchema.parse({
        submitKey: randomUUID(),
        sourceRecipeId: central.id,
        branchIds: [branchAsoke],
        acknowledgeOverwrite: true,
      }),
      userA
    );

    expect((await resolveFor(menu.id, branchAsoke))?.id).toBe(second.id);

    // The discarded line served อโศก and nobody else. Left alive with no branch
    // links it would read as CENTRAL — a rejected branch variant silently
    // becoming everyone's recipe.
    const orphan = await withRlsBypass((tx) =>
      tx.recipe.findUniqueOrThrow({ where: { id: first.id } })
    );
    expect(orphan.deletedAt).not.toBeNull();
    expect((await resolveFor(menu.id, branchCentral))?.id).toBe(central.id);
  });

  // ------------------------------------------------------------
  // Q3 — cycles and depth, over products AND menus in one budget
  // ------------------------------------------------------------

  it("R-20 refuses a cycle two hops long (set menu ↔ its component)", async () => {
    const dish = await makeMenu(tenantA, "สเต็ก");
    const set = await makeMenu(tenantA, "เซ็ทสเต็ก");

    const dishRecipe = await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: dish.id, ingredients: [ing(pork, 0.2)] }),
      userA
    );
    await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: set.id, ingredients: [ingMenu(dish.id, 1)] }),
      userA
    );

    // The set already contains the dish; making the dish contain the set closes
    // the loop. L2 catches only a menu listing ITSELF — this one needs the rows.
    await expect(
      updateRecipeLogic(
        tenantA,
        dishRecipe.id,
        recipeInput({
          menuId: dish.id,
          ingredients: [ing(pork, 0.2), ingMenu(set.id, 1)],
        }),
        userA
      )
    ).rejects.toBeInstanceOf(RecipeCycleError);

    // …and the refusal rolled the write back rather than leaving a cyclic row.
    const versions = await withRlsBypass((tx) =>
      tx.recipe.count({ where: { tenantId: tenantA, lineId: dishRecipe.lineId } })
    );
    expect(versions).toBe(1);
  });

  it("R-21 refuses a sixth node, counting menus and products in ONE budget", async () => {
    // m1 → pork is 2 nodes; each wrapper adds one.
    const menus = await Promise.all([
      makeMenu(tenantA, "ชั้น1"),
      makeMenu(tenantA, "ชั้น2"),
      makeMenu(tenantA, "ชั้น3"),
      makeMenu(tenantA, "ชั้น4"),
      makeMenu(tenantA, "ชั้น5"),
    ]);

    await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: menus[0].id, ingredients: [ing(pork, 0.1)] }),
      userA
    );
    // m4 → m3 → m2 → m1 → pork = five nodes exactly, which is allowed.
    for (let i = 1; i <= 3; i++) {
      await createRecipeLogic(
        tenantA,
        recipeInput({
          menuId: menus[i].id,
          ingredients: [ingMenu(menus[i - 1].id, 1)],
        }),
        userA
      );
    }

    await expect(
      createRecipeLogic(
        tenantA,
        recipeInput({
          menuId: menus[4].id,
          ingredients: [ingMenu(menus[3].id, 1)],
        }),
        userA
      )
    ).rejects.toBeInstanceOf(RecipeDepthExceededError);
  });

  it("R-22 counts what sits ABOVE the recipe being edited, not only below it", async () => {
    // Four levels of menu ending in pork = 5 nodes, at the cap.
    const menus = await Promise.all([
      makeMenu(tenantA, "ล่างสุด"),
      makeMenu(tenantA, "กลาง1"),
      makeMenu(tenantA, "กลาง2"),
      makeMenu(tenantA, "บนสุด"),
    ]);
    const bottom = await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: menus[0].id, ingredients: [ing(pork, 0.1)] }),
      userA
    );
    for (let i = 1; i <= 3; i++) {
      await createRecipeLogic(
        tenantA,
        recipeInput({
          menuId: menus[i].id,
          ingredients: [ingMenu(menus[i - 1].id, 1)],
        }),
        userA
      );
    }

    // Swapping pork for salmon FILLET adds one node BELOW the bottom recipe
    // (fillet → whole salmon), pushing the chain that starts three levels above
    // it to six. Nothing about the edited recipe alone looks too deep.
    await expect(
      updateRecipeLogic(
        tenantA,
        bottom.id,
        recipeInput({
          menuId: menus[0].id,
          ingredients: [ing(salmonFillet, 0.1)],
        }),
        userA
      )
    ).rejects.toBeInstanceOf(RecipeDepthExceededError);
  });

  // ------------------------------------------------------------
  // Q13 — `Product.type` is load-bearing from now on
  // ------------------------------------------------------------

  it("R-23 refuses PREPPED → RAW while a production recipe outputs it", async () => {
    const jam = await makeProduct(tenantA, "jam2", { type: "PREPPED" });
    await createRecipeLogic(
      tenantA,
      recipeInput({
        outputProductId: jam.id,
        servings: 0.25,
        ingredients: [ing(chilli, 0.2)],
      }),
      userA
    );

    await expect(
      updateProductLogic(
        tenantA,
        jam.id,
        productInputSchema.parse({
          name: jam.name,
          primaryDimension: "WEIGHT",
          baseUnitName: "kg",
          additionalUnits: [],
          defaultBuyUnitName: "kg",
          type: "RAW",
        })
      )
    ).rejects.toBeInstanceOf(ProductTypeChangeBlockedError);
  });

  it("R-24 allows RAW → PREPPED for a product recipes already use", async () => {
    const shallot = await makeProduct(tenantA, "shallot");
    const shallotParent = await makeProduct(tenantA, "shallot-raw");
    const menu = await makeMenu(tenantA, "หอมเจียว");
    await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: menu.id, ingredients: [ing(shallot, 0.05)] }),
      userA
    );

    // A RAW used in recipes that turns out to need trimming SHOULD become
    // PREPPED — that makes those recipes more accurate, not less.
    const updated = await updateProductLogic(
      tenantA,
      shallot.id,
      productInputSchema.parse({
        name: shallot.name,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
        type: "PREPPED",
        parentProductId: shallotParent.id,
        yieldPercent: 85,
      })
    );
    expect(updated?.type).toBe("PREPPED");
  });

  it("R-25 refuses deleting a product a recipe still uses, and NAMES the recipe", async () => {
    const garlic = await makeProduct(tenantA, "garlic");
    const menu = await makeMenu(tenantA, "กระเทียมเจียว");
    await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: menu.id, ingredients: [ing(garlic, 0.02)] }),
      userA
    );

    const err = await deleteProductLogic(tenantA, garlic.id).catch((e) => e);
    expect(err).toBeInstanceOf(ProductUsedInRecipeError);
    expect((err as ProductUsedInRecipeError).recipeNames.length).toBeGreaterThan(0);
  });

  it("R-26 refuses deleting a product that a production recipe OUTPUTS", async () => {
    const paste = await makeProduct(tenantA, "paste", { type: "PREPPED" });
    await createRecipeLogic(
      tenantA,
      recipeInput({
        outputProductId: paste.id,
        servings: 0.3,
        ingredients: [ing(chilli, 0.25)],
      }),
      userA
    );

    await expect(deleteProductLogic(tenantA, paste.id)).rejects.toBeInstanceOf(
      ProductUsedInRecipeError
    );
  });

  it("R-27 a branch that diverged is probed on its own, so a cycle only IT can see is refused", async () => {
    const dish = await makeMenu(tenantA, "จานเดี่ยว");
    const set = await makeMenu(tenantA, "เซ็ทของอโศก");

    const dishCentral = await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: dish.id, ingredients: [ing(pork, 0.2)] }),
      userA
    );
    const setCentral = await createRecipeLogic(
      tenantA,
      recipeInput({ menuId: set.id, ingredients: [ing(basil, 0.01)] }),
      userA
    );

    // อโศก alone puts the dish inside the set.
    const setAtAsoke = await copyRecipeToBranchesLogic(
      tenantA,
      copyRecipeToBranchesInputSchema.parse({
        submitKey: randomUUID(),
        sourceRecipeId: setCentral.id,
        branchIds: [branchAsoke],
      }),
      userA
    );
    await updateRecipeLogic(
      tenantA,
      setAtAsoke.id,
      recipeInput({ menuId: set.id, ingredients: [ingMenu(dish.id, 1)] }),
      userA
    );

    // Centrally there is no loop at all — only อโศก can see one, and the guard
    // has to probe that branch to find it.
    await expect(
      updateRecipeLogic(
        tenantA,
        dishCentral.id,
        recipeInput({
          menuId: dish.id,
          ingredients: [ing(pork, 0.2), ingMenu(set.id, 1)],
        }),
        userA
      )
    ).rejects.toBeInstanceOf(RecipeCycleError);
  });
});
