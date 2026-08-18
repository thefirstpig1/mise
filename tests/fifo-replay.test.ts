// ============================================================
// Mise — FIFO replay engine unit tests (Sprint 2 Part 14 L3a)
// ============================================================
// Pure, no DB. Every rule in ADR 0014 that can be stated as "these movements
// produce these layers" is stated that way here, because the engine is the one
// place in Part 14 where a wrong answer is silent — no constraint fires, no page
// errors, the number is just wrong.
//
// The money invariant (Q12) is asserted on EVERY case via `expectMoneyBalances`:
// inventory value must equal money in minus money consumed, to the satang.
// ============================================================

import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  replayFifoLayers,
  type CostLayer,
  type CostMovement,
  type ReplayState,
} from "@/server/fifo-replay";

const d = (n: number | string) => new Prisma.Decimal(n);
const num = (x: Prisma.Decimal) => x.toNumber();

let seq = 0;
const at = (day: number) => new Date(Date.UTC(2026, 7, day, 3, 0, 0));

/** A receipt of `qty` base units for `total` baht. */
const receive = (day: number, qty: number, total: number, itemId?: string): CostMovement => {
  const id = `mv-${++seq}`;
  return {
    id,
    qty: d(qty),
    type: "PO_RECEIVE",
    sourceType: "GR_LINE",
    sourceId: itemId ?? `gri-${id}`,
    occurredAt: at(day),
    lineTotal: d(total),
    reversalOfItemId: null,
    declaredUnitCost: null,
    transferValue: null,
    transferPricing: null,
  };
};

/** A void of the receipt whose GR item is `itemId`. */
const reverse = (day: number, qty: number, itemId: string): CostMovement => ({
  id: `mv-${++seq}`,
  qty: d(-qty),
  type: "PO_RECEIVE_REVERSAL",
  sourceType: "GR_LINE",
  sourceId: `gri-rev-${seq}`,
  occurredAt: at(day),
  lineTotal: null,
  reversalOfItemId: itemId,
  declaredUnitCost: null,
  transferValue: null,
  transferPricing: null,
});

const loss = (day: number, qty: number): CostMovement => ({
  id: `mv-${++seq}`,
  qty: d(-qty),
  type: "ADJUST_LOSS",
  sourceType: "ADJUSTMENT",
  sourceId: `adj-${seq}`,
  occurredAt: at(day),
  lineTotal: null,
  reversalOfItemId: null,
  declaredUnitCost: null,
  transferValue: null,
  transferPricing: null,
});

const gain = (day: number, qty: number, declaredUnitCost?: number): CostMovement => ({
  id: `mv-${++seq}`,
  qty: d(qty),
  type: "ADJUST_GAIN",
  sourceType: "ADJUSTMENT",
  sourceId: `adj-${seq}`,
  occurredAt: at(day),
  lineTotal: null,
  reversalOfItemId: null,
  declaredUnitCost: declaredUnitCost === undefined ? null : d(declaredUnitCost),
  transferValue: null,
  transferPricing: null,
});

/** ADR 0014 Q12 — the invariant the executive view gets reconciled against. */
const expectMoneyBalances = (s: ReplayState) => {
  expect(num(s.totalIn.minus(s.totalOut))).toBeCloseTo(num(s.inventoryValue), 2);
};

const run = (movements: CostMovement[], opening?: CostLayer[]) => {
  const s = replayFifoLayers(movements, opening);
  expectMoneyBalances(s);
  return s;
};

