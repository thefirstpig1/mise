// sales-insight — the arithmetic behind Kong's four questions (2026-09-28).
// Pure functions, no database.

import { describe, expect, it } from "vitest";
import {
  categoryByWeekday,
  costKey,
  enrich,
  menuCostPerDish,
  menuInsight,
  menuMovers,
  withDishCost,
  menusOnWeekday,
  periodStats,
  periodLabelTh,
  previousRange,
  type CostMap,
  type MenuDayRow,
  type MenuMeta,
} from "@/lib/sales-insight";

const menus = new Map<string, MenuMeta>([
  ["tomyum", { id: "tomyum", name: "ต้มยำ", categoryKey: "soup", categoryName: "ต้ม ยำ", isPosStub: false }],
  ["beer", { id: "beer", name: "เบียร์", categoryKey: "beer", categoryName: "เบียร์", isPosStub: false }],
  ["rare", { id: "rare", name: "เมนูนาน ๆ ที", categoryKey: "soup", categoryName: "ต้ม ยำ", isPosStub: false }],
]);
const row = (day: string, menuId: string, net: number, qty: number, branchId = "b1"): MenuDayRow => ({
  day,
  branchId,
  menuId,
  net,
  qty,
});
const noCost: CostMap = new Map();

// 2026-09-05 and 2026-09-12 are Saturdays; 2026-09-07 is a Monday.
describe("SI1 — compare per DAY, never in totals", () => {
  it("a longer period with more total is still worse per day", () => {
    const aug = enrich([row("2026-08-15", "tomyum", 300, 3)], menus, noCost); // 1 day
    const sep = enrich(
      [row("2026-09-05", "tomyum", 200, 2), row("2026-09-12", "tomyum", 200, 2)],
      menus,
      noCost
    ); // 2 days, more in total
    expect(periodStats(sep, menus, "net").perDay.net).toBe(200);
    expect(periodStats(aug, menus, "net").perDay.net).toBe(300);
  });
});

describe("categoryByWeekday — question 1", () => {
  const rows = enrich(
    [
      row("2026-09-05", "tomyum", 100, 1),
      row("2026-09-05", "beer", 300, 3),
      row("2026-09-12", "tomyum", 300, 3),
      row("2026-09-12", "beer", 300, 3),
      row("2026-09-07", "beer", 50, 1),
    ],
    menus,
    noCost
  );
  it("averages over the number of THAT weekday in the data, and shares within the day", () => {
    const t = categoryByWeekday(rows, menus, "net");
    const soup = t.categories.find((c) => c.key === "soup")!;
    expect(t.daysPerWeekday[6]).toBe(2);
    expect(soup.cells[6].perDay).toBe(200); // (100 + 300) / 2 Saturdays
    expect(soup.cells[6].share).toBe(40); // 400 of 1000
    expect(soup.cells[1].share).toBe(0); // sold nothing on Monday
  });
  it("switches measure: by plates the same Saturdays read differently", () => {
    const soup = categoryByWeekday(rows, menus, "qty").categories.find((c) => c.key === "soup")!;
    expect(soup.cells[6].perDay).toBe(2);
  });
  it("lists a cell's menus per such day", () => {
    const list = menusOnWeekday(rows, menus, "net", "soup", 6);
    expect(list).toEqual([{ id: "tomyum", name: "ต้มยำ", perDay: 200, qtyPerDay: 2 }]);
  });
});

