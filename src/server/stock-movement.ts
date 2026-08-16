// ============================================================
// Mise — Stock ledger READ logic (Sprint 2 Part 10 L3a; ADR 0011)
// ============================================================
// Same shape as src/server/{product,supplier-product-mapping}.ts: every fn takes
// `tenantId` FIRST, runs inside withTenantContext, and filters `tenantId`
// EXPLICITLY (app-layer isolation is the live guard; RLS is inert until Sprint 7
// — ADR 0004).
//
// The ledger is strictly append-only (Q7): this file has reads (L3a) and INSERTs
// (L3b), and deliberately NO update*/delete* — a correction is a compensating
// row through the same write path, never a mutation (Q4).
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

import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  MovementType,
  SourceType,
  StockAdjustment,
  StockMovement,
} from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import {
  bangkokDayEndUtc,
  bangkokDayStartUtc,
  isDayValue,
} from "@/lib/bangkok-date";
import { assertRefBelongsToTenant } from "@/server/product";
import { writeCostDeclaration } from "@/server/cost-declaration";
import type {
  CreateStockAdjustmentInput,
  GetStockBalanceQuery,
  GetStockMovementHistoryQuery,
} from "@/lib/validations/stock-movement";

const ZERO = new Prisma.Decimal(0);

/**
 * Turn an inclusive `asOf` / `dateTo` bound into the EXCLUSIVE upper bound the
 * query uses (`occurredAt < bound`).
 *
 * A date-only value (UTC midnight — what `z.coerce.date()` produces from an
 * `<input type="date">`, and what Bangkok day values look like per
 * `computeBangkokToday`) names a whole **Bangkok** business day, so it expands to
 * that day's end in UTC (`day − 7h + 24h`). Anything with a time component is a
 * precise instant and is made inclusive by 1ms.
 *
 * **Part 13 correction (ADR 0013 Q4).** This used to expand by a flat 24h from
 * the UTC midnight, which was self-consistent only while every `occurred_at` was
 * itself a date-only value. A GR writes real timestamps, so "balance ณ วันนี้"
 * would otherwise have reached to 07:00 Bangkok tomorrow, and a 06:00 delivery
 * would have landed on the previous business day. Decision #60.
 */
const exclusiveUpperBound = (inclusive: Date): Date =>
  isDayValue(inclusive)
    ? bangkokDayEndUtc(inclusive)
    : new Date(inclusive.getTime() + 1);

/** Mirror of the above for the lower bound: a day value starts at Bangkok 00:00. */
const inclusiveLowerBound = (inclusive: Date): Date =>
  isDayValue(inclusive) ? bangkokDayStartUtc(inclusive) : inclusive;

/**
 * `occurredAt` filter fragment for an optional inclusive range.
 *
 * Exported for Part 14's cost reads: they slice the same ledger on the same
 * business days, and a second implementation of Bangkok day bounds is exactly
 * how Decision #60 gets re-broken.
 */
