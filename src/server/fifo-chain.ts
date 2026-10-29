// ============================================================
// Mise — replaying piles whose money flows into each other (ADR 0040)
// ============================================================
// `fifo-replay.ts` walks ONE (product, branch) pile and knows nothing else.
// Until ADR 0040 that was enough: every arrival priced itself from its own
// document (a receipt, a declaration, a transfer's frozen money).
//
// A production breaks that. Soup arrives carrying whatever the bones and
// onions it was made from cost — and that number lives in the BONES' walk.
// Q4 refused to freeze it onto the document (a correction to last Tuesday's
// bone price must reach the soup), so it has to be handed across at replay
// time. This module is the hand-over and nothing else:
//
//   1. order the piles so every input is walked before what it was made into
//      (a topological order over the production documents present);
//   2. after each walk, collect what each production's inputs took out;
//   3. before walking an output, give each of its PRODUCTION_IN rows its share
//      of that money — split by the line's frozen % (Q7), with the satang
//      remainder on the largest share so the parts add up to exactly what
//      left the inputs.
//
// Pure: rows in, states out. No Prisma, no I/O — the same reason the walk is.
// A ledger with no production in it takes the fast path and is walked exactly
// as it was before this file existed.
// ============================================================

import { Prisma } from "@prisma/client";
import {
  replayFifoLayers,
  worsePricing,
  type CostMovement,
  type LayerPricing,
  type ReplayState,
} from "./fifo-replay";

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);
const money = (d: Prisma.Decimal) =>
  d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** What one production's inputs took out of their piles, all together. */
type InputMoney = { value: Prisma.Decimal; pricing: LayerPricing };

/**
 * Split `total` across outputs by their shares, to the satang.
 *
 * Normalised by the sum of the shares rather than by 100, so the parts ALWAYS
 * add up to the total — a share list that sums to 99.9999 from rounding the
 * percentages (or to anything else, from a bug upstream) cannot create or lose
 * money. Every output but the largest is rounded; the largest takes what is
 * left (Q7: "เศษไปอยู่ที่ส่วนที่มีมูลค่ามากที่สุด"). Shares that sum to zero
 * split evenly — a zero-share list is a mistake, and dropping the money on the
 * floor would hide it.
 */
export function allocateProduced(
  total: Prisma.Decimal,
  shares: { id: string; share: Prisma.Decimal | null | undefined }[]
): Map<string, Prisma.Decimal> {
  const out = new Map<string, Prisma.Decimal>();
  if (shares.length === 0) return out;

  const weights = shares.map((s) => ({ id: s.id, w: s.share ?? HUNDRED }));
  let sum = weights.reduce((acc, s) => acc.plus(s.w), ZERO);
  if (sum.isZero()) {
    for (const s of weights) s.w = new Prisma.Decimal(1);
    sum = new Prisma.Decimal(weights.length);
  }

  // The largest share, first one on a tie, absorbs the rounding.
  let largest = 0;
  for (let i = 1; i < weights.length; i++) {
    if (weights[i].w.greaterThan(weights[largest].w)) largest = i;
  }

  let allocated = ZERO;
  weights.forEach((s, i) => {
    if (i === largest) return;
    const v = money(total.mul(s.w).div(sum));
    out.set(s.id, v);
    allocated = allocated.plus(v);
  });
  out.set(weights[largest].id, total.minus(allocated));
  return out;
}

/** Every output line of one production: its item id and frozen % share. */
export type ProductionOutputShares = Map<
  string,
  { id: string; share: Prisma.Decimal | null | undefined }[]
>;

/**
 * Replay every pile, handing each production's input money to its outputs.
 *
 * @param rowsByKey  ledger rows per pile, each list in costing order — exactly
 *                   what `replayFifoLayers` takes. Not mutated.
 * @param outputShares  EVERY output line of each production (item id → share),
 *                   whether or not its pile was loaded. Without it the split
 *                   sees only the outputs in `rowsByKey`, and a caller asking
 *                   for the fillet alone would hand the fillet the whole fish.
 *                   The loader always passes it; pure tests that load every
 *                   output may leave it out.
 * @returns          one state per key, in the input map's key order.
 */
