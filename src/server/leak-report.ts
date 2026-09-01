// ============================================================
// Mise — ของหายไปไหน (Part 32 L5, ADR 0032 Q6/Q7)
// ============================================================
// §H.8's premise died before it was built. It was written when consumption was
// not in the ledger, so "theoretical" had to be computed separately — and Part
// 22 posts CONSUMPTION from recipes, which makes the LEDGER BALANCE the
// theoretical balance. Part 15 already stores the other side: every
// `stock_count_item` carries `qty_expected`, a snapshot of that balance taken
// when the line was saved, beside the `qty_counted` somebody walked and wrote
// down. The comparison has existed since Sprint 3.
//
// What was missing is a VIEW: the same variance per PRODUCT, accumulated over
// a PERIOD, ranked by MONEY. /cost has only ever shown it as one number for a
// whole branch, which tells an owner that ฿4,000 went missing and nothing about
// where to look.
//
// ── THE MONEY COMES FROM THE LEDGER, NOT FROM MULTIPLYING ──────────────────
// The variance already posted a movement, so it already has a realised cost.
// This reads that, filtered exactly as /cost filters it — ADJUST_LOSS, not
// WASTE_LOG, inside the same costing bounds, using the same `costSortKey`
// imported rather than copied. Two definitions of "variance" in one codebase
// would eventually disagree, and the page that disagreed would be believed.
//
// ── AND WHY NO DEPARTMENT COLUMN (rule F6) ─────────────────────────────────
// Nobody recorded whose hands the missing 13 kg left. Apportioning it by usage
// share would put a guess in a column readers take as fact — an accusation the
// data cannot support. So the report names which departments USE the product
// and in what proportion, and lets the owner decide who to ask. Information,
// not a verdict.
// ============================================================

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { occurredAtFilter } from "@/server/stock-movement";
import { replayPairsInTx, costKeyOf, costSortKey } from "./stock-cost";
import { departmentDemandForPeriodLogic } from "./department-cost";
import type { DepartmentId } from "./department-split";

const ZERO = new Prisma.Decimal(0);

export type LeakUsage = {
  departmentId: DepartmentId;
  /** 0–1 share of this product's demand in the period. */
  share: number;
};

export type LeakRow = {
  productId: string;
  productName: string;
  /** Ledger balance at the moment each line was counted, summed. */
  expectedQty: Prisma.Decimal;
  countedQty: Prisma.Decimal;
  /** counted − expected. Negative is the leak. */
  varianceQty: Prisma.Decimal;
  /**
   * 🔴 Part 32.5. The money is split because the two halves are DIFFERENT
   * FACTS, and the first version added them into one column that could
   * contradict its own row — a product counted with no variance sitting beside
   * a ฿5,000 figure, because a hand-typed write-off three weeks later had been
   * folded in.
   *
   * This half is the count's own shortfall, valued by the ledger. It is the
   * one that pairs with the quantity columns above.
   */
  countVarianceValue: Prisma.Decimal;
  /**
   * Everything else that left without a waste document in the period — a
   * manual write-off, a transfer that never arrived. Real, worth seeing, and
   * NOT what the count found, so it gets its own column rather than being
   * summed into one.
   */
  otherLossValue: Prisma.Decimal;
  /** The two together, which is the figure /cost shows as ส่วนต่าง/ปรับปรุง. */
  totalLossValue: Prisma.Decimal;
  /** 0 = this product was never counted in the window (see `neverCounted`). */
  countLines: number;
  /**
   * True when the product only appears because money left it, with no count to
   * compare against. The old report could not show these AT ALL — its product
   * list was seeded from count lines alone, so a product that leaked ฿5,000 and
   * was never counted was simply absent from a report about leaks.
   */
  neverCounted: boolean;
  usage: LeakUsage[];
};

