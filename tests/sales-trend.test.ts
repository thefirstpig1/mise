import { describe, expect, it } from "vitest";
import {
  changePct,
  discountedMonths,
  lastMonths,
  monthRangeDates,
  monthsBetween,
  perDay,
  promoSide,
  promoVerdict,
  promoWindows,
  salesTrend,
  type PromoSide,
} from "@/lib/sales-trend";
import type { CostMap, MenuDayRow, MenuMeta } from "@/lib/sales-insight";

const meta = (id: string, cat: string): MenuMeta => ({ id, name: id, categoryKey: cat, categoryName: `หมวด ${cat}`, isPosStub: false });
const menus = new Map([
  ["a", meta("a", "c1")],
  ["b", meta("b", "c1")],
  ["z", meta("z", "c2")],
]);
const row = (day: string, menuId: string, net: number, qty: number, branchId = "br"): MenuDayRow => ({ day, branchId, menuId, net, qty });

describe("month helpers", () => {
  it("lists months across a year end", () => {
    expect(monthsBetween("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(lastMonths("2026-02", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
    expect(monthRangeDates("2026-01", "2026-02")).toEqual({ from: "2026-01-01", to: "2026-02-28" });
  });
});

describe("salesTrend (TR1–TR3)", () => {
  const rows = [
    row("2026-08-01", "a", 100, 1),
    row("2026-08-02", "b", 400, 3),
    row("2026-09-01", "a", 200, 2),
    row("2026-09-01", "z", 50, 1),
  ];
  const costs: CostMap = new Map([["br:a", { cost: 40, confidence: "HIGH" }]]);
  const t = salesTrend(rows, menus, costs, ["2026-07", "2026-08", "2026-09"]);

  it("divides by the days the whole selection had data, and a month with none is a gap", () => {
    expect(t.months.map((m) => m.days)).toEqual([0, 2, 1]);
    const c1 = t.categories.find((c) => c.key === "c1")!;
    expect(perDay(c1.points[0], "net")).toBeNull();
    expect(perDay(c1.points[1], "net")).toBe(250); // (100 + 400) / 2 days
    expect(perDay(c1.points[2], "qty")).toBe(2);
  });

  it("counts profit only where a recipe exists and reports the rest as unknown", () => {
    const c1 = t.categories.find((c) => c.key === "c1")!;
    expect(c1.points[1].profit).toBe(60); // a: 100 − 40; b has no recipe
    expect(c1.points[1].unknownNet).toBe(400);
    const c2 = t.categories.find((c) => c.key === "c2")!;
    expect(perDay(c2.points[2], "profit")).toBeNull();
  });

  it("orders categories and menus by sales over the range", () => {
    expect(t.categories.map((c) => c.key)).toEqual(["c1", "c2"]);
    expect(t.menus.map((m) => m.key)).toEqual(["b", "a", "z"]);
  });
});

describe("discountedMonths (TR4)", () => {
  const p = (net: number, qty: number) => ({ days: 1, net, qty, profit: null, unknownNet: 0 });
  it("marks a month more than 5% under the usual price, not one 4% under", () => {
    expect(discountedMonths([p(1090, 10), p(1090, 10), p(950, 10), p(1050, 10)])).toEqual([2]);
  });
  it("needs at least two priced months", () => {
    expect(discountedMonths([p(500, 10), p(0, 0)])).toEqual([]);
  });
});

describe("promotion check (TR5)", () => {
  const side = (o: Partial<PromoSide>): PromoSide => ({
    from: "",
    to: "",
    days: 30,
    menuQty: 6,
    menuNet: 600,
    otherQty: 60,
    categoryQty: 66,
    categoryProfit: 4000,
    ...o,
  });

  it("refuses to judge on too few days", () => {
    expect(promoVerdict(side({ days: 5 }), side({}))).toBe("not_enough");
    expect(promoVerdict(side({}), side({ days: 2 }))).toBe("not_enough");
  });
  it("no lift when the menu did not sell more", () => {
    expect(promoVerdict(side({}), side({ menuQty: 6.1 }))).toBe("no_lift");
  });
  it("profit down beats everything else once the menu sold more", () => {
    expect(promoVerdict(side({}), side({ menuQty: 12, categoryProfit: 3900 }))).toBe("profit_down");
  });
  it("moved when the other menus lost most of what this one gained", () => {
    expect(promoVerdict(side({}), side({ menuQty: 12, otherQty: 55, categoryProfit: 4100 }))).toBe("moved");
  });
  it("worked when the gain was mostly new", () => {
    expect(promoVerdict(side({}), side({ menuQty: 12, otherQty: 59, categoryProfit: 4300 }))).toBe("worked");
  });
  it("without cost access judges on plates alone", () => {
    expect(promoVerdict(side({ categoryProfit: null }), side({ menuQty: 12, otherQty: 59, categoryProfit: null }))).toBe("worked");
  });

  it("builds a side per day with data, the other menus being the category minus this one", () => {
    const rows = [row("2026-10-01", "a", 200, 2), row("2026-10-01", "b", 100, 1), row("2026-10-02", "z", 50, 1), row("2026-10-02", "a", 100, 1)];
    const s = promoSide(rows, "a", new Set(["a", "b"]), new Map([["br:a", { cost: 40, confidence: "HIGH" }]]), "2026-10-01", "2026-10-31");
    expect(s.days).toBe(2);
    expect(s.menuQty).toBe(1.5);
    expect(s.otherQty).toBe(0.5);
    expect(s.categoryProfit).toBe((300 - 3 * 40) / 2);
  });

  it("windows: three months before, and as long after as it ran", () => {
    expect(promoWindows("2026-10-01", "2026-10-31", "3m")).toEqual({
      before: { from: "2026-07-01", to: "2026-09-30" },
      during: { from: "2026-10-01", to: "2026-10-31" },
      after: { from: "2026-11-01", to: "2026-12-01" },
    });
  });
});

describe("changePct", () => {
  it("is null without a base", () => {
    expect(changePct(5, 0)).toBeNull();
    expect(changePct(null, 3)).toBeNull();
    expect(changePct(110, 100)).toBeCloseTo(10);
  });
});
