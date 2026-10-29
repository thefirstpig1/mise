// ============================================================
// Mise — prepped stock comes off the shelf first (ADR 0040 Q1, Q8)
// ============================================================
// Pure: a hand-built recipe graph, a demand, and what is on each shelf.
// ============================================================

import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  explodeToRaw,
  menuKey,
  productKey,
  type GraphProduct,
  type RecipeGraph,
} from "@/server/recipe-graph";
import { settlePreppedDemand } from "@/server/prepped-first";

const d = (n: number | string) => new Prisma.Decimal(n);
const num = (x: Prisma.Decimal | undefined) => (x ? x.toNumber() : 0);

const raw = (id: string): GraphProduct => ({
  id,
  type: "RAW",
  yieldPercent: null,
  parentProductId: null,
  productionRecipe: null,
});

/** soup: 20 L from 8 kg bones + 2 kg onion. stock: 10 L from 5 kg bones. */
const graph = (): RecipeGraph => ({
  products: new Map<string, GraphProduct>([
    ["bones", raw("bones")],
    ["onion", raw("onion")],
    ["fish", raw("fish")],
    [
      "soup",
      {
        id: "soup",
        type: "PREPPED",
        yieldPercent: null,
        parentProductId: null,
        productionRecipe: {
          id: "r-soup",
          servings: d(20),
          ingredients: [
            { productId: "stock", componentMenuId: null, qty: d(10), toBaseRatio: d(1) },
            { productId: "onion", componentMenuId: null, qty: d(2), toBaseRatio: d(1) },
          ],
        },
      },
    ],
    [
      "stock",
      {
        id: "stock",
        type: "PREPPED",
        yieldPercent: null,
        parentProductId: null,
        productionRecipe: {
          id: "r-stock",
          servings: d(10),
          ingredients: [{ productId: "bones", componentMenuId: null, qty: d(5), toBaseRatio: d(1) }],
        },
      },
    ],
    [
      "fillet",
      {
        id: "fillet",
        type: "PREPPED",
        yieldPercent: null,
        parentProductId: null,
        productionRecipe: null,
        trimPart: { parentProductId: "fish", weightPct: d(48), valuePct: d(60) },
      },
    ],
    [
      "head",
      {
        id: "head",
        type: "PREPPED",
        yieldPercent: null,
        parentProductId: null,
        productionRecipe: null,
        trimPart: { parentProductId: "fish", weightPct: d(12), valuePct: d(15) },
      },
    ],
    [
      "jarSauce",
      { id: "jarSauce", type: "PREPPED", yieldPercent: null, parentProductId: null, productionRecipe: null },
    ],
  ]),
  menus: new Map([
    [
      "noodle",
      {
        id: "noodle",
        recipe: {
          id: "r-noodle",
          servings: d(1),
          ingredients: [{ productId: "soup", componentMenuId: null, qty: d("0.5"), toBaseRatio: d(1) }],
        },
      },
    ],
  ]),
});

const demandOf = (entries: [string, number][]) => new Map(entries.map(([k, v]) => [k, d(v)]));
const availOf = demandOf;

describe("explodeToRaw — the stopping point (ADR 0040 Q1)", () => {
  it("E1: stops at the first prepped product below a menu", () => {
    const leaves = explodeToRaw(graph(), menuKey("noodle"), d(10), { stopAtPrepped: true });
    expect(leaves).toEqual([{ productId: "soup", qty: d(5) }]);
  });

  it("E2: without the option, walks straight through as before", () => {
    const leaves = explodeToRaw(graph(), menuKey("noodle"), d(10));
    // 5 L soup = 2.5 L stock (1.25 kg bones) + 0.5 kg onion
    expect(new Map(leaves.map((l) => [l.productId, l.qty.toNumber()]))).toEqual(
      new Map([["bones", 1.25], ["onion", 0.5]])
    );
  });

  it("E3: a trimmed part charges its parent by weight AND value share (Q8)", () => {
    // 2.4 kg fillet ÷ 48% × 60% = 3 kg of fish; 0.6 kg head ÷ 12% × 15% = 0.75 kg
    const f = explodeToRaw(graph(), productKey("fillet"), d("2.4"));
    const h = explodeToRaw(graph(), productKey("head"), d("0.6"));
    expect(f[0].qty.toNumber()).toBe(3);
    expect(h[0].qty.toNumber()).toBe(0.75);
  });
});

