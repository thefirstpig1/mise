// ============================================================
// Mise — Stock Count logic (Sprint 3 Part 15 L3, ADR 0015)
// ============================================================
// The document that reconciles the Ledger with the shelf. Reads and writes live
// together here, following stock-movement.ts rather than splitting the file.
//
// Three shapes carry the Part's weight:
//
//   * **A line is saved with its expected quantity already resolved** (Q3). The
//     snapshot is taken here, at save time, from the ledger — never at close and
//     never from the client. A count edited later re-snapshots, because the draft
//     is a working sheet (Q2).
//   * **Closing writes one movement per non-zero variance** through
//     `createStockMovementLogic`, the only way anything reaches the ledger. The
//     count item IS the source, so the ledger's own UNIQUE(source_type,source_id)
//     makes a second close a no-op without a submit key (Q1).
//   * **Voiding appends reversal lines with the original's numbers SWAPPED**, so
//     the variance is the exact negation and the compensating movement needs no
//     new movement type (Q6).
// ============================================================

import { Prisma } from "@prisma/client";
import type { PrismaClient, StockCount, StockCountStatus } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { assertRefBelongsToTenant } from "@/server/product";
import { acquireCounterLock } from "@/server/counter-lock";
import { createStockMovementLogic, toBaseQty } from "@/server/stock-movement";
import type {
  CloseStockCountInput,
  GetStockCountsQuery,
  OpenStockCountInput,
  SaveStockCountLineInput,
  VoidStockCountInput,
} from "@/lib/validations/stock-count";

const ZERO = new Prisma.Decimal(0);

// ------------------------------------------------------------
// Typed errors
// ------------------------------------------------------------

