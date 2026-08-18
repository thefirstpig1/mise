// ============================================================
// Mise — Inter-branch transfer logic (Sprint 3 Part 18 L3b, ADR 0018)
// ============================================================
// The fifth writer to the ledger, after receipts, adjustments, counts and waste
// — and like all of them it goes through `createStockMovementLogic`, which ADR
// 0017 Consequence 3 asked the next writer not to be the first to bypass.
//
// It is also the first writer that touches TWO branches in one transaction, and
// four shapes carry that weight:
//
//   * **Both legs post at dispatch** (Q1). `−qty` at the sender and `+qty` at the
//     receiver, from one line, using two source types over the same
//     `stock_transfer_item.id`. The document's status is about paperwork; the
//     stock has already moved.
//   * **The money is frozen by asking the engine, not by re-deriving it** (Q5).
//     The outflow is posted first, then `replayPairsInTx` is asked what that
//     outflow cost. The document and `/cost` therefore cannot disagree about a
//     transfer — they are the same number from the same function.
//   * **Receiving posts the SHORTFALL, not the arrival** (Q2). What was
//     dispatched and never counted becomes a `TRANSFER_SHORTAGE` outflow at the
//     receiving branch, which is where the goods already belonged.
//   * **A void appends reversal lines into the same document** (Q6), never an
//     edit, and never a transfer back — those are different events and the ledger
//     cannot tell them apart afterwards.
// ============================================================

import { Prisma } from "@prisma/client";
import type { CostSource, PrismaClient, StockTransfer } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { assertRefBelongsToTenant } from "@/server/product";
import { acquireCounterLock } from "@/server/counter-lock";
import { costKeyOf, replayPairsInTx } from "@/server/stock-cost";
import {
  QtyRoundsToZeroError,
  StockUnitMismatchError,
  createStockMovementLogic,
  toBaseQty,
} from "@/server/stock-movement";
import type {
  DispatchTransferInput,
  GetTransfersQuery,
  ReceiveTransferInput,
  VoidTransferInput,
} from "@/lib/validations/transfer";

const ZERO = new Prisma.Decimal(0);
const money = (d: Prisma.Decimal) =>
  d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

// ------------------------------------------------------------
// Typed errors
// ------------------------------------------------------------

