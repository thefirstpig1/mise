// ============================================================
// Mise — the drafts list (Part 24 L5a, ADR 0025)
// ============================================================
// The one read the lab screen needs that L3 never wrote. It answers a list's
// question — what am I in the middle of? — and two things on each row are there
// so a screen can warn BEFORE a button rather than after it:
//
//   `liveRecipeId`  publishing this takes over a recipe that is already live.
//   `hasSales`      the dish sells, so the SOLD price is the price (Q2) and
//                   ราคาที่ตั้งใจ may only sit beside it.
//
//   B1  a draft for a new dish: MISE menu, planned price, ingredient count
//   B2  a draft over a live central recipe names it; one without says null
//   B3  a BRANCH recipe is not what publishing displaces
//   B4  sales make hasSales true, and a replaced day's rows do not
//   B5  discarding and publishing both take the row off the list
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withAdminContext, prisma } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { recipeInputSchema } from "@/lib/validations/recipe";
import {
  draftRecipeInputSchema,
  publishDraftInputSchema,
  discardDraftInputSchema,
} from "@/lib/validations/menu-lab";
import { createRecipeLogic } from "@/server/recipe";
import {
  createDraftLogic,
  discardDraftLogic,
  publishDraftLogic,
} from "@/server/menu-lab";
import { getDraftsLogic } from "@/server/menu-lab-read";

