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
  /**
   * The `..._item.id` being reversed. `PO_RECEIVE_REVERSAL` (a
   * `goods_receipt_item`) and `TRANSFER_IN_REVERSAL` (a `stock_transfer_item`)
   * both use it, for the same reason: a reversal must cut ITS OWN layer (Q8).
   */
  reversalOfItemId: string | null;
  /** `ADJUST_GAIN` only: the live declaration's cost PER BASE UNIT, if any. */
  declaredUnitCost: Prisma.Decimal | null;
  /**
   * `TRANSFER_*` only: the money frozen onto `stock_transfer_item` at dispatch,
   * as a positive magnitude (ADR 0018 Q5).
   *
   * This is why a transfer-in is not just "an arrival at the last known price".
   * The receiving branch's own history has nothing to say about what these goods
   * cost — they were bought by a different branch on a different day — so the
   * sending branch's FIFO money travels with them, frozen, and lands here.
   */
  transferValue: Prisma.Decimal | null;
  /**
   * How well the SENDING branch knew that money. Carried across the branch
   * boundary so a `0.00` arriving at the far end is readable as "the sender never
   * knew" rather than "these goods were free" — ADR 0014 Q10's provenance, made
   * to survive a journey.
   */
  transferPricing: LayerPricing | null;
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
  /**
   * What each `sales_consumption_item` did to the money in this pile (Part 22).
   *
   * SIGNED: positive is money that left with the cooking, negative is money that
   * came back — a day given up by a re-import, or (under TREAT_AS_NOT_COOKED) a
   * day whose cancellations outweighed its sales.
   *
   * Separate from `outflows` because half of these are not outflows at all, and
   * keyed by SOURCE rather than movement because the question it answers is
   * asked of the document: gross profit by สูตรอาหาร is the cost of what the
   * runs that still STAND say was sold, so `/cost` has to be able to drop the
   * ones a re-import took back (rule N10).
   */
  consumptionMoves: ConsumptionMove[];
};

