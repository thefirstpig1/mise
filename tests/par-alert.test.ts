// Rules PAR-1 / PAR-2 (Kong 2026-10-21): below par is red, near par is yellow.
import { describe, it, expect } from "vitest";
import { parAlertOf } from "@/lib/par-alert";

describe("parAlertOf", () => {
  it("no par = no alert, whatever is on hand", () => {
    expect(parAlertOf({ onHand: 0, par: null, usedPerDay: 5 }, 3)).toBeNull();
  });

  it("below par is LOW (on hand only — stock on order does not hide it)", () => {
    expect(parAlertOf({ onHand: 159, par: 200, usedPerDay: 6 }, 3)).toEqual({ level: "LOW" });
  });

  it("exactly at par is not LOW; it is NEAR when the shop warns ahead", () => {
    expect(parAlertOf({ onHand: 50, par: 50, usedPerDay: 2 }, 3)).toEqual({ level: "NEAR", daysToPar: 0 });
  });

  it("NEAR = reaches par within the warning days at the real usage rate", () => {
    // 163.3 − 160 = 3.3 kg above par, used 2.17/day → 1.5 days
    expect(parAlertOf({ onHand: 163.3, par: 160, usedPerDay: 2.17 }, 3)).toEqual({ level: "NEAR", daysToPar: 1 });
    // 880 − 450 = 430 above par at 24.6/day → 17 days: fine
    expect(parAlertOf({ onHand: 880, par: 450, usedPerDay: 24.6 }, 3)).toBeNull();
    // the same product in a shop that warns 20 days ahead
    expect(parAlertOf({ onHand: 880, par: 450, usedPerDay: 24.6 }, 20)).toEqual({ level: "NEAR", daysToPar: 17 });
  });

  it("with no usage rate, within 20% above par is NEAR", () => {
    expect(parAlertOf({ onHand: 59, par: 50, usedPerDay: null }, 3)).toEqual({ level: "NEAR", daysToPar: null });
    expect(parAlertOf({ onHand: 61, par: 50, usedPerDay: null }, 3)).toBeNull();
  });

  it("warning days 0 = below-par only", () => {
    expect(parAlertOf({ onHand: 50.1, par: 50, usedPerDay: 10 }, 0)).toBeNull();
    expect(parAlertOf({ onHand: 59, par: 50, usedPerDay: null }, 0)).toBeNull();
    expect(parAlertOf({ onHand: 49, par: 50, usedPerDay: null }, 0)).toEqual({ level: "LOW" });
  });
});

import { parStateOf } from "@/lib/par-alert";

describe("parStateOf — rule PAR-3: count what still needs a hand", () => {
  const cover = (o: Partial<{ ordered: number; requested: number; lateDays: number; requestLateDays: number }>) => ({ ordered: 0, requested: 0, lateDays: 0, requestLateDays: 0, ...o });
  const low = { onHand: 159, par: 200, usedPerDay: 5 };

  it("below par with nothing on its way needs ordering", () => {
    expect(parStateOf(low, 3, null)?.kind).toBe("need");
  });
  it("a sent order that covers it clears the red", () => {
    expect(parStateOf(low, 3, cover({ ordered: 50 }))).toEqual({ kind: "ordered", coming: 50 });
  });
  it("a purchase request that covers it clears the red too", () => {
    expect(parStateOf(low, 3, cover({ requested: 41 }))?.kind).toBe("requested");
  });
  it("ordered but not enough to reach par comes back red", () => {
    expect(parStateOf({ onHand: 43.6, par: 60, usedPerDay: 1 }, 3, cover({ ordered: 10 }))?.kind).toBe("short");
  });
  it("an order past its date comes back red, even if it would cover", () => {
    expect(parStateOf(low, 3, cover({ ordered: 50, lateDays: 4 }))?.kind).toBe("overdue");
  });
  it("a request nobody ordered for too long comes back red", () => {
    expect(parStateOf(low, 3, cover({ requested: 50, requestLateDays: 2 }))?.kind).toBe("stale-request");
    // ...but not once an order is out for it
    expect(parStateOf(low, 3, cover({ requested: 50, ordered: 50, requestLateDays: 2 }))?.kind).toBe("ordered");
  });
  it("near par: yellow until something is on its way", () => {
    const near = { onHand: 163.3, par: 160, usedPerDay: 2.17 };
    expect(parStateOf(near, 3, null)?.kind).toBe("near");
    expect(parStateOf(near, 3, cover({ ordered: 10 }))?.kind).toBe("near-covered");
  });
  it("fine stock has no state, whatever is on order", () => {
    expect(parStateOf({ onHand: 880, par: 450, usedPerDay: 24.6 }, 3, cover({ ordered: 100 }))).toBeNull();
  });
});

import { suggestOrderQty } from "@/lib/par-alert";

describe("suggestOrderQty — rule PAR-4", () => {
  it("below par: back to par, rounded up to the pack (PR1)", () => {
    // กุ้งขาว 200 − 158.6 = 41.4 kg → 21 boxes of 2 kg
    expect(suggestOrderQty({ onHand: 158.6, par: 200, usedPerDay: 5.48 }, 3, 0, 2)).toEqual({ level: "LOW", qty: 21 });
  });
  it("near par: enough to stay at par through the warning window", () => {
    // น้ำตาลทราย 160 + 2.17 × 3 − 163.3 = 3.2 kg → 1 sack of 10 kg
    expect(suggestOrderQty({ onHand: 163.3, par: 160, usedPerDay: 2.17 }, 3, 0, 10)).toEqual({ level: "NEAR", qty: 1 });
  });
  it("what is already coming is taken off", () => {
    expect(suggestOrderQty({ onHand: 158.6, par: 200, usedPerDay: 5.48 }, 3, 40, 2)).toEqual({ level: "LOW", qty: 1 });
    expect(suggestOrderQty({ onHand: 158.6, par: 200, usedPerDay: 5.48 }, 3, 50, 2)).toBeNull();
  });
  it("no par, or not low or near, suggests nothing", () => {
    expect(suggestOrderQty({ onHand: 1, par: null, usedPerDay: 5 }, 3, 0, 1)).toBeNull();
    expect(suggestOrderQty({ onHand: 880, par: 450, usedPerDay: 24.6 }, 3, 0, 15)).toBeNull();
  });
  it("2.0000000001 packs is 2, not 3", () => {
    expect(suggestOrderQty({ onHand: 0, par: 10.0000000001, usedPerDay: null }, 3, 0, 5)).toEqual({ level: "LOW", qty: 2 });
  });
});