export const occurredAtFilter = (
  from?: Date,
  to?: Date
): Prisma.DateTimeFilter | undefined => {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: inclusiveLowerBound(from) } : {}),
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
 * `adjustment` / `goodsReceipt` are the resolved polymorphic source (Q3): there
 * is no FK to follow, so each source type is resolved in ONE batched second query
 * and attached here. Exactly one of them is non-null on any given row.
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
  /**
   * The GR line behind a PO_RECEIVE / PO_RECEIVE_REVERSAL row (Part 13). Carries
   * the document number rather than just the line, because "GR-0007" is what the
   * user has on paper — a line id means nothing to them.
   */
  goodsReceipt: {
    lineId: string;
    goodsReceiptId: string;
    grNumber: string;
    supplierName: string;
    invoiceNo: string | null;
    poNumber: string | null;
    /** As-received magnitude + unit, the mirror of `adjustment.inputQty`. */
    qtyReceivedActual: Prisma.Decimal;
    receivedUnitName: string;
    isReversal: boolean;
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

    // Same treatment for GR_LINE (Part 13) — one more round trip, not one per row.
    const grLineIds = page
      .filter((m) => m.sourceType === "GR_LINE")
      .map((m) => m.sourceId);

    const grLines = grLineIds.length
      ? await tx.goodsReceiptItem.findMany({
          where: { tenantId, id: { in: grLineIds } },
          select: {
            id: true,
            qtyReceivedActual: true,
            receivedUnitName: true,
            reversalOfItemId: true,
            goodsReceipt: {
              select: {
                id: true,
                grNumber: true,
                invoiceNo: true,
                supplier: { select: { nameFull: true } },
                purchaseOrder: { select: { poNumber: true } },
              },
            },
          },
        })
      : [];

    const byGrLineId = new Map(grLines.map((l) => [l.id, l]));

    return {
      rows: page.map((m) => {
        const adj =
          m.sourceType === "ADJUSTMENT"
            ? byAdjustmentId.get(m.sourceId)
            : undefined;
        const gr =
          m.sourceType === "GR_LINE" ? byGrLineId.get(m.sourceId) : undefined;
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
          goodsReceipt: gr
            ? {
                lineId: gr.id,
                goodsReceiptId: gr.goodsReceipt.id,
                grNumber: gr.goodsReceipt.grNumber,
                supplierName: gr.goodsReceipt.supplier.nameFull,
                invoiceNo: gr.goodsReceipt.invoiceNo,
                poNumber: gr.goodsReceipt.purchaseOrder?.poNumber ?? null,
                qtyReceivedActual: gr.qtyReceivedActual,
                receivedUnitName: gr.receivedUnitName,
                isReversal: gr.reversalOfItemId !== null,
              }
            : null,
        };
      }),
      // The cursor is the LAST row of this page (Prisma re-anchors with skip: 1).
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  });
}

// ============================================================
// WRITE PATH (L3b) — insert only
// ============================================================
// Two layers:
//   createStockMovementLogic  — the ledger primitive. INTERNAL: it takes a `tx`
//     instead of a tenantId because every caller must already own a transaction
//     that also writes the SOURCE row (Q4: source + movement are one atomic
//     unit). Part 13's GR is the next caller.
//   createStockAdjustmentLogic — the only Part 10 producer: opens the tx, writes
//     the stock_adjustment source, then the movement.
// ============================================================

/** `qty` scale on both stock_movement.qty and stock_adjustment.input_qty. */
const QTY_SCALE = 3;

/**
 * Q1 conversion, in one place: as-entered magnitude × ratio → base-unit magnitude.
 *
 * ADR 0011 Q1 promised "a dedicated unit-conversion helper with tests"; Part 10
 * inlined it in `createStockAdjustmentLogic` instead. Part 13 needs exactly the
 * same three lines against a GR line's frozen `to_base_ratio`, and a stock
 * conversion duplicated across two files is precisely the silent-corruption risk
 * that Q1 called out — so it lives here now and both callers use it.
 *
 * Rounded to the column scale HERE rather than left to Postgres, so the number
 * the app returns is exactly the number that was stored. The result is always
 * POSITIVE (a magnitude); the caller applies the sign from the movement type.
 */
