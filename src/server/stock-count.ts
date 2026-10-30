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
import { createStockMovementLogic, occurredAtFilter, toBaseQty } from "@/server/stock-movement";
import { countWindows } from "@/lib/gross-profit-blocker";
import { getProductCostsLogic, layerValueOf } from "@/server/stock-cost";
import { getProductCostsQuerySchema } from "@/lib/validations/stock-cost";
import type { CostAccess } from "@/lib/permissions/cost-access";
import { branchScopeWhere, type BranchReach } from "@/lib/permissions/service";
import { settleCountedPreppedInTx, voidProductionInTx } from "@/server/production";
import { writeCostDeclaration } from "@/server/cost-declaration";
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
 * Who is acting on a sheet, whether they may act on anyone's behalf, and WHERE
 * they may act. The action computes `canCloseAny` from the role (`count:close`)
 * and `reach` from the membership; the logic decides with the sheet's
 * `started_by` and `branch_id` in hand. Required — a caller that forgot to
 * think about it does not compile.
 *
 * `reach` (rule A5, 2026-10-29): a counter with one branch saw and could write
 * every branch's sheets, because nothing below the page asked. It is checked
 * in the same query that finds the sheet, so it costs no round trip on the
 * per-row ยืนยัน — and a sheet outside reach is NOT FOUND for that person,
 * the way RLS makes another tenant's rows not exist.
 */
export type CountActor = { userId: string; canCloseAny: boolean; reach: BranchReach };

/**
 * The sheets a reach covers, as a `stock_count` filter. An AND clause, not a
 * `branchId` key: the list's own `...(query.branchId ? { branchId } : {})`
 * spreads after it and would overwrite the key (found 2026-10-29 in the
 * order list, where `?branch=` of another branch still listed it).
 */