/** One consumption item's effect on this pile's money. */
export type ConsumptionMove = {
  /** `sales_consumption_item.id` or `staff_meal_item.id` — see `sourceType`. */
  sourceId: string;
  /**
   * WHICH document this id belongs to (Part 26, ADR 0028 Consequence 1/2).
   *
   * The walk collects these by MOVEMENT type, because that is what it can see.
   * Every reader of them then has to resolve `sourceId` against a table, and
   * until Part 26 there was only one candidate — so the callers keyed off
   * `SALES_CONSUMPTION` and were right by having no alternative. A staff meal
   * posts the same movement type from a different table, and both readers in
   * `stock-cost.ts` would have failed SILENTLY: one looking up a reversal's
   * original and finding none (returning the stock at last-known cost instead
   * of the cost it left at), the other dropping the row from cost of goods sold
   * — which is the RIGHT answer, arrived at by a query missing rather than by a
   * rule. Carrying the source type turns both into decisions.
   */
  sourceType: SourceType;
  /** Positive = money out with the cooking; negative = money back. */
  value: Prisma.Decimal;
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
  const consumptionMoves: ConsumptionMove[] = [];

  // A voided receipt must cut ITS layer (Q8), and that layer may already be
  // partly or wholly consumed by the time the void lands — so the unit cost of
  // every receipt is remembered for the length of the walk, not just while its
  // layer survives.
  const receiptUnitCost = new Map<string, Prisma.Decimal>();

  // The same memory for arrivals by transfer (Part 18). Keyed by the
  // `stock_transfer_item.id` a void points back at.
  const transferUnitCost = new Map<string, Prisma.Decimal>();

  // Part 22: what each day's consumption actually TOOK, keyed by the
  // `sales_consumption_item.id` its reversal points back at.
  //
  // The third instance of the same idea, and the first for an OUTFLOW: a
  // reversal has to give back the money that left, not today's price. Without
  // it, re-importing one file would hand 10 kg back at 220 that went out at 180
  // and quietly add ฿400 to what the stock is worth (ADR 0022 Q6).
  const consumptionCostOut = new Map<
    string,
    { qty: Prisma.Decimal; value: Prisma.Decimal }
  >();

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
    /** The money that left with it — what a reversal has to give back (Part 22). */
  ): Prisma.Decimal => {
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
      return costOut;
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
    return costOut;
  };

  /**
   * Undo an arrival by cutting the layer IT created, not the head of the queue
   * (Q8). Receive 10 @ 180 then 10 @ 220 and void the second: popping the head
   * would leave the 220s standing when the goods that went back were the 220s.
   *
   * Shared by `PO_RECEIVE_REVERSAL` and `TRANSFER_IN_REVERSAL` because "give back
   * exactly what this document brought in" is one rule, not two — only the
   * remembered unit cost differs, and that is the caller's argument.
   *
   * Whatever the layer cannot cover was already used, so the pile goes negative
   * rather than the shortfall being smoothed away: "you returned goods you had
   * already consumed" is exactly the thing someone needs to go and look at.
   */
  const reverseOwnLayer = (
    m: CostMovement,
    targetId: string | null,
    fallbackUnitCost: Prisma.Decimal
  ) => {
    const idx = targetId ? stack.findIndex((l) => l.sourceId === targetId) : -1;
    let remaining = m.qty.negated();

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

    if (remaining.greaterThan(0)) {
      consume(remaining, fallbackUnitCost, {
        movementId: m.id,
        type: m.type,
        sourceType: m.sourceType,
        sourceId: m.sourceId,
        occurredAt: m.occurredAt,
      });
    }
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
        const targetId = m.reversalOfItemId;
        reverseOwnLayer(
          m,
          targetId,
          (targetId ? receiptUnitCost.get(targetId) : undefined) ??
            lastKnownUnitCost ??
            ZERO
        );
        break;
      }

      case "TRANSFER_IN": {
        // Part 18 (ADR 0018 Q5). The ONLY arrival whose value comes from another
        // branch's ledger — frozen onto the line at dispatch and carried here.
        //
        // Falling through to `default` would have priced these goods at the
        // RECEIVING branch's last known cost, which is a number about a different
        // pile bought on a different day. For a branch that has never bought this
        // product at all it would be 0, and the goods would arrive free.
        const value = money(m.transferValue ?? ZERO);
        const unit = m.qty.isZero() ? ZERO : value.div(m.qty);
        transferUnitCost.set(m.sourceId, unit);
        // A transfer is a document, so it establishes a known cost here — but
        // only when it actually carried money. A transfer of goods the sender
        // could not price teaches the receiver nothing.
        if (!m.qty.isZero() && !value.isZero()) lastKnownUnitCost = unit;
        totalIn = totalIn.plus(value);
        push({
          movementId: m.id,
          sourceType: m.sourceType,
          sourceId: m.sourceId,
          occurredAt: m.occurredAt,
          qty: m.qty,
          value,
          // The sender's own confidence, not a fresh guess made here.
          pricing: m.transferPricing ?? (value.isZero() ? "UNPRICED" : "LAST_KNOWN"),
        });
        break;
      }

      case "TRANSFER_OUT_REVERSAL": {
        // A void gives the goods back to the sender, carrying the same frozen
        // money they left with (Q6) — so value is restored exactly.
        //
        // Accepted, and stated in the ADR: the layer re-enters at the BACK of the
        // queue rather than its original position. Value is exact; FIFO ordering
        // is approximate. The alternative — reconstructing which layers the
        // dispatch drew down and reinstating each — is a second replay inside the
        // replay, for an ordering nuance on an event that means "this document
        // should never have existed".
        const value = money(m.transferValue ?? ZERO);
        totalIn = totalIn.plus(value);
        push({
          movementId: m.id,
          sourceType: m.sourceType,
          sourceId: m.sourceId,
          occurredAt: m.occurredAt,
          qty: m.qty,
          value,
          pricing: m.transferPricing ?? (value.isZero() ? "UNPRICED" : "LAST_KNOWN"),
        });
        break;
      }

      case "TRANSFER_IN_REVERSAL": {
        // Q8's rule again, at the receiving end: take back the layer THIS
        // transfer brought in, not the head of the queue. If the branch bought
        // cheaper stock in the meantime, popping the front would consume goods
        // that never came off this truck.
        const targetId = m.reversalOfItemId;
        reverseOwnLayer(
          m,
          targetId,
          (targetId ? transferUnitCost.get(targetId) : undefined) ??
            lastKnownUnitCost ??
            ZERO
        );
        break;
      }

      case "CONSUMPTION": {
        // An ordinary outflow — the generic rule below would cost it correctly
        // and always did (the comment there named it before it existed). What
        // this case adds is the REMEMBERING: its reversal needs the money, and
        // only the walk ever knows it.
        const takenValue = consume(m.qty.negated(), lastKnownUnitCost ?? ZERO, {
          movementId: m.id,
          type: m.type,
          sourceType: m.sourceType,
          sourceId: m.sourceId,
          occurredAt: m.occurredAt,
        });
        consumptionCostOut.set(m.sourceId, {
          qty: m.qty.negated(),
          value: takenValue,
        });
        consumptionMoves.push({
          sourceId: m.sourceId,
          sourceType: m.sourceType,
          value: takenValue,
        });
        break;
      }

      case "CONSUMPTION_REVERSAL": {
        // A day given back — by a re-import or a re-post — carrying the same
        // money it left with, exactly as TRANSFER_OUT_REVERSAL does above and
        // for the same reason (ADR 0014 Q8).
        //
        // The same accepted approximation applies: the layer re-enters at the
        // BACK of the queue rather than its original position. Value is exact;
        // FIFO ordering is not. Reconstructing which layers a day's cooking drew
        // down and reinstating each would be a second replay inside the replay.
        const original = m.reversalOfItemId
          ? consumptionCostOut.get(m.reversalOfItemId)
          : undefined;

        // No original to give back: either an ordinary POSITIVE item — the
        // TREAT_AS_NOT_COOKED day whose cancellations outweighed its sales, which
        // reverses nothing — or a consumption that happened before this walk
        // began. Both fall back to the generic inbound rule.
        const value =
          original !== undefined && original.qty.greaterThan(0)
            ? m.qty.equals(original.qty)
              ? original.value
              : money(original.value.mul(m.qty).div(original.qty))
            : money(m.qty.mul(lastKnownUnitCost ?? ZERO));

        totalIn = totalIn.plus(value);
        push({
          movementId: m.id,
          sourceType: m.sourceType,
          sourceId: m.sourceId,
          occurredAt: m.occurredAt,
          qty: m.qty,
          value,
          // Not DOCUMENT. The money is exactly what left, but what left was
          // itself drawn from layers of mixed provenance, and this walk does not
          // track that mix — claiming a document's confidence for it would
          // overstate what we know. Same choice as the transfer reversal.
          pricing: value.isZero() ? "UNPRICED" : "LAST_KNOWN",
        });
        consumptionMoves.push({
          sourceId: m.sourceId,
          sourceType: m.sourceType,
          value: value.negated(),
        });
        break;
      }

      case "ADJUST_LOSS":
      default: {
        // Every other movement that removes stock draws FIFO from the head —
        // including `TRANSFER_OUT`, which is an ordinary outflow at the sending
        // branch: the money it takes with it is whatever its own layers held, and
        // that figure is exactly what gets frozen onto the line.
        // `default` still catches Sprint 5's `RECIPE_CONSUME` so a new outflow
        // costs correctly the day it lands rather than being silently ignored —
        // a wrong number is worse than a missing feature.
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
    consumptionMoves,
  };
}
