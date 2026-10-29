// ============================================================
// Mise — counting more prepped stock than the ledger holds (ADR 0040 Q2)
// ============================================================
// Counted soup the ledger never saw made was MADE: the close writes that
// production (origin STOCK_COUNT) instead of a "found" gain, and compares the
// bones against what is left after the soup used them. Counting below the
// ledger stays an ordinary loss. Voiding the count takes the production back.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass, prismaBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { recipeInputSchema } from "@/lib/validations/recipe";
import { createRecipeLogic } from "@/server/recipe";
import { createStockAdjustmentLogic, getStockBalanceLogic } from "@/server/stock-movement";
import { createStockAdjustmentInputSchema } from "@/lib/validations/stock-movement";
import { declareStockCostLogic } from "@/server/cost-declaration";
import { declareStockCostInputSchema } from "@/lib/validations/stock-cost";
import {
  closeStockCountInputSchema,
  openStockCountInputSchema,
  saveStockCountLineInputSchema,
  voidStockCountInputSchema,
} from "@/lib/validations/stock-count";
import {
  closeStockCountLogic,
  openStockCountLogic,
  saveStockCountLineLogic,
  voidStockCountLogic,
} from "@/server/stock-count";
import { getProductCostLogic } from "@/server/stock-cost";
import { getCountPreppedHintsLogic } from "@/server/production-read";
import { EVERY_BRANCH } from "./support/reach";
import { sweepTestTenants } from "./support/sweep";

