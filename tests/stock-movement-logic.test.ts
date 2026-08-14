// ============================================================
// Mise — stock ledger READ *Logic integration tests (Sprint 2 Part 10 L3a)
// ============================================================
// Exercises src/server/stock-movement.ts against the real Neon DB through
// withTenantContext, keyed by tenantId (no auth mock) — same harness as
// tests/supplier-product-mapping-logic.test.ts. Tenant isolation is asserted at
// the APP LAYER (explicit tenantId filtering); RLS is inert until Sprint 7
// (ADR 0004).
//
// L3b (the write primitive) does not exist yet, so ledger rows are inserted
// DIRECTLY via admin context. That is deliberate: these are read tests, and
// hand-built fixtures let a slice pin exact `occurredAt`/`createdAt` instants —
// which is the only way to assert the (occurredAt, createdAt, id) total ordering
// the cursor pagination depends on.
//
// Every fixture row respects the DB CHECKs that ship with the ledger:
//   - stock_movement_sign_check  — ADJUST_LOSS < 0, ADJUST_GAIN / PO_RECEIVE > 0
//   - stock_movement_source_unique — one movement per (sourceType, sourceId)
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { withAdminContext, prisma } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import {
  getStockBalanceQuerySchema,
  getStockMovementHistoryQuerySchema,
} from "@/lib/validations/stock-movement";
import {
  getStockBalanceLogic,
  getStockBalancesByBranchLogic,
  getStockBalancesByProductLogic,
  getStockMovementHistoryLogic,
} from "@/server/stock-movement";

/** Decimal equality without caring about trailing zeros ("5" vs "5.000"). */
const dec = (d: Prisma.Decimal) => d.toNumber();

