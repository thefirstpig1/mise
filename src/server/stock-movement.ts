// ============================================================
// Mise — Stock ledger READ logic (Sprint 2 Part 10 L3a; ADR 0011)
// ============================================================
// Same shape as src/server/{product,supplier-product-mapping}.ts: every fn takes
// `tenantId` FIRST, runs inside withTenantContext, and filters `tenantId`
// EXPLICITLY (app-layer isolation is the live guard; RLS is inert until Sprint 7
// — ADR 0004).
//
// This file is READ-ONLY by design. The ledger is strictly append-only (Q7), so
// there is no update*/delete* here — and no create* either: the write primitive
// (`createStockMovementLogic`) + its adjustment wrapper are L3b.
//
// Balance = realtime `SUM(qty)` with NO join and NO ratio math (Q1/Q8): every
// row is already stored signed and in the product's base unit, so a later edit
// to `ProductUnit.toBaseRatio` cannot retro-change history. The composite
// `stock_movement_chronological_idx` (productId, branchId, occurredAt, createdAt)
// serves both the balance SUM (leftmost prefix) and the ordered history read.
//
// Decimal values stay `Prisma.Decimal` here; the string conversion for Client
// Components is the L5 view serializer's job (Pitfall #20).
//
// A cross-tenant / unknown id is NOT an error on a read path — the tenantId
// filter simply yields an empty ledger (balance 0). Ownership assertions belong
// to the WRITE path (L3b), where accepting a foreign id would corrupt data.
// ============================================================

import { Prisma } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import type {
  GetStockBalanceQuery,
  GetStockMovementHistoryQuery,
} from "@/lib/validations/stock-movement";

const DAY_MS = 86_400_000;
const ZERO = new Prisma.Decimal(0);

/**
 * Turn an inclusive `asOf` / `dateTo` bound into the EXCLUSIVE upper bound the
 * query uses (`occurredAt < bound`).
 *
 * A date-only value (UTC midnight — what `z.coerce.date()` produces from a
 * `<input type="date">`, and what Bangkok day values look like per
 * `computeBangkokToday`) means the WHOLE day, so it expands by 24h. Anything
 * with a time component is treated as a precise instant and is made inclusive
 * by 1ms — this matters once Part 13 writes GR movements at real timestamps.
 */
const exclusiveUpperBound = (inclusive: Date): Date =>
  inclusive.getTime() % DAY_MS === 0
    ? new Date(inclusive.getTime() + DAY_MS)
    : new Date(inclusive.getTime() + 1);

/** `occurredAt` filter fragment for an optional inclusive range. */
const occurredAtFilter = (
  from?: Date,
  to?: Date
): Prisma.DateTimeFilter | undefined => {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: from } : {}),
    ...(to ? { lt: exclusiveUpperBound(to) } : {}),
  };
};

// ------------------------------------------------------------
// Balance reads
// ------------------------------------------------------------

/**
 * The ledger position for one (product, branch) pair.
 *
 * `movementCount` distinguishes the two ways a balance can be 0 — "nothing ever
 * moved" vs "moved in and back out" — which the L5b dashboard renders
 * differently (blank vs an explicit 0).
 */
export type StockBalance = {
  productId: string;
  branchId: string;
  balance: Prisma.Decimal;
  lastMovementAt: Date | null;
  movementCount: number;
};

/** A balance row carrying the product identity the stock-levels grid labels by. */
export type ProductStockBalance = StockBalance & {
  product: {
    id: string;
    name: string;
    sku: string;
    type: string;
    primaryDimension: string;
    /** Unit the `balance` is expressed in (the product's base unit, Q1). */
    baseUnitName: string | null;
    /** true = soft-deleted but still holding stock — surfaced, never hidden. */
    deleted: boolean;
  };
};

/** A balance row carrying the branch identity (the per-product breakdown). */
export type BranchStockBalance = StockBalance & {
  branch: { id: string; name: string; code: string | null; deleted: boolean };
};

const PRODUCT_SELECT = {
  id: true,
  name: true,
  sku: true,
  type: true,
  primaryDimension: true,
  deletedAt: true,
  productUnits: { where: { isBase: true }, select: { unitName: true } },
} as const;

const BRANCH_SELECT = {
  id: true,
  name: true,
  code: true,
  deletedAt: true,
} as const;

