// ============================================================
// Mise — the FIFO replay engine (Sprint 2 Part 14 L3a, ADR 0014)
// ============================================================
// Product cost is not stored. It is derived by walking the stock ledger for one
// (product, branch) in `(occurred_at, created_at, id)` ASC and maintaining a
// stack of cost layers in memory (ADR 0014 Q2). This module is that walk, and
// NOTHING ELSE: it takes rows and returns a state. No Prisma, no tenantId, no
// I/O — which is what lets every rule in ADR 0014 be tested against a table of
// numbers instead of a database.
//
// Two shapes here are load-bearing rather than stylistic (ADR 0014 Consequence 2):
//
//   * `openingStack` is a PARAMETER. Today every caller passes nothing and the
//     walk starts empty. When volume eventually justifies snapshotting the stack
//     at a cut-off date (risk R2), the snapshot becomes an argument and this file
//     does not change at all. Hard-coding an empty start would make that a
//     rewrite of the algorithm instead of a change to one caller.
//   * The money, not a per-unit rate, is what a layer carries (Q12). Storing
//     11.1111 ฿/kg and multiplying back by 90 kg yields 999.999 — a fraction of a
//     satang evaporates per layer, forever. Carrying 1,000.00 and dividing only
//     for display cannot lose anything, which is what makes
//     `inventory value = money in − money consumed` exactly true.
//
// The stack keeps a strict invariant: **either every layer is positive, or the
// stack is exactly one negative layer.** You cannot simultaneously hold stock and
// owe it. Every operation below restores that invariant before returning.
// ============================================================

import { Prisma } from "@prisma/client";
import type { MovementType, SourceType } from "@prisma/client";
import type { CostSource } from "@/lib/validations/stock-cost";

const ZERO = new Prisma.Decimal(0);
const MONEY_SCALE = 2;
const money = (d: Prisma.Decimal) =>
  d.toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP);

/** How a layer's price was arrived at — the raw material for `costSource` (Q10). */
export type LayerPricing = "DOCUMENT" | "DECLARED" | "LAST_KNOWN" | "UNPRICED";

/**
 * One arrival of stock, or — when negative — stock consumed that was never
 * recorded as arriving (Q7).
 *
 * `qty` is in the product's BASE unit; `value` is the money still attached to
 * that quantity. A layer's unit cost is `value / qty`, computed when someone
 * asks, never stored.
 */
export type CostLayer = {
  /** The movement that created it — the audit trail back to the ledger. */
  movementId: string;
  sourceType: SourceType;
  /** For a `GR_LINE` layer this is the `goods_receipt_item.id` a void targets. */
  sourceId: string;
  occurredAt: Date;
  qty: Prisma.Decimal;
  value: Prisma.Decimal;
  pricing: LayerPricing;
};

/**
 * One ledger row, plus the two facts the ledger itself does not carry: the money
 * on the receipt behind it, and any human declaration about it.
 *
 * The caller is responsible for supplying these already resolved and for
 * ordering the rows `(occurredAt, createdAt, id)` ASC. Feeding them in any other
 * order produces a wrong answer silently, which is why the only caller is the
 * read layer in `stock-cost.ts` and not anything a page can reach.
 */
export type CostMovement = {
  id: string;
  qty: Prisma.Decimal;
  type: MovementType;
  sourceType: SourceType;
  sourceId: string;
  occurredAt: Date;
  /** `PO_RECEIVE` / `PO_RECEIVE_REVERSAL`: `goods_receipt_item.line_total_actual`. */
  lineTotal: Prisma.Decimal | null;
  /** `PO_RECEIVE_REVERSAL` only: the `goods_receipt_item.id` being reversed. */
  reversalOfItemId: string | null;
  /** `ADJUST_GAIN` only: the live declaration's cost PER BASE UNIT, if any. */
  declaredUnitCost: Prisma.Decimal | null;
};

