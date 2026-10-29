// ============================================================
// Mise — production in the FIFO walk (ADR 0040 Q4, Q7)
// ============================================================
// Pure, no DB, in the style of fifo-replay.test.ts: every rule is stated as
// "these movements produce these numbers", and every case checks that money
// is neither created nor destroyed — here ACROSS piles, because a production
// moves money from the bones' pile into the soup's.
// ============================================================

import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import type { CostMovement, ReplayState } from "@/server/fifo-replay";
import { allocateProduced, replayChain } from "@/server/fifo-chain";

const d = (n: number | string) => new Prisma.Decimal(n);
const num = (x: Prisma.Decimal) => x.toNumber();
const at = (day: number, hour = 3) => new Date(Date.UTC(2026, 9, day, hour, 0, 0));

let seq = 0;
const base = (over: Partial<CostMovement> & Pick<CostMovement, "qty" | "type" | "sourceType" | "occurredAt">): CostMovement => {
  const id = `mv-${++seq}`;
  return {
    id,
    sourceId: `src-${id}`,
    lineTotal: null,
    reversalOfItemId: null,
    declaredUnitCost: null,
    transferValue: null,
    transferPricing: null,
    ...over,
  };
};

const receive = (day: number, qty: number, total: number): CostMovement =>
  base({ qty: d(qty), type: "PO_RECEIVE", sourceType: "GR_LINE", occurredAt: at(day), lineTotal: d(total) });

const gainUnpriced = (day: number, qty: number): CostMovement =>
  base({ qty: d(qty), type: "ADJUST_GAIN", sourceType: "ADJUSTMENT", occurredAt: at(day) });

const loss = (day: number, qty: number): CostMovement =>
  base({ qty: d(-qty), type: "ADJUST_LOSS", sourceType: "ADJUSTMENT", occurredAt: at(day) });

/** An input used by production `pd`; its item id is returned as `sourceId`. */
const useIn = (pd: string, day: number, qty: number, itemId = `${pd}-in-${++seq}`): CostMovement =>
  base({ qty: d(-qty), type: "PRODUCTION_OUT", sourceType: "PRODUCTION", sourceId: itemId, occurredAt: at(day), productionId: pd });

const makeOut = (pd: string, day: number, qty: number, share = 100, itemId = `${pd}-out-${++seq}`): CostMovement =>
  base({ qty: d(qty), type: "PRODUCTION_IN", sourceType: "PRODUCTION", sourceId: itemId, occurredAt: at(day), productionId: pd, valueSharePct: d(share) });

const giveBackIn = (pd: string, day: number, qty: number, ofItem: string): CostMovement =>
  base({ qty: d(qty), type: "PRODUCTION_OUT_REVERSAL", sourceType: "PRODUCTION", occurredAt: at(day), productionId: pd, reversalOfItemId: ofItem });

const takeBackOut = (pd: string, day: number, qty: number, ofItem: string): CostMovement =>
  base({ qty: d(-qty), type: "PRODUCTION_IN_REVERSAL", sourceType: "PRODUCTION", occurredAt: at(day), productionId: pd, reversalOfItemId: ofItem });

/** money in − money out = value, in every pile. */
const balances = (states: Map<string, ReplayState>) => {
  for (const s of states.values()) {
    expect(num(s.totalIn.minus(s.totalOut))).toBeCloseTo(num(s.inventoryValue), 2);
  }
};

/** Inventory across all piles — what a production must leave unchanged. */
const totalValue = (states: Map<string, ReplayState>) =>
  [...states.values()].reduce((acc, s) => acc + num(s.inventoryValue), 0);

describe("allocateProduced (Q7)", () => {
  it("A1: splits by share and the parts add up to the total to the satang", () => {
    const split = allocateProduced(d("1000.01"), [
      { id: "fillet", share: d(60) },
      { id: "belly", share: d(25) },
      { id: "head", share: d(15) },
    ]);
    expect(num(split.get("belly")!)).toBe(250);
    expect(num(split.get("head")!)).toBe(150);
    // The remainder satang lands on the largest share.
    expect(num(split.get("fillet")!)).toBe(600.01);
    const sum = [...split.values()].reduce((a, v) => a.plus(v), d(0));
    expect(sum.toString()).toBe("1000.01");
  });

  it("A2: shares that do not sum to 100 still conserve the money", () => {
    const split = allocateProduced(d("100"), [
      { id: "a", share: d("33.3333") },
      { id: "b", share: d("33.3333") },
      { id: "c", share: d("33.3333") },
    ]);
    const sum = [...split.values()].reduce((a, v) => a.plus(v), d(0));
    expect(sum.toString()).toBe("100");
  });

  it("A3: a single output with no share takes everything", () => {
    const split = allocateProduced(d("460.5"), [{ id: "soup", share: null }]);
    expect(num(split.get("soup")!)).toBe(460.5);
  });
});

