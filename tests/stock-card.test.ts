// Rules SC-BAL / SC-VALUE (Kong 2026-10-25): the stock card's balance brought
// forward, the balance after every row, and a closing figure that equals the
// live balance.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { createStockAdjustmentLogic, getStockBalanceLogic } from "@/server/stock-movement";
import { createStockAdjustmentInputSchema } from "@/lib/validations/stock-movement";
import { getStockCardLogic } from "@/server/stock-card";

describe("stock card", () => {
  let tenantA: string;
  let branchA: string;
  let userA: string;
  let p: ProductWithUnits;
  const today = computeBangkokToday();

  const adjust = (type: "ADJUST_GAIN" | "ADJUST_LOSS", qty: number, daysAgo: number, unitCost?: number) =>
    createStockAdjustmentLogic(
      tenantA,
      createStockAdjustmentInputSchema.parse({
        submitKey: randomUUID(),
        productId: p.id,
        branchId: branchA,
        type,
        reason: "OTHER",
        inputQty: qty,
        inputUnitId: p.productUnits.find((u) => u.isBase)!.id,
        occurredAt: addDays(today, -daysAgo),
        notes: "card test",
        costDeclaration: unitCost !== undefined ? { unitCost, unitId: p.productUnits.find((u) => u.isBase)!.id, note: null } : null,
      }),
      userA
    );

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Stock Card Tenant" } });
      tenantA = t.id;
      branchA = (await tx.branch.create({ data: { tenantId: t.id, name: "อารีย์", code: "ARI" } })).id;
      userA = (await tx.user.create({ data: { email: `card-${randomUUID()}@example.com` } })).id;
    });
    p = await createProductLogic(
      tenantA,
      productInputSchema.parse({ name: `CARD-${randomUUID().slice(0, 6)}`, primaryDimension: "WEIGHT", baseUnitName: "kg", additionalUnits: [] })
    );
    await adjust("ADJUST_GAIN", 10, 20, 100); // before the window: brought forward
    await adjust("ADJUST_GAIN", 5, 5, 100);
    await adjust("ADJUST_LOSS", 3, 3);
    await adjust("ADJUST_LOSS", 1.5, 1);
  }, 120_000);

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.stockCostDeclaration.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockMovement.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockAdjustment.deleteMany({ where: { tenantId: tenantA } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId: tenantA } } });
      await tx.product.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.deleteMany({ where: { id: tenantA } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
  });

  it("SC1: opening is everything before the window; each row carries the balance after it; closing = live balance", async () => {
    const card = await getStockCardLogic(tenantA, { productId: p.id, branchId: branchA, from: addDays(today, -10), to: today, withCost: true });
    expect(card).not.toBeNull();
    expect(card!.opening).toBe(10);
    expect(card!.rows.map((r) => [r.qty, r.balance])).toEqual([
      [5, 15],
      [-3, 12],
      [-1.5, 10.5],
    ]);
    expect(card!.closing).toBe(10.5);
    expect(card!.totalIn).toBe(5);
    expect(card!.totalOut).toBe(4.5);
    const live = await getStockBalanceLogic(tenantA, { productId: p.id, branchId: branchA });
    expect(Number(live.balance)).toBe(card!.closing);
  });

  it("SC2: outgoing rows carry their FIFO baht, incoming rows none; without the cost ticket nothing", async () => {
    const card = await getStockCardLogic(tenantA, { productId: p.id, branchId: branchA, from: addDays(today, -10), to: today, withCost: true });
    expect(card!.rows.map((r) => r.value)).toEqual([null, 300, 150]);
    const blind = await getStockCardLogic(tenantA, { productId: p.id, branchId: branchA, from: addDays(today, -10), to: today, withCost: false });
    expect(blind!.rows.every((r) => r.value === null)).toBe(true);
  });
});