export type ReplayState = {
  layers: CostLayer[];
  qtyOnHand: Prisma.Decimal;
  inventoryValue: Prisma.Decimal;
  /** `value / qty` of the front layer; `lastKnownUnitCost` when there is none. */
  costPerBaseUnit: Prisma.Decimal;
  costSource: CostSource;
  /** The most recent cost a DOCUMENT established — the Q5/Q10 fallback. */
  lastKnownUnitCost: Prisma.Decimal | null;
  /** Some stock in hand was priced by guesswork or not at all — say so on screen. */
  hasUnpricedLayers: boolean;
  /** Q9's negative balance. Not an error; a thing to go and look at. */
  negativeStock: boolean;
  /** Total money that entered the pile — the left side of Q12's invariant. */
  totalIn: Prisma.Decimal;
  /** Total money that left it. `totalIn − totalOut` must equal `inventoryValue`. */
  totalOut: Prisma.Decimal;
  /**
   * What each outflow actually cost, in order.
   *
   * The walk is the only place that knows this: "4 kg of spoilage" is a quantity
   * until you know which layers it came out of. Recorded as it happens so the
   * branch summary can value a month's waste in **baht** — which is the number
   * that makes an owner act, where kilograms are just a fact (ADR 0014 Q9b) —
   * without walking the ledger a second time.
   */
  outflows: OutflowEntry[];
};

/** One movement's realised cost of goods out. */
export type OutflowEntry = {
  movementId: string;
  type: MovementType;
  /**
   * Where the outflow came from. Carried because a count shortage and a spoilage
   * loss are BOTH `ADJUST_LOSS` movements (ADR 0015 Q1), so filtering by type
   * alone would merge two numbers that demand different actions — spoilage is a
   * conversation with the kitchen, an unexplained variance one with the branch
   * manager (ADR 0015 Q5).
   */
  sourceType: SourceType;
  occurredAt: Date;
  /** Positive magnitude in base units. */
  qty: Prisma.Decimal;
  /** Money that left the pile for it. */
  value: Prisma.Decimal;
};

const unitCostOf = (layer: CostLayer): Prisma.Decimal =>
  layer.qty.isZero() ? ZERO : layer.value.div(layer.qty);

/**
 * Replay a product's ledger at one branch into a cost state.
 *
 * @param movements  ledger rows, `(occurredAt, createdAt, id)` ASC, with the GR
 *                   money and live declarations already attached
 * @param openingStack  layers carried in from a snapshot. Empty today — see the
 *                      header on why it is a parameter anyway.
 */
