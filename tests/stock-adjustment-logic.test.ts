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
  MovementSourceMismatchError,
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

  /**
   * Validated adjustment input — required fields with per-slice overrides.
   *
   * `submitKey` defaults to a FRESH uuid per call, so every slice that does not
   * care about idempotency behaves as it did before Part 13.5; W14 pins one
   * deliberately to replay it.
   */
  const adjInput = (over: Record<string, unknown>) =>
    createStockAdjustmentInputSchema.parse({
      submitKey: randomUUID(),
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
        tx.branch.create({ data: { tenantId: a.id, name: "ครัวกลาง", code: "MAIN" } }),
        tx.branch.create({ data: { tenantId: b.id, name: "B1", code: "MAIN" } }),
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

  it("W10: the primitive refuses a source type with no writer (SYSTEM_INITIAL, reserved)", async () => {
    // GR_LINE gained its writer in Part 13 and moved to W11; SYSTEM_INITIAL is
    // the one source type still reserved with no table behind it (ADR 0011 Q10).
    await expect(
      withTenantContext(tenantA, (tx) =>
        createStockMovementLogic(tx, {
          tenantId: tenantA,
          productId: prodSack.id,
          branchId: branchA,
          qty: new Prisma.Decimal(1),
          type: "PO_RECEIVE",
          sourceType: "SYSTEM_INITIAL",
          sourceId: randomUUID(),
          occurredAt: today,
          createdBy: userA,
        })
      )
    ).rejects.toThrow(UnsupportedSourceTypeError);
  });

  it("W11: GR_LINE is a known source type now, but the row still has to exist", async () => {
    // Part 13 added the branch to assertSourceExists. A GR_LINE id that resolves
    // to nothing must read as "source not found", NOT as "type unsupported" —
    // otherwise a genuine data-integrity bug would be reported as a missing feature.
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
    ).rejects.toThrow(MovementSourceNotFoundError);
  });

  it("W12: a replay whose numbers CHANGED is rejected, not silently reported as success", async () => {
    // The Part 10 review's third open item (ADR 0013 Consequence 4): the
    // idempotency lookup used to return on sourceId alone, so re-posting a
    // corrected quantity said "ok" while the ledger kept the old one.
    const first = await createStockAdjustmentLogic(
      tenantA,
      adjInput({
        productId: prodSack.id,
        inputQty: 2,
        inputUnitId: baseUnitId(prodSack),
      }),
      userA
    );

    // Same source, different qty → rejected.
    await expect(
      withTenantContext(tenantA, (tx) =>
        createStockMovementLogic(tx, {
          tenantId: tenantA,
          productId: prodSack.id,
          branchId: branchA,
          qty: new Prisma.Decimal(99),
          type: "ADJUST_GAIN",
          sourceType: "ADJUSTMENT",
          sourceId: first.adjustment.id,
          occurredAt: today,
          createdBy: userA,
        })
      )
    ).rejects.toThrow(MovementSourceMismatchError);

    // Same source, identical numbers → still an idempotent no-op (W7's guarantee).
    const replay = await withTenantContext(tenantA, (tx) =>
      createStockMovementLogic(tx, {
        tenantId: tenantA,
        productId: prodSack.id,
        branchId: branchA,
        qty: first.movement.qty,
        type: "ADJUST_GAIN",
        sourceType: "ADJUSTMENT",
        sourceId: first.adjustment.id,
        occurredAt: first.movement.occurredAt,
        createdBy: userA,
      })
    );
    expect(replay.id).toBe(first.movement.id);
  });

  it("W13: the source must belong to the same product as the movement", async () => {
    // assertSourceExists now reads the source's own product/branch. Without it,
    // a mis-wired caller could point a movement for product X at product Y's
    // adjustment row — and with no FK (Q3) nothing else would notice.
    const first = await createStockAdjustmentLogic(
      tenantA,
      adjInput({
        productId: prodSack.id,
        inputQty: 1,
        inputUnitId: baseUnitId(prodSack),
      }),
      userA
    );

    await expect(
      withTenantContext(tenantA, (tx) =>
        createStockMovementLogic(tx, {
          tenantId: tenantA,
          productId: prodOther.id, // ← not the adjustment's product
          branchId: branchA,
          qty: new Prisma.Decimal(1),
          type: "ADJUST_GAIN",
          sourceType: "ADJUSTMENT",
          sourceId: first.adjustment.id,
          occurredAt: today,
          createdBy: userA,
        })
      )
    ).rejects.toThrow(MovementSourceMismatchError);
  });

  // ----------------------------------------------------------
  // W14–W15 — submit-key idempotency at the PRODUCER (Part 13.5)
  // ----------------------------------------------------------
  // W7 proves the primitive is idempotent per (sourceType, sourceId). That
  // guarantee was unreachable from this producer while it minted the source id
  // itself: a double POST presented a new key and doubled the stock.

  it("W14: replaying one submitKey writes one adjustment and one movement", async () => {
    const before = await getStockBalanceLogic(
      tenantA,
      getStockBalanceQuerySchema.parse({
        productId: prodTiny.id,
        branchId: branchA,
      })
    );

    const input = adjInput({
      productId: prodTiny.id,
      inputQty: 7,
      inputUnitId: baseUnitId(prodTiny),
    });

    const first = await createStockAdjustmentLogic(tenantA, input, userA);
    const replay = await createStockAdjustmentLogic(tenantA, input, userA);

    expect(replay.adjustment.id).toBe(first.adjustment.id);
    expect(replay.movement.id).toBe(first.movement.id);
    expect(first.adjustment.id).toBe(input.submitKey); // the key IS the row id
    expect(dec(replay.postBalance)).toBe(dec(first.postBalance));

    // Counted at the DB, not inferred from the return value.
    const rows = await withTenantContext(tenantA, (tx) =>
      tx.stockMovement.count({
        where: { tenantId: tenantA, sourceId: input.submitKey },
      })
    );
    expect(rows).toBe(1);

    // The balance moved exactly once.
    const after = await getStockBalanceLogic(
      tenantA,
      getStockBalanceQuerySchema.parse({
        productId: prodTiny.id,
        branchId: branchA,
      })
    );
    expect(dec(after.balance.minus(before.balance))).toBe(7);
  });

  it("W15: two different keys with identical numbers are two adjustments", async () => {
    // The other half of the guarantee — deduping on the VALUES would break the
    // real workflow of counting the same item twice in one session.
    const before = await getStockBalanceLogic(
      tenantA,
      getStockBalanceQuerySchema.parse({
        productId: prodTiny.id,
        branchId: branchA,
      })
    );

    const shape = {
      productId: prodTiny.id,
      inputQty: 3,
      inputUnitId: baseUnitId(prodTiny),
    };
    const a = await createStockAdjustmentLogic(tenantA, adjInput(shape), userA);
    const b = await createStockAdjustmentLogic(tenantA, adjInput(shape), userA);

    expect(b.adjustment.id).not.toBe(a.adjustment.id);
    expect(b.movement.id).not.toBe(a.movement.id);

    const after = await getStockBalanceLogic(
      tenantA,
      getStockBalanceQuerySchema.parse({
        productId: prodTiny.id,
        branchId: branchA,
      })
    );
    expect(dec(after.balance.minus(before.balance))).toBe(6);
  });
});
