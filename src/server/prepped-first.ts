// ============================================================
// Mise — prepped stock comes off the shelf first (ADR 0040 Q1, Q9, D2)
// ============================================================
// Until ADR 0040 the explosion walked straight THROUGH every prepped product
// to raw (ADR 0021 Q11): nothing could put soup on a shelf, so there was no
// shelf to look at. Now production, purchase and a count can, and Q1 is one
// rule for all of them:
//
//   take the prepped product that is there; what is not there, walk down its
//   recipe and cut the raw ingredients instead ("ระบบตัดแทน").
//
// A shop that never records production has nothing on any prepped shelf, so
// every prepped demand falls through to the recipe exactly as before.
//
// Two halves:
//   * `settlePreppedDemand` — pure. Given demand that STOPPED at prepped
//     products and what is available of each, decide what comes off the shelf
//     and walk the rest down. A shortfall may itself need prepped products
//     (soup → stock → bones); those are settled the same way, from what is
//     left on THEIR shelves.
//   * `preppedAvailableInTx` — how much of a prepped product a posting at a
//     given instant may take. D2 (Kong 2026-10-29): no more than the LOWEST
//     balance from that instant on, so a sale or a waste recorded late never
//     takes soup a later day has already used — and the shelf never goes
//     negative without anything having to be re-posted.
// ============================================================

import { Prisma } from "@prisma/client";
import type { PrismaClient, SourceType } from "@prisma/client";
import {
  explodeToRaw,
  productKey,
  type RecipeGraph,
} from "@/server/recipe-graph";
import { costSortKey } from "@/server/stock-cost";

const ZERO = new Prisma.Decimal(0);

export type SettledDemand = {
  /** Positive quantity per product to post: prepped = taken off the shelf. */
  demand: Map<string, Prisma.Decimal>;
  /** Prepped product → quantity the system cut from its recipe instead. */
  shortfalls: Map<string, Prisma.Decimal>;
  /**
   * Prepped products that were short and have NO way to be made — no
   * production recipe, no parent + yield, no trim recipe. Their whole demand
   * stays on the product itself (it may have been bought — Q10), and the
   * caller decides what that means for the dishes that need it.
   */
  unmakeable: Set<string>;
};

/** Does this prepped product have a way down to its ingredients? */
export function hasMethod(graph: RecipeGraph, productId: string): boolean {
  const p = graph.products.get(productId);
  if (!p || p.type !== "PREPPED") return false;
  return p.productionRecipe !== null || p.parentProductId !== null || !!p.trimPart;
}

/**
 * Settle a posting's demand against the prepped shelves.
 *
 * @param demand     positive quantities from an explosion that stopped at
 *                   prepped products (`explodeToRaw(..., { stopAtPrepped })`)
 * @param available  per prepped product, what this posting may take (≥ 0;
 *                   missing means nothing on the shelf)
 */
