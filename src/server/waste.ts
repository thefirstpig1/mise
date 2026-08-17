// ============================================================
// Mise — Waste logic (Sprint 3 Part 17 L3, ADR 0017)
// ============================================================
// The fourth writer to the ledger, after receipts, adjustments and counts — and
// like all of them it goes through `createStockMovementLogic`, which ADR 0017
// Consequence 3 asks to stay the single narrow gate.
//
// Three shapes carry this Part's weight:
//
//   * **The waste row IS the source** (Q1): `source_type = WASTE_LOG`,
//     `source_id = waste_log.id`, posting an ordinary `ADJUST_LOSS`. The ledger's
//     UNIQUE(source_type, source_id) therefore makes a replay a no-op, and the
//     client's `submitKey` is used AS the row id to reach it (Part 13.5).
//   * **A void appends, never edits** (Q2): a second waste row against the
//     original, posting the compensating `ADJUST_GAIN`. The reversal is valued
//     from the ORIGINAL MOVEMENT, not recomputed — see `voidWasteLogic`.
//   * **Nothing here stores money.** Waste is stock going out, and what an
//     outflow cost is answered by the FIFO replay from the layers it draws down
//     (ADR 0014). A declared cost only ever applies to an inbound movement.
// ============================================================

import { Prisma } from "@prisma/client";
import type { PrismaClient, StockMovement, WasteLog } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { assertRefBelongsToTenant } from "@/server/product";
import {
  QtyRoundsToZeroError,
  StockUnitMismatchError,
  createStockMovementLogic,
  toBaseQty,
} from "@/server/stock-movement";
import type { CreateWasteInput, GetWasteQuery, VoidWasteInput } from "@/lib/validations/waste";

const ZERO = new Prisma.Decimal(0);

// ------------------------------------------------------------
// Typed errors
// ------------------------------------------------------------