export function toBaseQty(
  inputQty: Prisma.Decimal | number | string,
  toBaseRatio: Prisma.Decimal
): Prisma.Decimal {
  return new Prisma.Decimal(inputQty)
    .mul(toBaseRatio)
    .toDecimalPlaces(QTY_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Thrown when `inputUnitId` is not a ProductUnit of THIS product. Mirror of
 * OrderUnitMismatchError in supplier-product-mapping.ts (Q5i) — kept separate
 * because the field, the message, and the layer that maps it all differ.
 */
export class StockUnitMismatchError extends Error {
  constructor(
    public readonly unitId: string,
    public readonly productId: string
  ) {
    super(`Unit "${unitId}" is not a unit of product "${productId}"`);
    this.name = "StockUnitMismatchError";
  }
}

/**
 * Thrown when a valid positive input converts to 0.000 in the base unit — e.g.
 * 0.001 mg against a kg base. The DB CHECK forbids a zero-qty row (a movement
 * that moves nothing is meaningless), so this is caught in the app with a field
 * error instead of surfacing as a raw constraint violation.
 */
export class QtyRoundsToZeroError extends Error {
  constructor(
    public readonly inputQty: Prisma.Decimal,
    public readonly inputUnitName: string,
    public readonly baseUnitName: string | null
  ) {
    super(
      `${inputQty.toString()} ${inputUnitName} rounds to 0 in the base unit${baseUnitName ? ` (${baseUnitName})` : ""}`
    );
    this.name = "QtyRoundsToZeroError";
  }
}

/**
 * Thrown when a caller hands the primitive a qty whose sign contradicts its
 * type. Same rule as the `stock_movement_sign_check` CHECK, asserted first so a
 * caller bug reads as a named error rather than a Postgres constraint message.
 * Zero fails too — it satisfies neither branch.
 */
export class MovementSignMismatchError extends Error {
  constructor(
    public readonly type: MovementType,
    public readonly qty: Prisma.Decimal
  ) {
    super(`qty ${qty.toString()} contradicts movement type ${type}`);
    this.name = "MovementSignMismatchError";
  }
}

/**
 * Thrown when the polymorphic source row does not exist for this tenant. With no
 * FK to enforce it (Q3), this app-layer assertion is the ONLY thing keeping the
 * ledger from pointing at nothing.
 */
export class MovementSourceNotFoundError extends Error {
  constructor(
    public readonly sourceType: SourceType,
    public readonly sourceId: string
  ) {
    super(`Source ${sourceType} "${sourceId}" does not exist for this tenant`);
    this.name = "MovementSourceNotFoundError";
  }
}

/**
 * Thrown when the (sourceType, sourceId) unique index fires DESPITE the
 * pre-insert lookup — i.e. a concurrent writer won the race in between.
 *
 * ADR 0011 Q4 planned to swallow that P2002 and return the existing row, but
 * Postgres aborts the ENTIRE transaction on a constraint violation ("current
 * transaction is aborted, commands ignored until end of transaction block"), so
 * the re-read cannot run on the doomed tx — and Prisma exposes no SAVEPOINT to
 * scope the failure. The intent (a replayed source is a no-op, never double
 * stock) is preserved by the pre-insert lookup below; this error is the narrow
 * race window that survives.
 *
 * The caller retries the whole operation in a FRESH transaction — the pre-insert
 * lookup then finds the winner's row and returns it — or reads it directly with
 * `findStockMovementBySourceLogic`. Either way the ledger keeps exactly one row
 * per source. See L4 for the Thai mapping.
 */
export class MovementSourceConflictError extends Error {
  constructor(
    public readonly sourceType: SourceType,
    public readonly sourceId: string
  ) {
    super(
      `Concurrent writer already recorded a movement for ${sourceType} "${sourceId}"`
    );
    this.name = "MovementSourceConflictError";
  }
}

/**
 * Thrown for a source type that has no writer — SYSTEM_INITIAL is reserved
 * (Q10). GR_LINE gained its writer in Part 13. Better a named refusal than a
 * ledger row whose source can never be resolved.
 */
export class UnsupportedSourceTypeError extends Error {
  constructor(public readonly sourceType: SourceType) {
    super(`Source type ${sourceType} has no writer`);
    this.name = "UnsupportedSourceTypeError";
  }
}

/**
 * Thrown when a replayed source resolves to a movement that does NOT match what
 * the caller is now trying to write.
 *
 * Part 13 hardening (ADR 0013 Consequence 4). The idempotency lookup below used
 * to return on `sourceId` alone, which is right for a genuine replay and wrong
 * for everything else: a GR line re-confirmed with a corrected quantity would
 * report success while the ledger silently kept the old number. Idempotency
 * means "the same write twice is one write" — not "any write against a used
 * source id is a no-op".
 *
 * Reaching this is a caller bug (the ledger is append-only; a correction is a
 * compensating entry), so L4 does NOT map it to a form message — it rethrows to
 * the error boundary.
 */
export class MovementSourceMismatchError extends Error {
  constructor(
    public readonly sourceType: SourceType,
    public readonly sourceId: string,
    public readonly field: string
  ) {
    super(
      `Source ${sourceType} "${sourceId}" already has a movement whose ${field} differs from the one being written`
    );
    this.name = "MovementSourceMismatchError";
  }
}

/** `+` for the two IN types, `-` for the two OUT types (Q2). */
const isInboundType = (type: MovementType): boolean =>
  type === "PO_RECEIVE" || type === "ADJUST_GAIN";

/**
 * Q3 guard: the source row must exist before the ledger points at it — and it
 * must be a source for the SAME product and branch the movement claims.
 *
 * Part 13 hardening (ADR 0013 Consequence 4): this used to select only `id`,
 * which proved the row existed but not that it had anything to do with the
 * movement being written. With no FK (Q3) this assertion is the only integrity
 * the ledger has, so it now reads the source's own product/branch and compares.
 */
async function assertSourceExists(
  tx: PrismaClient,
  tenantId: string,
  sourceType: SourceType,
  sourceId: string,
  productId: string,
  branchId: string
): Promise<void> {
  const select = { productId: true, branchId: true } as const;

  const row =
    sourceType === "ADJUSTMENT"
      ? await tx.stockAdjustment.findFirst({
          where: { id: sourceId, tenantId },
          select,
        })
      : sourceType === "GR_LINE"
        ? // The GR line carries the product; the branch lives on its header.
          await tx.goodsReceiptItem
            .findFirst({
              where: { id: sourceId, tenantId },
              select: {
                productId: true,
                goodsReceipt: { select: { branchId: true } },
              },
            })
            .then((r) =>
              r ? { productId: r.productId, branchId: r.goodsReceipt.branchId } : null
            )
        : sourceType === "STOCK_COUNT"
          ? // Part 15 (ADR 0015 Q1): the count LINE is the source. Like a GR line
            // it carries the product and gets its branch from the header — a
            // count is always of one place (branch_id NOT NULL on stock_count).
            await tx.stockCountItem
              .findFirst({
                where: { id: sourceId, tenantId },
                select: {
                  productId: true,
                  stockCount: { select: { branchId: true } },
                },
              })
              .then((r) =>
                r ? { productId: r.productId, branchId: r.stockCount.branchId } : null
              )
          : // SYSTEM_INITIAL: reserved, no table and no writer (Q10).
            (() => {
              throw new UnsupportedSourceTypeError(sourceType);
            })();

  if (!row) throw new MovementSourceNotFoundError(sourceType, sourceId);
  if (row.productId !== productId) {
    throw new MovementSourceMismatchError(sourceType, sourceId, "productId");
  }
  if (row.branchId !== branchId) {
    throw new MovementSourceMismatchError(sourceType, sourceId, "branchId");
  }
}

export type CreateStockMovementParams = {
  tenantId: string;
  productId: string;
  branchId: string;
  /** SIGNED and already in the product's base unit (Q1) — the caller converts. */
  qty: Prisma.Decimal;
  type: MovementType;
  sourceType: SourceType;
  sourceId: string;
  /** Business time (Q5). The caller owns the backdate-window validation. */
  occurredAt: Date;
  createdBy: string;
  notes?: string | null;
};

/**
 * Append one row to the ledger. INTERNAL primitive — takes the caller's `tx`
 * (which is why it breaks the "tenantId first" convention of every other *Logic):
 * the source row and its movement must commit or fail together (Q4).
 *
 * IDEMPOTENT by (sourceType, sourceId): a replayed source returns the row
 * already written instead of inserting a second one (Q4) — a double-submitted GR
 * is a no-op, not double stock. That is done with a lookup BEFORE the insert,
 * not by catching P2002 after it: a constraint violation aborts the whole
 * Postgres transaction, so nothing can be read on it afterwards (see
 * MovementSourceConflictError, which covers the surviving race window).
 */
export async function createStockMovementLogic(
  tx: PrismaClient,
  params: CreateStockMovementParams
): Promise<StockMovement> {
  const { tenantId, productId, branchId, qty, type, sourceType, sourceId } =
    params;

  // Sign first: it is a pure check on the arguments, so it fails before any IO.
  if (isInboundType(type) ? !qty.greaterThan(0) : !qty.lessThan(0)) {
    throw new MovementSignMismatchError(type, qty);
  }

  await assertRefBelongsToTenant(tx, tenantId, "product", productId);
  await assertRefBelongsToTenant(tx, tenantId, "branch", branchId);
  await assertSourceExists(tx, tenantId, sourceType, sourceId, productId, branchId);

  // Idempotency, checked BEFORE the insert (see the doc comment): this row
  // already exists iff the source was replayed.
  //
  // Part 13 hardening (ADR 0013 Consequence 4): the lookup now filters by
  // `tenantId` — it was the one query on this write path that did not — and the
  // row is only returned if it MATCHES. Returning on sourceId alone made a
  // replay with different numbers report success while the ledger kept the old
  // ones, silently. Idempotency is "the same write twice is one write".
  const existing = await tx.stockMovement.findFirst({
    where: { tenantId, sourceType, sourceId },
  });
  if (existing) {
    if (existing.productId !== productId) {
      throw new MovementSourceMismatchError(sourceType, sourceId, "productId");
    }
    if (existing.branchId !== branchId) {
      throw new MovementSourceMismatchError(sourceType, sourceId, "branchId");
    }
    if (existing.type !== type) {
      throw new MovementSourceMismatchError(sourceType, sourceId, "type");
    }
    if (!existing.qty.equals(qty)) {
      throw new MovementSourceMismatchError(sourceType, sourceId, "qty");
    }
    if (existing.occurredAt.getTime() !== params.occurredAt.getTime()) {
      throw new MovementSourceMismatchError(sourceType, sourceId, "occurredAt");
    }
    return existing;
  }

  try {
    return await tx.stockMovement.create({
      data: {
        tenantId,
        productId,
        branchId,
        qty,
        type,
        sourceType,
        sourceId,
        occurredAt: params.occurredAt,
        createdBy: params.createdBy,
        notes: params.notes ?? null,
      },
    });
  } catch (e) {
    // Only the source-unique index can collide, and only against a concurrent
    // writer. The tx is already doomed, so translate and get out — do NOT issue
    // another query on it.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new MovementSourceConflictError(sourceType, sourceId);
    }
    throw e;
  }
}

/**
 * Read the movement a source produced, if any. The companion to the conflict
 * error above: after a doomed transaction rolls back, this resolves "did the
 * other writer's row land?" on a fresh connection, so the caller can report
 * idempotent success instead of a failure.
 */
export async function findStockMovementBySourceLogic(
  tenantId: string,
  sourceType: SourceType,
  sourceId: string
): Promise<StockMovement | null> {
  return withTenantContext(tenantId, (tx) =>
    tx.stockMovement.findFirst({ where: { tenantId, sourceType, sourceId } })
  );
}

export type CreateStockAdjustmentResult = {
  adjustment: StockAdjustment;
  movement: StockMovement;
  /** Balance for this (product, branch) AFTER the write — may be negative (Q9). */
  postBalance: Prisma.Decimal;
};

/**
 * Record a manual stock adjustment: the `stock_adjustment` source row and its
 * ledger movement, in ONE transaction (Q4).
 *
 * The as-entered unit and magnitude stay on the adjustment for audit; the
 * movement carries the signed base-unit qty (Q1). Direction comes from `type`
 * alone — a user never types a minus sign.
 *
 * A negative `postBalance` NEVER blocks (Q9): the result carries it and the L5
 * form owns the warn-and-confirm. Input must already be parsed by
 * `createStockAdjustmentInputSchema`.
 *
 * **`input.submitKey` becomes the adjustment's id** (Part 13.5). Q4's idempotency
 * is keyed on `(source_type, source_id)`, so while this function minted a fresh
 * adjustment id per call it never presented the same key twice and the primitive's
 * pre-insert lookup could never fire — a double POST wrote a second adjustment and
 * a second movement, and the stock doubled. With the client's key as the row id,
 * a replay finds the adjustment already there and returns it unchanged.
 */
export async function createStockAdjustmentLogic(
  tenantId: string,
  input: CreateStockAdjustmentInput,
  createdBy: string
): Promise<CreateStockAdjustmentResult> {
  const { productId, branchId, type, reason, inputQty, inputUnitId, occurredAt } =
    input;

  // withTenantContext IS the transaction (SET LOCAL + $transaction), so
  // everything below commits or rolls back together.
  return withTenantContext(tenantId, async (tx) => {
    // Idempotency, checked before anything is written or asserted. A replay
    // returns the adjustment that already exists — including its movement and a
    // freshly read balance, so the caller cannot tell a replay from the original.
    const replay = await tx.stockAdjustment.findFirst({
      where: { tenantId, id: input.submitKey },
    });
    if (replay) {
      const movement = await tx.stockMovement.findFirst({
        where: { tenantId, sourceType: "ADJUSTMENT", sourceId: replay.id },
      });
      // Unreachable by construction: the source and its movement are written in
      // ONE transaction (Q4) and the ledger has no delete (Q7). If it ever fires,
      // the ledger was edited outside the app — that belongs in the error
      // boundary, not in a Thai field error on a form.
      if (!movement) {
        throw new Error(
          `stock_adjustment "${replay.id}" has no ledger movement — the ledger was modified outside the app`
        );
      }
      const agg = await tx.stockMovement.aggregate({
        where: { tenantId, productId: replay.productId, branchId: replay.branchId },
        _sum: { qty: true },
      });
      return { adjustment: replay, movement, postBalance: agg._sum.qty ?? ZERO };
    }

    await assertRefBelongsToTenant(tx, tenantId, "product", productId);
    await assertRefBelongsToTenant(tx, tenantId, "branch", branchId);

    // The unit must belong to THIS product. Matching on productId is also what
    // makes a cross-tenant unit unreachable — the product is already asserted.
    const unit = await tx.productUnit.findFirst({
      where: { id: inputUnitId, productId },
      select: { id: true, unitName: true, toBaseRatio: true },
    });
    if (!unit) throw new StockUnitMismatchError(inputUnitId, productId);

    const magnitude = toBaseQty(inputQty, unit.toBaseRatio);

    if (magnitude.isZero()) {
      const base = await tx.productUnit.findFirst({
        where: { productId, isBase: true },
        select: { unitName: true },
      });
      throw new QtyRoundsToZeroError(
        new Prisma.Decimal(inputQty),
        unit.unitName,
        base?.unitName ?? null
      );
    }

    const qty = type === "ADJUST_LOSS" ? magnitude.negated() : magnitude;

    const adjustment = await tx.stockAdjustment.create({
      data: {
        id: input.submitKey,
        tenantId,
        productId,
        branchId,
        type,
        reason,
        inputQty: new Prisma.Decimal(inputQty),
        inputUnitId,
        occurredAt,
        createdBy,
      },
    });

    const movement = await createStockMovementLogic(tx, {
      tenantId,
      productId,
      branchId,
      qty,
      type,
      sourceType: "ADJUSTMENT",
      sourceId: adjustment.id,
      occurredAt,
      createdBy,
      notes: input.notes,
    });

    // Part 14 (ADR 0014 Q6), entry point one of two: a cost typed on the adjust
    // form is written HERE, inside the same transaction as the movement it
    // prices. Splitting them would let a form submission record stock at a price
    // nobody typed if the second write failed. `null` is the normal case — the
    // person counting usually does not know what it cost, and the replay falls
    // back to the last purchase price (Q5).
    if (input.costDeclaration) {
      await writeCostDeclaration(tx, {
        tenantId,
        movementId: movement.id,
        productId,
        movementType: type,
        body: input.costDeclaration,
        declaredBy: createdBy,
      });
    }

    // Read the balance inside the same tx so it includes the row just written.
    const agg = await tx.stockMovement.aggregate({
      where: { tenantId, productId, branchId },
      _sum: { qty: true },
    });

    return { adjustment, movement, postBalance: agg._sum.qty ?? ZERO };
  });
}
