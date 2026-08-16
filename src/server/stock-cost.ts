// ============================================================
// Mise — Cost READ logic (Sprint 2 Part 14 L3a, ADR 0014)
// ============================================================
// The database side of the replay: fetch the ledger rows for a (product, branch)
// along with the two facts the ledger does not itself carry — the money on the
// receipt behind each `PO_RECEIVE`, and any live cost declaration — then hand
// them to `replayFifoLayers`. Nothing here decides anything about FIFO; the
// arithmetic all lives in `fifo-replay.ts`, deliberately, so it can be tested
// without a database.
//
// **The batch function is the primitive and the single-product one wraps it**
// (ADR 0014 Consequence 2 / risk R1). This is not stylistic. Neon is in
// Singapore, ~30-60 ms per round trip, so a caller that loops over 200 products
// spends 6-16 SECONDS while the row count stays trivially small. There is
// deliberately no per-product query exported for a loop to reach.
//
// Reads never assert ownership of the ids they are given (the Part 10 L3a rule):
// the `tenantId` filter turns a foreign id into an empty ledger, and an empty
// ledger is the honest answer. Ownership assertions belong to the write path.
// ============================================================

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { bangkokDayEndUtc, isDayValue } from "@/lib/bangkok-date";
import { occurredAtFilter } from "@/server/stock-movement";
import {
  replayFifoLayers,
  type CostLayer,
  type CostMovement,
  type ReplayState,
} from "@/server/fifo-replay";
import type {
  GetBranchCostSummaryQuery,
  GetProductCostQuery,
  GetProductCostsQuery,
} from "@/lib/validations/stock-cost";

const ZERO = new Prisma.Decimal(0);

/** A replayed state, labelled with the pair it belongs to. */
export type ProductCost = ReplayState & {
  productId: string;
  branchId: string;
};

/** `${productId}|${branchId}` — layers are per PAIR, never per product (Q9). */
const keyOf = (productId: string, branchId: string) => `${productId}|${branchId}`;

/**
 * The instant a movement is treated as having happened, FOR COSTING ONLY.
 *
 * Two locked decisions collide here: ADR 0011 Q5 gives a manual adjustment a
 * business **date** (the `/stock/adjust` form submits Bangkok midnight), while
 * ADR 0013 Q4 gives a receipt a true **instant**. Ordering the ledger by the raw
 * `occurred_at` therefore puts *every* adjustment before *every* receipt of the
 * same day, and waste thrown out after the morning delivery gets valued at
 * yesterday's cost — or at zero on a product's first day.
 *
 * A date-only value names a whole Bangkok business day, so for ordering it is
 * read as that day's END (less 1 ms, to stay strictly inside it). "The day's
 * counting happened after the day's deliveries" is both the truer default and
 * the one that values same-day waste at what the goods actually cost.
 *
 * **Read-layer only, and deliberately so** — no stored `occurred_at` changes, no
 * migration, nothing to backfill, and the ledger keeps saying exactly what it
 * always said. The history viewer (Part 10 L5c) still lists rows by the raw
 * value; that is a display order, and changing it is Part 10's call, not this
 * Part's.
 */
const costSortKey = (occurredAt: Date): number =>
  isDayValue(occurredAt)
    ? bangkokDayEndUtc(occurredAt).getTime() - 1
    : occurredAt.getTime();

/** The empty state, for a pair with no ledger rows at all. */
const emptyState = (productId: string, branchId: string): ProductCost => ({
  productId,
  branchId,
  layers: [],
  qtyOnHand: ZERO,
  inventoryValue: ZERO,
  costPerBaseUnit: ZERO,
  costSource: "UNPRICED",
  lastKnownUnitCost: null,
  hasUnpricedLayers: false,
  negativeStock: false,
  totalIn: ZERO,
  totalOut: ZERO,
  outflows: [],
});

/**
 * Fetch and replay many (product, branch) pairs in a fixed number of queries.
 *
 * Three round trips regardless of how many products are asked for: the ledger
 * rows, the receipt money behind them, and the live declarations. Grouping and
 * ordering happen in memory — the index already returns the rows in
 * `(occurredAt, createdAt)` order, so `id` is the only tiebreak left to apply.
 */
