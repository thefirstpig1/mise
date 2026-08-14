// ============================================================
// Mise — stock ledger WRITE *Logic integration tests (Sprint 2 Part 10 L3b)
// ============================================================
// Covers the two write layers in src/server/stock-movement.ts against the real
// Neon DB: `createStockAdjustmentLogic` (the only Part 10 producer of ledger
// rows) and the `createStockMovementLogic` primitive underneath it.
//
// The primitive is exercised DIRECTLY for the guards a well-formed adjustment
// can never reach — sign mismatch, a source that does not exist, a source type
// with no writer yet, and the (sourceType, sourceId) idempotency retry. Those
// are exactly the paths Part 13's GR will hit.
//
// Tenant isolation is app-layer (explicit tenantId filtering); RLS is inert
// until Sprint 7 (ADR 0004).
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { withAdminContext, withTenantContext, prisma } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import {
  createProductLogic,
  CrossTenantReferenceError,
  type ProductWithUnits,
} from "@/server/product";
import { createStockAdjustmentInputSchema } from "@/lib/validations/stock-movement";
import {
  createStockAdjustmentLogic,
  createStockMovementLogic,
  findStockMovementBySourceLogic,
  getStockBalanceLogic,
  MovementSignMismatchError,
  MovementSourceNotFoundError,
  QtyRoundsToZeroError,
  StockUnitMismatchError,
  UnsupportedSourceTypeError,
} from "@/server/stock-movement";
import { getStockBalanceQuerySchema } from "@/lib/validations/stock-movement";

const dec = (d: Prisma.Decimal) => d.toNumber();