/**
 * Balance for ONE (product, branch), optionally as of a past date (Q8 time
 * travel). Input must already be parsed by `getStockBalanceQuerySchema`.
 */
export async function getStockBalanceLogic(
  tenantId: string,
  query: GetStockBalanceQuery
): Promise<StockBalance> {
  const { productId, branchId, asOf } = query;

  return withTenantContext(tenantId, async (tx) => {
    const agg = await tx.stockMovement.aggregate({
      where: {
        tenantId,
        productId,
        branchId,
        ...(asOf ? { occurredAt: { lt: exclusiveUpperBound(asOf) } } : {}),
      },
      _sum: { qty: true },
      _max: { occurredAt: true },
      _count: { _all: true },
    });

    return {
      productId,
      branchId,
      // _sum is null on an empty match — a ledger with no rows is a 0 balance,
      // not "unknown".
      balance: agg._sum.qty ?? ZERO,
      lastMovementAt: agg._max.occurredAt ?? null,
      movementCount: agg._count._all,
    };
  });
}

/**
 * Every product's balance in ONE branch — the L5b stock-levels grid.
 *
 * The row set is the union of (a) all LIVE products of the tenant, so a product
 * that has never moved still shows a 0, and (b) any product that HAS ledger rows
 * in this branch even if soft-deleted — deleting a product must never make its
 * remaining stock silently vanish from the grid (flagged `product.deleted`).
 */
export async function getStockBalancesByBranchLogic(
  tenantId: string,
  branchId: string,
  asOf?: Date
): Promise<ProductStockBalance[]> {
  return withTenantContext(tenantId, async (tx) => {
    const groups = await tx.stockMovement.groupBy({
      by: ["productId"],
      where: {
        tenantId,
        branchId,
        ...(asOf ? { occurredAt: { lt: exclusiveUpperBound(asOf) } } : {}),
      },
      _sum: { qty: true },
      _max: { occurredAt: true },
      _count: { _all: true },
    });

    const byProductId = new Map(groups.map((g) => [g.productId, g]));

    const products = await tx.product.findMany({
      where: {
        tenantId,
        OR: [{ deletedAt: null }, { id: { in: [...byProductId.keys()] } }],
      },
      select: PRODUCT_SELECT,
      orderBy: [{ name: "asc" }],
    });

    return products.map((p) => {
      const g = byProductId.get(p.id);
      return {
        productId: p.id,
        branchId,
        balance: g?._sum.qty ?? ZERO,
        lastMovementAt: g?._max.occurredAt ?? null,
        movementCount: g?._count._all ?? 0,
        product: {
          id: p.id,
          name: p.name,
          sku: p.sku,
          type: p.type,
          primaryDimension: p.primaryDimension,
          baseUnitName: p.productUnits[0]?.unitName ?? null,
          deleted: p.deletedAt !== null,
        },
      };
    });
  });
}

/**
 * One product's balance across every branch — the per-product breakdown on the
 * product detail page. Mirrors the by-branch union rule: all live branches, plus
 * any soft-deleted branch still holding rows.
 */
export async function getStockBalancesByProductLogic(
  tenantId: string,
  productId: string,
  asOf?: Date
): Promise<BranchStockBalance[]> {
  return withTenantContext(tenantId, async (tx) => {
    const groups = await tx.stockMovement.groupBy({
      by: ["branchId"],
      where: {
        tenantId,
        productId,
        ...(asOf ? { occurredAt: { lt: exclusiveUpperBound(asOf) } } : {}),
      },
      _sum: { qty: true },
      _max: { occurredAt: true },
      _count: { _all: true },
    });

    const byBranchId = new Map(groups.map((g) => [g.branchId, g]));

    const branches = await tx.branch.findMany({
      where: {
        tenantId,
        OR: [{ deletedAt: null }, { id: { in: [...byBranchId.keys()] } }],
      },
      select: BRANCH_SELECT,
      orderBy: [{ name: "asc" }],
    });

    return branches.map((b) => {
      const g = byBranchId.get(b.id);
      return {
        productId,
        branchId: b.id,
        balance: g?._sum.qty ?? ZERO,
        lastMovementAt: g?._max.occurredAt ?? null,
        movementCount: g?._count._all ?? 0,
        branch: {
          id: b.id,
          name: b.name,
          code: b.code,
          deleted: b.deletedAt !== null,
        },
      };
    });
  });
}