export async function getLeakReportLogic(
  tenantId: string,
  params: { branchId: string; from: Date; to: Date }
): Promise<LeakRow[]> {
  const { branchId, from, to } = params;

  return withTenantContext(tenantId, async (rawTx) => {
    const tx = rawTx as unknown as PrismaClient;

    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { cancelledSalePolicy: true },
    });

    // ── the counted side (Part 15) ──────────────────────────────────────────
    // Every line of every count that happened in the window. A product counted
    // three times contributes three lines, which is right: each one compared
    // the shelf against the balance at that moment.
    const countLines = await tx.stockCountItem.findMany({
      where: {
        tenantId,
        stockCount: {
          branchId,
          // CLOSED only. A draft is a count somebody is still walking, and a
          // voided one is a count that was withdrawn — neither is evidence of
          // what was on the shelf, and both would move a leak figure an owner
          // is about to act on.
          status: "CLOSED",
          countDate: { gte: from, lte: to },
        },
      },
      select: {
        productId: true,
        qtyCounted: true,
        qtyExpected: true,
      },
    });

    const counted = new Map<
      string,
      { expected: Prisma.Decimal; counted: Prisma.Decimal; lines: number }
    >();
    for (const l of countLines) {
      const cur = counted.get(l.productId) ?? {
        expected: ZERO,
        counted: ZERO,
        lines: 0,
      };
      counted.set(l.productId, {
        expected: cur.expected.plus(l.qtyExpected),
        counted: cur.counted.plus(l.qtyCounted),
        lines: cur.lines + 1,
      });
    }

    // ── the money side (the ledger) ─────────────────────────────────────────
    //
    // 🔴 Part 32.5. The product list is the UNION of "was counted" and "lost
    // money", not just the first. Seeding it from count lines alone meant a
    // product that leaked ฿5,000 and happened not to be counted never appeared
    // on a report whose entire subject is leaks.
    //
    // Discovery only — the authoritative value still comes from the replay
    // below, filtered by `costSortKey` exactly as /cost filters it. The window
    // is widened a day either side because this query compares raw
    // `occurred_at` while the replay compares the costing instant, and a
    // product missed here would have its money silently dropped.
    const lossProducts = await tx.stockMovement.findMany({
      where: {
        tenantId,
        branchId,
        type: "ADJUST_LOSS",
        sourceType: { not: "WASTE_LOG" },
        occurredAt: { gte: addDays(from, -1), lt: addDays(to, 2) },
      },
      select: { productId: true },
      distinct: ["productId"],
    });

    const productIds = [
      ...new Set([...counted.keys(), ...lossProducts.map((m) => m.productId)]),
    ];
    if (productIds.length === 0) return [];

    const replayed = await replayPairsInTx(tx, tenantId, productIds, [branchId], to);

    const bounds = occurredAtFilter(from, to) as { gte: Date; lt: Date };
    const lower = bounds.gte.getTime();
    const upper = bounds.lt.getTime();

    const valueOf = new Map<
      string,
      { fromCount: Prisma.Decimal; other: Prisma.Decimal }
    >();
    for (const productId of productIds) {
      const state = replayed.get(costKeyOf(productId, branchId));
      if (state === undefined) continue;
      let fromCount = ZERO;
      let other = ZERO;
      for (const out of state.outflows) {
        // The three tests /cost applies, in the same order and for the same
        // reasons: a transfer is not a loss, the costing instant decides the
        // period, and ของเสีย is the narrow documented case while everything
        // else that left without a document is variance.
        if (out.type !== "ADJUST_LOSS") continue;
        const t = costSortKey(out.occurredAt);
        if (t < lower || t >= upper) continue;
        if (out.sourceType === "WASTE_LOG") continue;
        // The ONE extra test this report makes that /cost does not: which of
        // those undocumented outflows was the count itself. /cost is right to
        // add them — its number is the branch's whole unexplained loss — but a
        // per-product row that prints a count's quantities has to say which
        // part of the money that count actually found.
        if (out.sourceType === "STOCK_COUNT") fromCount = fromCount.plus(out.value);
        else other = other.plus(out.value);
      }
      valueOf.set(productId, { fromCount, other });
    }

    // ── who uses it (Q7 — named, never blamed) ──────────────────────────────
    const demandResult = await departmentDemandForPeriodLogic(tx, tenantId, {
      branchId,
      from,
      to,
      cancelledSalePolicy: tenant.cancelledSalePolicy,
    });

    const names = await tx.product.findMany({
      where: { tenantId, id: { in: productIds } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(names.map((p) => [p.id, p.name]));

    const rows: LeakRow[] = productIds.map((productId) => {
      const c = counted.get(productId);
      const v = valueOf.get(productId) ?? { fromCount: ZERO, other: ZERO };
      return {
        productId,
        productName: nameOf.get(productId) ?? productId,
        expectedQty: c?.expected ?? ZERO,
        countedQty: c?.counted ?? ZERO,
        varianceQty: (c?.counted ?? ZERO).minus(c?.expected ?? ZERO),
        countVarianceValue: v.fromCount,
        otherLossValue: v.other,
        totalLossValue: v.fromCount.plus(v.other),
        countLines: c?.lines ?? 0,
        neverCounted: c === undefined,
        usage: usageShares(demandResult.demand.get(productId) ?? []),
      };
    })
      // A product discovered by the widened lookup whose money fell outside the
      // real costing bounds after all, and which was never counted either, has
      // nothing to say. Dropping it here rather than widening less keeps the
      // discovery safe and the report quiet.
      .filter((r) => !(r.neverCounted && r.totalLossValue.isZero()));

    // Ranked by money, biggest leak first — the whole point of the view. Ties
    // fall back to quantity so two products worth nothing still order stably.
    return rows.sort(
      (a, b) =>
        b.totalLossValue.comparedTo(a.totalLossValue) ||
        a.varianceQty.comparedTo(b.varianceQty) ||
        (a.productName < b.productName ? -1 : 1)
    );
  });
}

/**
 * Shares of demand, largest first.
 *
 * Deliberately a SHARE and not an amount: an amount in the same row as a loss
 * reads as a portion of that loss, which is exactly the claim rule F6 refuses
 * to make.
 */
function usageShares(
  demand: readonly { departmentId: DepartmentId; qty: Prisma.Decimal }[]
): LeakUsage[] {
  const total = demand.reduce((t, d) => t.plus(d.qty.abs()), ZERO);
  if (total.isZero()) return [];
  return demand
    .map((d) => ({
      departmentId: d.departmentId,
      share: d.qty.abs().div(total).toNumber(),
    }))
    .sort((a, b) => b.share - a.share);
}

const DAY_MS = 86_400_000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
