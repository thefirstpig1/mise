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
import type { CostSource, PrismaClient, SourceType } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { bangkokDayEndUtc, isDayValue } from "@/lib/bangkok-date";
import { occurredAtFilter } from "@/server/stock-movement";
import {
  replayFifoLayers,
  type CostLayer,
  type CostMovement,
  type LayerPricing,
  type ReplayState,
} from "@/server/fifo-replay";
import type {
  GetBranchCostSummaryQuery,
  GetProductCostQuery,
  GetProductCostsQuery,
} from "@/lib/validations/stock-cost";

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);
const money = (d: Prisma.Decimal) =>
  d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/**
 * What a receipt line's stock is WORTH — `line_total_actual`, plus the VAT the
 * shop cannot get back (Part 16, ADR 0016 Q2).
 *
 * For a VAT-registered buyer input VAT is a receivable, and the layer stays net.
 * For an unregistered one — which is most Thai SMEs, since the ฿1.8M threshold
 * is above them and `is_vat_registered` defaults to false — that VAT is money
 * gone, and it belongs in the cost of the goods. The system valued every layer
 * net until this Part, understating the common case by about 7%.
 *
 * `vat_reclaimable` is the RECEIPT's snapshot, not the tenant's setting read
 * today: a shop that registers in October must not have the whole year's stock
 * silently re-valued, because it did pay that VAT and nobody refunds it.
 *
 * The uplift is per line rather than a share of the header's `vat_amount`, and
 * the two are identical by construction — `vat_amount` is derived from the same
 * rate over the same lines (`grVatAmount` in goods-receipt.ts). Receipts written
 * before Part 16 carry no rate and are returned unchanged, which is exactly the
 * old behaviour: **no backfill, no migration of history.**
 */
const layerValueOf = (item: {
  lineTotalActual: Prisma.Decimal;
  goodsReceipt: { vatRatePercent: Prisma.Decimal | null; vatReclaimable: boolean };
}): Prisma.Decimal => {
  const { vatRatePercent, vatReclaimable } = item.goodsReceipt;
  if (vatReclaimable || vatRatePercent === null || vatRatePercent.isZero()) {
    return item.lineTotalActual;
  }
  // A reversal line's total is negative, so its uplift is too and a voided
  // receipt still nets to exactly zero.
  return money(
    item.lineTotalActual.plus(
      item.lineTotalActual.mul(vatRatePercent).div(HUNDRED)
    )
  );
};

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

/**
 * The three source types that point at a `stock_transfer_item` (ADR 0018 Q4).
 * A Set rather than a string prefix test: `sourceType` is an enum, and matching
 * it by shape would quietly capture any future value someone names TRANSFER_*.
 */
const TRANSFER_SOURCE_TYPES: ReadonlySet<SourceType> = new Set([
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "TRANSFER_SHORTAGE",
]);

/**
 * The sending branch's confidence, translated into the walk's vocabulary.
 *
 * `FRONT_LAYER` becomes `DOCUMENT` because that is what it means one level down:
 * the money came from a real purchase document, and the transfer is simply
 * carrying it. The other three pass through unchanged — a guess does not become
 * a fact by travelling.
 */
