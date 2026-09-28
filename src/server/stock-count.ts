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
  EditStockCountContributionInput,
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

/**
 * ADR 0034 Q3 — the person pressed ยืนยัน believing nobody had counted this
 * product, and somebody had. Refused rather than overwritten: the green line
 * reaches other devices on a polling interval, and inside that window two
 * people can both see an uncounted row. Carries what the screen needs to say
 * "เอนับไปแล้ว 4.5 กก. เมื่อ 10:32".
 */
export class CountLineTakenError extends Error {
  constructor(
    public readonly productId: string,
    public readonly countedByUserId: string,
    public readonly qtyCounted: Prisma.Decimal,
    public readonly countedAt: Date
  ) {
    super(`Product "${productId}" was already counted on this sheet`);
    this.name = "CountLineTakenError";
  }
}

/** ADR 0034 Q3 — a contribution may be changed only by the person who made it. */
export class NotYourContributionError extends Error {
  constructor(public readonly contributionId: string) {
    super(`Contribution "${contributionId}" belongs to another counter`);
    this.name = "NotYourContributionError";
  }
}

/**
 * ADR 0034 Q5 — closing, voiding, discarding the sheet or removing a whole line
 * (other people's counts with it) belongs to the host, or to a holder of
 * `count:close`.
 */
export class NotCountHostError extends Error {
  constructor(public readonly id: string) {
    super(`Only the host of stock count "${id}" or a count:close holder may do this`);
    this.name = "NotCountHostError";
  }
}

/**
 * Who is acting on a sheet, and whether they may act on anyone's behalf. The
 * action computes `canCloseAny` from the role (`count:close`); the logic
 * decides with the sheet's `started_by` in hand. Required — a caller that
 * forgot to think about it does not compile.
 */
