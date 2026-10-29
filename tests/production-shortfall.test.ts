// ============================================================
// Mise — prepped stock used beyond the shelf was made, unrecorded (ADR 0040 Q9)
// ============================================================
// Waste, a write-down, a transfer and a staff pot all NAME the prepped product.
// When the shelf cannot cover it, the system writes the production nobody
// recorded, so the named product leaves in full at the bones' price and the
// shelf never goes below zero.
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
import { createWasteInputSchema } from "@/lib/validations/waste";
import { createWasteLogic } from "@/server/waste";
import { dispatchTransferInputSchema } from "@/lib/validations/transfer";
import { dispatchTransferLogic } from "@/server/transfer";
import { createStaffMealInputSchema } from "@/lib/validations/staff-meal";
import { createStaffMealLogic } from "@/server/staff-meal";
import { getProductCostLogic } from "@/server/stock-cost";
import { sweepTestTenants } from "./support/sweep";

describe("using prepped stock beyond the shelf (ADR 0040 Q9)", () => {
  let tenant: string;
  let user: string;
  let branch: string;
  let branch2: string;

  const today = computeBangkokToday();

  const product = (tag: string, type: "RAW" | "PREPPED", base: "kg" | "l") =>
    createProductLogic(
      tenant,
      productInputSchema.parse({
        name: `SF-${tag}-${randomUUID().slice(0, 6)}`,
        type,
        primaryDimension: base === "kg" ? "WEIGHT" : "VOLUME",
        baseUnitName: base,
      })
    );
  const unit = (p: ProductWithUnits) => p.productUnits.find((u) => u.isBase)!.id;

  const adjust = (p: ProductWithUnits, type: "ADJUST_GAIN" | "ADJUST_LOSS", qty: number, at = addDays(new Date(), -20)) =>
    createStockAdjustmentLogic(
      tenant,
      createStockAdjustmentInputSchema.parse({
        submitKey: randomUUID(),
        productId: p.id,
        branchId: branch,
        type,
        reason: type === "ADJUST_GAIN" ? "RECOUNT" : "OTHER",
        inputQty: qty,
        inputUnitId: unit(p),
        occurredAt: at,
        notes: null,
      }),
      user
    );

  /** Bones at ฿50/kg; soup made 20 L per 8 kg of bones. */
  const world = async (tag: string) => {
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
    const { movement } = await adjust(bones, "ADJUST_GAIN", 50);
    await declareStockCostLogic(
      tenant,
      declareStockCostInputSchema.parse({ movementId: movement.id, unitCost: 50, unitId: unit(bones), note: "ทดสอบ" }),
      user
    );
    return { bones, soup };
  };

  const balance = async (p: ProductWithUnits, b = branch) =>
    (await getStockBalanceLogic(tenant, { productId: p.id, branchId: b })).balance.toNumber();

  const productionsFor = (originId: string) =>
    withRlsBypass((tx) =>
      tx.production.findMany({ where: { tenantId: tenant, originId }, include: { items: true } })
    );

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Shortfall Production Tenant", staffMealStockSource: "SYSTEM" } });
      tenant = t.id;
      branch = (await tx.branch.create({ data: { tenantId: t.id, name: "ครัวกลาง", code: "CK" } })).id;
      branch2 = (await tx.branch.create({ data: { tenantId: t.id, name: "อารีย์", code: "ARY" } })).id;
      user = (await tx.user.create({ data: { email: `sf-${randomUUID()}@example.com`, name: "เชฟ" } })).id;
    });
  });

  afterAll(async () => {
    await sweepTestTenants(prismaBypass, { ids: [tenant] });
    await withRlsBypass((tx) => tx.user.deleteMany({ where: { id: user } }));
  });

  it("Q9-1: throwing away soup nobody recorded making writes the production first", async () => {
    const { bones, soup } = await world("W");
    const { waste } = await createWasteLogic(
      tenant,
      createWasteInputSchema.parse({
        submitKey: randomUUID(),
        productId: soup.id,
        branchId: branch,
        reason: "SPOILED",
        inputQty: 5,
        inputUnitId: unit(soup),
        occurredAt: new Date(),
        wastedByName: null,
        departmentId: null,
        notes: null,
      }),
      user
    );
    const made = await productionsFor(waste.id);
    expect(made).toHaveLength(1);
    expect(made[0].origin).toBe("WASTE");
    expect(await balance(soup)).toBe(0); // made 5, wasted 5 — never below zero
    expect(await balance(bones)).toBe(48); // 5 L × 0.4 kg
  });

  it("Q9-2: soup that IS on the shelf is simply thrown away — no production", async () => {
    const { soup } = await world("W2");
    await adjust(soup, "ADJUST_GAIN", 10);
    const { waste } = await createWasteLogic(
      tenant,
      createWasteInputSchema.parse({
        submitKey: randomUUID(),
        productId: soup.id,
        branchId: branch,
        reason: "SPOILED",
        inputQty: 4,
        inputUnitId: unit(soup),
        occurredAt: new Date(),
        wastedByName: null,
        departmentId: null,
        notes: null,
      }),
      user
    );
    expect(await productionsFor(waste.id)).toHaveLength(0);
    expect(await balance(soup)).toBe(6);
  });

  it("Q9-3: a write-down beyond the shelf writes the production too", async () => {
    const { bones, soup } = await world("A");
    const { adjustment } = await adjust(soup, "ADJUST_LOSS", 2.5, new Date());
    const made = await productionsFor(adjustment.id);
    expect(made[0].origin).toBe("ADJUSTMENT");
    expect(await balance(soup)).toBe(0);
    expect(await balance(bones)).toBe(49);
  });

  it("Q9-4: soup sent beyond the central kitchen's shelf arrives priced by the bones", async () => {
    const { bones, soup } = await world("T");
    const submitKey = randomUUID();
    const tf = await dispatchTransferLogic(
      tenant,
      dispatchTransferInputSchema.parse({
        submitKey,
        fromBranchId: branch,
        toBranchId: branch2,
        dispatchedAt: new Date(),
        dispatchedByName: null,
        driverName: null,
        driverConfirmed: false,
        notes: null,
        lines: [{ productId: soup.id, qtySent: 10, inputUnitId: unit(soup), notes: null }],
      }),
      user
    );
    const made = await productionsFor(submitKey);
    expect(made[0].origin).toBe("TRANSFER");
    expect(await balance(soup)).toBe(0);
    expect(await balance(bones)).toBe(46);
    // 10 L = 4 kg bones × ฿50 = ฿200, frozen onto the line and arriving with it.
    expect(tf.items[0].costTotal.abs().toNumber()).toBe(200);
    const atAry = await getProductCostLogic(tenant, { productId: soup.id, branchId: branch2 });
    expect(atAry.inventoryValue.toNumber()).toBe(200);
  });

  it("Q9-5: a staff pot of soup takes the shelf first and cuts the bones for the rest", async () => {
    const { bones, soup } = await world("P");
    await adjust(soup, "ADJUST_GAIN", 1);
    const meal = await createStaffMealLogic(
      tenant,
      createStaffMealInputSchema.parse({
        submitKey: randomUUID(),
        branchId: branch,
        businessDate: today,
        staffMemberId: null,
        menuId: null,
        servings: 1,
        items: [{ productId: soup.id, inputQty: 3, inputUnitId: unit(soup) }],
        recordedByName: null,
        notes: null,
      }),
      user
    );
    expect(await balance(soup)).toBe(0);
    expect(await balance(bones)).toBeCloseTo(49.2, 3); // 2 L short × 0.4
    const sf = await withRlsBypass((tx) => tx.preppedShortfall.findMany({ where: { staffMealId: meal.id } }));
    expect(sf[0].qty.toNumber()).toBe(2);
  });

  it("Q9-6: a prepped product with no way to make it leaves as itself, like a raw one", async () => {
    const sauce = await product("jar", "PREPPED", "kg");
    const { waste } = await createWasteLogic(
      tenant,
      createWasteInputSchema.parse({
        submitKey: randomUUID(),
        productId: sauce.id,
        branchId: branch,
        reason: "SPOILED",
        inputQty: 1,
        inputUnitId: unit(sauce),
        occurredAt: new Date(),
        wastedByName: null,
        departmentId: null,
        notes: null,
      }),
      user
    );
    expect(await productionsFor(waste.id)).toHaveLength(0);
    expect(await balance(sauce)).toBe(-1);
  });
});