const inReach = (reach: BranchReach): Prisma.StockCountWhereInput =>
  reach.allBranches ? {} : { AND: [{ branchId: { in: [...reach.allowedBranchIds] } }] };

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
  query: GetStockCountsQuery,
  /** Rule A5: the list narrows to the reader's branches — `branchId` is optional, so asserting it guards nothing. */
  reach: BranchReach
): Promise<StockCountListRow[]> {
  return withTenantContext(tenantId, (tx) =>
    tx.stockCount.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...inReach(reach),
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

/**
 * Cost per base unit for valuing a sheet's variance (ADR 0015 Q4), or `null`
 * for a reader without `cost:view`.
 *
 * The ticket is required because the count sheet is opened by cooks and heads
 * of department (`count:write`), who see no money anywhere (ADR 0029). Until
 * 2026-10-26 the page computed this for everyone, printed มูลค่าส่วนต่าง ฿ to
 * them, and shipped every unit cost in the page payload (ADR 0038 audit).
 */
export async function getCountVarianceCostsLogic(
  tenantId: string,
  costAccess: CostAccess | null,
  branchId: string,
  productIds: readonly string[]
): Promise<Record<string, string> | null> {
  if (!costAccess) return null;
  if (productIds.length === 0) return {};
  const costs = await getProductCostsLogic(
    tenantId,
    getProductCostsQuerySchema.parse({ productIds: [...productIds], branchId })
  );
  const out: Record<string, string> = {};
  for (const [productId, state] of costs) out[productId] = state.costPerBaseUnit.toString();
  return out;
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
async function lockDraftSheet(tx: PrismaClient, tenantId: string, stockCountId: string, reach: BranchReach) {
  await tx.$queryRaw`SELECT id FROM stock_count WHERE id = ${stockCountId}::uuid FOR UPDATE`;
  const count = await tx.stockCount.findFirst({
    where: { id: stockCountId, tenantId, deletedAt: null, ...inReach(reach) },
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
  actor: CountActor
): Promise<StockCountDetail> {
  const countedBy = actor.userId;
  return withTenantContext(tenantId, async (tx) => {
    const count = await lockDraftSheet(tx, tenantId, input.stockCountId, actor.reach);
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
  actor: CountActor
): Promise<StockCountDetail> {
  const userId = actor.userId;
  return withTenantContext(tenantId, async (tx) => {
    const count = await lockDraftSheet(tx, tenantId, input.stockCountId, actor.reach);
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
  actor: CountActor
): Promise<StockCountDetail> {
  const userId = actor.userId;
  return withTenantContext(tenantId, async (tx) => {
    const count = await lockDraftSheet(tx, tenantId, stockCountId, actor.reach);
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
    const count = await lockDraftSheet(tx, tenantId, stockCountId, actor.reach);
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
        where: { id: input.id, tenantId, deletedAt: null, ...inReach(actor.reach) },
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

      // Rule PG4: the branch's first count is its OPENING — what it finds is
      // the stock it starts from, and each gain carries the price typed (or
      // filled in) at close, so the shelf is not worth ฿0.
      const opening = await isOpeningCountInTx(tx, tenantId, count);
      const priceOf = new Map((opening ? (input.prices ?? []) : []).map((p) => [p.productId, p]));

      // ADR 0040 Q2: prepped stock counted above the ledger was MADE — write
      // those productions first and lower every line's ledger figure by what
      // they used, then post only the difference that remains.
      const made = await settleCountedPreppedInTx(tx, tenantId, count, closedBy);
      const items = made.length
        ? await tx.stockCountItem.findMany({ where: { tenantId, stockCountId: count.id } })
        : count.items;

      for (const item of items) {
        const variance = item.qtyCounted.minus(item.qtyExpected);
        if (variance.isZero()) continue;

        const movement = await createStockMovementLogic(tx, {
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
        const price = priceOf.get(item.productId);
        if (price && movement.type === "ADJUST_GAIN") {
          await writeCostDeclaration(tx, {
            tenantId,
            movementId: movement.id,
            productId: item.productId,
            movementType: movement.type,
            body: { unitCost: price.unitCost, unitId: price.unitId, note: "นับเปิดระบบ" },
            declaredBy: closedBy,
          });
        }
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
        where: { id: input.id, tenantId, deletedAt: null, ...inReach(actor.reach) },
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

      // ADR 0040 Q2: the productions this count wrote for prepped stock it
      // found above the ledger stand or fall with it.
      const madeByCount = await tx.production.findMany({
        where: { tenantId, origin: "STOCK_COUNT", originId: count.id, voidedAt: null },
        select: { id: true },
      });
      for (const p of madeByCount) {
        await voidProductionInTx(tx, tenantId, { id: p.id, reason: input.voidReason }, voidedBy);
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
      where: { id, tenantId, deletedAt: null, ...inReach(actor.reach) },
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

/**
 * Rule PG2's reminder (Kong 2026-10-30, proposal E): on the month's last two
 * days, a นับสต๊อก shop is told to count tonight (or tomorrow night) — the
 * count its gross profit for the month cannot be worked out without. Lists the
 * branches in reach with no closed count inside the month's closing window
 * yet; null when the reminder does not apply (another method, not the last two
 * days, or nothing to count).
 */
export async function monthEndCountDueLogic(
  tenantId: string,
  reach: BranchReach,
  today: Date
): Promise<{ lastDay: Date; branches: { id: string; name: string }[] } | null> {
  const lastDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  const daysLeft = Math.round((lastDay.getTime() - today.getTime()) / 86_400_000);
  if (daysLeft > 1) return null;
  const month = occurredAtFilter(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)), lastDay) as { gte: Date; lt: Date };
  const { closing } = countWindows(month, month.lt);
  return withTenantContext(tenantId, async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { grossProfitMethod: true } });
    if (tenant.grossProfitMethod !== "PERIODIC_INVENTORY") return null;
    if (!(await tx.product.findFirst({ where: { tenantId, deletedAt: null }, select: { id: true } }))) return null;
    const branches = await tx.branch.findMany({
      where: { tenantId, deletedAt: null, ...branchScopeWhere(reach) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const counted = await tx.stockCount.findMany({
      where: {
        tenantId,
        branchId: { in: branches.map((b) => b.id) },
        status: "CLOSED",
        deletedAt: null,
        items: { some: { countedAt: closing, reversalOfItemId: null } },
      },
      select: { branchId: true },
      distinct: ["branchId"],
    });
    const done = new Set(counted.map((c) => c.branchId));
    const due = branches.filter((b) => !done.has(b.id));
    return due.length ? { lastDay, branches: due } : null;
  });
}

// ------------------------------------------------------------
// Rule PG4 — the opening count (นับเปิดระบบ)
// ------------------------------------------------------------

/**
 * A branch's FIRST closed count is its opening count: what it finds is the
 * stock the branch starts from (ยอดยกมา), not stock the ledger lost or
 * gained. Derived from history, never a flag somebody ticks — a voided first
 * count hands the role to the next one.
 */
export async function isOpeningCountInTx(
  tx: PrismaClient,
  tenantId: string,
  count: { id: string; branchId: string; status: StockCountStatus; closedAt: Date | null }
): Promise<boolean> {
  if (count.status === "VOIDED") return false;
  const earlier = await tx.stockCount.count({
    where: {
      tenantId,
      branchId: count.branchId,
      status: "CLOSED",
      deletedAt: null,
      id: { not: count.id },
      ...(count.closedAt ? { closedAt: { lt: count.closedAt } } : {}),
    },
  });
  return earlier === 0;
}

export async function isOpeningCountLogic(tenantId: string, countId: string): Promise<boolean> {
  return withTenantContext(tenantId, async (tx) => {
    const count = await tx.stockCount.findFirst({
      where: { id: countId, tenantId, deletedAt: null },
      select: { id: true, branchId: true, status: true, closedAt: true },
    });
    return count ? isOpeningCountInTx(tx, tenantId, count) : false;
  });
}

export type OpeningPriceLine = {
  productId: string;
  productName: string;
  /** What will enter the ledger, in base units (counted − expected). */
  qty: string;
  baseUnitName: string | null;
  units: { id: string; unitName: string; toBaseRatio: string }[];
  /** The filled-in price and the unit it is per; null when nothing is known. */
  unitId: string | null;
  unitCost: string | null;
  /** LEDGER = what the cost engine already holds; SUPPLIER = the price set on a supplier. */
  source: "LEDGER" | "SUPPLIER" | null;
};

/**
 * Rule PG4: the lines of an OPEN opening count that will enter stock, each
 * with the price the close sheet fills in — the cost the ledger already knows
 * for this branch, else the price set on a supplier (branch override first,
 * then the preferred supplier, then the newest), else nothing. null when the
 * sheet is not an open opening count.
 *
 * Ungated on purpose: the close action uses it to price for a closer who
 * cannot see cost. What reaches a SCREEN is gated by the caller (cost:view).
 */
export async function getOpeningPricesLogic(tenantId: string, countId: string): Promise<OpeningPriceLine[] | null> {
  const today = new Date();
  const facts = await withTenantContext(tenantId, async (tx) => {
    const count = await tx.stockCount.findFirst({
      where: { id: countId, tenantId, deletedAt: null },
      include: {
        items: {
          where: { reversalOfItemId: null },
          orderBy: { lineNo: "asc" },
          include: {
            product: {
              select: { name: true, productUnits: { select: { id: true, unitName: true, toBaseRatio: true, isBase: true }, orderBy: { toBaseRatio: "asc" } } },
            },
          },
        },
      },
    });
    if (!count || count.status !== "DRAFT") return null;
    if (!(await isOpeningCountInTx(tx, tenantId, count))) return null;
    const gains = count.items.filter((i) => i.qtyCounted.greaterThan(i.qtyExpected));
    const mappings = gains.length
      ? await tx.supplierProductMapping.findMany({
          where: {
            tenantId,
            productId: { in: gains.map((g) => g.productId) },
            deletedAt: null,
            currentUnitPrice: { not: null },
            OR: [{ branchId: null }, { branchId: count.branchId }],
            AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] }],
          },
          select: { productId: true, orderUnitId: true, currentUnitPrice: true, branchId: true, isPreferred: true, effectiveFrom: true },
        })
      : [];
    return { branchId: count.branchId, gains, mappings };
  });
  if (!facts) return null;
  if (facts.gains.length === 0) return [];

  const costs = await getProductCostsLogic(
    tenantId,
    getProductCostsQuerySchema.parse({ productIds: facts.gains.map((g) => g.productId), branchId: facts.branchId })
  );
  const rank = (m: (typeof facts.mappings)[number]) => [m.branchId ? 0 : 1, m.isPreferred ? 0 : 1, -m.effectiveFrom.getTime()];
  const bestMapping = new Map<string, (typeof facts.mappings)[number]>();
  for (const m of facts.mappings) {
    const cur = bestMapping.get(m.productId);
    if (!cur || compareRank(rank(m), rank(cur)) < 0) bestMapping.set(m.productId, m);
  }

  return facts.gains.map((g) => {
    const base = g.product.productUnits.find((u) => u.isBase) ?? null;
    const units = g.product.productUnits.map((u) => ({ id: u.id, unitName: u.unitName, toBaseRatio: u.toBaseRatio.toString() }));
    const ledger = costs.get(g.productId)?.costPerBaseUnit ?? ZERO;
    const mapping = bestMapping.get(g.productId);
    const price: Pick<OpeningPriceLine, "unitId" | "unitCost" | "source"> =
      ledger.greaterThan(0) && base
        ? { unitId: base.id, unitCost: ledger.toDecimalPlaces(2).toString(), source: "LEDGER" }
        : mapping?.currentUnitPrice && (mapping.orderUnitId ?? base?.id)
          ? { unitId: (mapping.orderUnitId ?? base!.id), unitCost: mapping.currentUnitPrice.toString(), source: "SUPPLIER" }
          : { unitId: base?.id ?? null, unitCost: null, source: null };
    return {
      productId: g.productId,
      productName: g.product.name,
      qty: g.qtyCounted.minus(g.qtyExpected).toString(),
      baseUnitName: base?.unitName ?? null,
      units,
      ...price,
    };
  });
}

const compareRank = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

// ------------------------------------------------------------
// Rule PG6 — opening stock still unpriced takes its first receipt's price
// ------------------------------------------------------------
// A shop that closes its opening count without a price for something leaves
// that stock at "ยังไม่มีราคา", and no later bill reaches back to price it —
// cost only ever uses what happened BEFORE (ADR 0014). Once the thing is
// received for the first time after the count, its price is the best evidence
// of what the counted stock was worth, so the count offers it. Never silently:
// the shop confirms each line (or all of them), may change the figure, and the
// price is written as the ordinary cost declaration on the opening gain
// (ADR 0014 Q6) — the same statement a person can make by hand on /cost.
// Kong 2026-10-30, "อนุมัติการเพิ่มกฎคำนวณ".

export type UnpricedOpeningLine = {
  /** The opening gain this price would be declared on. */
  movementId: string;
  productId: string;
  productName: string;
  /** What entered stock, in base units. */
  qty: string;
  baseUnitName: string;
  units: { id: string; unitName: string; toBaseRatio: string }[];
  /** The first receipt at this branch after the count began, priced as the ledger prices it; null when none yet. */
  suggestion: {
    unitId: string;
    unitName: string;
    /** Per `unitId`, VAT included when the shop could not reclaim it — what the receipt's layer costs. */
    unitCost: string;
    receivedAt: string;
    grNumber: string;
    supplierName: string;
  } | null;
};

/**
 * The opening gains of a CLOSED opening count that still have no price, each
 * with what its first later receipt suggests. null when the count is not a
 * closed opening count.
 */
export async function getUnpricedOpeningLogic(tenantId: string, countId: string): Promise<UnpricedOpeningLine[] | null> {
  return withTenantContext(tenantId, async (tx) => {
    const count = await tx.stockCount.findFirst({
      where: { id: countId, tenantId, deletedAt: null },
      include: { items: { where: { reversalOfItemId: null }, select: { id: true, countedAt: true } } },
    });
    if (!count || count.status !== "CLOSED") return null;
    if (!(await isOpeningCountInTx(tx, tenantId, count))) return null;
    const itemIds = count.items.map((i) => i.id);
    if (itemIds.length === 0) return [];

    const gains = await tx.stockMovement.findMany({
      where: { tenantId, sourceType: "STOCK_COUNT", sourceId: { in: itemIds }, type: "ADJUST_GAIN" },
      select: {
        id: true,
        productId: true,
        qty: true,
        product: {
          select: { name: true, productUnits: { select: { id: true, unitName: true, toBaseRatio: true, isBase: true }, orderBy: { toBaseRatio: "asc" } } },
        },
      },
    });
    const priced = new Set(
      (await tx.stockCostDeclaration.findMany({ where: { tenantId, movementId: { in: gains.map((g) => g.id) }, supersededAt: null }, select: { movementId: true } })).map(
        (d) => d.movementId
      )
    );
    const unpriced = gains.filter((g) => !priced.has(g.id));
    if (unpriced.length === 0) return [];

    // "After the count" is after counting began — a delivery that morning,
    // before anyone counted, is already in what the count found.
    const began = count.items.reduce((min, i) => (i.countedAt < min ? i.countedAt : min), count.items[0].countedAt);
    const receipts = await tx.goodsReceiptItem.findMany({
      where: {
        tenantId,
        productId: { in: unpriced.map((g) => g.productId) },
        reversalOfItemId: null,
        qtyReceivedActual: { gt: 0 },
        goodsReceipt: { branchId: count.branchId, status: "CONFIRMED", voidedAt: null, deletedAt: null, receivedAt: { gte: began } },
      },
      select: {
        productId: true,
        qtyReceivedActual: true,
        receivedUnitId: true,
        receivedUnitName: true,
        lineTotalActual: true,
        lineTotalQuoted: true,
        goodsReceipt: {
          select: { grNumber: true, receivedAt: true, vatRatePercent: true, vatReclaimable: true, pricesIncludeVat: true, supplier: { select: { nameFull: true } } },
        },
      },
      orderBy: [{ goodsReceipt: { receivedAt: "asc" } }, { lineNo: "asc" }],
    });
    const first = new Map<string, (typeof receipts)[number]>();
    for (const r of receipts) if (!first.has(r.productId)) first.set(r.productId, r);

    return unpriced
      .map((g): UnpricedOpeningLine => {
        const base = g.product.productUnits.find((u) => u.isBase);
        const r = first.get(g.productId);
        return {
          movementId: g.id,
          productId: g.productId,
          productName: g.product.name,
          qty: g.qty.toString(),
          baseUnitName: base?.unitName ?? "",
          units: g.product.productUnits.map((u) => ({ id: u.id, unitName: u.unitName, toBaseRatio: u.toBaseRatio.toString() })),
          suggestion: r
            ? {
                unitId: r.receivedUnitId,
                unitName: r.receivedUnitName,
                unitCost: layerValueOf(r).div(r.qtyReceivedActual).toDecimalPlaces(2).toString(),
                receivedAt: r.goodsReceipt.receivedAt.toISOString(),
                grNumber: r.goodsReceipt.grNumber,
                supplierName: r.goodsReceipt.supplier.nameFull,
              }
            : null,
        };
      })
      .sort((a, b) => a.productName.localeCompare(b.productName, "th"));
  });
}

export class OpeningPriceTargetError extends Error {
  constructor(public readonly movementId: string) {
    super(`Movement "${movementId}" is not an opening gain of this count`);
    this.name = "OpeningPriceTargetError";
  }
}

/**
 * Declare the prices the shop confirmed, all in one transaction. Each movement
 * must be an opening gain of THIS count — the page's list is a convenience, the
 * check is here.
 */
export async function declareOpeningPricesLogic(
  tenantId: string,
  input: { countId: string; lines: { movementId: string; unitId: string; unitCost: number; note: string }[] },
  declaredBy: string
): Promise<number> {
  return withTenantContext(
    tenantId,
    async (tx) => {
      const count = await tx.stockCount.findFirst({
        where: { id: input.countId, tenantId, deletedAt: null },
        include: { items: { where: { reversalOfItemId: null }, select: { id: true } } },
      });
      if (!count || count.status !== "CLOSED" || !(await isOpeningCountInTx(tx, tenantId, count))) throw new OpeningPriceTargetError(input.lines[0]?.movementId ?? "");
      const gains = await tx.stockMovement.findMany({
        where: { tenantId, sourceType: "STOCK_COUNT", sourceId: { in: count.items.map((i) => i.id) }, type: "ADJUST_GAIN", id: { in: input.lines.map((l) => l.movementId) } },
        select: { id: true, productId: true, type: true },
      });
      const byId = new Map(gains.map((g) => [g.id, g]));
      for (const l of input.lines) {
        const g = byId.get(l.movementId);
        if (!g) throw new OpeningPriceTargetError(l.movementId);
        await writeCostDeclaration(tx, {
          tenantId,
          movementId: g.id,
          productId: g.productId,
          movementType: g.type,
          body: { unitCost: l.unitCost, unitId: l.unitId, note: l.note },
          declaredBy,
        });
      }
      return input.lines.length;
    },
    { timeout: 30_000 }
  );
}

/**
 * Rule PG6 on the dashboard: each branch whose opening count has unpriced
 * stock that a receipt can now price. Asked through `getUnpricedOpeningLogic`
 * so the strip and the count page can never disagree about what is waiting.
 */
export async function openingPricesWaitingLogic(
  tenantId: string,
  reach: BranchReach
): Promise<{ countId: string; branchName: string; ready: number }[]> {
  // A branch's earliest closed count is its opening count (rule PG4).
  const counts = await withTenantContext(tenantId, (tx) =>
    tx.stockCount.findMany({
      where: { tenantId, status: "CLOSED", deletedAt: null, branch: branchScopeWhere(reach) },
      orderBy: { closedAt: "asc" },
      distinct: ["branchId"],
      select: { id: true, branch: { select: { name: true } } },
    })
  );
  const waiting = await Promise.all(
    counts.map(async (c) => ({ countId: c.id, branchName: c.branch.name, ready: ((await getUnpricedOpeningLogic(tenantId, c.id)) ?? []).filter((l) => l.suggestion !== null).length }))
  );
  return waiting.filter((w) => w.ready > 0);
}