export type CountActor = { userId: string; canCloseAny: boolean };

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
  contributions: {
    include: {
      countedByUser: { select: { id: true, name: true, email: true } },
      entries: {
        include: { productUnit: { select: { id: true, unitName: true } } },
        orderBy: { displayOrder: "asc" },
      },
    },
    orderBy: { seq: "asc" },
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

/**
 * Products holding a non-zero balance at a branch. The sheet works out "not
 * counted yet" from this on the device, as lines arrive (ADR 0034 Q7), instead
 * of asking the server again after every ยืนยัน.
 */
export async function getStockedProductIdsLogic(
  tenantId: string,
  branchId: string
): Promise<string[]> {
  return withTenantContext(tenantId, async (tx) => {
    const withStock = await tx.stockMovement.groupBy({
      by: ["productId"],
      where: { tenantId, branchId },
      _sum: { qty: true },
    });
    return withStock.filter((g) => !(g._sum.qty ?? ZERO).isZero()).map((g) => g.productId);
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

// ------------------------------------------------------------
// Counting (ADR 0034) — contributions, many devices, one sheet
// ------------------------------------------------------------

/**
 * Lock the sheet for the rest of the transaction and check it is still a draft.
 *
 * Five devices press ยืนยัน within the same second. Without this they would race
 * to create the same line and the loser would hit the partial unique
 * `stock_count_item_product_unique` as a raw error. With it they queue for a few
 * milliseconds each, and every one of them is either added or told, in words,
 * that someone got there first (ADR 0034 Q3).
 */
async function lockDraftSheet(tx: PrismaClient, tenantId: string, stockCountId: string) {
  await tx.$queryRaw`SELECT id FROM stock_count WHERE id = ${stockCountId}::uuid FOR UPDATE`;
  const count = await tx.stockCount.findFirst({
    where: { id: stockCountId, tenantId, deletedAt: null },
    select: { id: true, branchId: true, status: true, startedBy: true },
  });
  if (!count) throw new StockCountNotFoundError(stockCountId);
  if (count.status !== "DRAFT") {
    throw new StockCountNotEditableError(count.id, count.status);
  }
  return count;
}

/** Every entry's unit must belong to THIS product (also closes cross-tenant units). */
async function assertUnitsOfProduct(
  tx: PrismaClient,
  productId: string,
  entries: { productUnitId: string }[]
) {
  const units = await tx.productUnit.findMany({
    where: { id: { in: entries.map((e) => e.productUnitId) }, productId },
    select: { id: true },
  });
  const known = new Set(units.map((u) => u.id));
  for (const e of entries) {
    if (!known.has(e.productUnitId)) throw new CountUnitMismatchError(e.productUnitId, productId);
  }
}

/** Write one contribution's units, in the order they were typed. */
async function writeEntries(
  tx: PrismaClient,
  tenantId: string,
  stockCountItemId: string,
  contributionId: string,
  entries: { productUnitId: string; qtyInUnit: number }[]
) {
  await tx.stockCountEntry.createMany({
    data: entries.map((e, i) => ({
      tenantId,
      stockCountItemId,
      contributionId,
      productUnitId: e.productUnitId,
      qtyInUnit: new Prisma.Decimal(e.qtyInUnit),
      displayOrder: i + 1,
    })),
  });
}

/**
 * Bring a line back in step with its contributions — the ONE place the line's
 * numbers are written (ADR 0034 Q2/Q4, calc rule S4):
 *  - `qtyCounted` = the sum of every contribution's units, in base units;
 *  - `qtyExpected` = the ledger balance NOW (ADR 0015 Q3's snapshot, re-taken on
 *    every change, so a delivery between two contributions is not read as a loss);
 *  - `countedAt` / `countedBy` = the latest contribution's — the moment the
 *    variance occurs (ADR 0015 Q8) and the last person to touch it;
 *  - `notes` = the contributions' notes, so the ledger movement still says why.
 * A line with no contributions left is deleted: nobody counted it.
 */
async function syncLineFromContributions(
  tx: PrismaClient,
  tenantId: string,
  branchId: string,
  itemId: string
) {
  const item = await tx.stockCountItem.findFirstOrThrow({
    where: { id: itemId, tenantId },
    select: {
      productId: true,
      contributions: {
        select: {
          countedBy: true,
          countedAt: true,
          note: true,
          entries: {
            select: { qtyInUnit: true, productUnit: { select: { toBaseRatio: true } } },
          },
        },
        orderBy: { seq: "asc" },
      },
    },
  });

  if (item.contributions.length === 0) {
    await tx.stockCountItem.delete({ where: { id: itemId } });
    return;
  }

  let qtyCounted = ZERO;
  for (const c of item.contributions) {
    for (const e of c.entries) {
      qtyCounted = qtyCounted.plus(toBaseQty(e.qtyInUnit.toNumber(), e.productUnit.toBaseRatio));
    }
  }
  const latest = [...item.contributions].sort(
    (a, b) => b.countedAt.getTime() - a.countedAt.getTime()
  )[0];

  const agg = await tx.stockMovement.aggregate({
    where: { tenantId, productId: item.productId, branchId },
    _sum: { qty: true },
  });

  const notes = item.contributions
    .map((c) => c.note)
    .filter((n): n is string => !!n)
    .join(" · ");

  await tx.stockCountItem.update({
    where: { id: itemId },
    data: {
      qtyCounted,
      qtyExpected: agg._sum.qty ?? ZERO,
      countedAt: latest.countedAt,
      countedBy: latest.countedBy,
      countedByName: null,
      notes: notes || null,
    },
  });
}

const detailOf = (tx: PrismaClient, tenantId: string, id: string) =>
  tx.stockCount.findFirstOrThrow({ where: { id, tenantId }, include: DETAIL_INCLUDE });

/**
 * Confirm one person's count of one product (ADR 0034 Q2/Q3).
 *
 * `new` refuses with CountLineTakenError when the line already exists — the
 * person believed it was uncounted, and overwriting whoever beat them to it is
 * exactly the silent loss this ADR exists to stop. `add` appends a further
 * contribution ("found more in the walk-in") and the line becomes the sum.
 *
 * Both numbers that matter are resolved here, never from the client: the
 * expected balance and the counted instant (ADR 0015 Q3/Q8).
 */
export async function saveStockCountLineLogic(
  tenantId: string,
  input: SaveStockCountLineInput,
  countedBy: string
): Promise<StockCountDetail> {
  return withTenantContext(tenantId, async (tx) => {
    const count = await lockDraftSheet(tx, tenantId, input.stockCountId);
    await assertRefBelongsToTenant(tx, tenantId, "product", input.productId);
    await assertUnitsOfProduct(tx, input.productId, input.entries);

    let item = await tx.stockCountItem.findFirst({
      where: { tenantId, stockCountId: count.id, productId: input.productId, reversalOfItemId: null },
      select: { id: true, countedBy: true, qtyCounted: true, countedAt: true },
    });

    if (item && input.mode === "new") {
      throw new CountLineTakenError(input.productId, item.countedBy, item.qtyCounted, item.countedAt);
    }

    const isNewLine = !item;
    if (!item) {
      const maxLine = await tx.stockCountItem.aggregate({
        where: { stockCountId: count.id },
        _max: { lineNo: true },
      });
      // Placeholder numbers; syncLineFromContributions writes the real ones
      // before this transaction commits.
      item = await tx.stockCountItem.create({
        data: {
          tenantId,
          stockCountId: count.id,
          productId: input.productId,
          lineNo: (maxLine._max.lineNo ?? 0) + 1,
          qtyCounted: ZERO,
          qtyExpected: ZERO,
          countedAt: new Date(),
          countedBy,
        },
        select: { id: true, countedBy: true, qtyCounted: true, countedAt: true },
      });
    }

    // A line created just now has no contributions yet — skip the round trip.
    const seq = isNewLine
      ? 1
      : ((
          await tx.stockCountContribution.aggregate({
            where: { stockCountItemId: item.id },
            _max: { seq: true },
          })
        )._max.seq ?? 0) + 1;
    const contribution = await tx.stockCountContribution.create({
      data: {
        tenantId,
        stockCountItemId: item.id,
        seq,
        countedBy,
        countedAt: new Date(),
        note: input.notes,
      },
      select: { id: true },
    });
    await writeEntries(tx, tenantId, item.id, contribution.id, input.entries);

    await syncLineFromContributions(tx, tenantId, count.branchId, item.id);
    return detailOf(tx, tenantId, count.id);
  });
}

/** Correct your own contribution: its units, its note, and its moment. */
export async function editStockCountContributionLogic(
  tenantId: string,
  input: EditStockCountContributionInput,
  userId: string
): Promise<StockCountDetail> {
  return withTenantContext(tenantId, async (tx) => {
    const count = await lockDraftSheet(tx, tenantId, input.stockCountId);
    const contribution = await tx.stockCountContribution.findFirst({
      where: { id: input.contributionId, tenantId, item: { stockCountId: count.id } },
      select: {
        id: true,
        countedBy: true,
        stockCountItemId: true,
        item: { select: { productId: true } },
      },
    });
    if (!contribution) throw new StockCountNotFoundError(input.contributionId);
    if (contribution.countedBy !== userId) throw new NotYourContributionError(contribution.id);

    await assertUnitsOfProduct(tx, contribution.item.productId, input.entries);

    await tx.stockCountEntry.deleteMany({ where: { contributionId: contribution.id } });
    await tx.stockCountContribution.update({
      where: { id: contribution.id },
      data: { countedAt: new Date(), note: input.notes },
    });
    await writeEntries(tx, tenantId, contribution.stockCountItemId, contribution.id, input.entries);

    await syncLineFromContributions(tx, tenantId, count.branchId, contribution.stockCountItemId);
    return detailOf(tx, tenantId, count.id);
  });
}

/** Take back your own contribution. The line goes with it if it was the last. */
export async function deleteStockCountContributionLogic(
  tenantId: string,
  stockCountId: string,
  contributionId: string,
  userId: string
): Promise<StockCountDetail> {
  return withTenantContext(tenantId, async (tx) => {
    const count = await lockDraftSheet(tx, tenantId, stockCountId);
    const contribution = await tx.stockCountContribution.findFirst({
      where: { id: contributionId, tenantId, item: { stockCountId: count.id } },
      select: { id: true, countedBy: true, stockCountItemId: true },
    });
    if (!contribution) throw new StockCountNotFoundError(contributionId);
    if (contribution.countedBy !== userId) throw new NotYourContributionError(contribution.id);

    // Its entries cascade from it.
    await tx.stockCountContribution.delete({ where: { id: contribution.id } });
    await syncLineFromContributions(tx, tenantId, count.branchId, contribution.stockCountItemId);
    return detailOf(tx, tenantId, count.id);
  });
}

/**
 * Remove a whole line — "this product should not be on the sheet at all" — with
 * every person's count on it. Host or count:close only (ADR 0034 Q5): one cook
 * must not be able to wipe another's numbers.
 */
export async function deleteStockCountLineLogic(
  tenantId: string,
  stockCountId: string,
  itemId: string,
  actor: CountActor
): Promise<StockCountDetail> {
  return withTenantContext(tenantId, async (tx) => {
    const count = await lockDraftSheet(tx, tenantId, stockCountId);
    if (!actor.canCloseAny && count.startedBy !== actor.userId) {
      throw new NotCountHostError(count.id);
    }
    // Entries first: they point at the line with a RESTRICT key, so leaving
    // them to the contribution cascade would depend on trigger order.
    // Contributions then cascade from the line.
    await tx.stockCountEntry.deleteMany({
      where: { tenantId, stockCountItemId: itemId, item: { stockCountId: count.id } },
    });
    await tx.stockCountItem.deleteMany({
      where: { id: itemId, tenantId, stockCountId: count.id, reversalOfItemId: null },
    });
    return detailOf(tx, tenantId, count.id);
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
  actor: CountActor
): Promise<StockCountDetail> {
  const closedBy = actor.userId;
  return withTenantContext(
    tenantId,
    async (tx) => {
      // Locked like a save, so a contribution cannot land between reading the
      // lines and posting them (ADR 0034 Q3).
      await tx.$queryRaw`SELECT id FROM stock_count WHERE id = ${input.id}::uuid FOR UPDATE`;
      const count = await tx.stockCount.findFirst({
        where: { id: input.id, tenantId, deletedAt: null },
        include: { items: true },
      });
      if (!count) throw new StockCountNotFoundError(input.id);
      if (count.status !== "DRAFT") {
        throw new StockCountTransitionError(count.id, count.status, "CLOSED");
      }
      // ADR 0034 Q5: the host, or anyone holding count:close.
      if (!actor.canCloseAny && count.startedBy !== actor.userId) {
        throw new NotCountHostError(count.id);
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
  actor: CountActor
): Promise<StockCountDetail> {
  const voidedBy = actor.userId;
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
      // ADR 0034 Q5: the host, or anyone holding count:close.
      if (!actor.canCloseAny && count.startedBy !== actor.userId) {
        throw new NotCountHostError(count.id);
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
  id: string,
  actor: CountActor
): Promise<StockCount> {
  return withTenantContext(tenantId, async (tx) => {
    const count = await tx.stockCount.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, status: true, startedBy: true },
    });
    if (!count) throw new StockCountNotFoundError(id);
    if (count.status !== "DRAFT") {
      throw new StockCountNotEditableError(count.id, count.status);
    }
    // ADR 0034 Q5: the host, or anyone holding count:close.
    if (!actor.canCloseAny && count.startedBy !== actor.userId) {
      throw new NotCountHostError(count.id);
    }
    return tx.stockCount.update({
      where: { id: count.id },
      data: { deletedAt: new Date() },
    });
  });
}