// ------------------------------------------------------------
// History read
// ------------------------------------------------------------

/**
 * One ledger row plus the identities the L5c viewer renders.
 *
 * `adjustment` is the resolved polymorphic source (Q3): there is no FK to follow,
 * so ADJUSTMENT rows are resolved in ONE batched second query and attached here.
 * It stays null for other source types (GR_LINE resolution is Part 13's).
 */
export type StockMovementHistoryRow = {
  id: string;
  qty: Prisma.Decimal;
  type: string;
  sourceType: string;
  sourceId: string;
  occurredAt: Date;
  createdAt: Date;
  notes: string | null;
  product: { id: string; name: string; sku: string; baseUnitName: string | null };
  branch: { id: string; name: string };
  createdBy: { id: string; name: string | null; email: string };
  adjustment: {
    id: string;
    reason: string;
    inputQty: Prisma.Decimal;
    inputUnitName: string;
  } | null;
};

export type StockMovementHistoryPage = {
  rows: StockMovementHistoryRow[];
  /** Feed straight back as `cursor`; null = last page. */
  nextCursor: string | null;
};

/**
 * The ledger feed, newest first, cursor-paginated.
 *
 * Ordering is `(occurredAt, createdAt, id)` DESC — the same tuple the cost engine
 * (Part 14) walks ASC, with `id` appended so the sort is TOTAL. That matters for
 * cursor pagination: two rows sharing an instant would otherwise be free to swap
 * places between pages and get skipped or duplicated.
 *
 * Input must already be parsed by `getStockMovementHistoryQuerySchema` (which
 * supplies the `limit` default).
 */
export async function getStockMovementHistoryLogic(
  tenantId: string,
  query: GetStockMovementHistoryQuery
): Promise<StockMovementHistoryPage> {
  const {
    productId,
    branchId,
    type,
    sourceType,
    dateFrom,
    dateTo,
    limit,
    cursor,
  } = query;

  return withTenantContext(tenantId, async (tx) => {
    const occurredAt = occurredAtFilter(dateFrom, dateTo);

    // One extra row is the cheapest has-more probe: no COUNT over the ledger.
    const fetched = await tx.stockMovement.findMany({
      where: {
        tenantId,
        ...(productId ? { productId } : {}),
        ...(branchId ? { branchId } : {}),
        ...(type ? { type } : {}),
        ...(sourceType ? { sourceType } : {}),
        ...(occurredAt ? { occurredAt } : {}),
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            productUnits: { where: { isBase: true }, select: { unitName: true } },
          },
        },
        branch: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = fetched.length > limit;
    const page = hasMore ? fetched.slice(0, limit) : fetched;

    // Resolve the ADJUSTMENT sources in one round trip (Q3: no FK to include).
    const adjustmentIds = page
      .filter((m) => m.sourceType === "ADJUSTMENT")
      .map((m) => m.sourceId);

    const adjustments = adjustmentIds.length
      ? await tx.stockAdjustment.findMany({
          where: { tenantId, id: { in: adjustmentIds } },
          select: {
            id: true,
            reason: true,
            inputQty: true,
            inputUnit: { select: { unitName: true } },
          },
        })
      : [];

    const byAdjustmentId = new Map(adjustments.map((a) => [a.id, a]));

    return {
      rows: page.map((m) => {
        const adj =
          m.sourceType === "ADJUSTMENT"
            ? byAdjustmentId.get(m.sourceId)
            : undefined;
        return {
          id: m.id,
          qty: m.qty,
          type: m.type,
          sourceType: m.sourceType,
          sourceId: m.sourceId,
          occurredAt: m.occurredAt,
          createdAt: m.createdAt,
          notes: m.notes,
          product: {
            id: m.product.id,
            name: m.product.name,
            sku: m.product.sku,
            baseUnitName: m.product.productUnits[0]?.unitName ?? null,
          },
          branch: { id: m.branch.id, name: m.branch.name },
          createdBy: {
            id: m.createdByUser.id,
            name: m.createdByUser.name,
            email: m.createdByUser.email,
          },
          adjustment: adj
            ? {
                id: adj.id,
                reason: adj.reason,
                inputQty: adj.inputQty,
                inputUnitName: adj.inputUnit.unitName,
              }
            : null,
        };
      }),
      // The cursor is the LAST row of this page (Prisma re-anchors with skip: 1).
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  });
}