export function replayChain(
  rowsByKey: Map<string, CostMovement[]>,
  outputShares?: ProductionOutputShares
): Map<string, ReplayState> {
  // Which production each leg belongs to, and which piles hold its inputs and
  // its outputs.
  const inputKeys = new Map<string, Set<string>>();
  const outputKeys = new Map<string, Set<string>>();
  const outputRows = new Map<string, CostMovement[]>();
  const productionOfMovement = new Map<string, string>();

  for (const [key, rows] of rowsByKey) {
    for (const r of rows) {
      if (!r.productionId) continue;
      if (r.type === "PRODUCTION_OUT") {
        productionOfMovement.set(r.id, r.productionId);
        addTo(inputKeys, r.productionId, key);
      } else if (r.type === "PRODUCTION_IN") {
        addTo(outputKeys, r.productionId, key);
        const list = outputRows.get(r.productionId);
        if (list) list.push(r);
        else outputRows.set(r.productionId, [r]);
      }
    }
  }

  const result = new Map<string, ReplayState>();

  // Fast path: no production anywhere in what was loaded. Identical to the
  // walk this codebase ran before ADR 0040.
  if (outputRows.size === 0 && productionOfMovement.size === 0) {
    for (const [key, rows] of rowsByKey) result.set(key, replayFifoLayers(rows));
    return result;
  }

  const order = dependencyOrder(rowsByKey, inputKeys, outputKeys);

  const inputMoney = new Map<string, InputMoney>();
  const allocations = new Map<string, Map<string, Prisma.Decimal>>();

  const allocationFor = (productionId: string): Map<string, Prisma.Decimal> => {
    const cached = allocations.get(productionId);
    if (cached) return cached;
    const total = inputMoney.get(productionId)?.value ?? ZERO;
    // Keyed by the OUTPUT ITEM (the movement's source), so a split computed
    // from the full list of lines lands on the right pile.
    const shares =
      outputShares?.get(productionId) ??
      (outputRows.get(productionId) ?? []).map((r) => ({
        id: r.sourceId,
        share: r.valueSharePct,
      }));
    const split = allocateProduced(total, shares);
    allocations.set(productionId, split);
    return split;
  };

  for (const key of order) {
    const rows = rowsByKey.get(key)!;
    const priced = rows.map((r) => {
      if (r.type !== "PRODUCTION_IN" || !r.productionId) return r;
      const took = inputMoney.get(r.productionId);
      return {
        ...r,
        producedValue: allocationFor(r.productionId).get(r.sourceId) ?? ZERO,
        producedPricing:
          took && !took.value.isZero() ? took.pricing : ("UNPRICED" as const),
      };
    });

    const state = replayFifoLayers(priced);
    result.set(key, state);

    for (const out of state.outflows) {
      if (out.type !== "PRODUCTION_OUT") continue;
      const productionId = productionOfMovement.get(out.movementId);
      if (!productionId) continue;
      const cur = inputMoney.get(productionId);
      inputMoney.set(productionId, {
        value: (cur?.value ?? ZERO).plus(out.value),
        pricing: cur ? worsePricing(cur.pricing, out.pricing) : out.pricing,
      });
    }
  }

  // Back in the caller's key order, so nothing that iterates the result sees a
  // different sequence because a production happened to exist.
  const ordered = new Map<string, ReplayState>();
  for (const key of rowsByKey.keys()) ordered.set(key, result.get(key)!);
  return ordered;
}

function addTo(map: Map<string, Set<string>>, id: string, key: string) {
  const set = map.get(id);
  if (set) set.add(key);
  else map.set(id, new Set([key]));
}

/**
 * Kahn's algorithm over "input pile → output pile" edges, stable in the
 * caller's key order. A pile in a cycle (soup made from soup — refused when a
 * production is written, so this is a damaged ledger, not a normal one) is
 * walked last rather than crashing the page: its production values are what
 * was known by then, and an output priced at zero shows as UNPRICED.
 */
function dependencyOrder(
  rowsByKey: Map<string, CostMovement[]>,
  inputKeys: Map<string, Set<string>>,
  outputKeys: Map<string, Set<string>>
): string[] {
  const keys = [...rowsByKey.keys()];
  const edges = new Map<string, Set<string>>();
  const indegree = new Map<string, number>(keys.map((k) => [k, 0]));

  for (const [productionId, outs] of outputKeys) {
    const ins = inputKeys.get(productionId);
    if (!ins) continue;
    for (const from of ins) {
      for (const to of outs) {
        if (from === to) continue;
        const set = edges.get(from) ?? new Set<string>();
        if (set.has(to)) continue;
        set.add(to);
        edges.set(from, set);
        indegree.set(to, (indegree.get(to) ?? 0) + 1);
      }
    }
  }

  const order: string[] = [];
  const queue = keys.filter((k) => (indegree.get(k) ?? 0) === 0);
  const done = new Set<string>();
  while (queue.length > 0) {
    const k = queue.shift()!;
    order.push(k);
    done.add(k);
    for (const to of edges.get(k) ?? []) {
      const n = (indegree.get(to) ?? 0) - 1;
      indegree.set(to, n);
      if (n === 0) queue.push(to);
    }
  }
  for (const k of keys) if (!done.has(k)) order.push(k);
  return order;
}
