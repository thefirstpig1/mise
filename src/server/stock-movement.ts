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
import { assertRefBelongsToTenant } from "@/server/product";
import type {
  CreateStockAdjustmentInput,
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
 * Thrown for a source type that has no writer yet — GR_LINE lands in Part 13,
 * SYSTEM_INITIAL is reserved (Q10). Better a named refusal than a ledger row
 * whose source can never be resolved.
 */
export class UnsupportedSourceTypeError extends Error {
  constructor(public readonly sourceType: SourceType) {
    super(`Source type ${sourceType} has no writer in Part 10`);
    this.name = "UnsupportedSourceTypeError";
  }
}

/** `+` for the two IN types, `-` for the one OUT type (Q2). */
const isInboundType = (type: MovementType): boolean =>
  type === "PO_RECEIVE" || type === "ADJUST_GAIN";

/** Q3 guard: the source row must exist before the ledger points at it. */
async function assertSourceExists(
  tx: PrismaClient,
  tenantId: string,
  sourceType: SourceType,
  sourceId: string
): Promise<void> {
  if (sourceType !== "ADJUSTMENT") {
    // GR_LINE: Part 13 adds the goods_received_line branch here.
    // SYSTEM_INITIAL: reserved, no table and no writer (Q10).
    throw new UnsupportedSourceTypeError(sourceType);
  }
  const row = await tx.stockAdjustment.findFirst({
    where: { id: sourceId, tenantId },
    select: { id: true },
  });
  if (!row) throw new MovementSourceNotFoundError(sourceType, sourceId);
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
  await assertSourceExists(tx, tenantId, sourceType, sourceId);

  // Idempotency, checked BEFORE the insert (see the doc comment): this row
  // already exists iff the source was replayed.
  const existing = await tx.stockMovement.findUnique({
    where: { sourceType_sourceId: { sourceType, sourceId } },
  });
  if (existing) return existing;

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
    await assertRefBelongsToTenant(tx, tenantId, "product", productId);
    await assertRefBelongsToTenant(tx, tenantId, "branch", branchId);

    // The unit must belong to THIS product. Matching on productId is also what
    // makes a cross-tenant unit unreachable — the product is already asserted.
    const unit = await tx.productUnit.findFirst({
      where: { id: inputUnitId, productId },
      select: { id: true, unitName: true, toBaseRatio: true },
    });
    if (!unit) throw new StockUnitMismatchError(inputUnitId, productId);

    // Q1 conversion. Rounded to the column scale HERE rather than left to
    // Postgres, so the number the app returns is the number that was stored.
    const magnitude = new Prisma.Decimal(inputQty)
      .mul(unit.toBaseRatio)
      .toDecimalPlaces(QTY_SCALE, Prisma.Decimal.ROUND_HALF_UP);

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

    // Read the balance inside the same tx so it includes the row just written.
    const agg = await tx.stockMovement.aggregate({
      where: { tenantId, productId, branchId },
      _sum: { qty: true },
    });

    return { adjustment, movement, postBalance: agg._sum.qty ?? ZERO };
  });
}
