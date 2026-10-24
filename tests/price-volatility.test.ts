// การผันผวนราคาวัตถุดิบ — rule PV-ALLOW (the price the menus can bear).
import { describe, expect, it } from "vitest";
import { allowances, menuCostDelta, type MenuCostRow } from "@/lib/price-volatility";

const menu = (over: Partial<MenuCostRow>): MenuCostRow => ({
  menuId: "m",
  name: "m",
  department: null,
  price: 100,
  plates: 10,
  cost: 50,
  target: 35,
  ownTarget: false,
  leaves: [["shrimp", 40], ["rice", 10]],
  ...over,
});

describe("PV-ALLOW", () => {
  it("a dish at 50% against a 35% target: every ingredient may cost 70% of today", () => {
    const a = allowances([menu({})]);
    expect(a.get("shrimp")!.k).toBeCloseTo(0.7, 6);
    // 40 baht a plate × 10 plates × (1 − 0.7)
    expect(a.get("shrimp")!.over).toBeCloseTo(120, 6);
    expect(a.get("rice")!.over).toBeCloseTo(30, 6);
  });
  it("the overruns of a dish's ingredients add up to the dish's own overrun", () => {
    const a = allowances([menu({})]);
    // (50 − 35) × 10 plates
    expect(a.get("shrimp")!.over + a.get("rice")!.over).toBeCloseTo(150, 6);
  });
  it("across menus the allowance is weighted by the money the product puts into each", () => {
    const a = allowances([
      menu({ menuId: "a", leaves: [["shrimp", 40]], cost: 40, price: 100, target: 40, plates: 10 }), // k = 1
      menu({ menuId: "b", leaves: [["shrimp", 20]], cost: 20, price: 100, target: 10, plates: 10 }), // k = 0.5
    ]);
    // weights 400 and 200 → (400×1 + 200×0.5) / 600
    expect(a.get("shrimp")!.k).toBeCloseTo(500 / 600, 6);
  });
  it("a higher target on one menu leaves its ingredients room (negative overrun)", () => {
    const a = allowances([menu({ target: 75, leaves: [["beer", 50]], cost: 50 })]);
    expect(a.get("beer")!.k).toBeCloseTo(1.5, 6);
    expect(a.get("beer")!.over).toBeLessThan(0);
  });
  it("menuCostDelta prices each leaf by its own ratio", () => {
    const r = menuCostDelta(menu({}), (id) => (id === "shrimp" ? 1.1 : null));
    expect(r.delta).toBeCloseTo(4, 6);
    expect(r.parts[0][0]).toBe("shrimp");
  });
});