describe("replayChain — a production hands its inputs' money to its output (Q4)", () => {
  it("C1: soup carries exactly what the bones and onion cost, and nothing is created", () => {
    const bones = [receive(1, 10, 500), useIn("pd1", 2, 8)];
    const onion = [receive(1, 5, 150), useIn("pd1", 2, 2)];
    const soup = [makeOut("pd1", 2, 20), loss(3, 5)];
    // Soup FIRST in the map: the driver must still walk the inputs before it.
    const states = replayChain(new Map([["soup", soup], ["bones", bones], ["onion", onion]]));

    expect([...states.keys()]).toEqual(["soup", "bones", "onion"]);
    // 8 kg bones @ 50 + 2 kg onion @ 30 = 460 for 20 L.
    const s = states.get("soup")!;
    expect(num(s.qtyOnHand)).toBe(15);
    expect(num(s.inventoryValue)).toBe(345); // 15 L × 23
    expect(num(s.outflows[0].value)).toBe(115); // 5 L × 23
    expect(s.costSource).toBe("FRONT_LAYER");
    expect(num(states.get("bones")!.inventoryValue)).toBe(100);
    expect(num(states.get("onion")!.inventoryValue)).toBe(90);
    // 650 bought − 115 lost = 535 still held across the three piles.
    expect(totalValue(states)).toBeCloseTo(535, 2);
    balances(states);
  });

  it("C2: correcting a bone price moves the soup (stored nowhere)", () => {
    const run = (boneTotal: number) =>
      replayChain(new Map([
        ["bones", [receive(1, 10, boneTotal), useIn("pd2", 2, 10)]],
        ["soup", [makeOut("pd2", 2, 20)]],
      ]));
    expect(num(run(500).get("soup")!.inventoryValue)).toBe(500);
    expect(num(run(600).get("soup")!.inventoryValue)).toBe(600);
  });

  it("C3: a trim splits the fish by % value, to the satang", () => {
    const fish = [receive(1, 5, 1000.01), useIn("pd3", 2, 5)];
    const states = replayChain(new Map([
      ["fillet", [makeOut("pd3", 2, 2.4, 60)]],
      ["belly", [makeOut("pd3", 2, 0.9, 25)]],
      ["head", [makeOut("pd3", 2, 0.6, 15)]],
      ["fish", fish],
    ]));
    expect(num(states.get("fillet")!.inventoryValue)).toBe(600.01);
    expect(num(states.get("belly")!.inventoryValue)).toBe(250);
    expect(num(states.get("head")!.inventoryValue)).toBe(150);
    expect(num(states.get("fish")!.inventoryValue)).toBe(0);
    expect(totalValue(states)).toBeCloseTo(1000.01, 2);
    balances(states);
  });

  it("C4: a chain two levels deep — bones → stock → soup", () => {
    const states = replayChain(new Map([
      ["soup", [makeOut("pdB", 3, 10)]],
      ["stock", [makeOut("pdA", 2, 20), useIn("pdB", 3, 10)]],
      ["bones", [receive(1, 10, 400), useIn("pdA", 2, 10)]],
    ]));
    expect(num(states.get("stock")!.inventoryValue)).toBe(200);
    expect(num(states.get("soup")!.inventoryValue)).toBe(200);
    expect(totalValue(states)).toBeCloseTo(400, 2);
    balances(states);
  });

  it("C5: unpriced inputs make an unpriced output — confidence survives the cooking", () => {
    const states = replayChain(new Map([
      ["bones", [gainUnpriced(1, 10), useIn("pd5", 2, 10)]],
      ["soup", [makeOut("pd5", 2, 20)]],
    ]));
    const soup = states.get("soup")!;
    expect(num(soup.inventoryValue)).toBe(0);
    expect(soup.hasUnpricedLayers).toBe(true);
    expect(soup.costSource).toBe("UNPRICED");
  });

  it("C6: inputs bought with a receipt make a document-confident output", () => {
    const states = replayChain(new Map([
      ["bones", [receive(1, 10, 500), useIn("pd6", 2, 10)]],
      ["soup", [makeOut("pd6", 2, 20)]],
    ]));
    expect(states.get("soup")!.costSource).toBe("FRONT_LAYER");
  });

  it("C7: a void gives the inputs back at the money they left with, and takes the output's own layer", () => {
    const inItem = "pd7-in";
    const outItem = "pd7-out";
    const states = replayChain(new Map([
      ["bones", [
        receive(1, 10, 500),
        useIn("pd7", 2, 10, inItem),
        receive(3, 10, 700), // the price went up after the making
        giveBackIn("pd7", 4, 10, inItem),
      ]],
      ["soup", [
        receive(1, 5, 50), // soup bought earlier, sits at the front
        makeOut("pd7", 2, 20, 100, outItem),
        takeBackOut("pd7", 4, 20, outItem),
      ]],
    ]));
    // Bones: 700 bought on day 3 + the 500 given back at what it left with.
    expect(num(states.get("bones")!.inventoryValue)).toBe(1200);
    // Soup: the production's own layer left; the bought soup stays.
    expect(num(states.get("soup")!.inventoryValue)).toBe(50);
    expect(num(states.get("soup")!.qtyOnHand)).toBe(5);
    balances(states);
  });

  it("C8: a cycle in a damaged ledger does not crash the page", () => {
    const states = replayChain(new Map([
      ["a", [receive(1, 10, 100), useIn("x", 2, 5), makeOut("y", 3, 5)]],
      ["b", [makeOut("x", 2, 5), useIn("y", 3, 5)]],
    ]));
    expect(states.size).toBe(2);
    balances(states);
  });

  it("C9: a ledger with no production is walked exactly as before", () => {
    const rows = [receive(1, 10, 100), loss(2, 3)];
    const states = replayChain(new Map([["p", rows]]));
    expect(num(states.get("p")!.inventoryValue)).toBe(70);
    expect(states.get("p")!.outflows[0].pricing).toBe("DOCUMENT");
    expect(states.get("p")!.outflows[0].sourceId).toBe(rows[1].sourceId);
  });
});