describe("FIFO replay (ADR 0014)", () => {
  // ----------------------------------------------------------
  // F1–F4 — the shape of the thing
  // ----------------------------------------------------------

  it("F1: an empty ledger is not an error — it is a product nobody has bought", () => {
    const s = run([]);
    expect(num(s.qtyOnHand)).toBe(0);
    expect(num(s.inventoryValue)).toBe(0);
    expect(num(s.costPerBaseUnit)).toBe(0);
    expect(s.costSource).toBe("UNPRICED");
  });

  it("F2: two receipts stack, and cost is the FRONT layer's (Q3b)", () => {
    // 10 kg @ 180 then 10 kg @ 220 — the ADR's running example.
    const s = run([receive(1, 10, 1800), receive(5, 10, 2200)]);

    expect(num(s.qtyOnHand)).toBe(20);
    expect(num(s.inventoryValue)).toBe(4000);
    expect(num(s.costPerBaseUnit)).toBe(180); // NOT the 200 a weighted average gives
    expect(s.costSource).toBe("FRONT_LAYER");
    expect(s.layers).toHaveLength(2);
  });

  it("F3: cost × qty is NOT the inventory value — the trap Q3b names", () => {
    const s = run([receive(1, 10, 1800), receive(5, 10, 2200)]);
    expect(num(s.costPerBaseUnit.mul(s.qtyOnHand))).toBe(3600);
    expect(num(s.inventoryValue)).toBe(4000); // sum the layers, never multiply
  });

  it("F4: consumption draws from the oldest layer first", () => {
    const s = run([receive(1, 10, 1800), receive(5, 10, 2200), loss(6, 4)]);

    expect(num(s.qtyOnHand)).toBe(16);
    expect(num(s.inventoryValue)).toBe(4000 - 720); // 4 kg left at 180
    expect(num(s.layers[0].qty)).toBe(6);
    expect(num(s.costPerBaseUnit)).toBe(180);
  });

  it("F5: exhausting a cheap layer RAISES the cost with nothing bought (Q3b)", () => {
    const s = run([receive(1, 10, 1800), receive(5, 10, 2200), loss(6, 10)]);
    expect(num(s.costPerBaseUnit)).toBe(220);
    expect(s.layers).toHaveLength(1);
  });

  // ----------------------------------------------------------
  // F6–F8 — Q5: stock that arrives with no document
  // ----------------------------------------------------------

  it("F6: a recount gain takes the LAST PURCHASE cost, not the front layer's (Q5)", () => {
    // Front layer is the old cheap one; the newest purchase is 220.
    const s = run([receive(1, 10, 1800), receive(5, 10, 2200), gain(6, 5)]);

    const found = s.layers[s.layers.length - 1];
    expect(num(found.qty)).toBe(5);
    expect(num(found.value)).toBe(1100); // 5 × 220, not 5 × 180
    expect(found.pricing).toBe("LAST_KNOWN");
    expect(s.hasUnpricedLayers).toBe(false);
  });

  it("F7: a declaration beats the fallback (Q5/Q6)", () => {
    const s = run([receive(1, 10, 1800), gain(6, 5, 150)]);
    const found = s.layers[1];
    expect(num(found.value)).toBe(750);
    expect(found.pricing).toBe("DECLARED");
  });

  it("F8: a gain with no purchase behind it is UNPRICED, not silently zero", () => {
    const s = run([gain(1, 5)]);
    expect(num(s.inventoryValue)).toBe(0);
    expect(s.costSource).toBe("UNPRICED");
    expect(s.hasUnpricedLayers).toBe(true); // the flag the UI must surface
  });

  // ----------------------------------------------------------
  // F9–F12 — Q7: negative stock
  // ----------------------------------------------------------

  it("F9: consuming more than exists creates a debt layer at the last known cost", () => {
    const s = run([receive(1, 10, 1800), loss(2, 15)]);

    expect(num(s.qtyOnHand)).toBe(-5);
    expect(num(s.inventoryValue)).toBe(-900); // NOT 0 — the contradiction Q7 rejects
    expect(s.negativeStock).toBe(true);
    expect(num(s.costPerBaseUnit)).toBe(180);
    expect(s.costSource).toBe("LAST_KNOWN");
    expect(s.layers).toHaveLength(1);
  });

  it("F10: the debt unwinds by itself when goods arrive (Q7)", () => {
    const s = run([receive(1, 10, 1800), loss(2, 15), receive(3, 10, 2200)]);

    expect(num(s.qtyOnHand)).toBe(5);
    expect(s.negativeStock).toBe(false);
    expect(s.layers).toHaveLength(1);
    expect(num(s.layers[0].qty)).toBe(5);
    expect(num(s.costPerBaseUnit)).toBe(220);
  });

  it("F11: an arrival that only partly covers the debt leaves the pile negative", () => {
    const s = run([receive(1, 10, 1800), loss(2, 20), receive(3, 5, 1100)]);
    expect(num(s.qtyOnHand)).toBe(-5);
    expect(s.negativeStock).toBe(true);
  });

  it("F12: stock at exactly zero still answers with the last known cost (Q10)", () => {
    const s = run([receive(1, 10, 1800), loss(2, 10)]);
    expect(num(s.qtyOnHand)).toBe(0);
    expect(s.layers).toHaveLength(0);
    expect(num(s.costPerBaseUnit)).toBe(180);
    expect(s.costSource).toBe("LAST_KNOWN");
  });

  // ----------------------------------------------------------
  // F13–F15 — Q8: a void cuts its own layer
  // ----------------------------------------------------------

  it("F13: voiding the SECOND receipt leaves the first — not the other way round", () => {
    const s = run([
      receive(1, 10, 1800, "gri-A"),
      receive(5, 10, 2200, "gri-B"),
      reverse(10, 10, "gri-B"),
    ]);

    expect(num(s.qtyOnHand)).toBe(10);
    expect(num(s.inventoryValue)).toBe(1800);
    expect(num(s.costPerBaseUnit)).toBe(180); // popping the head would say 220
    expect(s.layers[0].sourceId).toBe("gri-A");
  });

  it("F14: voiding a partly-consumed receipt drives the pile negative (Q8)", () => {
    // Only the 220 layer exists; 6 kg of it is used; then the receipt is voided.
    const s = run([receive(1, 10, 2200, "gri-B"), loss(2, 6), reverse(3, 10, "gri-B")]);

    expect(num(s.qtyOnHand)).toBe(-6);
    expect(s.negativeStock).toBe(true);
    expect(num(s.inventoryValue)).toBe(-1320); // 6 × 220
  });

  it("F15: a void never touches an unrelated layer", () => {
    const s = run([
      receive(1, 10, 1800, "gri-A"),
      receive(5, 10, 2200, "gri-B"),
      reverse(10, 10, "gri-A"),
    ]);

    expect(num(s.qtyOnHand)).toBe(10);
    expect(s.layers[0].sourceId).toBe("gri-B");
    expect(num(s.costPerBaseUnit)).toBe(220);
  });

  // ----------------------------------------------------------
  // F16–F18 — Q12 money, and Q2's whole reason for existing
  // ----------------------------------------------------------

  it("F16: an indivisible cost loses nothing across a partial consumption (Q12)", () => {
    // 1,000 ฿ for 90 kg = 11.111... ฿/kg, the ADR's worked example.
    const s = run([receive(1, 90, 1000), loss(2, 30)]);

    expect(num(s.qtyOnHand)).toBe(60);
    // Money out is the rounded third; what remains is exactly the difference.
    expect(num(s.totalOut)).toBe(333.33);
    expect(num(s.inventoryValue)).toBe(666.67);
    expect(num(s.totalIn)).toBe(1000);
  });

  it("F17: consuming a layer to exactly zero leaves no rounding residue", () => {
    const s = run([receive(1, 3, 100), loss(2, 1), loss(3, 1), loss(4, 1)]);
    expect(num(s.qtyOnHand)).toBe(0);
    expect(num(s.inventoryValue)).toBe(0);
    expect(num(s.totalOut)).toBe(100); // every satang accounted for
  });

  it("F18: a backdated receipt changes the answer — which is the point (Q2/Q4)", () => {
    // Same three events; the only difference is that the cheap delivery is
    // discovered later and keyed with its true, earlier date. A stored cost
    // history would now be wrong about the 1st; the replay simply is not.
    const asKeyed = run([receive(1, 10, 1800), loss(2, 4)]);
    expect(num(asKeyed.costPerBaseUnit)).toBe(180);

    const withBackdate = run([
      receive(-3, 10, 1500), // 28 Jul, found in a drawer three weeks later
      receive(1, 10, 1800),
      loss(2, 4),
    ]);
    expect(num(withBackdate.costPerBaseUnit)).toBe(150);
    expect(num(withBackdate.qtyOnHand)).toBe(16);
  });

  // ----------------------------------------------------------
  // F19 — the snapshot escape hatch (risk R2)
  // ----------------------------------------------------------

  it("F19: an opening stack is honoured and never mutated", () => {
    const opening: CostLayer[] = [
      {
        movementId: "snap-1",
        sourceType: "SYSTEM_INITIAL",
        sourceId: "snap-src",
        occurredAt: at(0),
        qty: d(10),
        value: d(1800),
        pricing: "DOCUMENT",
      },
    ];
    const before = num(opening[0].qty);

    const s = replayFifoLayers([loss(2, 4)], opening);
    expect(num(s.qtyOnHand)).toBe(6);
    expect(num(s.inventoryValue)).toBe(1080);
    // The caller's array survives intact — a snapshot is shared state one day.
    expect(num(opening[0].qty)).toBe(before);
  });

  // ----------------------------------------------------------
  // F20 — Sprint 3+ movement types must cost, not be ignored
  // ----------------------------------------------------------

  it("F20: an unknown outflow type still draws FIFO rather than being skipped", () => {
    const future: CostMovement = {
      ...loss(3, 4),
      // A WASTE / TRANSFER_OUT / RECIPE_CONSUME row from a later sprint.
      type: "PO_RECEIVE_REVERSAL" as never,
      reversalOfItemId: null,
    };
    const s = run([receive(1, 10, 1800), { ...future, type: "WASTE" as never }]);
    expect(num(s.qtyOnHand)).toBe(6);
    expect(num(s.inventoryValue)).toBe(1080);
  });

  // ----------------------------------------------------------
  // F21–F22 — outflow valuation (what the branch summary prices waste from)
  // ----------------------------------------------------------

  it("F21: each outflow records what it actually cost, layer by layer", () => {
    // 4 kg out of the cheap layer, then 8 kg that straddles both layers.
    const s = run([receive(1, 10, 1800), receive(5, 10, 2200), loss(6, 4), loss(7, 8)]);

    expect(s.outflows).toHaveLength(2);
    expect(num(s.outflows[0].value)).toBe(720); // 4 × 180
    // 6 kg left at 180 (1,080) + 2 kg at 220 (440) — NOT 8 × any single rate.
    expect(num(s.outflows[1].value)).toBe(1520);
    expect(num(s.outflows[1].qty)).toBe(8);
    expect(s.outflows[1].type).toBe("ADJUST_LOSS");
  });

  it("F22: an outflow beyond the layers is still valued, at the last known cost", () => {
    const s = run([receive(1, 10, 1800), loss(2, 15)]);
    expect(s.outflows).toHaveLength(1);
    expect(num(s.outflows[0].value)).toBe(2700); // 1,800 held + 900 owed
    expect(num(s.outflows[0].qty)).toBe(15);
  });
});