async function replayPairs(
  tx: PrismaClient,
  tenantId: string,
  productIds: string[],
  branchIds: string[],
  asOf?: Date
): Promise<Map<string, ProductCost>> {
  const result = new Map<string, ProductCost>();
  if (productIds.length === 0 || branchIds.length === 0) return result;

  const occurredAt = occurredAtFilter(undefined, asOf);

  const movements = await tx.stockMovement.findMany({
    where: {
      tenantId,
      productId: { in: productIds },
      branchId: { in: branchIds },
      ...(occurredAt ? { occurredAt } : {}),
    },
    select: {
      id: true,
      productId: true,
      branchId: true,
      qty: true,
      type: true,
      sourceType: true,
      sourceId: true,
      occurredAt: true,
      createdAt: true,
    },
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  if (movements.length === 0) return result;

  // Re-ordered by the COSTING instant, not the stored one (see costSortKey). The
  // index already returned a total order; this only moves same-day date-only
  // rows to the end of their Bangkok day, and the `createdAt`/`id` tail keeps
  // the result a total order when two rows land on the same instant.
  movements.sort(
    (a, b) =>
      costSortKey(a.occurredAt) - costSortKey(b.occurredAt) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );

  // The money behind a receipt lives on the GR line, which the ledger points at
  // polymorphically with no FK (ADR 0011 Q3) — so it is a second query, batched,
  // never a per-row lookup.
  const grItemIds = movements
    .filter((m) => m.sourceType === "GR_LINE")
    .map((m) => m.sourceId);

  const grItems = grItemIds.length
    ? await tx.goodsReceiptItem.findMany({
        where: { tenantId, id: { in: grItemIds } },
        select: { id: true, lineTotalActual: true, reversalOfItemId: true },
      })
    : [];
  const grById = new Map(grItems.map((i) => [i.id, i]));

  // Live declarations only: a superseded one is a statement someone has since
  // corrected, and replaying it would resurrect the number they retracted (Q6).
  const declarations = await tx.stockCostDeclaration.findMany({
    where: {
      tenantId,
      supersededAt: null,
      movementId: { in: movements.map((m) => m.id) },
    },
    select: { movementId: true, unitCost: true },
  });
  const declaredByMovement = new Map(
    declarations.map((d) => [d.movementId, d.unitCost])
  );

  const grouped = new Map<string, CostMovement[]>();
  for (const m of movements) {
    const gr = m.sourceType === "GR_LINE" ? grById.get(m.sourceId) : undefined;
    const row: CostMovement = {
      id: m.id,
      qty: m.qty,
      type: m.type,
      sourceType: m.sourceType,
      sourceId: m.sourceId,
      occurredAt: m.occurredAt,
      lineTotal: gr?.lineTotalActual ?? null,
      reversalOfItemId: gr?.reversalOfItemId ?? null,
      declaredUnitCost: declaredByMovement.get(m.id) ?? null,
    };
    const key = keyOf(m.productId, m.branchId);
    const list = grouped.get(key);
    if (list) list.push(row);
    else grouped.set(key, [row]);
  }

  for (const [key, rows] of grouped) {
    const [productId, branchId] = key.split("|");
    // openingStack stays empty here; it exists so a snapshot can be handed in
    // without touching the engine (risk R2).
    result.set(key, { productId, branchId, ...replayFifoLayers(rows) });
  }

  return result;
}

/**
 * Cost for many products at ONE branch — the shape every grid and roll-up must
 * call. Products with no ledger rows come back as an explicit empty state rather
 * than being absent, so a caller cannot accidentally render a blank cell as if
 * the product did not exist.
 */
export async function getProductCostsLogic(
  tenantId: string,
  query: GetProductCostsQuery
): Promise<Map<string, ProductCost>> {
  const { productIds, branchId, asOf } = query;

  return withTenantContext(tenantId, async (tx) => {
    const replayed = await replayPairs(tx, tenantId, productIds, [branchId], asOf);

    const byProduct = new Map<string, ProductCost>();
    for (const productId of productIds) {
      byProduct.set(
        productId,
        replayed.get(keyOf(productId, branchId)) ?? emptyState(productId, branchId)
      );
    }
    return byProduct;
  });
}

/**
 * Cost for ONE product at one branch. A thin wrapper over the batch primitive —
 * never its own query, so there is no cheap-looking call for a loop to reach for.
 */
export async function getProductCostLogic(
  tenantId: string,
  query: GetProductCostQuery
): Promise<ProductCost> {
  const costs = await getProductCostsLogic(tenantId, {
    productIds: [query.productId],
    branchId: query.branchId,
    asOf: query.asOf,
  });
  return costs.get(query.productId) ?? emptyState(query.productId, query.branchId);
}

// ------------------------------------------------------------
// The business-wide roll-up (Q9b)
// ------------------------------------------------------------

/**
 * One row of the branch-comparison page.
 *
 * `revenue` and `grossProfit` are `null` and will stay null until Sprint 4 lands
 * POS sync — carried from day one so that filling them is a change to one query
 * rather than a redesign of every consumer (ADR 0014 Q9b). A null here means
 * "not measurable yet", never "zero".
 */
export type BranchCostSummary = {
  branchId: string;
  branchName: string;
  branchCode: string | null;
  /** Money spent receiving goods in the period. Voids net themselves out. */
  purchaseSpend: Prisma.Decimal;
  /** Value of stock held at the END of the period, summed layer by layer (Q3b). */
  inventoryValue: Prisma.Decimal;
  /** What was thrown away / went missing, in BAHT — the number that makes an owner act. */
  wasteValue: Prisma.Decimal;
  /** Baht this branch paid above the cheapest branch for the same goods. */
  excessSpend: Prisma.Decimal;
  /** Products whose stock is negative here — the ledger says the keying is behind. */
  negativeStockProducts: number;
  /** Products holding stock nobody has ever priced. */
  unpricedProducts: number;
  revenue: null;
  grossProfit: null;
};

/**
 * Every branch, side by side, for one period.
 *
 * This is the first caller heavy enough to matter: it replays every product at
 * every branch. The threshold is written down in the risk register — if this
 * exceeds ~1 s, build the snapshot rather than waiting for a second signal.
 */
export async function getBranchCostSummaryLogic(
  tenantId: string,
  query: GetBranchCostSummaryQuery
): Promise<BranchCostSummary[]> {
  const { from, to } = query;

  return withTenantContext(tenantId, async (tx) => {
    const branches = await tx.branch.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    });
    if (branches.length === 0) return [];

    const products = await tx.product.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true },
    });
    const productIds = products.map((p) => p.id);

    const branchIds = branches.map((b) => b.id);
    const replayed = await replayPairs(tx, tenantId, productIds, branchIds, to);

    // One set of period bounds for every query and every in-memory filter below,
    // taken from the ledger's own helper so a Bangkok business day means the same
    // thing here as it does in a balance read (Decision #60).
    const periodBounds = occurredAtFilter(from, to) as {
      gte: Date;
      lt: Date;
    };

    // Purchase spend comes from the receipts themselves, not from the layers: it
    // is the money that left the business in the period, which is a different
    // question from what the stock still on the shelf is worth. A voided receipt
    // nets to zero because Part 13 writes its reversal line with a negated total.
    const spendRows = await tx.goodsReceiptItem.groupBy({
      by: ["goodsReceiptId"],
      where: {
        tenantId,
        goodsReceipt: {
          tenantId,
          deletedAt: null,
          status: { in: ["CONFIRMED", "VOIDED"] },
          receivedAt: periodBounds,
        },
      },
      _sum: { lineTotalActual: true },
    });
    const receipts = spendRows.length
      ? await tx.goodsReceipt.findMany({
          where: { tenantId, id: { in: spendRows.map((r) => r.goodsReceiptId) } },
          select: { id: true, branchId: true },
        })
      : [];
    const branchOfReceipt = new Map(receipts.map((r) => [r.id, r.branchId]));

    const spendByBranch = new Map<string, Prisma.Decimal>();
    for (const row of spendRows) {
      const branchId = branchOfReceipt.get(row.goodsReceiptId);
      if (!branchId) continue;
      spendByBranch.set(
        branchId,
        (spendByBranch.get(branchId) ?? ZERO).plus(row._sum.lineTotalActual ?? ZERO)
      );
    }

    // --- what each branch paid per base unit, per product, in the period ---
    // Two branches buying the same thing at different prices is money leaking in
    // plain sight, and it is invisible on any single branch's own screen.
    // Keyed `${productId}|${branchId}`. Taken from the ledger rather than the
    // replayed layers, because a layer is END state — what a branch paid during
    // the period is a different question from what it still holds.
    const purchaseQty = new Map<string, Prisma.Decimal>();
    const purchaseValue = new Map<string, Prisma.Decimal>();

    const receiptMovements = await tx.stockMovement.findMany({
      where: {
        tenantId,
        branchId: { in: branchIds },
        type: { in: ["PO_RECEIVE", "PO_RECEIVE_REVERSAL"] },
        occurredAt: periodBounds,
      },
      select: { productId: true, branchId: true, qty: true, sourceId: true },
    });
    const rmItems = receiptMovements.length
      ? await tx.goodsReceiptItem.findMany({
          where: { tenantId, id: { in: receiptMovements.map((m) => m.sourceId) } },
          select: { id: true, lineTotalActual: true },
        })
      : [];
    const totalById = new Map(rmItems.map((i) => [i.id, i.lineTotalActual]));

    for (const m of receiptMovements) {
      const key = keyOf(m.productId, m.branchId);
      purchaseQty.set(key, (purchaseQty.get(key) ?? ZERO).plus(m.qty));
      purchaseValue.set(
        key,
        (purchaseValue.get(key) ?? ZERO).plus(totalById.get(m.sourceId) ?? ZERO)
      );
    }

    // Cheapest branch per product, then what everyone else paid above it.
    const cheapest = new Map<string, Prisma.Decimal>();
    for (const [key, qty] of purchaseQty) {
      if (qty.lessThanOrEqualTo(0)) continue;
      const [productId] = key.split("|");
      const unit = (purchaseValue.get(key) ?? ZERO).div(qty);
      const current = cheapest.get(productId);
      if (!current || unit.lessThan(current)) cheapest.set(productId, unit);
    }

    const excessByBranch = new Map<string, Prisma.Decimal>();
    for (const [key, qty] of purchaseQty) {
      if (qty.lessThanOrEqualTo(0)) continue;
      const [productId, branchId] = key.split("|");
      const unit = (purchaseValue.get(key) ?? ZERO).div(qty);
      const best = cheapest.get(productId);
      if (!best) continue;
      const excess = unit.minus(best).mul(qty);
      if (excess.lessThanOrEqualTo(0)) continue;
      excessByBranch.set(
        branchId,
        (excessByBranch.get(branchId) ?? ZERO).plus(excess)
      );
    }

    // --- inventory value, waste and data quality, from the replayed states ---
    const lowerBound = periodBounds.gte.getTime();
    const upperBound = periodBounds.lt.getTime();

    return branches.map((branch) => {
      let inventoryValue = ZERO;
      let wasteValue = ZERO;
      let negativeStockProducts = 0;
      let unpricedProducts = 0;

      for (const productId of productIds) {
        const state = replayed.get(keyOf(productId, branch.id));
        if (!state) continue;

        inventoryValue = inventoryValue.plus(state.inventoryValue);
        if (state.negativeStock) negativeStockProducts += 1;
        if (state.hasUnpricedLayers) unpricedProducts += 1;

        for (const out of state.outflows) {
          if (out.type !== "ADJUST_LOSS") continue;
          // Same costing instant the walk used, so a midnight adjustment falls in
          // the period its business day belongs to.
          const t = costSortKey(out.occurredAt);
          if (t < lowerBound || t >= upperBound) continue;
          wasteValue = wasteValue.plus(out.value);
        }
      }

      return {
        branchId: branch.id,
        branchName: branch.name,
        branchCode: branch.code,
        purchaseSpend: spendByBranch.get(branch.id) ?? ZERO,
        inventoryValue,
        wasteValue,
        excessSpend: excessByBranch.get(branch.id) ?? ZERO,
        negativeStockProducts,
        unpricedProducts,
        revenue: null,
        grossProfit: null,
      };
    });
  });
}

export type { CostLayer };
