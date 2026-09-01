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
   * The realised cost the ledger recorded for undocumented outflows of this
   * product in the period. Positive = money gone.
   */
  varianceValue: Prisma.Decimal;
  /** How many count lines the quantities came from — 0 means never counted. */
  countLines: number;
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
    const productIds = [...counted.keys()];
    if (productIds.length === 0) return [];

    const replayed = await replayPairsInTx(tx, tenantId, productIds, [branchId], to);

    const bounds = occurredAtFilter(from, to) as { gte: Date; lt: Date };
    const lower = bounds.gte.getTime();
    const upper = bounds.lt.getTime();

    const valueOf = new Map<string, Prisma.Decimal>();
    for (const productId of productIds) {
      const state = replayed.get(costKeyOf(productId, branchId));
      if (state === undefined) continue;
      let value = ZERO;
      for (const out of state.outflows) {
        // The three tests /cost applies, in the same order and for the same
        // reasons: a transfer is not a loss, the costing instant decides the
        // period, and ของเสีย is the narrow documented case while everything
        // else that left without a document is variance.
        if (out.type !== "ADJUST_LOSS") continue;
        const t = costSortKey(out.occurredAt);
        if (t < lower || t >= upper) continue;
        if (out.sourceType === "WASTE_LOG") continue;
        value = value.plus(out.value);
      }
      valueOf.set(productId, value);
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
      const c = counted.get(productId)!;
      return {
        productId,
        productName: nameOf.get(productId) ?? productId,
        expectedQty: c.expected,
        countedQty: c.counted,
        varianceQty: c.counted.minus(c.expected),
        varianceValue: valueOf.get(productId) ?? ZERO,
        countLines: c.lines,
        usage: usageShares(demandResult.demand.get(productId) ?? []),
      };
    });

    // Ranked by money, biggest leak first — the whole point of the view. Ties
    // fall back to quantity so two products worth nothing still order stably.
    return rows.sort(
      (a, b) =>
        b.varianceValue.comparedTo(a.varianceValue) ||
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
