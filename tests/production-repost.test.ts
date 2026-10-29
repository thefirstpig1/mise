// ============================================================
// Mise — a late or voided production re-posts the days it changes (ADR 0040 Q5)
// ============================================================
// A day posted while the soup shelf was empty cut the bones. When the soup is
// then recorded as made the day before, that day must be re-posted to take
// the soup instead — and when the production is voided, re-posted back.
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
import { postConsumptionForDayLogic } from "@/server/consumption-post";
import { createProductionInputSchema } from "@/lib/validations/production";
import { recordProductionLogic, voidProductionAndRepostLogic } from "@/server/production";
import { voidProductionInputSchema } from "@/lib/validations/production";
import { sweepTestTenants } from "./support/sweep";

describe("re-posting after a late or voided production (ADR 0040 Q5)", () => {
  let tenant: string;
  let user: string;
  let branch: string;
  let batchId: string;

  const today = computeBangkokToday();
  const RECIPES_FROM = addDays(today, -60);

  const product = (tag: string, type: "RAW" | "PREPPED", base: "kg" | "l") =>
    createProductLogic(
      tenant,
      productInputSchema.parse({
        name: `PF-${tag}-${randomUUID().slice(0, 6)}`,
        type,
        primaryDimension: base === "kg" ? "WEIGHT" : "VOLUME",
        baseUnitName: base,
      })
    );
  const unit = (p: ProductWithUnits) => p.productUnits.find((u) => u.isBase)!.id;

  const menu = (name: string) =>
    withRlsBypass((tx) =>
      tx.menu.create({
        data: { tenantId: tenant, source: "MISE", name: `${name}-${randomUUID().slice(0, 4)}` },
        select: { id: true },
      })
    );

  const recipe = (
    target: { menuId: string } | { outputProductId: string; servings: number },
    lines: [ProductWithUnits, number][]
  ) =>
    createRecipeLogic(
      tenant,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId: "menuId" in target ? target.menuId : null,
        outputProductId: "outputProductId" in target ? target.outputProductId : null,
        servings: "servings" in target ? target.servings : 1,
        effectiveFrom: RECIPES_FROM,
        ingredients: lines.map(([p, qty], i) => ({
          productId: p.id,
          componentMenuId: null,
          qty,
          productUnitId: unit(p),
          sortOrder: i,
          notes: null,
        })),
        notes: null,
      }),
      user
    );

  const stock = (p: ProductWithUnits, qty: number) =>
    createStockAdjustmentLogic(
      tenant,
      createStockAdjustmentInputSchema.parse({
        submitKey: randomUUID(),
        productId: p.id,
        branchId: branch,
        type: "ADJUST_GAIN",
        reason: "RECOUNT",
        inputQty: qty,
        inputUnitId: unit(p),
        occurredAt: addDays(new Date(), -20),
        notes: null,
      }),
      user
    );

  const sell = (businessDate: Date, menuId: string, qty: number) =>
    withRlsBypass(async (tx) => {
      const day = await tx.salesDay.upsert({
        where: { branchId_businessDate: { branchId: branch, businessDate } },
        create: { tenantId: tenant, branchId: branch, businessDate, currentBatchId: batchId },
        update: {},
        select: { id: true },
      });
      await tx.salesLine.create({
        data: {
          tenantId: tenant,
          branchId: branch,
          businessDate,
          salesDayId: day.id,
          importBatchId: batchId,
          menuId,
          qty,
          grossAmount: qty * 50,
          discountAmount: 0,
          netAmount: qty * 50,
          serviceChargeAmount: 0,
          vatAmount: 0,
        },
      });
    });

  const post = (businessDate: Date) =>
    postConsumptionForDayLogic(
      tenant,
      { submitKey: randomUUID(), branchId: branch, businessDate, acknowledgeRepost: false },
      user
    );

  const produce = (input: ProductWithUnits, inQty: number, output: ProductWithUnits, outQty: number, producedOn: Date) =>
    recordProductionLogic(
      tenant,
      createProductionInputSchema.parse({
        submitKey: randomUUID(),
        branchId: branch,
        kind: "PRODUCE",
        producedOn,
        inputs: [{ productId: input.id, inputQty: inQty, inputUnitId: unit(input) }],
        outputs: [{ productId: output.id, inputQty: outQty, inputUnitId: unit(output) }],
      }),
      user
    );

  const balance = async (p: ProductWithUnits) =>
    (await getStockBalanceLogic(tenant, { productId: p.id, branchId: branch })).balance.toNumber();

  const shortfallsOf = (runId: string) =>
    withRlsBypass((tx) =>
      tx.preppedShortfall.findMany({ where: { salesConsumptionRunId: runId }, select: { productId: true, qty: true } })
    );

  /** A fresh soup world: bones → soup (20 L per 8 kg), and a noodle using 0.5 L. */
  const world = async (tag: string) => {
    const bones = await product(`${tag}-bones`, "RAW", "kg");
    const soup = await product(`${tag}-soup`, "PREPPED", "l");
    await recipe({ outputProductId: soup.id, servings: 20 }, [[bones, 8]]);
    const noodle = await menu(`${tag}-noodle`);
    await recipe({ menuId: noodle.id }, [[soup, 0.5]]);
    await stock(bones, 50);
    return { bones, soup, noodle };
  };

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Production Repost Tenant", staffMealStockSource: "SYSTEM" } });
      tenant = t.id;
      const b = await tx.branch.create({ data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" } });
      branch = b.id;
      const u = await tx.user.create({ data: { email: `rp-${randomUUID()}@example.com`, name: "เชฟ" } });
      user = u.id;
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
  });

  afterAll(async () => {
    await sweepTestTenants(prismaBypass, { ids: [tenant] });
    await withRlsBypass((tx) => tx.user.deleteMany({ where: { id: user } }));
  });

  it("R1: soup recorded late is taken by the day that cut the bones instead", async () => {
    const { bones, soup, noodle } = await world("R1");
    const day = addDays(today, -3);
    await sell(day, noodle.id, 10); // 5 L
    const first = await post(day);
    expect((await shortfallsOf(first.run.id))[0].qty.toNumber()).toBe(5);
    expect(await balance(bones)).toBe(48);

    const { production, reposted } = await produce(bones, 8, soup, 20, addDays(day, -1));
    expect(reposted.map((r) => r.outcome)).toEqual(["REPOSTED"]);
    expect(await balance(soup)).toBe(15);
    expect(await balance(bones)).toBe(42); // the day's 2 kg went back; 8 kg made the soup

    // R2 on the same world: voiding the production puts the day back on the bones.
    const undone = await voidProductionAndRepostLogic(
      tenant,
      voidProductionInputSchema.parse({ id: production.id, reason: "บันทึกผิด" }),
      user
    );
    expect(undone.reposted.map((r) => r.outcome)).toEqual(["REPOSTED"]);
    expect(await balance(soup)).toBe(0);
    expect(await balance(bones)).toBe(48);
  });

  it("R3: two days share a late batch oldest first, and the shelf never goes below zero", async () => {
    const { bones, soup, noodle } = await world("R3");
    const d1 = addDays(today, -6);
    const d2 = addDays(today, -5);
    await sell(d1, noodle.id, 10); // 5 L
    await sell(d2, noodle.id, 10); // 5 L
    await post(d1);
    await post(d2);
    const { reposted } = await produce(bones, 2.4, soup, 6, addDays(d1, -1)); // 6 L
    expect(reposted.map((r) => r.businessDate.getTime())).toEqual([d1.getTime(), d2.getTime()]);
    expect(await balance(soup)).toBe(0);
    // d1 took 5 L, d2 took 1 L and cut 4 L from the bones (1.6 kg).
    expect(await balance(bones)).toBeCloseTo(50 - 2.4 - 1.6, 3);
  });
});