const LAYER_PRICING_BY_COST_SOURCE: Record<CostSource, LayerPricing> = {
  FRONT_LAYER: "DOCUMENT",
  DECLARED: "DECLARED",
  LAST_KNOWN: "LAST_KNOWN",
  UNPRICED: "UNPRICED",
};

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
 * FOUR round trips regardless of how many products are asked for: the ledger
 * rows, the receipt money behind them, the money a transfer froze at dispatch
 * (Part 18), and the live declarations. Grouping and ordering happen in memory —
 * the index already returns the rows in `(occurredAt, createdAt)` order, so `id`
 * is the only tiebreak left to apply.
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
  // never a per-row lookup. Since Part 16 it also carries the receipt's VAT
  // snapshot, because what a layer is WORTH depends on it (see `layerValueOf`).
  const grItemIds = movements
    .filter((m) => m.sourceType === "GR_LINE")
    .map((m) => m.sourceId);

  const grItems = grItemIds.length
    ? await tx.goodsReceiptItem.findMany({
        where: { tenantId, id: { in: grItemIds } },
        select: {
          id: true,
          lineTotalActual: true,
          reversalOfItemId: true,
          // Part 16 Q2 — the receipt's OWN snapshot of whether this shop could
          // reclaim the VAT it paid, never the tenant's setting read today.
          goodsReceipt: {
            select: { vatRatePercent: true, vatReclaimable: true },
          },
        },
      })
    : [];
  const grById = new Map(grItems.map((i) => [i.id, i]));

  // Part 18: the money a transfer froze at dispatch (ADR 0018 Q5). Same shape as
  // the GR query above and for the same reason — the ledger points at the line
  // polymorphically, so it is one batched second query, never a per-row lookup.
  //
  // All three transfer source types are fetched, not just the inbound one: a
  // TRANSFER_IN_REVERSAL needs its line's `reversal_of_item_id` to know WHICH
  // layer to cut, and that arrives on the same row.
  const transferItemIds = movements
    .filter((m) => TRANSFER_SOURCE_TYPES.has(m.sourceType))
    .map((m) => m.sourceId);

  const transferItems = transferItemIds.length
    ? await tx.stockTransferItem.findMany({
        where: { tenantId, id: { in: transferItemIds } },
        select: {
          id: true,
          costTotal: true,
          costSource: true,
          reversalOfItemId: true,
        },
      })
    : [];
  const transferById = new Map(transferItems.map((i) => [i.id, i]));

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
    const tf = TRANSFER_SOURCE_TYPES.has(m.sourceType)
      ? transferById.get(m.sourceId)
      : undefined;
    const row: CostMovement = {
      id: m.id,
      qty: m.qty,
      type: m.type,
      sourceType: m.sourceType,
      sourceId: m.sourceId,
      occurredAt: m.occurredAt,
      lineTotal: gr ? layerValueOf(gr) : null,
      // Two documents feed this one field. A GR line's reversal and a transfer
      // line's are the same fact — "the row this one undoes" — and the walk cuts
      // its own layer from either (ADR 0014 Q8).
      reversalOfItemId: gr?.reversalOfItemId ?? tf?.reversalOfItemId ?? null,
      declaredUnitCost: declaredByMovement.get(m.id) ?? null,
      // Stored SIGNED on the line (negative on a reversal line, to keep the
      // document's own sums honest); the walk wants a magnitude, because it is
      // told the direction by the movement type.
      transferValue: tf ? tf.costTotal.abs() : null,
      transferPricing: tf ? LAYER_PRICING_BY_COST_SOURCE[tf.costSource] : null,
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
  /**
   * Money spent on MATERIALS in the period — every expense line whose category
   * sits under `account = COGS` (ADR 0016 Q4).
   *
   * Read from `expense`, not from receipts: confirming a receipt writes its own
   * expense (Q3), so this table is the one place all money-out lands and there is
   * nothing to double count. A voided receipt takes its bill with it.
   *
   * Both spend figures are **net of VAT** — the line stores `total_price` excluding
   * tax. A registered shop reclaims that VAT; an unregistered one meets it in the
   * cost of its stock instead (Q2's uplift). Mixing gross spend with net stock
   * value would make two columns of the same table incomparable.
   */
  cogsSpend: Prisma.Decimal;
  /**
   * Everything else — rent, utilities, wages, the accountant. *"Materials 60,000,
   * everything else 40,000"* is a sentence an owner acts on, where a single spend
   * total is not; and when revenue lands in Sprint 4 the first half becomes food
   * cost %, the number restaurants actually run on.
   */
  opexSpend: Prisma.Decimal;
  /** Value of stock held at the END of the period, summed layer by layer (Q3b). */
  inventoryValue: Prisma.Decimal;
  /**
   * What was thrown away, in BAHT — and from Part 17 that means **`WASTE_LOG`
   * outflows alone** (ADR 0017 Q4).
   *
   * The column was mislabelled from Part 14 until then: it counted *every*
   * non-count `ADJUST_LOSS`, including `RECOUNT` and `OTHER`, so it really meant
   * "stock that left without a document". Now it means food someone watched go
   * in the bin, with a date and a reason — a purchasing and storage problem, and
   * a conversation with the kitchen.
   *
   * Existing `SPOILAGE`/`DAMAGE` adjustments are not rewritten; they stay
   * adjustments and land in `varianceValue` from now on (Consequence 1). The
   * past is relabelled by a rule, not by a migration — and the figure was wrong
   * before rather than after.
   */
  wasteValue: Prisma.Decimal;
  /**
   * Stock that is gone with no one able to say where: `STOCK_COUNT` shortages,
   * hand-typed `ADJUSTMENT` losses (ADR 0017 Q4, widening ADR 0015 Q5), and from
   * Part 18 `TRANSFER_SHORTAGE` — goods dispatched from one branch that never
   * reached the other.
   *
   * The transit case is the only one here that HAS a document, and it still
   * belongs: the document says the goods left and did not arrive, not where they
   * went. It also names a driver, which makes it the most actionable row in this
   * column rather than the odd one out.
   *
   * Deliberately NOT folded into `wasteValue`, though all of them post as
   * `ADJUST_LOSS`: an unexplained shortage is theft, mis-keying or bad receiving
   * — a conversation with the branch manager, not the kitchen. A shortage found
   * by counting and one typed in by hand are the same conversation with the same
   * person, which is why they now share a column. A figure that cannot tell a
   * manager who to talk to is worth less than one that can.
   */
  varianceValue: Prisma.Decimal;
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

    // Spend comes from EXPENSES since Part 16 — one source of money-out, split
    // by the account its category sits under (ADR 0016 Q3/Q4). Receipts are in
    // here too: confirming one writes its own expense, so reading both would
    // count every delivery twice.
    //
    // Filtered on `bill_date`, a DATE column, so the plain period bounds apply —
    // the Bangkok day-start shift belongs to `occurred_at`, which is an instant.
    const expenseLines = await tx.expenseItem.findMany({
      where: {
        tenantId,
        expense: {
          tenantId,
          deletedAt: null,
          branchId: { in: branchIds },
          billDate: { gte: from, lte: to },
        },
      },
      select: {
        totalPrice: true,
        category: { select: { account: true } },
        expense: { select: { branchId: true } },
      },
    });

    const cogsByBranch = new Map<string, Prisma.Decimal>();
    const opexByBranch = new Map<string, Prisma.Decimal>();
    for (const line of expenseLines) {
      // The 3-tier tree has carried `account` since Sprint 1, so the split is
      // free. Anything not marked COGS is treated as operating cost: a category
      // whose account nobody set is an overhead until someone says otherwise.
      const target = line.category.account === "COGS" ? cogsByBranch : opexByBranch;
      const branchId = line.expense.branchId;
      target.set(branchId, (target.get(branchId) ?? ZERO).plus(line.totalPrice));
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
          select: {
            id: true,
            lineTotalActual: true,
            goodsReceipt: {
              select: { vatRatePercent: true, vatReclaimable: true },
            },
          },
        })
      : [];
    // Valued the same way a layer is (Part 16 Q2): "what this branch paid" has to
    // mean the same thing here as it does on the shelf, or the excess-spend
    // comparison drifts from the cost it is meant to explain.
    const totalById = new Map(rmItems.map((i) => [i.id, layerValueOf(i)]));

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
      let varianceValue = ZERO;
      let negativeStockProducts = 0;
      let unpricedProducts = 0;

      for (const productId of productIds) {
        const state = replayed.get(keyOf(productId, branch.id));
        if (!state) continue;

        inventoryValue = inventoryValue.plus(state.inventoryValue);
        if (state.negativeStock) negativeStockProducts += 1;
        if (state.hasUnpricedLayers) unpricedProducts += 1;

        for (const out of state.outflows) {
          // Part 18: this line is also what keeps a TRANSFER off both columns.
          // `TRANSFER_OUT` and `TRANSFER_IN_REVERSAL` are outflows in the walk —
          // they take money out of this branch's pile — but the value did not
          // leave the BUSINESS, it arrived somewhere else. Counting them here
          // would report a truck of pork as a loss at the sending branch and
          // still hold it as inventory at the receiving one (ADR 0018
          // Consequence 2). Having them be their own movement types is what makes
          // this a one-line exclusion instead of a source-by-source exception.
          if (out.type !== "ADJUST_LOSS") continue;
          // Same costing instant the walk used, so a midnight adjustment falls in
          // the period its business day belongs to.
          const t = costSortKey(out.occurredAt);
          if (t < lowerBound || t >= upperBound) continue;
          // Split by SOURCE, not by type: waste, a count shortage and a manual
          // write-off are all ADJUST_LOSS (ADR 0015 Q1, ADR 0017 Q1).
          //
          // Part 17 Q4 INVERTED this test. ของเสีย is now the narrow case — a
          // waste document — and everything else that left without one is
          // variance. Written as an explicit WASTE_LOG check rather than an
          // `else`, so a fifth source type lands in variance (where an
          // undocumented outflow belongs) instead of silently inflating waste.
          //
          // Part 18's TRANSFER_SHORTAGE reaches that `else` and belongs there,
          // deliberately rather than by accident: goods that left one branch and
          // never reached the other are not food anyone watched go in the bin.
          // The conversation is with the driver and the branch manager, which is
          // the same conversation variance already exists to start.
          if (out.sourceType === "WASTE_LOG") {
            wasteValue = wasteValue.plus(out.value);
          } else {
            varianceValue = varianceValue.plus(out.value);
          }
        }
      }

      return {
        branchId: branch.id,
        branchName: branch.name,
        branchCode: branch.code,
        cogsSpend: cogsByBranch.get(branch.id) ?? ZERO,
        opexSpend: opexByBranch.get(branch.id) ?? ZERO,
        inventoryValue,
        wasteValue,
        varianceValue,
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
