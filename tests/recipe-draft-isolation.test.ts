// ============================================================
// Mise — a draft cannot reach the ledger (Part 24 L3b, ADR 0025 Q4)
// ============================================================
// `is_draft` is a flag on the same table the ledger reads from, which is the
// deliberate trade recorded in ADR 0025 Q4: one cost engine, two filters. These
// tests are the other half of that trade. They are written BEFORE the screen
// that creates drafts, and they write drafts straight in with admin context, so
// what is proved is the BARRIER — not whichever path happened to build the row.
//
// The four things a draft must never do:
//   G1  resolve for a sales day
//   G2  block the published recipe of its own menu
//   G3  consume stock when a day is posted
//   G4  change what the live recipe costs
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { withRlsBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { recipeInputSchema } from "@/lib/validations/recipe";
import { createRecipeLogic } from "@/server/recipe";
import { resolveRecipeIds } from "@/server/recipe-resolve";
import { computeConsumptionForDayLogic } from "@/server/consumption";
import { getRecipeCostsLogic } from "@/server/recipe-cost";

describe("a draft recipe cannot reach the ledger (ADR 0025 Q4)", () => {
  let tenantA: string;
  let branchA: string;
  let userA: string;
  let batchId: string;
  let flour: ProductWithUnits;

  const today = computeBangkokToday();
  const FROM = addDays(today, -60);
  const DAY = addDays(today, -1);

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

  /** A published recipe, through the real write path. */
  const publish = (menuId: string, qty: number) =>
    createRecipeLogic(
      tenantA,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId,
        outputProductId: null,
        servings: 1,
        effectiveFrom: FROM,
        ingredients: [ing(flour, qty)],
        notes: null,
      }),
      userA
    );

  /**
   * A draft, written straight in. Deliberately NOT through the write path: this
   * spec is about what the readers refuse, and it must keep proving that even
   * if the draft-creating flow is later changed or replaced.
   */
  const draft = async (menuId: string, qty: number, plannedPrice?: number) =>
    withRlsBypass(async (tx) => {
      const lineId = randomUUID();
      const r = await tx.recipe.create({
        data: {
          id: randomUUID(),
          tenantId: tenantA,
          lineId,
          menuId,
          servings: 1,
          effectiveFrom: FROM,
          isDraft: true,
          plannedPrice: plannedPrice ?? null,
          createdBy: userA,
        },
        select: { id: true },
      });
      await tx.recipeIngredient.create({
        data: {
          tenantId: tenantA,
          recipeId: r.id,
          productId: flour.id,
          productUnitId: baseUnitOf(flour),
          qty,
          sortOrder: 0,
        },
      });
      return r;
    });

  const sell = (menuId: string, qty: number, net: number) =>
    withRlsBypass(async (tx) => {
      const day = await tx.salesDay.upsert({
        where: {
          branchId_businessDate: { branchId: branchA, businessDate: DAY },
        },
        create: {
          tenantId: tenantA,
          branchId: branchA,
          businessDate: DAY,
          currentBatchId: batchId,
        },
        update: {},
        select: { id: true },
      });
      await tx.salesLine.create({
        data: {
          tenantId: tenantA,
          branchId: branchA,
          businessDate: DAY,
          salesDayId: day.id,
          importBatchId: batchId,
          menuId,
          qty,
          grossAmount: net,
          discountAmount: 0,
          netAmount: net,
          serviceChargeAmount: 0,
          vatAmount: 0,
        },
      });
    });

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Draft Isolation Tenant" } });
      tenantA = t.id;
      const b = await tx.branch.create({
        data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" },
      });
      branchA = b.id;
      const u = await tx.user.create({
        data: { email: `draft-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;

      // sales_line's FKs to a batch and a day are NOT NULL, so the chain has to
      // exist even though nothing here reads it.
      const integ = await tx.posIntegration.create({
        data: { tenantId: t.id, branchId: b.id, posType: "CUSTOM", name: "POS" },
        select: { id: true },
      });
      const prof = await tx.salesImportProfile.create({
        data: {
          tenantId: t.id,
          posIntegrationId: integ.id,
          name: "รายวัน",
          fileKind: "DAILY_SUMMARY",
          dateFormat: "yyyy-MM-dd",
          columnMap: {},
          headerSignature: "x",
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
      batchId = batch.id;
    });

    flour = await createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `DRAFT-flour-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
      })
    );
  }, 120_000);

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.salesConsumptionItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesConsumptionRun.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockMovement.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeIngredient.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeBranch.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipe.updateMany({
        where: { tenantId: tenantA },
        data: { supersededById: null },
      });
      await tx.recipe.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesLine.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesDay.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportBatch.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportProfile.deleteMany({ where: { tenantId: tenantA } });
      // menu before posIntegration, or menu_source_check refuses the SET NULL.
      await tx.menu.deleteMany({ where: { tenantId: tenantA } });
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

  it("G1: the resolver — the single route to the ledger — does not see a draft", async () => {
    const menu = await makeMenu("G1");
    await draft(menu.id, 5);

    const resolved = await resolveRecipeIds(
      prisma,
      tenantA,
      [{ kind: "menu", id: menu.id }],
      branchA,
      DAY
    );

    // Not "resolves to something else" — resolves to nothing at all.
    expect(resolved.has(`menu:${menu.id}`)).toBe(false);
  });

  it("G2: a draft does not block publishing a real recipe for the same menu", async () => {
    const menu = await makeMenu("G2");
    await draft(menu.id, 5);

    // Without the filter in liveLinesFor this throws RecipeAlreadyExistsError,
    // and drafting a change to a dish that sells would be impossible.
    const real = await publish(menu.id, 2);
    expect(real.id).toBeTruthy();
    expect(real.isDraft).toBe(false);

    const resolved = await resolveRecipeIds(
      prisma,
      tenantA,
      [{ kind: "menu", id: menu.id }],
      branchA,
      DAY
    );
    expect(resolved.get(`menu:${menu.id}`)?.id).toBe(real.id);
  });

  it("G3: posting a day treats a menu that has only a draft as having no recipe", async () => {
    const menu = await makeMenu("G3");
    await draft(menu.id, 5);
    await sell(menu.id, 3, 300);

    const demand = await computeConsumptionForDayLogic(prisma, tenantA, {
      branchId: branchA,
      businessDate: DAY,
      cancelledSalePolicy: "TREAT_AS_COOKED",
    });

    // Nothing of the draft's flour is demanded...
    expect(demand.lines.find((l) => l.productId === flour.id)).toBeUndefined();
    // ...and the dish is reported as skipped, not silently dropped: a menu the
    // shop is still designing must look unposted, not look finished.
    expect(demand.skipped.some((s) => s.menuId === menu.id)).toBe(true);
  });

  it("G4: a set menu does not cost its component from that component's draft", async () => {
    // The path that actually reaches the resolver from a COST read. Costing a
    // recipe by id uses that id verbatim as the root (see getRecipeCostsLogic),
    // so a draft on the same menu could never have been picked up there — an
    // earlier version of this test asserted that and passed with the filter
    // removed, which is to say it tested nothing.
    //
    // A COMPONENT is different: `loadRecipeGraph` must resolve the component
    // menu's own recipe, and that is a real resolution that a draft could win.
    const component = await makeMenu("G4-part");
    await draft(component.id, 20); // the only recipe the component has

    const set = await makeMenu("G4-set");
    const setRecipe = await createRecipeLogic(
      tenantA,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId: set.id,
        outputProductId: null,
        servings: 1,
        effectiveFrom: FROM,
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
        notes: null,
      }),
      userA
    );

    const costs = await getRecipeCostsLogic(tenantA, {
      recipeIds: [setRecipe.id],
      branchId: branchA,
    });
    const cost = costs.get(setRecipe.id);

    expect(cost).toBeDefined();

    // Assert on WHAT could not be priced, not on the money. Flour has never
    // been purchased, so the total is 0 and the confidence LOW either way —
    // an earlier version of this test asserted exactly that and passed with the
    // filter removed, which is to say it tested nothing. The two worlds differ
    // in the REASON: with the draft ignored the set is missing a component
    // recipe; with the draft resolved it would be missing flour's price.
    const unpriced = cost!.unpriced;
    expect(unpriced.map((u) => ({ kind: u.kind, id: u.id, reason: u.reason })))
      .toEqual([{ kind: "menu", id: component.id, reason: "NO_RECIPE" }]);

    // And the draft's flour never entered the walk at all.
    expect(cost!.leaves.some((l) => l.productId === flour.id)).toBe(false);
  });
});