export function settlePreppedDemand(
  graph: RecipeGraph,
  demand: Map<string, Prisma.Decimal>,
  available: Map<string, Prisma.Decimal>
): SettledDemand {
  const settled = new Map<string, Prisma.Decimal>();
  const unsettled = new Map<string, Prisma.Decimal>();
  const remaining = new Map<string, Prisma.Decimal>();
  const shortfalls = new Map<string, Prisma.Decimal>();
  const unmakeable = new Set<string>();

  const add = (map: Map<string, Prisma.Decimal>, id: string, q: Prisma.Decimal) =>
    map.set(id, (map.get(id) ?? ZERO).plus(q));

  const isPrepped = (id: string) => graph.products.get(id)?.type === "PREPPED";

  for (const [id, q] of demand) {
    if (q.lessThanOrEqualTo(0)) {
      // A day whose cancellations outweighed its sales gives stock BACK
      // (ADR 0022 Q6 under TREAT_AS_NOT_COOKED). Nothing is taken from a
      // shelf, so it passes through untouched.
      if (!q.isZero()) add(settled, id, q);
      continue;
    }
    if (isPrepped(id)) add(unsettled, id, q);
    else add(settled, id, q);
  }

  // The order does not change the answer: every unit of demand for a prepped
  // product takes from what is left on its shelf, whenever it arrives, so the
  // total taken is min(total demand, available) either way. Re-queuing a
  // product that gains demand from a parent's shortfall is what makes that true
  // without first sorting the graph. It terminates because each walk goes
  // strictly DOWN an acyclic graph (the posting path validated every dish with
  // a full explosion before getting here).
  const queue = [...unsettled.keys()];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const want = unsettled.get(id) ?? ZERO;
    if (want.lessThanOrEqualTo(0)) continue;
    unsettled.set(id, ZERO);

    const left = remaining.has(id)
      ? remaining.get(id)!
      : Prisma.Decimal.max(available.get(id) ?? ZERO, ZERO);
    const take = Prisma.Decimal.min(want, left);
    remaining.set(id, left.minus(take));
    if (take.greaterThan(0)) add(settled, id, take);

    const short = want.minus(take);
    if (short.lessThanOrEqualTo(0)) continue;

    if (!hasMethod(graph, id)) {
      // Nothing to walk down to. The shortfall stays on the product itself —
      // which is what a BOUGHT prepped product's missing receipt looks like,
      // the same negative balance a raw product shows (ADR 0014 Q7).
      unmakeable.add(id);
      add(settled, id, short);
      continue;
    }

    add(shortfalls, id, short);
    for (const leaf of explodeToRaw(graph, productKey(id), short, { stopAtPrepped: true })) {
      if (isPrepped(leaf.productId)) {
        add(unsettled, leaf.productId, leaf.qty);
        queue.push(leaf.productId);
      } else {
        add(settled, leaf.productId, leaf.qty);
      }
    }
  }

  return { demand: settled, shortfalls, unmakeable };
}

/**
 * What a posting at `at` may take of each prepped product at one branch.
 *
 * D2: the LOWEST balance from that instant on — the balance just after `at`,
 * and after every later movement. A sale recorded for last Tuesday may take
 * only soup that nothing after Tuesday has used; otherwise the shelf would go
 * negative on Wednesday and every later day would have to be re-posted.
 *
 * `exclude` drops movements the posting is about to replace — a re-posted day's
 * own earlier consumption and its reversal — so a day never competes with the
 * version of itself it is taking back.
 */
export async function preppedAvailableInTx(
  tx: PrismaClient,
  tenantId: string,
  branchId: string,
  productIds: string[],
  at: Date,
  exclude?: { sourceType: SourceType; sourceIds: ReadonlySet<string> }
): Promise<Map<string, Prisma.Decimal>> {
  const out = new Map<string, Prisma.Decimal>();
  if (productIds.length === 0) return out;

  const rows = await tx.stockMovement.findMany({
    where: { tenantId, branchId, productId: { in: productIds } },
    select: {
      productId: true,
      qty: true,
      occurredAt: true,
      createdAt: true,
      sourceType: true,
      sourceId: true,
    },
  });

  const t = costSortKey(at);
  const byProduct = new Map<string, typeof rows>();
  for (const r of rows) {
    if (exclude && r.sourceType === exclude.sourceType && exclude.sourceIds.has(r.sourceId)) continue;
    const list = byProduct.get(r.productId) ?? [];
    list.push(r);
    byProduct.set(r.productId, list);
  }

  for (const id of productIds) {
    const list = (byProduct.get(id) ?? []).sort(
      (a, b) =>
        costSortKey(a.occurredAt) - costSortKey(b.occurredAt) ||
        a.createdAt.getTime() - b.createdAt.getTime()
    );
    let balance = ZERO;
    let i = 0;
    while (i < list.length && costSortKey(list[i].occurredAt) <= t) {
      balance = balance.plus(list[i].qty);
      i += 1;
    }
    let lowest = balance;
    for (; i < list.length; i++) {
      balance = balance.plus(list[i].qty);
      if (balance.lessThan(lowest)) lowest = balance;
    }
    out.set(id, Prisma.Decimal.max(lowest, ZERO));
  }
  return out;
}