describe("SI2 — profit from the recipe cost; no recipe is null, not zero", () => {
  const costs: CostMap = new Map([[costKey("b1", "tomyum"), { cost: 40, confidence: "HIGH" }]]);
  const rows = enrich([row("2026-09-05", "tomyum", 300, 3), row("2026-09-05", "beer", 100, 1)], menus, costs);
  it("net − qty × cost, and the uncosted revenue is reported beside it", () => {
    const s = periodStats(rows, menus, "profit");
    expect(s.perDay.profit).toBe(180); // 300 − 3 × 40
    expect(s.unknownNetPerDay).toBe(100); // beer has no recipe
    expect(rows.find((r) => r.menuId === "beer")!.profit).toBeNull();
  });
  it("weights the cost per dish by plates sold at each branch", () => {
    const c2: CostMap = new Map([
      [costKey("b1", "tomyum"), { cost: 40, confidence: "HIGH" }],
      [costKey("b2", "tomyum"), { cost: 60, confidence: "LOW" }],
    ]);
    const r2 = enrich(
      [row("2026-09-05", "tomyum", 300, 3, "b1"), row("2026-09-05", "tomyum", 100, 1, "b2")],
      menus,
      c2
    );
    const m = menuInsight("tomyum", r2, [], menus, c2, "net")!;
    expect(m.costPerDish).toBe(45); // (3×40 + 1×60) / 4
    expect(m.avgPrice).toBe(100);
    expect(m.profitPerDish).toBe(55);
    expect(m.confidence).toBe("LOW"); // the weakest branch speaks for the dish
  });
  it("the popup priced with the page's cost equals the popup priced on the server", () => {
    const c2: CostMap = new Map([
      [costKey("b1", "tomyum"), { cost: 40, confidence: "HIGH", recipeId: "r1" }],
      [costKey("b2", "tomyum"), { cost: 60, confidence: "LOW", recipeId: "r2" }],
    ]);
    const raw = [row("2026-09-05", "tomyum", 300, 3, "b1"), row("2026-09-05", "tomyum", 100, 1, "b2")];
    const onServer = menuInsight("tomyum", enrich(raw, menus, c2), [], menus, c2, "net")!;
    const uncosted = menuInsight("tomyum", enrich(raw, menus, noCost), [], menus, noCost, "net")!;
    const fromPage = withDishCost(uncosted, menuCostPerDish(enrich(raw, menus, c2), c2).get("tomyum")!);
    expect(fromPage).toEqual(onServer);
    expect(withDishCost(uncosted, null)).toEqual(uncosted); // no recipe stays uncosted
  });
});

describe("SI3 — movers need volume in BOTH periods", () => {
  it("1 → 2 plates is not 'rising' ahead of 40 → 48", () => {
    const prev = enrich([row("2026-08-15", "rare", 10, 0.5), row("2026-08-15", "tomyum", 4000, 40)], menus, noCost);
    const cur = enrich([row("2026-09-05", "rare", 20, 2), row("2026-09-05", "tomyum", 4800, 48)], menus, noCost);
    const m = menuMovers(cur, prev, menus, "net");
    expect(m.rising.map((x) => x.id)).toEqual(["tomyum"]);
    expect(m.rising[0].change).toBeCloseTo(20);
  });
  it("a collapse to under one plate a day is not a 'mover' either — it is too thin to read", () => {
    const prev = enrich([row("2026-08-15", "rare", 40, 4), row("2026-08-15", "tomyum", 4000, 40)], menus, noCost);
    const cur = enrich(
      [row("2026-09-05", "rare", 5, 0.5), row("2026-09-05", "tomyum", 3600, 36)],
      menus,
      noCost
    );
    expect(menuMovers(cur, prev, menus, "net").watch.map((x) => x.id)).toEqual(["tomyum"]);
  });
  it("a dish that stopped selling is named, not silently absent", () => {
    const prev = enrich([row("2026-08-15", "beer", 300, 3), row("2026-08-15", "tomyum", 100, 1)], menus, noCost);
    const cur = enrich([row("2026-09-05", "tomyum", 100, 1)], menus, noCost);
    expect(menuMovers(cur, prev, menus, "net").gone.map((x) => x.id)).toEqual(["beer"]);
  });
});

describe("previousRange", () => {
  it("a month (even part of one) compares with the whole month before", () => {
    expect(previousRange("2026-09-01", "2026-09-28")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });
  it("any other range: the same number of days just before", () => {
    expect(previousRange("2026-09-10", "2026-09-16")).toEqual({ from: "2026-09-03", to: "2026-09-09" });
  });
});

describe("periodLabelTh — every % names what it is compared with", () => {
  it("a whole month is its name, anything else its dates", () => {
    expect(periodLabelTh("2026-08-01", "2026-08-31")).toBe("ส.ค. 69");
    expect(periodLabelTh("2026-09-01", "2026-09-28")).toBe("1–28 ก.ย. 69");
    expect(periodLabelTh("2026-08-15", "2026-08-15")).toBe("15 ส.ค. 69");
    expect(periodLabelTh("2026-08-25", "2026-09-03")).toBe("25 ส.ค. 69 – 3 ก.ย. 69");
  });
});