describe("the drafts list (ADR 0025 L5a)", () => {
  let tenantA: string;
  let userA: string;
  let branchA: string;
  let batchA: string;
  let posIntegrationA: string;
  let categoryA: string;
  let flour: ProductWithUnits;

  const today = computeBangkokToday();
  const LONG_AGO = addDays(today, -60);

  const makeMenu = (name: string, source: "POS" | "MISE" = "POS") =>
    withAdminContext((tx) =>
      tx.menu.create({
        data: {
          tenantId: tenantA,
          source,
          name: `${name}-${randomUUID().slice(0, 4)}`,
          // `menu_source_check`: a POS menu must name the integration it came
          // from. `posMenuId` may stay null — a daily-summary file often carries
          // names only.
          ...(source === "POS" ? { posIntegrationId: posIntegrationA } : {}),
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

  const draft = (over: Record<string, unknown> = {}) =>
    createDraftLogic(
      tenantA,
      draftRecipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId: null,
        newMenuName: null,
        menuCategoryId: null,
        servings: 1,
        plannedPrice: null,
        ingredients: [ing(flour, 2)],
        notes: null,
        ...over,
      }),
      userA
    );

  const giveRecipe = (menuId: string) =>
    createRecipeLogic(
      tenantA,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId,
        outputProductId: null,
        servings: 1,
        effectiveFrom: LONG_AGO,
        ingredients: [ing(flour, 2)],
        notes: null,
      }),
      userA
    );

  const sell = (
    businessDate: Date,
    menuId: string,
    net: number,
    superseded = false
  ) =>
    withAdminContext(async (tx) => {
      const day = await tx.salesDay.upsert({
        where: {
          branchId_businessDate: { branchId: branchA, businessDate },
        },
        create: {
          tenantId: tenantA,
          branchId: branchA,
          businessDate,
          currentBatchId: batchA,
        },
        update: {},
        select: { id: true },
      });
      return tx.salesLine.create({
        data: {
          tenantId: tenantA,
          branchId: branchA,
          businessDate,
          salesDayId: day.id,
          importBatchId: batchA,
          menuId,
          qty: 1,
          grossAmount: net,
          discountAmount: 0,
          netAmount: net,
          serviceChargeAmount: 0,
          vatAmount: 0,
          ...(superseded
            ? { supersededAt: new Date(), supersededByBatchId: batchA }
            : {}),
        },
        select: { id: true },
      });
    });

  const rowFor = async (recipeId: string) =>
    (await getDraftsLogic(tenantA)).find((r) => r.recipeId === recipeId);

  beforeAll(async () => {
    await withAdminContext(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Drafts List Tenant" } });
      tenantA = t.id;
      const u = await tx.user.create({
        data: { email: `drafts-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;
      const b = await tx.branch.create({
        data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" },
        select: { id: true },
      });
      branchA = b.id;
      const c = await tx.menuCategory.create({
        data: { tenantId: t.id, name: `จานเดียว-${randomUUID().slice(0, 4)}` },
        select: { id: true },
      });
      categoryA = c.id;

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

    flour = await createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `DRAFTS-flour-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
      })
    );
  }, 120_000);

  afterAll(async () => {
    await withAdminContext(async (tx) => {
      await tx.recipeIngredient.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeBranch.deleteMany({ where: { tenantId: tenantA } });
      // Both halves, or `recipe_superseded_pair_check` refuses the row.
      await tx.recipe.updateMany({
        where: { tenantId: tenantA },
        data: { supersededById: null, supersededAt: null },
      });
      await tx.recipe.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesLine.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesDay.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportBatch.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportProfile.deleteMany({ where: { tenantId: tenantA } });
      await tx.menu.deleteMany({ where: { tenantId: tenantA } });
      await tx.menuCategory.deleteMany({ where: { tenantId: tenantA } });
      await tx.posIntegration.deleteMany({ where: { tenantId: tenantA } });
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

  it("B1: a draft for a dish that does not exist carries its MISE menu", async () => {
    const d = await draft({
      newMenuName: "B1 ข้าวผัดปูใหม่",
      menuCategoryId: categoryA,
      plannedPrice: 189,
      servings: 2,
      ingredients: [ing(flour, 2)],
    });

    const row = await rowFor(d.id);
    expect(row).toBeDefined();
    expect(row!.menuName).toBe("B1 ข้าวผัดปูใหม่");
    // Q3: the lab made this menu, so no POS knows it. Part 25 is what merges it
    // if the dish later turns up in an export.
    expect(row!.menuIsMise).toBe(true);
    expect(row!.plannedPrice?.toString()).toBe("189");
    expect(row!.servings.toString()).toBe("2");
    expect(row!.ingredientCount).toBe(1);
    // Nothing to take over, and nothing sold.
    expect(row!.liveRecipeId).toBeNull();
    expect(row!.hasSales).toBe(false);
  });

  it("B2: a draft over a live central recipe names the one it would replace", async () => {
    const sells = await makeMenu("B2 ต้มยำ");
    const live = await giveRecipe(sells.id);
    const over = await draft({ menuId: sells.id });

    const untouched = await makeMenu("B2 ยำวุ้นเส้น");
    const fresh = await draft({ menuId: untouched.id });

    expect((await rowFor(over.id))!.liveRecipeId).toBe(live.id);
    expect((await rowFor(over.id))!.menuIsMise).toBe(false);
    expect((await rowFor(fresh.id))!.liveRecipeId).toBeNull();
  });

  it("B3: a branch recipe is not the central one publishing displaces", async () => {
    const dish = await makeMenu("B3 ผัดกะเพรา");
    const central = await giveRecipe(dish.id);

    // The branch stops following central (Q8) — its copy is its own line, and a
    // draft does not replace it. If this row leaked into the lookup, the screen
    // would warn about taking over a recipe publishing leaves alone.
    await withAdminContext(async (tx) => {
      const branchCopy = await tx.recipe.create({
        data: {
          tenantId: tenantA,
          lineId: randomUUID(),
          menuId: dish.id,
          outputProductId: null,
          servings: 1,
          effectiveFrom: LONG_AGO,
          isDraft: false,
          createdBy: userA,
        },
        select: { id: true, lineId: true },
      });
      await tx.recipeBranch.create({
        data: {
          tenantId: tenantA,
          lineId: branchCopy.lineId,
          branchId: branchA,
          recipeId: branchCopy.id,
          createdBy: userA,
        },
      });
    });

    const d = await draft({ menuId: dish.id });
    // The CENTRAL one, never the branch copy.
    expect((await rowFor(d.id))!.liveRecipeId).toBe(central.id);
  });

  it("B4: a dish that sells says so, and a replaced day's rows do not", async () => {
    const sold = await makeMenu("B4 กะเพราหมู");
    const replaced = await makeMenu("B4 คอหมูย่าง");

    await sell(addDays(today, -3), sold.id, 120);
    // Evidence, not revenue — the same filter the coverage read applies.
    await sell(addDays(today, -4), replaced.id, 220, true);

    const withSales = await draft({ menuId: sold.id });
    const withoutSales = await draft({ menuId: replaced.id });

    expect((await rowFor(withSales.id))!.hasSales).toBe(true);
    expect((await rowFor(withoutSales.id))!.hasSales).toBe(false);
  });

  it("B5: discarding and publishing both take the row off the list", async () => {
    const discarded = await draft({ newMenuName: "B5 ทิ้ง" });
    const publishedFrom = await draft({ newMenuName: "B5 เผยแพร่" });

    expect(await rowFor(discarded.id)).toBeDefined();
    expect(await rowFor(publishedFrom.id)).toBeDefined();

    await discardDraftLogic(
      tenantA,
      discardDraftInputSchema.parse({ recipeId: discarded.id })
    );
    await publishDraftLogic(
      tenantA,
      publishDraftInputSchema.parse({ recipeId: publishedFrom.id })
    );

    // One is gone because it never was a recipe; the other because it now IS
    // one — and a published recipe belongs to /recipes, not to the lab.
    expect(await rowFor(discarded.id)).toBeUndefined();
    expect(await rowFor(publishedFrom.id)).toBeUndefined();
  });
});