export class TransferNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Transfer "${id}" does not exist for this tenant`);
    this.name = "TransferNotFoundError";
  }
}

/** A transfer to itself is not a transfer — `stock_transfer_branch_differs_check`. */
export class TransferSameBranchError extends Error {
  constructor(public readonly branchId: string) {
    super(`A transfer cannot send branch "${branchId}" its own stock`);
    this.name = "TransferSameBranchError";
  }
}

export class TransferAlreadyVoidedError extends Error {
  constructor(public readonly id: string) {
    super(`Transfer "${id}" is already voided`);
    this.name = "TransferAlreadyVoidedError";
  }
}

/**
 * Receiving twice is refused rather than treated as an edit.
 *
 * The shortfall's source key `(TRANSFER_SHORTAGE, itemId)` already makes a
 * genuine replay a no-op, so this only ever fires on a SECOND, DIFFERENT count —
 * which is a correction, and corrections to a posted document are voids in this
 * system, not overwrites (ADR 0011 Q7).
 */
export class TransferAlreadyReceivedError extends Error {
  constructor(public readonly id: string) {
    super(`Transfer "${id}" has already been received`);
    this.name = "TransferAlreadyReceivedError";
  }
}

/** A voided document cannot be received: the goods never travelled. */
export class TransferNotReceivableError extends Error {
  constructor(public readonly id: string) {
    super(`Transfer "${id}" is voided and cannot be received`);
    this.name = "TransferNotReceivableError";
  }
}

/**
 * The receive payload must answer exactly the lines this document has — no
 * strangers, and none left out. A partial answer would leave some lines confirmed
 * and others still NULL under a document that says RECEIVED, and nobody reading
 * the list later could tell which of the two a blank meant.
 */
export class TransferLineMismatchError extends Error {
  constructor(public readonly id: string) {
    super(`The lines submitted do not match transfer "${id}"`);
    this.name = "TransferLineMismatchError";
  }
}

/**
 * Receiving MORE than was dispatched (`stock_transfer_item_received_le_sent_check`).
 * A surplus has no posting, no cost and no meaning as a transfer — driving a truck
 * does not create stock — so it means one of the two counts is wrong.
 */
export class TransferQtyExceedsSentError extends Error {
  constructor(
    public readonly itemId: string,
    public readonly qtySent: Prisma.Decimal,
    public readonly qtyReceived: Prisma.Decimal
  ) {
    super(
      `Line "${itemId}" received ${qtyReceived.toString()} against ${qtySent.toString()} dispatched`
    );
    this.name = "TransferQtyExceedsSentError";
  }
}

export class TransferNumberConflictError extends Error {
  constructor(public readonly tfNumber: string) {
    super(`Transfer number "${tfNumber}" was taken concurrently`);
    this.name = "TransferNumberConflictError";
  }
}

// ------------------------------------------------------------
// Read shapes
// ------------------------------------------------------------

const DETAIL_INCLUDE = {
  fromBranch: { select: { id: true, name: true, code: true } },
  toBranch: { select: { id: true, name: true, code: true } },
  dispatchedByUser: { select: { id: true, name: true, email: true } },
  driverUser: { select: { id: true, name: true, email: true } },
  receivedByUser: { select: { id: true, name: true, email: true } },
  voidedByUser: { select: { id: true, name: true, email: true } },
  items: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          productUnits: { where: { isBase: true }, select: { unitName: true } },
        },
      },
      inputUnit: { select: { id: true, unitName: true, toBaseRatio: true } },
    },
    orderBy: { lineNo: "asc" },
  },
} as const;

export type TransferDetail = Prisma.StockTransferGetPayload<{
  include: typeof DETAIL_INCLUDE;
}>;

/**
 * Hard cap on one page of the list — the lesson Part 17's UX pass paid for, taken
 * before it bites rather than after. `getWasteLogsLogic` had no `take` at all and
 * would have put every entry ever written on one page, forever.
 */
export const MAX_TRANSFER_ROWS = 200;

// ------------------------------------------------------------
// Reads
// ------------------------------------------------------------

export async function getTransfersLogic(
  tenantId: string,
  query: GetTransfersQuery
): Promise<TransferDetail[]> {
  const { branchId, direction, status, productId, from, to } = query;

  // A single branchId means nothing on its own here: this is the first document
  // with a branch at each end, so the caller must say WHICH end it means. ANY (or
  // an absent direction) matches both, which is what /transfers shows a manager.
  const branchWhere = branchId
    ? direction === "OUT"
      ? { fromBranchId: branchId }
      : direction === "IN"
        ? { toBranchId: branchId }
        : {
            OR: [{ fromBranchId: branchId }, { toBranchId: branchId }],
          }
    : {};

  return withTenantContext(tenantId, (tx) =>
    tx.stockTransfer.findMany({
      where: {
        tenantId,
        ...branchWhere,
        ...(status ? { status } : {}),
        ...(productId ? { items: { some: { productId } } } : {}),
        ...(from || to
          ? {
              dispatchedAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      include: DETAIL_INCLUDE,
      orderBy: [{ dispatchedAt: "desc" }, { createdAt: "desc" }],
      // +1 so the caller can tell "exactly 200" from "at least 200" and say so.
      take: MAX_TRANSFER_ROWS + 1,
    })
  );
}

export async function getTransferByIdLogic(
  tenantId: string,
  id: string
): Promise<TransferDetail | null> {
  return withTenantContext(tenantId, (tx) =>
    tx.stockTransfer.findFirst({ where: { id, tenantId }, include: DETAIL_INCLUDE })
  );
}

/**
 * What is on its way to this branch and nobody here has confirmed (Q8).
 *
 * This read exists because the receiving half of a transfer is **somebody else's
 * work in another branch** — no earlier Part has been true of that. Without it,
 * the person at the destination has no way to learn a truck is coming except by
 * being telephoned.
 */
export async function getIncomingTransfersLogic(
  tenantId: string,
  branchId: string
): Promise<TransferDetail[]> {
  return withTenantContext(tenantId, (tx) =>
    tx.stockTransfer.findMany({
      where: { tenantId, toBranchId: branchId, status: "SENT" },
      include: DETAIL_INCLUDE,
      orderBy: [{ dispatchedAt: "asc" }],
      take: MAX_TRANSFER_ROWS,
    })
  );
}

// ------------------------------------------------------------
// Writes
// ------------------------------------------------------------

/**
 * Send stock to another branch, posting BOTH ledger legs (Q1).
 *
 * IDEMPOTENT by `submitKey`, used as the document's id — Part 13.5's pattern. A
 * replay returns the document that already exists rather than moving the same
 * goods a second time, which here would be wrong at two branches at once.
 */
export async function dispatchTransferLogic(
  tenantId: string,
  input: DispatchTransferInput,
  dispatchedBy: string
): Promise<TransferDetail> {
  const { fromBranchId, toBranchId, dispatchedAt, lines } = input;

  if (fromBranchId === toBranchId) throw new TransferSameBranchError(fromBranchId);

  return withTenantContext(tenantId, async (tx) => {
    const replay = await tx.stockTransfer.findFirst({
      where: { tenantId, id: input.submitKey },
      include: DETAIL_INCLUDE,
    });
    if (replay) return replay;

    await assertRefBelongsToTenant(tx, tenantId, "branch", fromBranchId);
    await assertRefBelongsToTenant(tx, tenantId, "branch", toBranchId);

    const fromBranch = await tx.branch.findFirst({
      where: { id: fromBranchId, tenantId },
      select: { code: true },
    });
    if (!fromBranch) throw new TransferNotFoundError(fromBranchId);

    // Resolve every unit and base quantity BEFORE writing anything, so a bad line
    // fails the whole dispatch rather than leaving half a truck in the ledger.
    const prepared = [];
    for (const l of lines) {
      await assertRefBelongsToTenant(tx, tenantId, "product", l.productId);

      // The unit must belong to THIS product. Matching on productId is also what
      // makes a cross-tenant unit unreachable — the product is already asserted.
      const unit = await tx.productUnit.findFirst({
        where: { id: l.inputUnitId, productId: l.productId },
        select: { id: true, unitName: true, toBaseRatio: true },
      });
      if (!unit) throw new StockUnitMismatchError(l.inputUnitId, l.productId);

      const baseQty = toBaseQty(l.qtySent, unit.toBaseRatio);
      if (baseQty.isZero()) {
        const base = await tx.productUnit.findFirst({
          where: { productId: l.productId, isBase: true },
          select: { unitName: true },
        });
        throw new QtyRoundsToZeroError(
          new Prisma.Decimal(l.qtySent),
          unit.unitName,
          base?.unitName ?? null
        );
      }

      prepared.push({ line: l, unit, baseQty });
    }

    // How well the SENDING branch knows its own cost, read BEFORE the outflow is
    // posted — this is a statement about the goods that are about to leave, and
    // once they have left the front layer may be a different one entirely.
    const preState = await replayPairsInTx(
      tx,
      tenantId,
      prepared.map((p) => p.line.productId),
      [fromBranchId],
      dispatchedAt
    );

    const tfNumber = await generateTfNumber(tx, tenantId, fromBranch.code);

    let transfer: StockTransfer;
    try {
      transfer = await tx.stockTransfer.create({
        data: {
          id: input.submitKey,
          tenantId,
          fromBranchId,
          toBranchId,
          tfNumber,
          status: "SENT",
          dispatchedAt,
          dispatchedBy,
          dispatchedByName: input.dispatchedByName,
          driverName: input.driverName,
          // The FK stays null: a company driver will fill it the day user
          // management exists, and a hired outside driver never will (Q3).
          driverConfirmedAt: input.driverConfirmed ? new Date() : null,
          notes: input.notes,
        },
      });
    } catch (e) {
      rethrowNumberConflict(e, tfNumber);
    }

    const outMovementByItem = new Map<string, string>();

    for (const [i, p] of prepared.entries()) {
      const item = await tx.stockTransferItem.create({
        data: {
          tenantId,
          stockTransferId: transfer.id,
          productId: p.line.productId,
          lineNo: i + 1,
          qtySent: new Prisma.Decimal(p.line.qtySent),
          // NULL, not 0: nobody has counted yet, and 0 is what "nothing arrived"
          // will mean when somebody has (Q2).
          qtyReceived: null,
          inputUnitId: p.unit.id,
          inputUnitName: p.unit.unitName,
          toBaseRatio: p.unit.toBaseRatio,
          // Placeholders — the real figures are written below, once the engine
          // has been asked what this outflow actually cost.
          costTotal: ZERO,
          costSource: preState.get(costKeyOf(p.line.productId, fromBranchId))
            ?.costSource ?? "UNPRICED",
          notes: p.line.notes,
        },
      });

      const out = await createStockMovementLogic(tx, {
        tenantId,
        productId: p.line.productId,
        branchId: fromBranchId,
        qty: p.baseQty.negated(),
        type: "TRANSFER_OUT",
        sourceType: "TRANSFER_OUT",
        sourceId: item.id,
        occurredAt: dispatchedAt,
        createdBy: dispatchedBy,
        notes: p.line.notes,
      });
      outMovementByItem.set(item.id, out.id);

      await createStockMovementLogic(tx, {
        tenantId,
        productId: p.line.productId,
        branchId: toBranchId,
        // The goods belong to the receiving branch from this instant (Q1).
        qty: p.baseQty,
        type: "TRANSFER_IN",
        sourceType: "TRANSFER_IN",
        sourceId: item.id,
        occurredAt: dispatchedAt,
        createdBy: dispatchedBy,
        notes: p.line.notes,
      });
    }

    // Now ask the engine what those outflows cost and freeze the answer (Q5).
    // Deliberately AFTER posting: the walk values an outflow by the layers it
    // actually drew down, so reading it back is the only way to be certain the
    // document says the same thing /cost will.
    const postState = await replayPairsInTx(
      tx,
      tenantId,
      prepared.map((p) => p.line.productId),
      [fromBranchId]
    );

    for (const [itemId, movementId] of outMovementByItem) {
      const item = await tx.stockTransferItem.findFirstOrThrow({
        where: { id: itemId, tenantId },
        select: { productId: true },
      });
      const state = postState.get(costKeyOf(item.productId, fromBranchId));
      const outflow = state?.outflows.find((o) => o.movementId === movementId);
      await tx.stockTransferItem.update({
        where: { id: itemId },
        data: { costTotal: money(outflow?.value ?? ZERO) },
      });
    }

    return tx.stockTransfer.findFirstOrThrow({
      where: { id: transfer.id, tenantId },
      include: DETAIL_INCLUDE,
    });
  });
}

/**
 * Confirm a delivery, and post whatever never arrived (Q2).
 *
 * This posts **no** arrival — the goods arrived in the ledger when they were
 * dispatched. What it posts is the gap, as a `TRANSFER_SHORTAGE` outflow at the
 * RECEIVING branch, because that is who owned the goods while they were moving.
 */
export async function receiveTransferLogic(
  tenantId: string,
  input: ReceiveTransferInput,
  receivedBy: string
): Promise<TransferDetail> {
  return withTenantContext(tenantId, async (tx) => {
    const transfer = await tx.stockTransfer.findFirst({
      where: { id: input.id, tenantId },
      include: { items: true },
    });
    if (!transfer) throw new TransferNotFoundError(input.id);
    if (transfer.status === "VOIDED") throw new TransferNotReceivableError(transfer.id);
    if (transfer.receivedAt !== null) throw new TransferAlreadyReceivedError(transfer.id);

    // Exactly this document's lines, no strangers and none left out.
    const live = transfer.items.filter((i) => i.reversalOfItemId === null);
    const byId = new Map(live.map((i) => [i.id, i]));
    if (
      input.lines.length !== live.length ||
      input.lines.some((l) => !byId.has(l.itemId))
    ) {
      throw new TransferLineMismatchError(transfer.id);
    }

    const receivedAt = new Date();

    for (const l of input.lines) {
      const item = byId.get(l.itemId)!;
      const qtyReceived = new Prisma.Decimal(l.qtyReceived);
      if (qtyReceived.greaterThan(item.qtySent)) {
        throw new TransferQtyExceedsSentError(item.id, item.qtySent, qtyReceived);
      }

      await tx.stockTransferItem.update({
        where: { id: item.id },
        data: { qtyReceived },
      });

      const missing = item.qtySent.minus(qtyReceived);
      if (missing.isZero()) continue;

      // Converted with the line's FROZEN ratio, not a fresh lookup: a sack
      // resized between dispatch and arrival must not change how much went
      // missing on a journey that already happened (ADR 0012 Q3).
      const missingBase = toBaseQty(missing, item.toBaseRatio);
      if (missingBase.isZero()) continue;

      await createStockMovementLogic(tx, {
        tenantId,
        productId: item.productId,
        // The receiving branch's loss: the goods became its property at dispatch.
        branchId: transfer.toBranchId,
        qty: missingBase.negated(),
        // An ordinary loss movement — what makes it legible is the SOURCE, which
        // is how /cost can say "gone in transit" rather than "gone".
        type: "ADJUST_LOSS",
        sourceType: "TRANSFER_SHORTAGE",
        sourceId: item.id,
        occurredAt: receivedAt,
        createdBy: receivedBy,
        notes: input.notes,
      });
    }

    return tx.stockTransfer.update({
      where: { id: transfer.id },
      data: {
        status: "RECEIVED",
        receivedAt,
        receivedBy,
        receivedByName: input.receivedByName,
        ...(input.notes ? { notes: input.notes } : {}),
      },
      include: DETAIL_INCLUDE,
    });
  });
}

/**
 * Void a transfer: append reversal lines into the same document and post the
 * compensating movements at both branches (Q6).
 *
 * **A void is not a transfer back.** This says the document should never have
 * existed. If the goods really did travel back, that is a new transfer in the
 * opposite direction — collapse the two and a crate that made two journeys reads
 * as a crate that never left.
 *
 * Every compensating movement is valued from **what was actually posted**, never
 * recomputed from today's ratios or today's layers — Part 17 L3a's rule, and for
 * the same reason: reversing means undoing what happened, not posting what we
 * would post today.
 */
export async function voidTransferLogic(
  tenantId: string,
  input: VoidTransferInput,
  voidedBy: string
): Promise<TransferDetail> {
  return withTenantContext(tenantId, async (tx) => {
    const transfer = await tx.stockTransfer.findFirst({
      where: { id: input.id, tenantId },
      include: { items: true },
    });
    if (!transfer) throw new TransferNotFoundError(input.id);
    if (transfer.status === "VOIDED") throw new TransferAlreadyVoidedError(transfer.id);

    const live = transfer.items.filter((i) => i.reversalOfItemId === null);
    const voidedAt = new Date();
    let lineNo = Math.max(...transfer.items.map((i) => i.lineNo), 0);

    for (const item of live) {
      const posted = await tx.stockMovement.findMany({
        where: {
          tenantId,
          sourceId: item.id,
          sourceType: { in: ["TRANSFER_OUT", "TRANSFER_IN", "TRANSFER_SHORTAGE"] },
        },
        select: { qty: true, sourceType: true },
      });
      const qtyOf = (t: string) =>
        posted.find((p) => p.sourceType === t)?.qty ?? null;

      const outQty = qtyOf("TRANSFER_OUT");
      const inQty = qtyOf("TRANSFER_IN");
      // Unreachable by construction: a line and its two legs are written in ONE
      // transaction and the ledger has no delete (ADR 0011 Q7). If it fires, the
      // ledger was edited outside the app — the error boundary's business, not a
      // Thai field error on a form.
      if (!outQty || !inQty) {
        throw new Error(
          `stock_transfer_item "${item.id}" is missing a ledger leg — the ledger was modified outside the app`
        );
      }

      lineNo += 1;
      const reversal = await tx.stockTransferItem.create({
        data: {
          tenantId,
          stockTransferId: transfer.id,
          productId: item.productId,
          lineNo,
          // The original's numbers negated, so the document's own sums come to
          // zero without anyone having to know which lines were reversals.
          qtySent: item.qtySent.negated(),
          qtyReceived: item.qtyReceived ? item.qtyReceived.negated() : null,
          inputUnitId: item.inputUnitId,
          inputUnitName: item.inputUnitName,
          toBaseRatio: item.toBaseRatio,
          costTotal: item.costTotal.negated(),
          costSource: item.costSource,
          reversalOfItemId: item.id,
          notes: input.voidReason,
        },
      });

      // Back to the sender, carrying exactly the money that left with it.
      await createStockMovementLogic(tx, {
        tenantId,
        productId: item.productId,
        branchId: transfer.fromBranchId,
        qty: outQty.negated(),
        type: "TRANSFER_OUT_REVERSAL",
        sourceType: "TRANSFER_OUT",
        sourceId: reversal.id,
        occurredAt: voidedAt,
        createdBy: voidedBy,
        notes: input.voidReason,
      });

      // Off the receiver — and the walk cuts the layer THIS transfer brought in,
      // not the head of its queue, because the reversal line points back at the
      // original (ADR 0014 Q8).
      await createStockMovementLogic(tx, {
        tenantId,
        productId: item.productId,
        branchId: transfer.toBranchId,
        qty: inQty.negated(),
        type: "TRANSFER_IN_REVERSAL",
        sourceType: "TRANSFER_IN",
        sourceId: reversal.id,
        occurredAt: voidedAt,
        createdBy: voidedBy,
        notes: input.voidReason,
      });

      // A shortfall recorded against a document that never happened has to go
      // back too, or the receiving branch keeps a loss for goods it is no longer
      // deemed to have owned.
      const shortageQty = qtyOf("TRANSFER_SHORTAGE");
      if (shortageQty) {
        await createStockMovementLogic(tx, {
          tenantId,
          productId: item.productId,
          branchId: transfer.toBranchId,
          qty: shortageQty.negated(),
          type: "ADJUST_GAIN",
          sourceType: "TRANSFER_SHORTAGE",
          sourceId: reversal.id,
          occurredAt: voidedAt,
          createdBy: voidedBy,
          notes: input.voidReason,
        });
      }
    }

    return tx.stockTransfer.update({
      where: { id: transfer.id },
      data: {
        status: "VOIDED",
        voidedAt,
        voidedBy,
        voidReason: input.voidReason,
      },
      include: DETAIL_INCLUDE,
    });
  });
}

// ------------------------------------------------------------
// Internals
// ------------------------------------------------------------

/**
 * Next `{FROM_BRANCH_CODE}-TF-####`. Mirrors `generateGrNumber`, which mirrors
 * `generatePoNumber`: scan the numbers of that shape, take max + 1, pad to 4.
 *
 * Numbered by the SENDING branch, because that is who issues the document.
 * Serialised per branch by the counter lock (Part 13.5, Pitfall #25);
 * `stock_transfer_number_unique` stays as the backstop.
 */
async function generateTfNumber(
  tx: PrismaClient,
  tenantId: string,
  branchCode: string
): Promise<string> {
  await acquireCounterLock(tx, `tf_number:${tenantId}:${branchCode}`);

  const prefix = `${branchCode}-TF-`;
  const rows = await tx.stockTransfer.findMany({
    where: { tenantId, tfNumber: { startsWith: prefix } },
    select: { tfNumber: true },
  });

  const re = new RegExp(
    `^${branchCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-TF-(\\d+)$`
  );
  let max = 0;
  for (const { tfNumber } of rows) {
    const m = re.exec(tfNumber);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

/** Translate the tf_number unique violation; rethrow anything else untouched. */
function rethrowNumberConflict(e: unknown, tfNumber: string): never {
  if (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === "P2002" &&
    String(e.meta?.target ?? "").includes("stock_transfer_number")
  ) {
    throw new TransferNumberConflictError(tfNumber);
  }
  throw e;
}

/** Re-exported for the view layer, which labels a frozen cost by its provenance. */
export type { CostSource };
