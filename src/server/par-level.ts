// ============================================================
// Mise — Par level logic (Sprint 3 Part 17 L3b, ADR 0017)
// ============================================================
// "How much of this should be on the shelf here", and the list that says which
// products are under it (Q5/Q6/Q6b).
//
// Four things this file deliberately does NOT do:
//
//   * **It orders nothing and suggests nothing** (Q5). Auto-drafting a purchase
//     order needs a preferred supplier, a lead time and an approver; ADR 0012 Q1
//     dropped the purchase-request layer for want of the last one.
//   * **It does not subtract stock on order** (Q6). A row appears the moment
//     on-hand < par, whatever is in transit — because an order placed and never
//     chased is the failure nobody notices until service. The order is shown as
//     CONTEXT on the row instead, which is what the three states are.
//   * **It stores nothing it can derive.** On-hand, the gap, the state and the
//     freshness are all computed per read (ADR 0014's rule). There is no second
//     store of "what we think we have" — H.5 will write CONSUMPTION into the same
//     ledger, so one count still corrects everything at once (Q6b).
//   * **It does not predict.** Until H.5 the ledger balance only ever RISES,
//     because nothing deducts what was sold. That is precisely why every row
//     carries when its figure was last confirmed by a physical count.
// ============================================================

import { Prisma } from "@prisma/client";
import type { ParLevel, PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { assertRefBelongsToTenant } from "@/server/product";
import { StockUnitMismatchError, toBaseQty } from "@/server/stock-movement";
import type {
  DeleteParLevelInput,
  GetParLevelsQuery,
  SetParLevelInput,
} from "@/lib/validations/par-level";

const ZERO = new Prisma.Decimal(0);

/** Open in the sense that matters here: sent, and stock still owed. */
const OPEN_PO_STATUSES = ["SENT", "PARTIALLY_RECEIVED"] as const;

// ------------------------------------------------------------
// Typed errors
// ------------------------------------------------------------

export class ParLevelNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Par level "${id}" does not exist for this tenant`);
    this.name = "ParLevelNotFoundError";
  }
}

// ------------------------------------------------------------
// Read shape
// ------------------------------------------------------------

/**
 * The three states of ADR 0017 Q6, plus `OK`.
 *
 * `OVERDUE` is the case that has no home in the system today — an order that was
 * placed, is late, and that nobody is chasing. It only appears when the PO
 * carries an expected delivery date, which is optional (Consequence 7): a shop
 * that never fills them in gets the two-state version of this list, and the UI
 * should say so rather than leave the third state mysteriously empty.
 */
export type ParState = "OK" | "NEEDS_ORDER" | "ON_ORDER" | "OVERDUE";

export type ParOpenOrder = {
  /** Base-unit quantity still owed across every open order for this pair. */
  qtyOutstanding: Prisma.Decimal;
  /** The EARLIEST expected date among them — the one that is late first. */
  expectedDeliveryDate: Date | null;
  purchaseOrderId: string;
  poNumber: string;
  supplierName: string;
  /** How many open orders this row summarises; 1 in the ordinary case. */
  orderCount: number;
};

export type ParLevelRow = {
  id: string;
  productId: string;
  branchId: string;
  /** Base unit — the figure compared against the ledger. */
  parQty: Prisma.Decimal;
  /** As entered, so the form re-opens in the unit the user chose. */
  inputQty: Prisma.Decimal;
  inputUnitName: string;
  onHand: Prisma.Decimal;
  /** `parQty − onHand`, positive when short. Zero or negative when not. */
  gap: Prisma.Decimal;
  isBelow: boolean;
  state: ParState;
  openOrder: ParOpenOrder | null;
  /**
   * When someone last physically counted this product at this branch (Q6b).
   *
   * Read from the COUNT DOCUMENT (`stock_count_item.counted_at` on a CLOSED
   * count), not from the ledger's `STOCK_COUNT` movements. Closing a count posts
   * nothing for a line whose variance is zero, so the ledger cannot see a product
   * that was counted and found exactly right — which is the best-managed stock in
   * the shop, and would have read "ยังไม่เคยนับ" forever. The question this
   * answers is "did anyone stand in front of this shelf", and only the document
   * knows.
   */
  lastCountedAt: Date | null;
  product: {
    id: string;
    name: string;
    sku: string;
    baseUnitName: string | null;
    deleted: boolean;
  };
  branch: { id: string; name: string };
};

// ------------------------------------------------------------
// Writes
// ------------------------------------------------------------

/**
 * Set the par for one product at one branch, in any unit (Q5).
 *
 * An UPSERT on the live (product, branch) pair rather than an insert: a par is a
 * current setting, not a document with a history, and the partial unique in
 * prisma/manual/waste_and_par_unique.sql says the same thing. Re-setting one
 * updates the row that exists — including a soft-deleted one, which is revived
 * rather than duplicated, so removing and re-adding a par does not leave the
 * table growing a dead row per edit.
 */
export async function setParLevelLogic(
  tenantId: string,
  input: SetParLevelInput
): Promise<ParLevel> {
  const { productId, branchId, inputQty, inputUnitId } = input;

  return withTenantContext(tenantId, async (tx) => {
    await assertRefBelongsToTenant(tx, tenantId, "product", productId);
    await assertRefBelongsToTenant(tx, tenantId, "branch", branchId);

    const unit = await tx.productUnit.findFirst({
      where: { id: inputUnitId, productId },
      select: { id: true, toBaseRatio: true },
    });
    if (!unit) throw new StockUnitMismatchError(inputUnitId, productId);

    const parQty = toBaseQty(inputQty, unit.toBaseRatio);
    // A par that rounds away to nothing is not a par. The DB refuses the row
    // (par_level_qty_check); catching it here keeps the message actionable.
    if (parQty.lessThanOrEqualTo(ZERO)) {
      throw new ParQtyRoundsToZeroError(new Prisma.Decimal(inputQty));
    }

    const existing = await tx.parLevel.findFirst({
      where: { tenantId, productId, branchId },
      orderBy: { deletedAt: { sort: "asc", nulls: "first" } },
    });

    const data = {
      parQty,
      inputQty: new Prisma.Decimal(inputQty),
      inputUnitId,
      deletedAt: null,
    };

    return existing
      ? tx.parLevel.update({ where: { id: existing.id }, data })
      : tx.parLevel.create({ data: { tenantId, productId, branchId, ...data } });
  });
}

/** Thrown when a positive input converts to 0.000 in the base unit. */
export class ParQtyRoundsToZeroError extends Error {
  constructor(public readonly inputQty: Prisma.Decimal) {
    super(`Par level ${inputQty.toString()} converts to 0 in the base unit`);
    this.name = "ParQtyRoundsToZeroError";
  }
}

/**
 * Remove a par. Soft delete: the product then simply has no par, which is not a
 * state anything has to handle — it drops out of the list entirely, which is the
 * difference between "no par" and a par of zero (Q5).
 */
export async function deleteParLevelLogic(
  tenantId: string,
  input: DeleteParLevelInput
): Promise<ParLevel> {
  return withTenantContext(tenantId, async (tx) => {
    const existing = await tx.parLevel.findFirst({
      where: { id: input.id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new ParLevelNotFoundError(input.id);
    return tx.parLevel.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
  });
}

// ------------------------------------------------------------
// The list
// ------------------------------------------------------------

/**
 * Every par, with what is actually in the building, what is on the way and how
 * old the number is.
 *
 * Four reads, none of them per row: the pars, one grouped balance, one pass over
 * open order lines, one pass over closed count lines. Everything else is
 * arithmetic in memory.
 *
 * **Sorted the way Q6b asks**: below par first, and within that the stalest
 * figure first — a product that is both short and has not been counted for weeks
 * is the one to look at, because it is simultaneously the most likely to be
 * wrong and the most expensive to be wrong about. Never counted sorts above any
 * date.
 */
export async function getParLevelsLogic(
  tenantId: string,
  query: GetParLevelsQuery
): Promise<ParLevelRow[]> {
  const { branchId, search, belowOnly } = query;

  return withTenantContext(tenantId, async (tx) => {
    const pars = await tx.parLevel.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(branchId ? { branchId } : {}),
        ...(search
          ? {
              product: {
                OR: [
                  { name: { contains: search, mode: "insensitive" } },
                  { sku: { contains: search, mode: "insensitive" } },
                ],
              },
            }
          : {}),
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            deletedAt: true,
            productUnits: { where: { isBase: true }, select: { unitName: true } },
          },
        },
        branch: { select: { id: true, name: true } },
        inputUnit: { select: { unitName: true } },
      },
    });

    if (pars.length === 0) return [];

    const productIds = [...new Set(pars.map((p) => p.productId))];
    const branchIds = [...new Set(pars.map((p) => p.branchId))];
    const key = (productId: string, branch: string) => `${productId}|${branch}`;

    const [balances, orderLines, countLines] = await Promise.all([
      tx.stockMovement.groupBy({
        by: ["productId", "branchId"],
        where: {
          tenantId,
          productId: { in: productIds },
          branchId: { in: branchIds },
        },
        _sum: { qty: true },
      }),
      // Outstanding is computed from the LINE's frozen ratio (ADR 0012 Q3), not
      // from the live ProductUnit: what is owed is what was ordered.
      tx.purchaseOrderItem.findMany({
        where: {
          tenantId,
          productId: { in: productIds },
          purchaseOrder: {
            branchId: { in: branchIds },
            status: { in: [...OPEN_PO_STATUSES] },
            deletedAt: null,
          },
        },
        select: {
          productId: true,
          qtyOrdered: true,
          qtyReceived: true,
          toBaseRatio: true,
          purchaseOrder: {
            select: {
              id: true,
              poNumber: true,
              branchId: true,
              expectedDeliveryDate: true,
              supplier: { select: { nameFull: true } },
            },
          },
        },
      }),
      // The count DOCUMENT, not the ledger — a zero-variance line posts no
      // movement, and that product is exactly the one whose figure is trustworthy.
      tx.stockCountItem.findMany({
        where: {
          tenantId,
          productId: { in: productIds },
          reversalOfItemId: null,
          stockCount: {
            branchId: { in: branchIds },
            status: "CLOSED",
            deletedAt: null,
          },
        },
        select: {
          productId: true,
          countedAt: true,
          stockCount: { select: { branchId: true } },
        },
        orderBy: { countedAt: "desc" },
      }),
    ]);

    const onHandBy = new Map(
      balances.map((b) => [key(b.productId, b.branchId), b._sum.qty ?? ZERO])
    );

    const lastCountBy = new Map<string, Date>();
    for (const line of countLines) {
      // Ordered desc, so the first sighting of a pair is its latest count.
      const k = key(line.productId, line.stockCount.branchId);
      if (!lastCountBy.has(k)) lastCountBy.set(k, line.countedAt);
    }

    const openBy = new Map<string, ParOpenOrder>();
    for (const line of orderLines) {
      const outstanding = line.qtyOrdered.minus(line.qtyReceived);
      if (outstanding.lessThanOrEqualTo(ZERO)) continue;

      const k = key(line.productId, line.purchaseOrder.branchId);
      const qty = toBaseQty(outstanding, line.toBaseRatio);
      const current = openBy.get(k);

      if (!current) {
        openBy.set(k, {
          qtyOutstanding: qty,
          expectedDeliveryDate: line.purchaseOrder.expectedDeliveryDate,
          purchaseOrderId: line.purchaseOrder.id,
          poNumber: line.purchaseOrder.poNumber,
          supplierName: line.purchaseOrder.supplier.nameFull,
          orderCount: 1,
        });
        continue;
      }

      current.qtyOutstanding = current.qtyOutstanding.plus(qty);
      current.orderCount += 1;
      // The representative order is the one due FIRST — it is the one already
      // late, and the row exists to make that visible. A missing date never wins:
      // "no date" cannot be overdue.
      const candidate = line.purchaseOrder.expectedDeliveryDate;
      if (
        candidate &&
        (!current.expectedDeliveryDate ||
          candidate.getTime() < current.expectedDeliveryDate.getTime())
      ) {
        current.expectedDeliveryDate = candidate;
        current.purchaseOrderId = line.purchaseOrder.id;
        current.poNumber = line.purchaseOrder.poNumber;
        current.supplierName = line.purchaseOrder.supplier.nameFull;
      }
    }

    const now = new Date();

    const rows: ParLevelRow[] = pars.map((par) => {
      const k = key(par.productId, par.branchId);
      const onHand = onHandBy.get(k) ?? ZERO;
      const gap = par.parQty.minus(onHand);
      const isBelow = gap.greaterThan(ZERO);
      const openOrder = openBy.get(k) ?? null;

      return {
        id: par.id,
        productId: par.productId,
        branchId: par.branchId,
        parQty: par.parQty,
        inputQty: par.inputQty,
        inputUnitName: par.inputUnit.unitName,
        onHand,
        gap,
        isBelow,
        state: !isBelow
          ? "OK"
          : !openOrder
            ? "NEEDS_ORDER"
            : openOrder.expectedDeliveryDate &&
                openOrder.expectedDeliveryDate.getTime() < now.getTime()
              ? "OVERDUE"
              : "ON_ORDER",
        openOrder,
        lastCountedAt: lastCountBy.get(k) ?? null,
        product: {
          id: par.product.id,
          name: par.product.name,
          sku: par.product.sku,
          baseUnitName: par.product.productUnits[0]?.unitName ?? null,
          deleted: par.product.deletedAt !== null,
        },
        branch: par.branch,
      };
    });

    const filtered = belowOnly ? rows.filter((r) => r.isBelow) : rows;
    return filtered.sort(compareParRows);
  });
}

/**
 * Below par first, then the stalest figure, then the biggest gap, then the name.
 *
 * The freshness ordering is Q6b's: with a MONTHLY count and no consumption
 * deduction, a figure is true on count day and drifts for three more weeks. A row
 * that is short AND old is the one where the number in front of you is most
 * likely to be worse than it looks.
 */
const compareParRows = (a: ParLevelRow, b: ParLevelRow): number => {
  if (a.isBelow !== b.isBelow) return a.isBelow ? -1 : 1;

  if (a.isBelow) {
    // Never counted (null) is the stalest thing there is.
    const at = a.lastCountedAt?.getTime() ?? -Infinity;
    const bt = b.lastCountedAt?.getTime() ?? -Infinity;
    if (at !== bt) return at - bt;

    const byGap = b.gap.comparedTo(a.gap);
    if (byGap !== 0) return byGap;
  }

  return a.product.name.localeCompare(b.product.name, "th");
};

/** One product's par at one branch. */
export async function getParLevelForProductLogic(
  tenantId: string,
  productId: string,
  branchId: string
): Promise<ParLevel | null> {
  return withTenantContext(tenantId, (tx: PrismaClient) =>
    tx.parLevel.findFirst({
      where: { tenantId, productId, branchId, deletedAt: null },
    })
  );
}

/**
 * One product's pars across every branch — the product page's section.
 *
 * Raw rows rather than `ParLevelRow`s: that page sets the par, it does not judge
 * it, so it needs `inputQty`/`inputUnitId` to re-open the form in the unit the
 * user chose and nothing about on-hand or open orders.
 */
export async function getParLevelsForProductLogic(
  tenantId: string,
  productId: string
): Promise<ParLevel[]> {
  return withTenantContext(tenantId, (tx: PrismaClient) =>
    tx.parLevel.findMany({
      where: { tenantId, productId, deletedAt: null },
    })
  );
}