// ============================================================
// Part 18 — arrivals and departures by transfer (ADR 0018 Q5/Q6)
// ============================================================
// The transfer types are the first movements whose value comes from ANOTHER
// branch's ledger. Everything below is about that money surviving the journey
// intact, and about a void giving back exactly what a transfer brought in.

/** Goods arriving from another branch, carrying `total` baht frozen at dispatch. */
const transferIn = (
  day: number,
  qty: number,
  total: number,
  itemId?: string,
  pricing: "DOCUMENT" | "DECLARED" | "LAST_KNOWN" | "UNPRICED" = "DOCUMENT"
): CostMovement => ({
  id: `mv-${++seq}`,
  qty: d(qty),
  type: "TRANSFER_IN",
  sourceType: "TRANSFER_IN",
  sourceId: itemId ?? `tfi-${seq}`,
  occurredAt: at(day),
  lineTotal: null,
  reversalOfItemId: null,
  declaredUnitCost: null,
  transferValue: d(total),
  transferPricing: pricing,
});

/** Goods leaving for another branch — an ordinary outflow at this end. */
const transferOut = (day: number, qty: number): CostMovement => ({
  id: `mv-${++seq}`,
  qty: d(-qty),
  type: "TRANSFER_OUT",
  sourceType: "TRANSFER_OUT",
  sourceId: `tfo-${seq}`,
  occurredAt: at(day),
  lineTotal: null,
  reversalOfItemId: null,
  declaredUnitCost: null,
  transferValue: null,
  transferPricing: null,
});