describe("stock adjustment write *Logic (append-only ledger, ADR 0011)", () => {
  const today = computeBangkokToday();
  const day = (offset: number) => addDays(today, offset);

  let tenantA: string;
  let tenantB: string;
  let branchA: string;
  let branchB: string;
  let userA: string;

  let prodSack: ProductWithUnits; // kg base + กระสอบ (×25)
  let prodTiny: ProductWithUnits; // kg base + mg (×0.000001)
  let prodOther: ProductWithUnits; // unit-mismatch fixture
  let prodB: ProductWithUnits; // tenant-B fixture

  const unitId = (p: ProductWithUnits, name: string): string => {
    const u = p.productUnits.find((x) => x.unitName === name);
    if (!u) throw new Error(`fixture missing unit ${name}`);
    return u.id;
  };
  const baseUnitId = (p: ProductWithUnits): string =>
    p.productUnits.find((u) => u.isBase)!.id;

  /** Validated adjustment input — required fields with per-slice overrides. */
  const adjInput = (over: Record<string, unknown>) =>
    createStockAdjustmentInputSchema.parse({
      branchId: branchA,
      type: "ADJUST_GAIN",
      reason: "RECOUNT",
      occurredAt: today,
      notes: null,
      ...over,
    });

  beforeAll(async () => {
    await withAdminContext(async (tx) => {
      const a = await tx.tenant.create({ data: { name: "Adjust Test Tenant A" } });
      const b = await tx.tenant.create({ data: { name: "Adjust Test Tenant B" } });
      tenantA = a.id;
      tenantB = b.id;
      const [ba, bb] = await Promise.all([
        tx.branch.create({ data: { tenantId: a.id, name: "ครัวกลาง" } }),
        tx.branch.create({ data: { tenantId: b.id, name: "B1" } }),
      ]);
      branchA = ba.id;
      branchB = bb.id;
      const u = await tx.user.create({
        data: { email: `adjust-test-${randomUUID()}@example.com`, name: "ผู้ทดสอบ" },
      });
      userA = u.id;
    });

    prodSack = await createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: "ADJ ข้าวสาร",
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [{ unitName: "กระสอบ", toBaseRatio: 25 }],
      })
    );
    prodTiny = await createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: "ADJ ผงฟู",
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [{ unitName: "mg", toBaseRatio: 0.000001 }],
      })
    );
    prodOther = await createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: "ADJ น้ำตาล",
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
      })
    );
    prodB = await createProductLogic(
      tenantB,
      productInputSchema.parse({
        name: "ADJ B-cross",
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
      })
    );
  });

  afterAll(async () => {
    const ids = [tenantA, tenantB];
    await withAdminContext(async (tx) => {
      await tx.stockMovement.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.stockAdjustment.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.productUnit.deleteMany({
        where: { product: { tenantId: { in: ids } } },
      });
      await tx.product.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.branch.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.tenant.deleteMany({ where: { id: { in: ids } } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
    await prisma.$disconnect();
  });

  // ----------------------------------------------------------
  // W1–W3 — the happy paths
  // ----------------------------------------------------------

  it("W1: a base-unit gain writes source + movement in one tx and returns postBalance", async () => {
    const res = await createStockAdjustmentLogic(
      tenantA,
      adjInput({
        productId: prodSack.id,
        inputQty: 12.5,
        inputUnitId: baseUnitId(prodSack),
      }),
      userA
    );

    expect(dec(res.movement.qty)).toBe(12.5);
    expect(res.movement.type).toBe("ADJUST_GAIN");
    expect(res.movement.sourceType).toBe("ADJUSTMENT");
    // The movement points at the adjustment written in the same tx (Q4).
    expect(res.movement.sourceId).toBe(res.adjustment.id);
    expect(res.movement.occurredAt.getTime()).toBe(today.getTime());
    expect(res.movement.createdBy).toBe(userA);
    expect(dec(res.adjustment.inputQty)).toBe(12.5);
    expect(res.adjustment.reason).toBe("RECOUNT");
    expect(dec(res.postBalance)).toBe(12.5);
  });

  it("W2: a non-base unit converts by toBaseRatio; the adjustment keeps the as-entered qty", async () => {
    const res = await createStockAdjustmentLogic(
      tenantA,
      adjInput({
        productId: prodSack.id,
        inputQty: 2,
        inputUnitId: unitId(prodSack, "กระสอบ"),
        occurredAt: day(-5), // backdating within the 90-day window
      }),
      userA
    );

    expect(dec(res.movement.qty)).toBe(50); // 2 × 25 kg
    expect(dec(res.adjustment.inputQty)).toBe(2); // as entered, for audit (Q1)
    expect(res.adjustment.inputUnitId).toBe(unitId(prodSack, "กระสอบ"));
    expect(res.movement.occurredAt.getTime()).toBe(day(-5).getTime());
    expect(dec(res.postBalance)).toBe(62.5); // 12.5 + 50
  });

  it("W3: a loss is stored negative and may drive the balance below zero (Q9)", async () => {
    const res = await createStockAdjustmentLogic(
      tenantA,
      adjInput({
        productId: prodOther.id,
        type: "ADJUST_LOSS",
        reason: "SPOILAGE",
        inputQty: 3,
        inputUnitId: baseUnitId(prodOther),
        notes: "ของเสียจากตู้เย็นเสีย",
      }),
      userA
    );

    // Nothing was ever received for prodOther — a loss takes it negative and the
    // logic returns it rather than blocking.
    expect(dec(res.movement.qty)).toBe(-3);
    expect(res.movement.notes).toBe("ของเสียจากตู้เย็นเสีย");
    expect(dec(res.postBalance)).toBe(-3);

    const bal = await getStockBalanceLogic(
      tenantA,
      getStockBalanceQuerySchema.parse({
        productId: prodOther.id,
        branchId: branchA,
      })
    );
    expect(dec(bal.balance)).toBe(-3);
  });

  // ----------------------------------------------------------
  // W4–W6 — the write-path guards
  // ----------------------------------------------------------

  it("W4: rejects a cross-tenant product or branch", async () => {
    await expect(
      createStockAdjustmentLogic(
        tenantA,
        adjInput({
          productId: prodB.id,
          inputQty: 1,
          inputUnitId: baseUnitId(prodB),
        }),
        userA
      )
    ).rejects.toThrow(CrossTenantReferenceError);

    await expect(
      createStockAdjustmentLogic(
        tenantA,
        adjInput({
          productId: prodSack.id,
          branchId: branchB,
          inputQty: 1,
          inputUnitId: baseUnitId(prodSack),
        }),
        userA
      )
    ).rejects.toThrow(CrossTenantReferenceError);
  });

  it("W5: rejects a unit that belongs to a different product", async () => {
    await expect(
      createStockAdjustmentLogic(
        tenantA,
        adjInput({
          productId: prodSack.id,
          inputQty: 1,
          inputUnitId: baseUnitId(prodOther), // valid unit, wrong product
        }),
        userA
      )
    ).rejects.toThrow(StockUnitMismatchError);
  });

  it("W6: rejects a qty that rounds to zero in the base unit, writing nothing", async () => {
    await expect(
      createStockAdjustmentLogic(
        tenantA,
        adjInput({
          productId: prodTiny.id,
          inputQty: 0.001, // 0.001 mg = 1e-9 kg → 0.000 at scale 3
          inputUnitId: unitId(prodTiny, "mg"),
        }),
        userA
      )
    ).rejects.toThrow(QtyRoundsToZeroError);

    // The whole tx rolled back — no orphan source row (Q4).
    const rows = await withAdminContext((tx) =>
      tx.stockAdjustment.count({ where: { productId: prodTiny.id } })
    );
    expect(rows).toBe(0);

    // A qty that survives the rounding goes through.
    const ok = await createStockAdjustmentLogic(
      tenantA,
      adjInput({
        productId: prodTiny.id,
        inputQty: 2000,
        inputUnitId: unitId(prodTiny, "mg"),
      }),
      userA
    );
    expect(dec(ok.movement.qty)).toBe(0.002);
  });

  // ----------------------------------------------------------
  // W7–W10 — the primitive, direct (the paths GR will hit in Part 13)
  // ----------------------------------------------------------

  it("W7: the primitive is idempotent per (sourceType, sourceId)", async () => {
    const first = await createStockAdjustmentLogic(
      tenantA,
      adjInput({
        productId: prodOther.id,
        inputQty: 4,
        inputUnitId: baseUnitId(prodOther),
      }),
      userA
    );

    // The source→movement lookup the retry path uses after a doomed tx.
    const found = await findStockMovementBySourceLogic(
      tenantA,
      "ADJUSTMENT",
      first.adjustment.id
    );
    expect(found?.id).toBe(first.movement.id);
    expect(
      await findStockMovementBySourceLogic(tenantA, "ADJUSTMENT", randomUUID())
    ).toBeNull();

    // Replay the SAME source — a retry after a lost response, or a double submit.
    const replay = await withTenantContext(tenantA, (tx) =>
      createStockMovementLogic(tx, {
        tenantId: tenantA,
        productId: prodOther.id,
        branchId: branchA,
        qty: new Prisma.Decimal(4),
        type: "ADJUST_GAIN",
        sourceType: "ADJUSTMENT",
        sourceId: first.adjustment.id,
        occurredAt: today,
        createdBy: userA,
      })
    );

    expect(replay.id).toBe(first.movement.id);
    const count = await withAdminContext((tx) =>
      tx.stockMovement.count({
        where: { sourceType: "ADJUSTMENT", sourceId: first.adjustment.id },
      })
    );
    expect(count).toBe(1);

    // The replay did NOT double the stock: -3 (W3) + 4 = 1.
    const bal = await getStockBalanceLogic(
      tenantA,
      getStockBalanceQuerySchema.parse({
        productId: prodOther.id,
        branchId: branchA,
      })
    );
    expect(dec(bal.balance)).toBe(1);
  });

  it("W8: the primitive rejects a sign that contradicts the type", async () => {
    const adjustmentId = (
      await createStockAdjustmentLogic(
        tenantA,
        adjInput({
          productId: prodSack.id,
          inputQty: 1,
          inputUnitId: baseUnitId(prodSack),
        }),
        userA
      )
    ).adjustment.id;

    await expect(
      withTenantContext(tenantA, (tx) =>
        createStockMovementLogic(tx, {
          tenantId: tenantA,
          productId: prodSack.id,
          branchId: branchA,
          qty: new Prisma.Decimal(-5), // negative on an inbound type
          type: "ADJUST_GAIN",
          sourceType: "ADJUSTMENT",
          sourceId: adjustmentId,
          occurredAt: today,
          createdBy: userA,
        })
      )
    ).rejects.toThrow(MovementSignMismatchError);

    // Zero fails too — it satisfies neither branch of the CHECK.
    await expect(
      withTenantContext(tenantA, (tx) =>
        createStockMovementLogic(tx, {
          tenantId: tenantA,
          productId: prodSack.id,
          branchId: branchA,
          qty: new Prisma.Decimal(0),
          type: "ADJUST_LOSS",
          sourceType: "ADJUSTMENT",
          sourceId: adjustmentId,
          occurredAt: today,
          createdBy: userA,
        })
      )
    ).rejects.toThrow(MovementSignMismatchError);
  });

  it("W9: the primitive refuses a source that does not exist (no FK backs it — Q3)", async () => {
    await expect(
      withTenantContext(tenantA, (tx) =>
        createStockMovementLogic(tx, {
          tenantId: tenantA,
          productId: prodSack.id,
          branchId: branchA,
          qty: new Prisma.Decimal(1),
          type: "ADJUST_GAIN",
          sourceType: "ADJUSTMENT",
          sourceId: randomUUID(),
          occurredAt: today,
          createdBy: userA,
        })
      )
    ).rejects.toThrow(MovementSourceNotFoundError);
  });

  it("W10: the primitive refuses a source type with no writer yet (GR_LINE → Part 13)", async () => {
    await expect(
      withTenantContext(tenantA, (tx) =>
        createStockMovementLogic(tx, {
          tenantId: tenantA,
          productId: prodSack.id,
          branchId: branchA,
          qty: new Prisma.Decimal(1),
          type: "PO_RECEIVE",
          sourceType: "GR_LINE",
          sourceId: randomUUID(),
          occurredAt: today,
          createdBy: userA,
        })
      )
    ).rejects.toThrow(UnsupportedSourceTypeError);
  });
});