describe("a count that finds prepped stock the ledger never saw made (ADR 0040 Q2)", () => {
  let tenant: string;
  let user: string;

  const today = computeBangkokToday();
  const actor = () => ({ userId: user, canCloseAny: true, reach: EVERY_BRANCH });

  const product = (tag: string, type: "RAW" | "PREPPED", base: "kg" | "l") =>
    createProductLogic(
      tenant,
      productInputSchema.parse({
        name: `CT-${tag}-${randomUUID().slice(0, 6)}`,
        type,
        primaryDimension: base === "kg" ? "WEIGHT" : "VOLUME",
        baseUnitName: base,
      })
    );
  const unit = (p: ProductWithUnits) => p.productUnits.find((u) => u.isBase)!.id;

  /** Each test gets its own branch: one open sheet per branch at a time. */
  const newBranch = () =>
    withRlsBypass((tx) =>
      tx.branch.create({
        data: { tenantId: tenant, name: `สาขา ${randomUUID().slice(0, 4)}`, code: `C${randomUUID().slice(0, 4).toUpperCase()}` },
        select: { id: true },
      })
    ).then((b) => b.id);

  const world = async (branchId: string, tag: string) => {
    const bones = await product(`${tag}-bones`, "RAW", "kg");
    const soup = await product(`${tag}-soup`, "PREPPED", "l");
    await createRecipeLogic(
      tenant,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId: null,
        outputProductId: soup.id,
        servings: 20,
        effectiveFrom: addDays(today, -60),
        ingredients: [
          { productId: bones.id, componentMenuId: null, qty: 8, productUnitId: unit(bones), sortOrder: 0, notes: null },
        ],
        notes: null,
      }),
      user
    );
    const { movement } = await createStockAdjustmentLogic(
      tenant,
      createStockAdjustmentInputSchema.parse({
        submitKey: randomUUID(),
        productId: bones.id,
        branchId,
        type: "ADJUST_GAIN",
        reason: "RECOUNT",
        inputQty: 50,
        inputUnitId: unit(bones),
        occurredAt: addDays(new Date(), -20),
        notes: null,
      }),
      user
    );
    await declareStockCostLogic(
      tenant,
      declareStockCostInputSchema.parse({ movementId: movement.id, unitCost: 50, unitId: unit(bones), note: "ทดสอบ" }),
      user
    );
    return { bones, soup };
  };

  const sheet = (branchId: string) =>
    openStockCountLogic(
      tenant,
      openStockCountInputSchema.parse({ branchId, countDate: today.toISOString().slice(0, 10), notes: null }),
      user
    );

  const count = (stockCountId: string, p: ProductWithUnits, qty: number) =>
    saveStockCountLineLogic(
      tenant,
      saveStockCountLineInputSchema.parse({
        stockCountId,
        productId: p.id,
        mode: "new",
        entries: [{ productUnitId: unit(p), qtyInUnit: qty }],
        notes: null,
      }),
      actor()
    );

  const close = (id: string) => closeStockCountLogic(tenant, closeStockCountInputSchema.parse({ id }), actor());

  const balance = async (p: ProductWithUnits, branchId: string) =>
    (await getStockBalanceLogic(tenant, { productId: p.id, branchId })).balance.toNumber();

  const madeBy = (countId: string) =>
    withRlsBypass((tx) =>
      tx.production.findMany({ where: { tenantId: tenant, originId: countId }, include: { items: true } })
    );

  const movementsOf = (p: ProductWithUnits) =>
    withRlsBypass((tx) =>
      tx.stockMovement.findMany({ where: { tenantId: tenant, productId: p.id }, select: { type: true, sourceType: true } })
    );

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      tenant = (await tx.tenant.create({ data: { name: "Production Count Tenant" } })).id;
      user = (await tx.user.create({ data: { email: `ct-${randomUUID()}@example.com`, name: "ผู้นับ" } })).id;
    });
  });

  afterAll(async () => {
    await sweepTestTenants(prismaBypass, { ids: [tenant] });
    await withRlsBypass((tx) => tx.user.deleteMany({ where: { id: user } }));
  });

  it("C1: soup counted above the ledger is a production, not a gain — inputs unconfirmed when not counted", async () => {
    const branch = await newBranch();
    const { bones, soup } = await world(branch, "C1");
    const sc = await sheet(branch);
    await count(sc.id, soup, 10);
    await close(sc.id);

    const made = await madeBy(sc.id);
    expect(made).toHaveLength(1);
    expect(made[0].origin).toBe("STOCK_COUNT");
    expect(made[0].inputsUnconfirmed).toBe(true); // the bones were not on the sheet
    expect(await balance(soup, branch)).toBe(10);
    expect(await balance(bones, branch)).toBe(46); // 10 L × 0.4 kg
    // No "found" soup: the soup arrived by production only.
    expect((await movementsOf(soup)).map((m) => m.type)).toEqual(["PRODUCTION_IN"]);
    // And it carries the bones' money, not zero.
    const cost = await getProductCostLogic(tenant, { productId: soup.id, branchId: branch });
    expect(cost.inventoryValue.toNumber()).toBe(200);
  });

  it("C2: bones counted on the same sheet are compared AFTER the soup used them", async () => {
    const branch = await newBranch();
    const { bones, soup } = await world(branch, "C2");
    const sc = await sheet(branch);
    await count(sc.id, soup, 10);
    await count(sc.id, bones, 45); // the ledger had 50; the soup used 4; 1 kg is missing

    // What the open sheet shows BEFORE closing must be what the close does:
    // "ledger 50 − 4 used for the soup" and "should have ~46 left".
    const [hint] = await getCountPreppedHintsLogic(tenant, sc.id);
    expect(hint.productId).toBe(soup.id);
    expect(hint.over).toBe(10);
    expect(hint.allUsed).toEqual([{ productId: bones.id, qty: 4 }]);
    expect(hint.inputs).toMatchObject([{ productId: bones.id, systemQty: 50, used: 4, left: 46, counted: 45 }]);

    await close(sc.id);

    const made = await madeBy(sc.id);
    expect(made[0].inputsUnconfirmed).toBe(false);
    expect(await balance(bones, branch)).toBe(45);
    const lines = await withRlsBypass((tx) =>
      tx.stockCountItem.findMany({ where: { stockCountId: sc.id, productId: bones.id } })
    );
    // The sheet reads "ledger 46 (50 − 4 made into soup), counted 45".
    expect(lines[0].qtyExpected.toNumber()).toBe(46);
  });

  it("C3: soup counted BELOW the ledger is an ordinary loss", async () => {
    const branch = await newBranch();
    const { soup } = await world(branch, "C3");
    const first = await sheet(branch);
    await count(first.id, soup, 10);
    await close(first.id);
    const second = await sheet(branch);
    await count(second.id, soup, 7);
    await close(second.id);
    expect(await madeBy(second.id)).toHaveLength(0);
    expect(await balance(soup, branch)).toBe(7);
  });

  it("C4: voiding the count takes its production back", async () => {
    const branch = await newBranch();
    const { bones, soup } = await world(branch, "C4");
    const sc = await sheet(branch);
    await count(sc.id, soup, 10);
    await close(sc.id);
    await voidStockCountLogic(
      tenant,
      voidStockCountInputSchema.parse({ id: sc.id, voidReason: "นับผิดถัง" }),
      actor()
    );
    const made = await madeBy(sc.id);
    expect(made[0].voidedAt).not.toBeNull();
    expect(await balance(soup, branch)).toBe(0);
    expect(await balance(bones, branch)).toBe(50);
  });
});