export function replayFifoLayers(
  movements: CostMovement[],
  openingStack: CostLayer[] = []
): ReplayState {
  // Cloned: the caller's array (a snapshot, one day) must not be mutated.
  const stack: CostLayer[] = openingStack.map((l) => ({ ...l }));

  let lastKnownUnitCost: Prisma.Decimal | null = null;
  let totalIn = ZERO;
  let totalOut = ZERO;
  const outflows: OutflowEntry[] = [];

  // A voided receipt must cut ITS layer (Q8), and that layer may already be
  // partly or wholly consumed by the time the void lands — so the unit cost of
  // every receipt is remembered for the length of the walk, not just while its
  // layer survives.
  const receiptUnitCost = new Map<string, Prisma.Decimal>();

  /** The debt layer, if the pile is currently negative (invariant: at most one). */
  const debtLayer = (): CostLayer | null =>
    stack.length === 1 && stack[0].qty.isNegative() ? stack[0] : null;

  /**
   * Stock arrives. Cancels an outstanding debt before it becomes stock on hand —
   * which is how a negative balance unwinds by itself when the missing delivery
   * is finally keyed (Q7).
   */
  const push = (layer: CostLayer) => {
    let remainingQty = layer.qty;
    let remainingValue = layer.value;

    const debt = debtLayer();
    if (debt) {
      const owed = debt.qty.negated();
      const owedValue = debt.value.negated();
      const settled = Prisma.Decimal.min(owed, remainingQty);

      // What the settling stock is worth, taken from the arrival...
      const settledValue = settled.equals(remainingQty)
        ? remainingValue
        : money(remainingValue.mul(settled).div(remainingQty));
      // ...versus what the debt was booked out at when it was created.
      const debtPortion = settled.equals(owed)
        ? owedValue
        : money(owedValue.mul(settled).div(owed));

      debt.qty = debt.qty.plus(settled);
      debt.value = debt.value.plus(debtPortion);

      // Only the DIFFERENCE moves. Stock consumed before it was recorded as
      // received was already booked out at the cost we believed at the time;
      // the arrival reveals what it actually cost, and settling posts the
      // correction — not the whole amount a second time. Booking the full
      // `settledValue` here is what broke `money in − money out = value` (Q12),
      // which is exactly the invariant every test asserts.
      totalOut = totalOut.plus(settledValue.minus(debtPortion));

      remainingQty = remainingQty.minus(settled);
      remainingValue = remainingValue.minus(settledValue);

      if (debt.qty.isZero()) stack.shift();
      if (remainingQty.isZero()) return;
    }

    stack.push({ ...layer, qty: remainingQty, value: remainingValue });
  };

  /**
   * Stock leaves, oldest first. When the layers run out the remainder becomes a
   * debt at `unitCost` rather than vanishing (Q7) — a balance of −5 with a value
   * of 0 would contradict itself on screen.
   */
  const consume = (
    qty: Prisma.Decimal,
    unitCost: Prisma.Decimal,
    origin: {
      movementId: string;
      type: MovementType;
      sourceType: SourceType;
      sourceId: string;
      occurredAt: Date;
    }
  ) => {
    let remaining = qty;
    let costOut = ZERO;

    while (remaining.greaterThan(0) && stack.length > 0 && stack[0].qty.greaterThan(0)) {
      const front = stack[0];
      const taken = Prisma.Decimal.min(front.qty, remaining);
      // Exact on full consumption, proportional otherwise, with the rounding
      // remainder left behind in the layer so no satang is created or destroyed.
      const takenValue = taken.equals(front.qty)
        ? front.value
        : money(front.value.mul(taken).div(front.qty));

      front.qty = front.qty.minus(taken);
      front.value = front.value.minus(takenValue);
      totalOut = totalOut.plus(takenValue);
      costOut = costOut.plus(takenValue);
      remaining = remaining.minus(taken);

      if (front.qty.isZero()) stack.shift();
    }

    const record = () =>
      outflows.push({
        movementId: origin.movementId,
        type: origin.type,
        sourceType: origin.sourceType,
        occurredAt: origin.occurredAt,
        qty,
        value: costOut,
      });

    if (remaining.lessThanOrEqualTo(0)) {
      record();
      return;
    }

    const debt = debtLayer();
    const debtValue = money(remaining.mul(unitCost));
    if (debt) {
      debt.qty = debt.qty.minus(remaining);
      debt.value = debt.value.minus(debtValue);
    } else {
      stack.push({
        movementId: origin.movementId,
        sourceType: origin.sourceType,
        sourceId: origin.sourceId,
        occurredAt: origin.occurredAt,
        qty: remaining.negated(),
        value: debtValue.negated(),
        pricing: unitCost.isZero() ? "UNPRICED" : "LAST_KNOWN",
      });
    }
    totalOut = totalOut.plus(debtValue);
    costOut = costOut.plus(debtValue);
    record();
  };

  for (const m of movements) {
    switch (m.type) {
      case "PO_RECEIVE": {
        // The receipt's own money is the layer's value — never a rate (Q12).
        const value = money(m.lineTotal ?? ZERO);
        const unit = m.qty.isZero() ? ZERO : value.div(m.qty);
        receiptUnitCost.set(m.sourceId, unit);
        if (!m.qty.isZero()) lastKnownUnitCost = unit;
        totalIn = totalIn.plus(value);
        push({
          movementId: m.id,
          sourceType: m.sourceType,
          sourceId: m.sourceId,
          occurredAt: m.occurredAt,
          qty: m.qty,
          value,
          pricing: "DOCUMENT",
        });
        break;
      }

      case "ADJUST_GAIN": {
        // Q5's chain: a declaration, else the last purchase, else nothing.
        const declared = m.declaredUnitCost;
        const unit = declared ?? lastKnownUnitCost ?? ZERO;
        const pricing: LayerPricing = declared
          ? "DECLARED"
          : lastKnownUnitCost
            ? "LAST_KNOWN"
            : "UNPRICED";
        const value = money(m.qty.mul(unit));
        totalIn = totalIn.plus(value);
        push({
          movementId: m.id,
          sourceType: m.sourceType,
          sourceId: m.sourceId,
          occurredAt: m.occurredAt,
          qty: m.qty,
          value,
          pricing,
        });
        break;
      }

      case "PO_RECEIVE_REVERSAL": {
        // Q8: cut the layer this void reverses, NOT the head of the queue. The
        // goods that went back to the supplier were that receipt's goods; popping
        // the front would return someone else's cheaper stock on paper.
        const magnitude = m.qty.negated();
        const targetId = m.reversalOfItemId;
        const unit =
          (targetId ? receiptUnitCost.get(targetId) : undefined) ??
          lastKnownUnitCost ??
          ZERO;

        const idx = targetId ? stack.findIndex((l) => l.sourceId === targetId) : -1;
        let remaining = magnitude;

        if (idx >= 0) {
          const target = stack[idx];
          const taken = Prisma.Decimal.min(target.qty, remaining);
          const takenValue = taken.equals(target.qty)
            ? target.value
            : money(target.value.mul(taken).div(target.qty));
          target.qty = target.qty.minus(taken);
          target.value = target.value.minus(takenValue);
          totalOut = totalOut.plus(takenValue);
          remaining = remaining.minus(taken);
          if (target.qty.isZero()) stack.splice(idx, 1);
        }

        // Whatever the layer could not cover was already used: the pile goes
        // negative rather than the shortfall being smoothed away, because
        // "you returned goods you had already consumed" is exactly the thing
        // someone needs to go and look at.
        if (remaining.greaterThan(0)) {
          consume(remaining, unit, {
            movementId: m.id,
            type: m.type,
            sourceType: m.sourceType,
            sourceId: m.sourceId,
            occurredAt: m.occurredAt,
          });
        }
        break;
      }

      case "ADJUST_LOSS":
      default: {
        // Every other movement that removes stock draws FIFO from the head.
        // `default` catches Sprint 3+ types (WASTE / TRANSFER_OUT / RECIPE_CONSUME)
        // so a new outflow costs correctly the day it lands rather than being
        // silently ignored — a wrong number is worse than a missing feature.
        if (m.qty.isNegative()) {
          consume(m.qty.negated(), lastKnownUnitCost ?? ZERO, {
            movementId: m.id,
            type: m.type,
            sourceType: m.sourceType,
            sourceId: m.sourceId,
            occurredAt: m.occurredAt,
          });
        } else if (m.qty.greaterThan(0)) {
          const unit = lastKnownUnitCost ?? ZERO;
          const value = money(m.qty.mul(unit));
          totalIn = totalIn.plus(value);
          push({
            movementId: m.id,
            sourceType: m.sourceType,
            sourceId: m.sourceId,
            occurredAt: m.occurredAt,
            qty: m.qty,
            value,
            pricing: unit.isZero() ? "UNPRICED" : "LAST_KNOWN",
          });
        }
        break;
      }
    }
  }

  const layers = stack.filter((l) => !l.qty.isZero());
  const qtyOnHand = layers.reduce((sum, l) => sum.plus(l.qty), ZERO);
  const inventoryValue = layers.reduce((sum, l) => sum.plus(l.value), ZERO);
  const front = layers.find((l) => l.qty.greaterThan(0)) ?? null;

  const costPerBaseUnit = front
    ? unitCostOf(front)
    : (lastKnownUnitCost ?? ZERO);

  const costSource: CostSource = front
    ? front.pricing === "DOCUMENT"
      ? "FRONT_LAYER"
      : front.pricing
    : lastKnownUnitCost
      ? "LAST_KNOWN"
      : "UNPRICED";

  return {
    layers,
    qtyOnHand,
    inventoryValue,
    costPerBaseUnit,
    costSource,
    lastKnownUnitCost,
    hasUnpricedLayers: layers.some((l) => l.pricing === "UNPRICED"),
    negativeStock: qtyOnHand.isNegative(),
    totalIn,
    totalOut,
    outflows,
  };
}