export class StockCountNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Stock count "${id}" does not exist for this tenant`);
    this.name = "StockCountNotFoundError";
  }
}

/**
 * Thrown when a branch already has an open sheet (Q8).
 *
 * The partial unique index is the DB-level guarantee; this is the app-level
 * check that turns it into a message naming the sheet the user should join,
 * because "someone is already counting" is only useful with a link to it.
 */
export class StockCountAlreadyOpenError extends Error {
  constructor(
    public readonly branchId: string,
    public readonly existingId: string
  ) {
    super(`Branch "${branchId}" already has an open count (${existingId})`);
    this.name = "StockCountAlreadyOpenError";
  }
}

/** Thrown when the document is not in a state that permits what was asked. */
export class StockCountNotEditableError extends Error {
  constructor(
    public readonly id: string,
    public readonly status: StockCountStatus
  ) {
    super(`Stock count "${id}" is ${status} and can no longer be edited`);
    this.name = "StockCountNotEditableError";
  }
}

export class StockCountTransitionError extends Error {
  constructor(
    public readonly id: string,
    public readonly from: StockCountStatus,
    public readonly to: StockCountStatus
  ) {
    super(`Stock count "${id}" cannot go from ${from} to ${to}`);
    this.name = "StockCountTransitionError";
  }
}

/** Thrown when a counted unit is not a unit of the product being counted. */
export class CountUnitMismatchError extends Error {
  constructor(
    public readonly unitId: string,
    public readonly productId: string
  ) {
    super(`Unit "${unitId}" is not a unit of product "${productId}"`);
    this.name = "CountUnitMismatchError";
  }
}

// ------------------------------------------------------------
// Shapes
// ------------------------------------------------------------

const ITEM_INCLUDE = {
  product: {
    select: {
      id: true,
      name: true,
      sku: true,
      deletedAt: true,
      productUnits: { where: { isBase: true }, select: { unitName: true } },
    },
  },
  countedByUser: { select: { id: true, name: true, email: true } },
  entries: {
    include: { productUnit: { select: { id: true, unitName: true } } },
    orderBy: { displayOrder: "asc" },
  },
} as const;

const DETAIL_INCLUDE = {
  branch: { select: { id: true, name: true, code: true } },
  startedByUser: { select: { id: true, name: true, email: true } },
  closedByUser: { select: { id: true, name: true, email: true } },
  voidedByUser: { select: { id: true, name: true, email: true } },
  items: { include: ITEM_INCLUDE, orderBy: { lineNo: "asc" } },
} as const;

export type StockCountDetail = Prisma.StockCountGetPayload<{
  include: typeof DETAIL_INCLUDE;
}>;

export type StockCountListRow = Prisma.StockCountGetPayload<{
  include: {
    branch: { select: { id: true; name: true; code: true } };
    _count: { select: { items: true } };
  };
}>;

// ------------------------------------------------------------
// Reads
// ------------------------------------------------------------

export async function getStockCountsLogic(
  tenantId: string,
  query: GetStockCountsQuery = {}
): Promise<StockCountListRow[]> {
  return withTenantContext(tenantId, (tx) =>
    tx.stockCount.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        _count: { select: { items: true } },
      },
      orderBy: [{ countDate: "desc" }, { createdAt: "desc" }],
    })
  );
}

export async function getStockCountByIdLogic(
  tenantId: string,
  id: string
): Promise<StockCountDetail | null> {
  return withTenantContext(tenantId, (tx) =>
    tx.stockCount.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: DETAIL_INCLUDE,
    })
  );
}

/** The open sheet for a branch, if any — what the "join the count" link needs. */
export async function getOpenStockCountLogic(
  tenantId: string,
  branchId: string
): Promise<StockCount | null> {
  return withTenantContext(tenantId, (tx) =>
    tx.stockCount.findFirst({
      where: { tenantId, branchId, status: "DRAFT", deletedAt: null },
    })
  );
}

/**
 * How many products hold stock at this branch but are NOT on the sheet.
 *
 * Q7 makes a partial count the normal case, so this is **information for the
 * close screen, never a blocker**: the difference between "I only counted the
 * freezer" and "I forgot half the store" is one the person closing knows and the
 * server does not.
 */
export async function getUncountedStockedCountLogic(
  tenantId: string,
  stockCountId: string
): Promise<number> {
  return withTenantContext(tenantId, async (tx) => {
    const count = await tx.stockCount.findFirst({
      where: { id: stockCountId, tenantId },
      select: { branchId: true, items: { select: { productId: true } } },
    });
    if (!count) throw new StockCountNotFoundError(stockCountId);

    const counted = new Set(count.items.map((i) => i.productId));

    const withStock = await tx.stockMovement.groupBy({
      by: ["productId"],
      where: { tenantId, branchId: count.branchId },
      _sum: { qty: true },
    });

    return withStock.filter(
      (g) => !counted.has(g.productId) && !(g._sum.qty ?? ZERO).isZero()
    ).length;
  });
}

// ------------------------------------------------------------
// Writes
// ------------------------------------------------------------

/** `{BRANCH_CODE}-SC-####` per branch. Mirrors generatePoNumber / generateGrNumber. */
async function generateScNumber(
  tx: PrismaClient,
  tenantId: string,
  branchCode: string
): Promise<string> {
  await acquireCounterLock(tx, `sc_number:${tenantId}:${branchCode}`);

  const prefix = `${branchCode}-SC-`;
  const rows = await tx.stockCount.findMany({
    where: { tenantId, scNumber: { startsWith: prefix } },
    select: { scNumber: true },
  });

  const re = new RegExp(
    `^${branchCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-SC-(\\d+)$`
  );
  let max = 0;
  for (const { scNumber } of rows) {
    const m = re.exec(scNumber);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

/**
 * Open a sheet. At most one per branch (Q8) — checked here for a message that
 * can name the existing sheet, and guaranteed by the partial unique index for
 * the concurrent case the check cannot see.
 */
export async function openStockCountLogic(
  tenantId: string,
  input: OpenStockCountInput,
  startedBy: string
): Promise<StockCountDetail> {
  return withTenantContext(tenantId, async (tx) => {
    await assertRefBelongsToTenant(tx, tenantId, "branch", input.branchId);

    const open = await tx.stockCount.findFirst({
      where: { tenantId, branchId: input.branchId, status: "DRAFT", deletedAt: null },
      select: { id: true },
    });
    if (open) throw new StockCountAlreadyOpenError(input.branchId, open.id);

    const branch = await tx.branch.findFirst({
      where: { id: input.branchId, tenantId },
      select: { code: true },
    });
    const scNumber = await generateScNumber(tx, tenantId, branch!.code);

    return tx.stockCount.create({
      data: {
        tenantId,
        branchId: input.branchId,
        scNumber,
        countDate: input.countDate,
        status: "DRAFT",
        showExpected: input.showExpected,
        notes: input.notes,
        startedBy,
      },
      include: DETAIL_INCLUDE,
    });
  });
}

/**
 * Save (or re-save) one counted line.
 *
 * The two numbers that matter are both resolved HERE, from the ledger and the
 * clock, never from the client: `qtyExpected` is the balance at this instant
 * (Q3) and `countedAt` is that same instant, which becomes the variance
 * movement's `occurred_at` at close (Q8). Re-counting overwrites both, because
 * the sheet is a working document until it is closed (Q2).
 */
export async function saveStockCountLineLogic(
  tenantId: string,
  input: SaveStockCountLineInput,
  countedBy: string
): Promise<StockCountDetail> {
  return withTenantContext(tenantId, async (tx) => {
    const count = await tx.stockCount.findFirst({
      where: { id: input.stockCountId, tenantId, deletedAt: null },
      select: { id: true, branchId: true, status: true },
    });
    if (!count) throw new StockCountNotFoundError(input.stockCountId);
    if (count.status !== "DRAFT") {
      throw new StockCountNotEditableError(count.id, count.status);
    }

    await assertRefBelongsToTenant(tx, tenantId, "product", input.productId);

    // Every entry's unit must belong to THIS product — which is also what makes
    // a cross-tenant unit unreachable, since the product is already asserted.
    const units = await tx.productUnit.findMany({
      where: {
        id: { in: input.entries.map((e) => e.productUnitId) },
        productId: input.productId,
      },
      select: { id: true, toBaseRatio: true },
    });
    const ratioById = new Map(units.map((u) => [u.id, u.toBaseRatio]));
    for (const e of input.entries) {
      if (!ratioById.has(e.productUnitId)) {
        throw new CountUnitMismatchError(e.productUnitId, input.productId);
      }
    }

    // "2 กระสอบ + 3 kg" becomes one base-unit total, converted with the same
    // helper the adjustment and the receipt use.
    let qtyCounted = ZERO;
    for (const e of input.entries) {
      qtyCounted = qtyCounted.plus(toBaseQty(e.qtyInUnit, ratioById.get(e.productUnitId)!));
    }

    const countedAt = new Date();

    // THE snapshot (Q3). Taken now, from the ledger, for this branch — not at
    // close, or a delivery arriving between counting and closing would read as a
    // shortage exactly its own size.
    const agg = await tx.stockMovement.aggregate({
      where: { tenantId, productId: input.productId, branchId: count.branchId },
      _sum: { qty: true },
    });
    const qtyExpected = agg._sum.qty ?? ZERO;

    const existing = await tx.stockCountItem.findFirst({
      where: {
        tenantId,
        stockCountId: count.id,
        productId: input.productId,
        reversalOfItemId: null,
      },
      select: { id: true },
    });

    if (existing) {
      await tx.stockCountEntry.deleteMany({ where: { stockCountItemId: existing.id } });
      await tx.stockCountItem.update({
        where: { id: existing.id },
        data: {
          qtyCounted,
          qtyExpected,
          countedAt,
          countedBy,
          countedByName: input.countedByName,
          notes: input.notes,
          entries: {
            create: input.entries.map((e, i) => ({
              tenantId,
              productUnitId: e.productUnitId,
              qtyInUnit: new Prisma.Decimal(e.qtyInUnit),
              displayOrder: i + 1,
            })),
          },
        },
      });
    } else {
      const maxLine = await tx.stockCountItem.aggregate({
        where: { stockCountId: count.id },
        _max: { lineNo: true },
      });
      await tx.stockCountItem.create({
        data: {
          tenantId,
          stockCountId: count.id,
          productId: input.productId,
          lineNo: (maxLine._max.lineNo ?? 0) + 1,
          qtyCounted,
          qtyExpected,
          countedAt,
          countedBy,
          countedByName: input.countedByName,
          notes: input.notes,
          entries: {
            create: input.entries.map((e, i) => ({
              tenantId,
              productUnitId: e.productUnitId,
              qtyInUnit: new Prisma.Decimal(e.qtyInUnit),
              displayOrder: i + 1,
            })),
          },
        },
      });
    }

    return tx.stockCount.findFirstOrThrow({
      where: { id: count.id, tenantId },
      include: DETAIL_INCLUDE,
    });
  });
}

/** Remove a line — "I put this on the sheet by mistake", not "there are zero". */
export async function deleteStockCountLineLogic(
  tenantId: string,
  stockCountId: string,
  itemId: string
): Promise<StockCountDetail> {
  return withTenantContext(tenantId, async (tx) => {
    const count = await tx.stockCount.findFirst({
      where: { id: stockCountId, tenantId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!count) throw new StockCountNotFoundError(stockCountId);
    if (count.status !== "DRAFT") {
      throw new StockCountNotEditableError(count.id, count.status);
    }

    await tx.stockCountEntry.deleteMany({
      where: { tenantId, stockCountItemId: itemId, item: { stockCountId: count.id } },
    });
    await tx.stockCountItem.deleteMany({
      where: { id: itemId, tenantId, stockCountId: count.id },
    });

    return tx.stockCount.findFirstOrThrow({
      where: { id: count.id, tenantId },
      include: DETAIL_INCLUDE,
    });
  });
}

/**
 * Close the sheet: post every non-zero variance to the ledger (Q1).
 *
 * A line whose count matches expectation writes nothing — the sign CHECK forbids
 * a zero-qty movement, and nothing moved. The movement's `occurred_at` is the
 * line's own `countedAt`, not now (Q8).
 *
 * Idempotent without a submit key: the count item is the source, so a replayed
 * close finds each movement already there through the ledger's own
 * UNIQUE(source_type, source_id).
 */
export async function closeStockCountLogic(
  tenantId: string,
  input: CloseStockCountInput,
  closedBy: string
): Promise<StockCountDetail> {
  return withTenantContext(
    tenantId,
    async (tx) => {
      const count = await tx.stockCount.findFirst({
        where: { id: input.id, tenantId, deletedAt: null },
        include: { items: true },
      });
      if (!count) throw new StockCountNotFoundError(input.id);
      if (count.status !== "DRAFT") {
        throw new StockCountTransitionError(count.id, count.status, "CLOSED");
      }

      for (const item of count.items) {
        const variance = item.qtyCounted.minus(item.qtyExpected);
        if (variance.isZero()) continue;

        await createStockMovementLogic(tx, {
          tenantId,
          productId: item.productId,
          branchId: count.branchId,
          qty: variance,
          type: variance.isPositive() ? "ADJUST_GAIN" : "ADJUST_LOSS",
          sourceType: "STOCK_COUNT",
          sourceId: item.id,
          occurredAt: item.countedAt,
          createdBy: closedBy,
          notes: item.notes,
        });
      }

      return tx.stockCount.update({
        where: { id: count.id },
        data: { status: "CLOSED", closedAt: new Date(), closedBy },
        include: DETAIL_INCLUDE,
      });
    },
    // A sheet can carry hundreds of lines, each writing a movement — well past
    // Prisma's default 5s transaction budget (the option Part 13 added for the
    // same reason).
    { timeout: 30_000, maxWait: 10_000 }
  );
}

/**
 * Void a closed count: append a reversal line per posted line, each producing the
 * opposite movement (Q6).
 *
 * The reversal carries the original's numbers **swapped**, so its variance is the
 * exact negation — which is why no new movement type is needed and why the
 * non-negative CHECK on `qty_counted` exempts reversal rows.
 *
 * The reversals occur NOW, not at the original `countedAt`: a general ledger
 * reverses on the day the error is found, and backdating would silently move a
 * balance that has already been reported (ADR 0013's L3b shape 1, same call).
 */
export async function voidStockCountLogic(
  tenantId: string,
  input: VoidStockCountInput,
  voidedBy: string
): Promise<StockCountDetail> {
  return withTenantContext(
    tenantId,
    async (tx) => {
      const count = await tx.stockCount.findFirst({
        where: { id: input.id, tenantId, deletedAt: null },
        include: { items: true },
      });
      if (!count) throw new StockCountNotFoundError(input.id);
      if (count.status !== "CLOSED") {
        throw new StockCountTransitionError(count.id, count.status, "VOIDED");
      }

      const voidedAt = new Date();
      const originals = count.items.filter((i) => i.reversalOfItemId === null);
      let nextLineNo = Math.max(...count.items.map((i) => i.lineNo), 0) + 1;

      for (const item of originals) {
        const variance = item.qtyCounted.minus(item.qtyExpected);
        if (variance.isZero()) continue; // nothing was posted, nothing to reverse

        const reversal = await tx.stockCountItem.create({
          data: {
            tenantId,
            stockCountId: count.id,
            productId: item.productId,
            lineNo: nextLineNo++,
            // Swapped: variance flips sign without a negative qty_counted.
            qtyCounted: item.qtyExpected,
            qtyExpected: item.qtyCounted,
            countedAt: voidedAt,
            countedBy: voidedBy,
            countedByName: item.countedByName,
            notes: input.voidReason,
            reversalOfItemId: item.id,
          },
        });

        await createStockMovementLogic(tx, {
          tenantId,
          productId: item.productId,
          branchId: count.branchId,
          qty: variance.negated(),
          type: variance.isPositive() ? "ADJUST_LOSS" : "ADJUST_GAIN",
          sourceType: "STOCK_COUNT",
          sourceId: reversal.id,
          occurredAt: voidedAt,
          createdBy: voidedBy,
          notes: input.voidReason,
        });
      }

      return tx.stockCount.update({
        where: { id: count.id },
        data: { status: "VOIDED", voidedAt, voidedBy, voidReason: input.voidReason },
        include: DETAIL_INCLUDE,
      });
    },
    { timeout: 30_000, maxWait: 10_000 }
  );
}

/** Discard a sheet nobody finished. DRAFT only — a CLOSED count is voided. */
export async function deleteStockCountDraftLogic(
  tenantId: string,
  id: string
): Promise<StockCount> {
  return withTenantContext(tenantId, async (tx) => {
    const count = await tx.stockCount.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!count) throw new StockCountNotFoundError(id);
    if (count.status !== "DRAFT") {
      throw new StockCountNotEditableError(count.id, count.status);
    }
    return tx.stockCount.update({
      where: { id: count.id },
      data: { deletedAt: new Date() },
    });
  });
}