export class WasteLogNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Waste log "${id}" does not exist for this tenant`);
    this.name = "WasteLogNotFoundError";
  }
}

/**
 * Thrown when the entry has already been voided.
 *
 * `waste_log_reversal_unique` is the DB-level guarantee; this is the app-level
 * check that turns it into a message the user can act on. Both exist because the
 * second void can arrive from a different browser, where a client key would not
 * help.
 */
export class WasteAlreadyVoidedError extends Error {
  constructor(public readonly id: string) {
    super(`Waste log "${id}" is already voided`);
    this.name = "WasteAlreadyVoidedError";
  }
}

/**
 * Thrown when the target of a void is itself a reversal. Voiding a void has no
 * meaning in an append-only ledger — the correct move is a NEW waste entry, not
 * a chain of compensations nobody can read back. The DB agrees
 * (`waste_log_reversal_not_voided_check`).
 */
export class WasteNotVoidableError extends Error {
  constructor(public readonly id: string) {
    super(`Waste log "${id}" is a reversal and cannot itself be voided`);
    this.name = "WasteNotVoidableError";
  }
}

// ------------------------------------------------------------
// Read shapes
// ------------------------------------------------------------

const DETAIL_INCLUDE = {
  product: {
    select: {
      id: true,
      name: true,
      sku: true,
      productUnits: { where: { isBase: true }, select: { unitName: true } },
    },
  },
  branch: { select: { id: true, name: true } },
  inputUnit: { select: { id: true, unitName: true, toBaseRatio: true } },
  wastedByUser: { select: { id: true, name: true, email: true } },
  voidedByUser: { select: { id: true, name: true, email: true } },
} as const;

export type WasteLogDetail = Prisma.WasteLogGetPayload<{
  include: typeof DETAIL_INCLUDE;
}>;

export type CreateWasteResult = {
  waste: WasteLog;
  movement: StockMovement;
  /** Balance AFTER the write, so the caller can warn about a negative shelf. */
  postBalance: Prisma.Decimal;
};

// ------------------------------------------------------------
// Reads
// ------------------------------------------------------------

export async function getWasteLogsLogic(
  tenantId: string,
  query: GetWasteQuery
): Promise<WasteLogDetail[]> {
  const { branchId, productId, reason, from, to, includeVoided } = query;

  return withTenantContext(tenantId, (tx) =>
    tx.wasteLog.findMany({
      where: {
        tenantId,
        ...(branchId ? { branchId } : {}),
        ...(productId ? { productId } : {}),
        ...(reason ? { reason } : {}),
        ...(from || to
          ? {
              occurredAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
        // The list answers "what was thrown away". A voided entry was not, and
        // neither was the reversal that undid it — showing the pair would double
        // every correction in a list people read as a total.
        ...(includeVoided ? {} : { voidedAt: null, reversalOfId: null }),
      },
      include: DETAIL_INCLUDE,
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    })
  );
}

export async function getWasteLogByIdLogic(
  tenantId: string,
  id: string
): Promise<WasteLogDetail | null> {
  return withTenantContext(tenantId, (tx) =>
    tx.wasteLog.findFirst({ where: { id, tenantId }, include: DETAIL_INCLUDE })
  );
}

// ------------------------------------------------------------
// Writes
// ------------------------------------------------------------

/**
 * Record one thing thrown away and post it to the ledger, in one transaction
 * (Q2). There is no draft: an unposted entry would leave the ledger claiming
 * stock that is already in the bin.
 *
 * IDEMPOTENT by `submitKey`, which is used as the row's id — the pattern
 * `createStockAdjustmentLogic` established in Part 13.5. A replay returns the
 * entry that already exists, including its movement and a freshly read balance,
 * so the caller cannot tell a replay from the original.
 */
export async function createWasteLogic(
  tenantId: string,
  input: CreateWasteInput,
  wastedBy: string
): Promise<CreateWasteResult> {
  const { productId, branchId, reason, inputQty, inputUnitId, occurredAt } = input;

  return withTenantContext(tenantId, async (tx) => {
    const replay = await tx.wasteLog.findFirst({
      where: { tenantId, id: input.submitKey },
    });
    if (replay) return resultFor(tx, tenantId, replay);

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

    const waste = await tx.wasteLog.create({
      data: {
        id: input.submitKey,
        tenantId,
        productId,
        branchId,
        reason,
        inputQty: new Prisma.Decimal(inputQty),
        inputUnitId,
        occurredAt,
        wastedBy,
        wastedByName: input.wastedByName,
        notes: input.notes,
      },
    });

    const movement = await createStockMovementLogic(tx, {
      tenantId,
      productId,
      branchId,
      // Waste is always OUT. The sign is applied here, never typed: the input is
      // a magnitude and the DB CHECK keeps it that way.
      qty: magnitude.negated(),
      type: "ADJUST_LOSS",
      sourceType: "WASTE_LOG",
      sourceId: waste.id,
      occurredAt,
      createdBy: wastedBy,
      notes: input.notes,
    });

    return { waste, movement, postBalance: await balanceOf(tx, tenantId, waste) };
  });
}

/**
 * Void an entry: append a reversal row against it and post the compensating
 * `ADJUST_GAIN` (Q2). The original is left standing — the ledger is append-only
 * (ADR 0011 Q7) and "this was keyed wrong" is itself worth being able to see.
 *
 * **The reversal is valued from the ORIGINAL MOVEMENT, not recomputed** from the
 * input quantity and today's `toBaseRatio`. A unit edited between the entry and
 * its correction would otherwise credit back a different quantity than was taken
 * out, leaving the ledger permanently off by the difference. Reversing means
 * undoing what was posted, not posting what we would post today — the same
 * instinct as ADR 0012 Q3's frozen ratio.
 *
 * The reversal occurs NOW, not at the original `occurredAt`: a ledger reverses
 * on the day the error is found, and backdating would silently move a balance
 * that has already been reported (Part 15 made the same call).
 */
export async function voidWasteLogic(
  tenantId: string,
  input: VoidWasteInput,
  voidedBy: string
): Promise<WasteLogDetail> {
  return withTenantContext(tenantId, async (tx) => {
    const original = await tx.wasteLog.findFirst({
      where: { id: input.id, tenantId },
    });
    if (!original) throw new WasteLogNotFoundError(input.id);
    if (original.reversalOfId !== null) throw new WasteNotVoidableError(original.id);
    if (original.voidedAt !== null) throw new WasteAlreadyVoidedError(original.id);

    const posted = await tx.stockMovement.findFirst({
      where: { tenantId, sourceType: "WASTE_LOG", sourceId: original.id },
      select: { qty: true },
    });
    // Unreachable by construction: the row and its movement are written in ONE
    // transaction and the ledger has no delete (ADR 0011 Q7). If it ever fires,
    // the ledger was edited outside the app — that belongs in the error boundary,
    // not in a Thai field error on a form.
    if (!posted) {
      throw new Error(
        `waste_log "${original.id}" has no ledger movement — the ledger was modified outside the app`
      );
    }

    const voidedAt = new Date();

    const reversal = await tx.wasteLog.create({
      data: {
        tenantId,
        productId: original.productId,
        branchId: original.branchId,
        reason: original.reason,
        inputQty: original.inputQty,
        inputUnitId: original.inputUnitId,
        occurredAt: voidedAt,
        wastedBy: voidedBy,
        wastedByName: original.wastedByName,
        notes: input.voidReason,
        reversalOfId: original.id,
      },
    });

    await createStockMovementLogic(tx, {
      tenantId,
      productId: original.productId,
      branchId: original.branchId,
      // The exact negation of what went out — see the doc comment.
      qty: posted.qty.negated(),
      type: "ADJUST_GAIN",
      sourceType: "WASTE_LOG",
      sourceId: reversal.id,
      occurredAt: voidedAt,
      createdBy: voidedBy,
      notes: input.voidReason,
    });

    return tx.wasteLog.update({
      where: { id: original.id },
      data: { voidedAt, voidedBy, voidReason: input.voidReason },
      include: DETAIL_INCLUDE,
    });
  });
}

// ------------------------------------------------------------
// Internals
// ------------------------------------------------------------

const balanceOf = async (
  tx: PrismaClient,
  tenantId: string,
  waste: WasteLog
): Promise<Prisma.Decimal> => {
  const agg = await tx.stockMovement.aggregate({
    where: { tenantId, productId: waste.productId, branchId: waste.branchId },
    _sum: { qty: true },
  });
  return agg._sum.qty ?? ZERO;
};

/** The replay path's result — identical in shape to a first write. */
const resultFor = async (
  tx: PrismaClient,
  tenantId: string,
  waste: WasteLog
): Promise<CreateWasteResult> => {
  const movement = await tx.stockMovement.findFirst({
    where: { tenantId, sourceType: "WASTE_LOG", sourceId: waste.id },
  });
  if (!movement) {
    throw new Error(
      `waste_log "${waste.id}" has no ledger movement — the ledger was modified outside the app`
    );
  }
  return { waste, movement, postBalance: await balanceOf(tx, tenantId, waste) };
};