describe("settlePreppedDemand (ADR 0040 Q1)", () => {
  it("S1: nothing on the shelf — everything walks down, exactly as before ADR 0040", () => {
    const r = settlePreppedDemand(graph(), demandOf([["soup", 5]]), new Map());
    expect(num(r.demand.get("bones"))).toBe(1.25);
    expect(num(r.demand.get("onion"))).toBe(0.5);
    expect(r.demand.has("soup")).toBe(false);
    expect(num(r.shortfalls.get("soup"))).toBe(5);
    expect(num(r.shortfalls.get("stock"))).toBe(2.5);
  });

  it("S2: enough soup on the shelf — only soup is taken", () => {
    const r = settlePreppedDemand(graph(), demandOf([["soup", 5]]), availOf([["soup", 8]]));
    expect(num(r.demand.get("soup"))).toBe(5);
    expect(r.demand.size).toBe(1);
    expect(r.shortfalls.size).toBe(0);
  });

  it("S3: part on the shelf, the rest walked down — and the walk uses the stock shelf too", () => {
    // 5 L wanted, 2 L on the shelf: 3 L short → 1.5 L stock + 0.3 kg onion.
    // 1 L of stock on its shelf → 0.5 L short → 0.25 kg bones.
    const r = settlePreppedDemand(
      graph(),
      demandOf([["soup", 5]]),
      availOf([["soup", 2], ["stock", 1]])
    );
    expect(num(r.demand.get("soup"))).toBe(2);
    expect(num(r.demand.get("stock"))).toBe(1);
    expect(num(r.demand.get("onion"))).toBe(0.3);
    expect(num(r.demand.get("bones"))).toBe(0.25);
    expect(num(r.shortfalls.get("soup"))).toBe(3);
    expect(num(r.shortfalls.get("stock"))).toBe(0.5);
  });

  it("S4: two demands share one shelf — never more than is there, whatever the order", () => {
    // Stock wanted directly (4 L) AND through soup's shortfall (2.5 L); 5 L on the shelf.
    const r = settlePreppedDemand(
      graph(),
      demandOf([["soup", 5], ["stock", 4]]),
      availOf([["stock", 5]])
    );
    expect(num(r.demand.get("stock"))).toBe(5);
    expect(num(r.shortfalls.get("stock"))).toBe(1.5);
    expect(num(r.demand.get("bones"))).toBe(0.75);
  });

  it("S5: a prepped product with no way to make it stays on itself and is reported", () => {
    const r = settlePreppedDemand(graph(), demandOf([["jarSauce", 3]]), availOf([["jarSauce", 1]]));
    expect(num(r.demand.get("jarSauce"))).toBe(3);
    expect([...r.unmakeable]).toEqual(["jarSauce"]);
    expect(r.shortfalls.size).toBe(0);
  });

  it("S6: a bought prepped product that IS on the shelf is simply taken (Q10)", () => {
    const r = settlePreppedDemand(graph(), demandOf([["jarSauce", 3]]), availOf([["jarSauce", 5]]));
    expect(num(r.demand.get("jarSauce"))).toBe(3);
    expect(r.unmakeable.size).toBe(0);
  });

  it("S7: a returning day (negative demand) passes through untouched", () => {
    const r = settlePreppedDemand(graph(), demandOf([["soup", -2]]), availOf([["soup", 10]]));
    expect(num(r.demand.get("soup"))).toBe(-2);
  });

  it("S8: a trimmed part short of its shelf charges the whole fish (Q8)", () => {
    const r = settlePreppedDemand(graph(), demandOf([["fillet", 2.4]]), new Map());
    expect(num(r.demand.get("fish"))).toBe(3);
  });
});