describe("stock-movement read *Logic (tenant-scoped, app-layer isolation)", () => {
  const today = computeBangkokToday();
  const day = (offset: number) => addDays(today, offset);

  let tenantA: string;
  let tenantB: string;
  let branchA1: string;
  let branchA2: string;
  let branchAGone: string; // soft-deleted branch that still holds stock
  let branchB: string;
  let userA: string;

  let prodMain: ProductWithUnits; // the multi-slice balance fixture
  let prodZero: ProductWithUnits; // live, never moved
  let prodGone: ProductWithUnits; // soft-deleted but still holding stock
  let prodB: ProductWithUnits; // tenant-B cross-tenant fixture

  const freshProduct = (tenant: string, tag: string): Promise<ProductWithUnits> =>
    createProductLogic(
      tenant,
      productInputSchema.parse({
        name: `SM-${tag}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
      })
    );

  /** Insert one ledger row with fully pinned timestamps. */
  const mv = (opts: {
    tenantId: string;
    productId: string;
    branchId: string;
    qty: number;
    type: "PO_RECEIVE" | "ADJUST_GAIN" | "ADJUST_LOSS";
    occurredAt: Date;
    createdAt?: Date;
    sourceType?: "GR_LINE" | "ADJUSTMENT" | "SYSTEM_INITIAL";
    sourceId?: string;
    notes?: string | null;
  }) =>
    withAdminContext((tx) =>
      tx.stockMovement.create({
        data: {
          tenantId: opts.tenantId,
          productId: opts.productId,
          branchId: opts.branchId,
          qty: new Prisma.Decimal(opts.qty),
          type: opts.type,
          sourceType: opts.sourceType ?? "ADJUSTMENT",
          sourceId: opts.sourceId ?? randomUUID(),
          occurredAt: opts.occurredAt,
          createdAt: opts.createdAt ?? opts.occurredAt,
          createdBy: userA,
          notes: opts.notes ?? null,
        },
      })
    );

  beforeAll(async () => {
    await withAdminContext(async (tx) => {
      const a = await tx.tenant.create({ data: { name: "Stock Test Tenant A" } });
      const b = await tx.tenant.create({ data: { name: "Stock Test Tenant B" } });
      tenantA = a.id;
      tenantB = b.id;

      const [a1, a2, gone, bb] = await Promise.all([
        tx.branch.create({ data: { tenantId: a.id, name: "A1 ครัวกลาง" } }),
        tx.branch.create({ data: { tenantId: a.id, name: "A2 หน้าร้าน" } }),
        tx.branch.create({
          data: { tenantId: a.id, name: "A3 สาขาปิด", deletedAt: new Date() },
        }),
        tx.branch.create({ data: { tenantId: b.id, name: "B1" } }),
      ]);
      branchA1 = a1.id;
      branchA2 = a2.id;
      branchAGone = gone.id;
      branchB = bb.id;

      const u = await tx.user.create({
        data: { email: `stock-test-${randomUUID()}@example.com`, name: "ผู้ทดสอบ" },
      });
      userA = u.id;
    });

    // Names are prefixed so the by-branch ORDER BY name is deterministic.
    prodMain = await freshProduct(tenantA, "1-main");
    prodZero = await freshProduct(tenantA, "2-zero");
    prodGone = await freshProduct(tenantA, "3-gone");
    prodB = await freshProduct(tenantB, "B-cross");
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
  // S1–S5 — getStockBalanceLogic
  // ----------------------------------------------------------

  it("S1: empty ledger = balance 0, no last movement, count 0", async () => {
    const bal = await getStockBalanceLogic(
      tenantA,
      getStockBalanceQuerySchema.parse({
        productId: prodZero.id,
        branchId: branchA1,
      })
    );

    expect(dec(bal.balance)).toBe(0);
    expect(bal.lastMovementAt).toBeNull();
    expect(bal.movementCount).toBe(0);
  });

  it("S2: balance = SUM of signed qty; lastMovementAt = latest occurredAt", async () => {
    await mv({
      tenantId: tenantA,
      productId: prodMain.id,
      branchId: branchA1,
      qty: 10,
      type: "PO_RECEIVE",
      sourceType: "GR_LINE",
      occurredAt: day(-3),
    });
    await mv({
      tenantId: tenantA,
      productId: prodMain.id,
      branchId: branchA1,
      qty: 2.5,
      type: "ADJUST_GAIN",
      occurredAt: day(-2),
    });
    await mv({
      tenantId: tenantA,
      productId: prodMain.id,
      branchId: branchA1,
      qty: -4,
      type: "ADJUST_LOSS",
      occurredAt: day(-1),
    });

    const bal = await getStockBalanceLogic(
      tenantA,
      getStockBalanceQuerySchema.parse({
        productId: prodMain.id,
        branchId: branchA1,
      })
    );

    expect(dec(bal.balance)).toBe(8.5);
    expect(bal.lastMovementAt?.getTime()).toBe(day(-1).getTime());
    expect(bal.movementCount).toBe(3);
  });

  it("S3: asOf is inclusive of the whole day and excludes later rows", async () => {
    // A same-day row with a TIME component — the midnight-expansion rule must
    // still include it when asOf is that (date-only) day.
    await mv({
      tenantId: tenantA,
      productId: prodMain.id,
      branchId: branchA1,
      qty: 1,
      type: "ADJUST_GAIN",
      occurredAt: new Date(day(-2).getTime() + 10 * 3600 * 1000),
    });

    const asOfD2 = await getStockBalanceLogic(
      tenantA,
      getStockBalanceQuerySchema.parse({
        productId: prodMain.id,
        branchId: branchA1,
        asOf: day(-2),
      })
    );
    // 10 (d-3) + 2.5 (d-2 midnight) + 1 (d-2 10:00) — the d-1 loss is excluded.
    expect(dec(asOfD2.balance)).toBe(13.5);
    expect(asOfD2.movementCount).toBe(3);

    const asOfD3 = await getStockBalanceLogic(
      tenantA,
      getStockBalanceQuerySchema.parse({
        productId: prodMain.id,
        branchId: branchA1,
        asOf: day(-3),
      })
    );
    expect(dec(asOfD3.balance)).toBe(10);

    const asOfD4 = await getStockBalanceLogic(
      tenantA,
      getStockBalanceQuerySchema.parse({
        productId: prodMain.id,
        branchId: branchA1,
        asOf: day(-4),
      })
    );
    expect(dec(asOfD4.balance)).toBe(0);
    expect(asOfD4.movementCount).toBe(0);
  });

  it("S4: balance is per-branch — the same product in another branch is separate", async () => {
    await mv({
      tenantId: tenantA,
      productId: prodMain.id,
      branchId: branchA2,
      qty: 7,
      type: "ADJUST_GAIN",
      occurredAt: day(-1),
    });

    const a1 = await getStockBalanceLogic(
      tenantA,
      getStockBalanceQuerySchema.parse({
        productId: prodMain.id,
        branchId: branchA1,
      })
    );
    const a2 = await getStockBalanceLogic(
      tenantA,
      getStockBalanceQuerySchema.parse({
        productId: prodMain.id,
        branchId: branchA2,
      })
    );

    expect(dec(a1.balance)).toBe(9.5); // S2's 8.5 + S3's +1
    expect(dec(a2.balance)).toBe(7);
  });

  it("S5: another tenant's ledger is invisible (explicit tenantId filter)", async () => {
    await mv({
      tenantId: tenantB,
      productId: prodB.id,
      branchId: branchB,
      qty: 99,
      type: "ADJUST_GAIN",
      occurredAt: day(-1),
    });

    // Tenant A asking for tenant B's (product, branch) sees an empty ledger.
    const leak = await getStockBalanceLogic(
      tenantA,
      getStockBalanceQuerySchema.parse({
        productId: prodB.id,
        branchId: branchB,
      })
    );
    expect(dec(leak.balance)).toBe(0);
    expect(leak.movementCount).toBe(0);

    const own = await getStockBalanceLogic(
      tenantB,
      getStockBalanceQuerySchema.parse({
        productId: prodB.id,
        branchId: branchB,
      })
    );
    expect(dec(own.balance)).toBe(99);
  });

  // ----------------------------------------------------------
  // S6–S8 — the grid reads
  // ----------------------------------------------------------

  it("S6: by-branch lists every live product, including never-moved ones at 0", async () => {
    const rows = await getStockBalancesByBranchLogic(tenantA, branchA1);
    const byId = new Map(rows.map((r) => [r.productId, r]));

    const main = byId.get(prodMain.id);
    expect(dec(main!.balance)).toBe(9.5);
    expect(main!.product.baseUnitName).toBe("kg");
    expect(main!.product.deleted).toBe(false);

    const zero = byId.get(prodZero.id);
    expect(zero).toBeDefined();
    expect(dec(zero!.balance)).toBe(0);
    expect(zero!.movementCount).toBe(0);
    expect(zero!.lastMovementAt).toBeNull();

    // Sorted by product name (SM-1-main < SM-2-zero < SM-3-gone).
    const names = rows.map((r) => r.product.name);
    expect([...names].sort()).toEqual(names);

    // No tenant-B product leaks in.
    expect(byId.has(prodB.id)).toBe(false);
  });

  it("S7: by-branch keeps a soft-deleted product that still holds stock, flagged", async () => {
    await mv({
      tenantId: tenantA,
      productId: prodGone.id,
      branchId: branchA1,
      qty: 3,
      type: "ADJUST_GAIN",
      occurredAt: day(-1),
    });
    await withAdminContext((tx) =>
      tx.product.update({
        where: { id: prodGone.id },
        data: { deletedAt: new Date() },
      })
    );

    const rows = await getStockBalancesByBranchLogic(tenantA, branchA1);
    const gone = rows.find((r) => r.productId === prodGone.id);

    expect(gone).toBeDefined();
    expect(gone!.product.deleted).toBe(true);
    expect(dec(gone!.balance)).toBe(3);
  });

  it("S8: by-product lists every live branch plus a deleted branch holding stock", async () => {
    await mv({
      tenantId: tenantA,
      productId: prodMain.id,
      branchId: branchAGone,
      qty: 5,
      type: "ADJUST_GAIN",
      occurredAt: day(-1),
    });

    const rows = await getStockBalancesByProductLogic(tenantA, prodMain.id);
    const byBranch = new Map(rows.map((r) => [r.branchId, r]));

    expect(dec(byBranch.get(branchA1)!.balance)).toBe(9.5);
    expect(dec(byBranch.get(branchA2)!.balance)).toBe(7);
    expect(byBranch.get(branchA1)!.branch.deleted).toBe(false);

    const gone = byBranch.get(branchAGone);
    expect(gone).toBeDefined();
    expect(gone!.branch.deleted).toBe(true);
    expect(dec(gone!.balance)).toBe(5);

    expect(byBranch.has(branchB)).toBe(false);
  });

  // ----------------------------------------------------------
  // S9–S13 — getStockMovementHistoryLogic
  // ----------------------------------------------------------

  it("S9: history is newest-first on (occurredAt, createdAt, id)", async () => {
    const page = await getStockMovementHistoryLogic(
      tenantA,
      getStockMovementHistoryQuerySchema.parse({
        productId: prodMain.id,
        branchId: branchA1,
      })
    );

    const occurred = page.rows.map((r) => r.occurredAt.getTime());
    expect([...occurred].sort((a, b) => b - a)).toEqual(occurred);
    expect(page.rows[0].occurredAt.getTime()).toBe(day(-1).getTime());
    expect(page.rows.every((r) => r.product.id === prodMain.id)).toBe(true);
    expect(page.rows[0].product.baseUnitName).toBe("kg");
    expect(page.rows[0].branch.id).toBe(branchA1);
    expect(page.rows[0].createdBy.id).toBe(userA);
    expect(page.nextCursor).toBeNull();
  });

  it("S10: history filters by type, sourceType and an inclusive date range", async () => {
    const losses = await getStockMovementHistoryLogic(
      tenantA,
      getStockMovementHistoryQuerySchema.parse({
        productId: prodMain.id,
        type: "ADJUST_LOSS",
      })
    );
    expect(losses.rows.length).toBe(1);
    expect(dec(losses.rows[0].qty)).toBe(-4);

    const fromGr = await getStockMovementHistoryLogic(
      tenantA,
      getStockMovementHistoryQuerySchema.parse({
        productId: prodMain.id,
        sourceType: "GR_LINE",
      })
    );
    expect(fromGr.rows.length).toBe(1);
    expect(fromGr.rows[0].type).toBe("PO_RECEIVE");

    // dateFrom/dateTo are inclusive on both ends — day(-2) catches the midnight
    // row AND the 10:00 row of that same day.
    const window = await getStockMovementHistoryLogic(
      tenantA,
      getStockMovementHistoryQuerySchema.parse({
        productId: prodMain.id,
        branchId: branchA1,
        dateFrom: day(-2),
        dateTo: day(-2),
      })
    );
    expect(window.rows.length).toBe(2);
    expect(
      window.rows.every(
        (r) =>
          r.occurredAt.getTime() >= day(-2).getTime() &&
          r.occurredAt.getTime() < day(-1).getTime()
      )
    ).toBe(true);
  });

  it("S11: cursor pagination walks the ledger with no gaps or repeats", async () => {
    const all = await getStockMovementHistoryLogic(
      tenantA,
      getStockMovementHistoryQuerySchema.parse({ productId: prodMain.id })
    );
    expect(all.rows.length).toBe(6); // 4 in A1 + 1 in A2 + 1 in the closed branch

    const seen: string[] = [];
    let cursor: string | null = null;
    let guard = 0;

    do {
      const page: Awaited<ReturnType<typeof getStockMovementHistoryLogic>> =
        await getStockMovementHistoryLogic(
          tenantA,
          getStockMovementHistoryQuerySchema.parse({
            productId: prodMain.id,
            limit: 2,
            ...(cursor ? { cursor } : {}),
          })
        );
      seen.push(...page.rows.map((r) => r.id));
      cursor = page.nextCursor;
    } while (cursor && ++guard < 10);

    expect(seen).toEqual(all.rows.map((r) => r.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("S12: an ADJUSTMENT row resolves its polymorphic source; a GR_LINE row does not", async () => {
    const adjustmentId = randomUUID();
    await withAdminContext((tx) =>
      tx.stockAdjustment.create({
        data: {
          id: adjustmentId,
          tenantId: tenantA,
          productId: prodMain.id,
          branchId: branchA2,
          type: "ADJUST_LOSS",
          reason: "SPOILAGE",
          inputQty: new Prisma.Decimal(2),
          inputUnitId: prodMain.productUnits[0].id,
          occurredAt: today,
          createdBy: userA,
        },
      })
    );
    await mv({
      tenantId: tenantA,
      productId: prodMain.id,
      branchId: branchA2,
      qty: -2,
      type: "ADJUST_LOSS",
      occurredAt: today,
      sourceType: "ADJUSTMENT",
      sourceId: adjustmentId,
      notes: "ของเสียจากตู้เย็นเสีย",
    });

    const page = await getStockMovementHistoryLogic(
      tenantA,
      getStockMovementHistoryQuerySchema.parse({
        productId: prodMain.id,
        branchId: branchA2,
      })
    );

    const resolved = page.rows.find((r) => r.sourceId === adjustmentId);
    expect(resolved).toBeDefined();
    expect(resolved!.notes).toBe("ของเสียจากตู้เย็นเสีย");
    expect(resolved!.adjustment).toEqual({
      id: adjustmentId,
      reason: "SPOILAGE",
      inputQty: expect.anything(),
      inputUnitName: "kg",
    });
    expect(dec(resolved!.adjustment!.inputQty)).toBe(2);

    const gr = await getStockMovementHistoryLogic(
      tenantA,
      getStockMovementHistoryQuerySchema.parse({
        productId: prodMain.id,
        sourceType: "GR_LINE",
      })
    );
    expect(gr.rows[0].adjustment).toBeNull();
  });

  it("S13: history never crosses tenants", async () => {
    const fromA = await getStockMovementHistoryLogic(
      tenantA,
      getStockMovementHistoryQuerySchema.parse({ productId: prodB.id })
    );
    expect(fromA.rows.length).toBe(0);

    const fromB = await getStockMovementHistoryLogic(
      tenantB,
      getStockMovementHistoryQuerySchema.parse({})
    );
    expect(fromB.rows.length).toBe(1);
    expect(dec(fromB.rows[0].qty)).toBe(99);
  });
});