/** A void, at the RECEIVING end: take back the layer `itemId` brought in. */
const transferInReversal = (
  day: number,
  qty: number,
  itemId: string
): CostMovement => ({
  id: `mv-${++seq}`,
  qty: d(-qty),
  type: "TRANSFER_IN_REVERSAL",
  sourceType: "TRANSFER_IN",
  sourceId: `tfi-rev-${seq}`,
  occurredAt: at(day),
  lineTotal: null,
  reversalOfItemId: itemId,
  declaredUnitCost: null,
  transferValue: null,
  transferPricing: null,
});

/** A void, at the SENDING end: the goods come back, carrying the same money. */
const transferOutReversal = (
  day: number,
  qty: number,
  total: number
): CostMovement => ({
  id: `mv-${++seq}`,
  qty: d(qty),
  type: "TRANSFER_OUT_REVERSAL",
  sourceType: "TRANSFER_OUT",
  sourceId: `tfo-rev-${seq}`,
  occurredAt: at(day),
  lineTotal: null,
  reversalOfItemId: null,
  declaredUnitCost: null,
  transferValue: d(total),
  transferPricing: "DOCUMENT",
});

describe("replayFifoLayers — transfers (ADR 0018)", () => {
  it("F23: a transfer-in is valued at the money frozen at dispatch, not at this branch's history", () => {
    // The receiving branch bought at 220; the goods that arrive were bought at
    // 180 by the sender. Pricing them at 220 would invent 400 baht of stock.
    const s = run([receive(1, 10, 2200), transferIn(2, 10, 1800)]);
    expect(num(s.inventoryValue)).toBe(4000);
    expect(s.layers).toHaveLength(2);
    expect(num(s.layers[1].value)).toBe(1800);
  });

  it("F24: a transfer-in to a branch that never bought this product is NOT free", () => {
    // The whole reason the money travels: with no purchase history here, the
    // fallback chain would have priced these goods at 0.
    const s = run([transferIn(1, 10, 1800)]);
    expect(num(s.inventoryValue)).toBe(1800);
    expect(num(s.costPerBaseUnit)).toBe(180);
    expect(s.costSource).toBe("FRONT_LAYER");
    expect(s.hasUnpricedLayers).toBe(false);
  });

  it("F25: the SENDER's uncertainty survives the journey — 0 baht reads as UNPRICED, not as free goods", () => {
    const s = run([transferIn(1, 10, 0, undefined, "UNPRICED")]);
    expect(num(s.inventoryValue)).toBe(0);
    expect(s.hasUnpricedLayers).toBe(true);
    expect(s.costSource).toBe("UNPRICED");
    // And it must not teach this branch a "last known cost" of zero.
    expect(s.lastKnownUnitCost).toBeNull();
  });

  it("F26: a transfer-out is an ordinary FIFO outflow, oldest layer first", () => {
    const s = run([receive(1, 10, 1800), receive(5, 10, 2200), transferOut(6, 10)]);
    expect(num(s.inventoryValue)).toBe(2200);
    expect(s.outflows).toHaveLength(1);
    // 1,800 is exactly the money the dispatch freezes onto the line.
    expect(num(s.outflows[0].value)).toBe(1800);
    expect(s.outflows[0].type).toBe("TRANSFER_OUT");
  });

  it("F27: voiding at the receiving end cuts the TRANSFER's layer, not the head of the queue", () => {
    // The branch already held cheap stock when the transfer arrived. Popping the
    // front would give back the 180s and leave the 250s standing.
    const s = run([
      receive(1, 10, 1800),
      transferIn(2, 10, 2500, "tf-item-1"),
      transferInReversal(3, 10, "tf-item-1"),
    ]);
    expect(num(s.qtyOnHand)).toBe(10);
    expect(num(s.inventoryValue)).toBe(1800);
    expect(s.layers).toHaveLength(1);
    expect(s.layers[0].sourceType).toBe("GR_LINE");
  });

  it("F28: voiding at the sending end gives back the same money that left", () => {
    const s = run([receive(1, 10, 1800), transferOut(2, 4), transferOutReversal(3, 4, 720)]);
    expect(num(s.qtyOnHand)).toBe(10);
    expect(num(s.inventoryValue)).toBe(1800);
  });

  it("F29: a void after the goods were used drives the receiver negative rather than smoothing it away", () => {
    const s = run([
      transferIn(1, 10, 1800, "tf-item-2"),
      loss(2, 6),
      transferInReversal(3, 10, "tf-item-2"),
    ]);
    expect(num(s.qtyOnHand)).toBe(-6);
    expect(s.negativeStock).toBe(true);
  });

  it("F30: a chain of transfers keeps the money exact through both ends", () => {
    // Arrive at 180, send half on, and the value left must be exactly half.
    const s = run([transferIn(1, 10, 1800), transferOut(2, 5)]);
    expect(num(s.qtyOnHand)).toBe(5);
    expect(num(s.inventoryValue)).toBe(900);
    expect(num(s.outflows[0].value)).toBe(900);
  });
});
