// /cost overview — the pure rules (Kong 2026-10-23). The period figures
// themselves are getBranchCostSummariesLogic's and are pinned by its own tests;
// what this file adds is only what the overview computes on top.

import { describe, expect, it } from "vitest";
import { laborFor, monthRanges, priceMovesFor, weekRanges } from "@/server/cost-overview";
import type { PricePoint } from "@/server/price-watch";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("weekRanges / monthRanges", () => {
  it("weeks start on Monday and the last one is this unfinished week", () => {
    const ws = weekRanges(d("2026-10-23"), 3); // a Friday
    expect(ws.map((w) => [w.from.toISOString().slice(0, 10), w.to.toISOString().slice(0, 10), w.partial])).toEqual([
      ["2026-10-05", "2026-10-11", false],
      ["2026-10-12", "2026-10-18", false],
      ["2026-10-19", "2026-10-23", true],
    ]);
    expect(ws[2].label).toBe("19–25 ต.ค.");
  });
  it("a week across two months names both", () => {
    expect(weekRanges(d("2026-09-02"), 1)[0].label).toBe("31 ส.ค.–6 ก.ย.");
  });
  it("months end today for the current one, with a Buddhist-era short year", () => {
    const ms = monthRanges(d("2026-10-23"), 2);
    expect(ms.map((m) => [m.label, m.to.toISOString().slice(0, 10), m.partial])).toEqual([
      ["ก.ย. 69", "2026-09-30", false],
      ["ต.ค. 69", "2026-10-23", true],
    ]);
  });
});

describe("rule CO-LABOR — monthly labour spread over calendar days", () => {
  const aug = new Map([["2026-08", 31_000]]);
  it("a week inside the month gets 7 days' share", () => {
    expect(laborFor({ from: d("2026-08-10"), to: d("2026-08-16") }, aug)).toEqual({ labor: 7000, missing: null });
  });
  it("a week touching a month with no labour is unknown, named by that month", () => {
    expect(laborFor({ from: d("2026-08-31"), to: d("2026-09-06") }, aug)).toEqual({ labor: null, missing: "ยังไม่มีค่าแรง ก.ย." });
  });
});

describe("rule CO-PRICE — what price movements cost in a period", () => {
  const pt = (date: string, productId: string, price: number, qty: number): PricePoint => ({
    date: d(date),
    productId,
    productName: productId,
    baseUnit: "kg",
    section: "",
    group: "",
    supplierId: "s",
    supplierName: "s",
    pricePerBase: price,
    qtyBase: qty,
  });
  const range = { from: d("2026-09-01"), to: d("2026-09-30") };

  it("prices each receipt in the period against the last price before it", () => {
    const r = priceMovesFor(range, [pt("2026-08-20", "pork", 100, 5), pt("2026-09-05", "pork", 110, 10), pt("2026-09-20", "pork", 120, 10)]);
    expect(r.up).toHaveLength(1);
    expect(r.up[0].extra).toBe(300); // (110−100)×10 + (120−100)×10
    expect(r.up[0].changePct).toBe(15);
  });
  it("a product first bought inside the period has no reference and is left out", () => {
    expect(priceMovesFor(range, [pt("2026-09-05", "new", 50, 1), pt("2026-09-25", "new", 80, 1)]).up).toEqual([]);
  });
  it("a fall is a saving, listed apart", () => {
    const r = priceMovesFor(range, [pt("2026-08-01", "sugar", 30, 1), pt("2026-09-10", "sugar", 27, 10)]);
    expect(r.up).toEqual([]);
    expect(r.down[0].extra).toBe(-30);
  });
});
