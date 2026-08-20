// ============================================================
// Mise — recipe graph walker unit tests (Sprint 5 Part 21 L3, ADR 0021)
// ============================================================
// Pure, no DB — the same footing as fifo-replay.test.ts, and for the same
// reason: this is the arithmetic that decides what a dish costs and what a sale
// consumes, so it must be provable without anything else being right.
//
// The two divisions of rule R2 are the heart of it, and they are DIFFERENT
// things that both get spoken of as "yield":
//     per_serving = recipe_qty / servings
//     raw_qty     = per_serving / (yield% / 100)     <- Decision #59, a DIVISION
// G-12 is the one that catches the classic error: 80 g at 80% yield needs 100 g
// of raw material, not 96. `qty x (1 + loss%)` gives 96 and is wrong every time.
// ============================================================

import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  GraphNodeMissingError,
  MAX_RECIPE_DEPTH,
  RecipeCycleError,
  RecipeDepthExceededError,
  RecipeMethodMissingError,
  type GraphMenu,
  type GraphProduct,
  type RecipeGraph,
  assertGraphValid,
  chainDepth,
  explodeToRaw,
  menuKey,
  productKey,
  reachable,
} from "@/server/recipe-graph";

const D = (n: number | string) => new Prisma.Decimal(n);

// ------------------------------------------------------------
// Builders
// ------------------------------------------------------------

const raw = (id: string): GraphProduct => ({
  id,
  type: "RAW",
  yieldPercent: null,
  parentProductId: null,
  productionRecipe: null,
});

/** The one-parent-and-a-yield half of Q1 (portioned salmon). */
const preppedFromParent = (
  id: string,
  parentProductId: string,
  yieldPercent: number
): GraphProduct => ({
  id,
  type: "PREPPED",
  yieldPercent: D(yieldPercent),
  parentProductId,
  productionRecipe: null,
});

/** The production-recipe half of Q1 (chilli jam). */
const preppedFromRecipe = (
  id: string,
  servings: number,
  ingredients: { productId?: string; menuId?: string; qty: number; ratio?: number }[]
): GraphProduct => ({
  id,
  type: "PREPPED",
  yieldPercent: null,
  parentProductId: null,
  productionRecipe: {
    id: `r-${id}`,
    servings: D(servings),
    ingredients: ingredients.map((i) => ({
      productId: i.productId ?? null,
      componentMenuId: i.menuId ?? null,
      qty: D(i.qty),
      toBaseRatio: i.productId ? D(i.ratio ?? 1) : null,
    })),
  },
});

const menu = (
  id: string,
  servings: number | null,
  ingredients: { productId?: string; menuId?: string; qty: number; ratio?: number }[] = []
): GraphMenu => ({
  id,
  recipe:
    servings === null
      ? null
      : {
          id: `r-${id}`,
          servings: D(servings),
          ingredients: ingredients.map((i) => ({
            productId: i.productId ?? null,
            componentMenuId: i.menuId ?? null,
            qty: D(i.qty),
            toBaseRatio: i.productId ? D(i.ratio ?? 1) : null,
          })),
        },
});

const graph = (products: GraphProduct[], menus: GraphMenu[]): RecipeGraph => ({
  products: new Map(products.map((p) => [p.id, p])),
  menus: new Map(menus.map((m) => [m.id, m])),
});

const qtyOf = (rows: { productId: string; qty: Prisma.Decimal }[], id: string) =>
  rows.find((r) => r.productId === id)?.qty.toString();

// ------------------------------------------------------------
// 1. Depth — one budget, both kinds of hop (Q3)
// ------------------------------------------------------------

describe("chainDepth — nodes, not edges, and one budget for products AND menus", () => {
  it("G-1: a RAW product on its own is one node", () => {
    expect(chainDepth(graph([raw("beef")], []), productKey("beef"))).toBe(1);
  });

  it("G-2: a menu of raw ingredients is two", () => {
    const g = graph([raw("pork")], [menu("kaprao", 1, [{ productId: "pork", qty: 120 }])]);
    expect(chainDepth(g, menuKey("kaprao"))).toBe(2);
  });

  it("G-3: the ADR's own example — set -> dish -> prepped -> raw — is four", () => {
    const g = graph(
      [raw("beef"), preppedFromParent("cut", "beef", 80)],
      [
        menu("steak", 1, [{ productId: "cut", qty: 200 }]),
        menu("setB", 1, [{ menuId: "steak", qty: 1 }]),
      ]
    );
    expect(chainDepth(g, menuKey("setB"))).toBe(4);
  });

  it("G-4: a menu with NO recipe is a leaf, not an error — most menus have none yet", () => {
    const g = graph([], [menu("stub", null)]);
    expect(chainDepth(g, menuKey("stub"))).toBe(1);
  });

  it("G-5: the deepest branch wins, not the first or the widest", () => {
    const g = graph(
      [raw("salt"), raw("beef"), preppedFromParent("cut", "beef", 80)],
      [
        menu("dish", 1, [
          { productId: "salt", qty: 1 },
          { productId: "cut", qty: 200 },
        ]),
      ]
    );
    expect(chainDepth(g, menuKey("dish"))).toBe(3);
  });
});

describe("assertGraphValid — Decision #58's five nodes", () => {
  /** A chain of `n` prepped products standing on one raw. */
  const chainOf = (n: number) => {
    const products: GraphProduct[] = [raw("p0")];
    for (let i = 1; i <= n; i += 1) {
      products.push(preppedFromParent(`p${i}`, `p${i - 1}`, 80));
    }
    return graph(products, []);
  };

  it("G-6: exactly five nodes is accepted", () => {
    expect(() =>
      assertGraphValid(chainOf(4), productKey("p4"))
    ).not.toThrow();
    expect(chainDepth(chainOf(4), productKey("p4"))).toBe(MAX_RECIPE_DEPTH);
  });

  it("G-7: six nodes is refused, and the error NAMES the chain", () => {
    let err: unknown;
    try {
      assertGraphValid(chainOf(5), productKey("p5"));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RecipeDepthExceededError);
    const e = err as RecipeDepthExceededError;
    expect(e.depth).toBe(6);
    // Not just "too deep" — the path, so someone can go and fix it.
    expect(e.path).toEqual([
      productKey("p5"),
      productKey("p4"),
      productKey("p3"),
      productKey("p2"),
      productKey("p1"),
      productKey("p0"),
    ]);
  });

  it("G-7b: ancestorDepth is counted too — a subtree moved under something deep is refused", () => {
    // Three nodes below, already two above: six in total, the case ADR 0007's
    // upward-only check would wrongly wave through.
    const g = graph(
      [raw("p0"), preppedFromParent("p1", "p0", 80), preppedFromParent("p2", "p1", 80)],
      []
    );
    expect(chainDepth(g, productKey("p2"))).toBe(3);
    expect(() => assertGraphValid(g, productKey("p2"), 2)).not.toThrow();
    expect(() => assertGraphValid(g, productKey("p2"), 3)).toThrow(
      RecipeDepthExceededError
    );
  });
});

// ------------------------------------------------------------
// 2. Cycles — including the menu-to-menu kind Q3 made possible
// ------------------------------------------------------------

describe("cycles", () => {
  it("G-8: a set menu containing itself is refused", () => {
    const g = graph([], [menu("setB", 1, [{ menuId: "setB", qty: 1 }])]);
    expect(() => chainDepth(g, menuKey("setB"))).toThrow(RecipeCycleError);
  });

  it("G-9: menu -> menu -> menu is refused, and the path shows the loop", () => {
    const g = graph(
      [],
      [
        menu("a", 1, [{ menuId: "b", qty: 1 }]),
        menu("b", 1, [{ menuId: "a", qty: 1 }]),
      ]
    );
    let err: unknown;
    try {
      chainDepth(g, menuKey("a"));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RecipeCycleError);
    expect((err as RecipeCycleError).path).toEqual([
      menuKey("a"),
      menuKey("b"),
      menuKey("a"),
    ]);
  });

  it("G-10: a product cycle through production recipes is refused too", () => {
    const g = graph(
      [
        preppedFromRecipe("x", 1, [{ productId: "y", qty: 1 }]),
        preppedFromRecipe("y", 1, [{ productId: "x", qty: 1 }]),
      ],
      []
    );
    expect(() => chainDepth(g, productKey("x"))).toThrow(RecipeCycleError);
  });

  it("G-11: a diamond is NOT a cycle — the same product reached twice is fine", () => {
    const g = graph(
      [raw("oil"), preppedFromRecipe("paste", 1, [{ productId: "oil", qty: 10 }])],
      [
        menu("dish", 1, [
          { productId: "paste", qty: 20 },
          { productId: "oil", qty: 5 },
        ]),
      ]
    );
    expect(() => chainDepth(g, menuKey("dish"))).not.toThrow();
    expect(chainDepth(g, menuKey("dish"))).toBe(3);
  });
});

// ------------------------------------------------------------
// 3. The two divisions (rule R2) — the arithmetic everything rests on
// ------------------------------------------------------------

describe("explodeToRaw — yield is a DIVISION (Decision #59)", () => {
  it("G-12: 80 g of trimmed beef at 80% yield needs 100 g of raw — NOT 96", () => {
    // qty x (1 + loss%) would give 80 x 1.2 = 96 and be wrong every time.
    const g = graph(
      [raw("beef"), preppedFromParent("cut", "beef", 80)],
      [menu("steak", 1, [{ productId: "cut", qty: 80 }])]
    );
    const rows = explodeToRaw(g, menuKey("steak"));
    expect(qtyOf(rows, "beef")).toBe("100");
  });

  it("G-13: yields compound down a chain", () => {
    // 100 g of the top prepped, each step 50%: 100 -> 200 -> 400.
    const g = graph(
      [
        raw("p0"),
        preppedFromParent("p1", "p0", 50),
        preppedFromParent("p2", "p1", 50),
      ],
      [menu("dish", 1, [{ productId: "p2", qty: 100 }])]
    );
    expect(qtyOf(explodeToRaw(g, menuKey("dish")), "p0")).toBe("400");
  });

  it("G-14: a yield above 100% is honoured, not clamped — soaking rice gains weight", () => {
    const g = graph(
      [raw("dry"), preppedFromParent("soaked", "dry", 200)],
      [menu("dish", 1, [{ productId: "soaked", qty: 200 }])]
    );
    expect(qtyOf(explodeToRaw(g, menuKey("dish")), "dry")).toBe("100");
  });
});

describe("explodeToRaw — servings is the OTHER division (Q16)", () => {
  it("G-15: a pot of 20 divides its ingredients by 20, with no rounding by hand", () => {
    // 350 g of paste over 20 servings is 17.5 - the number a shop would round.
    const g = graph(
      [raw("paste")],
      [menu("curry", 20, [{ productId: "paste", qty: 350 }])]
    );
    expect(qtyOf(explodeToRaw(g, menuKey("curry")), "paste")).toBe("17.5");
  });

  it("G-16: BOTH divisions apply, in order — servings first, then yield", () => {
    // 400 g of trimmed beef per pot of 20 = 20 g per serving; at 80% yield that
    // is 25 g of raw beef. Applying yield first and servings after gives the
    // same product here, which is why G-17 pins the ORDER with a set menu.
    const g = graph(
      [raw("beef"), preppedFromParent("cut", "beef", 80)],
      [menu("curry", 20, [{ productId: "cut", qty: 400 }])]
    );
    expect(qtyOf(explodeToRaw(g, menuKey("curry")), "beef")).toBe("25");
  });

  it("G-17: servings on a production recipe means the OUTPUT's base units", () => {
    // One batch makes 250 g of jam from 200 g chilli + 100 g oil. A dish using
    // 50 g of jam therefore takes 50/250 of a batch: 40 g chilli, 20 g oil.
    const g = graph(
      [
        raw("chilli"),
        raw("oil"),
        preppedFromRecipe("jam", 250, [
          { productId: "chilli", qty: 200 },
          { productId: "oil", qty: 100 },
        ]),
      ],
      [menu("dish", 1, [{ productId: "jam", qty: 50 }])]
    );
    const rows = explodeToRaw(g, menuKey("dish"));
    expect(qtyOf(rows, "chilli")).toBe("40");
    expect(qtyOf(rows, "oil")).toBe("20");
  });
});

// ------------------------------------------------------------
// 4. Units convert at read (Q17)
// ------------------------------------------------------------

describe("explodeToRaw — the unit ratio is applied at READ, never stored (Q17)", () => {
  it("G-18: 1.5 kg written in kg becomes 1.5 base units when the ratio is 1", () => {
    const g = graph([raw("pork")], [menu("d", 1, [{ productId: "pork", qty: 1.5 }])]);
    expect(qtyOf(explodeToRaw(g, menuKey("d")), "pork")).toBe("1.5");
  });

  it("G-19: 120 written in grams against a kg base (ratio 0.001) becomes 0.12", () => {
    const g = graph(
      [raw("pork")],
      [menu("d", 1, [{ productId: "pork", qty: 120, ratio: 0.001 }])]
    );
    expect(qtyOf(explodeToRaw(g, menuKey("d")), "pork")).toBe("0.12");
  });

  it("G-20: correcting what a bag weighs moves the recipe, which is the whole point", () => {
    const before = graph(
      [raw("paste")],
      [menu("d", 1, [{ productId: "paste", qty: 1, ratio: 1 }])]
    );
    const after = graph(
      [raw("paste")],
      [menu("d", 1, [{ productId: "paste", qty: 1, ratio: 1.2 }])]
    );
    expect(qtyOf(explodeToRaw(before, menuKey("d")), "paste")).toBe("1");
    expect(qtyOf(explodeToRaw(after, menuKey("d")), "paste")).toBe("1.2");
  });
});

// ------------------------------------------------------------
// 5. Set menus (Q3) — free, because an ingredient may be a menu
// ------------------------------------------------------------

describe("explodeToRaw — set menus", () => {
  it("G-21: a set explodes through its component menus to raw material", () => {
    const g = graph(
      [raw("beef"), raw("rice"), preppedFromParent("cut", "beef", 80)],
      [
        menu("steak", 1, [{ productId: "cut", qty: 200 }]),
        menu("khao", 1, [{ productId: "rice", qty: 150 }]),
        menu("setB", 1, [
          { menuId: "steak", qty: 1 },
          { menuId: "khao", qty: 1 },
        ]),
      ]
    );
    const rows = explodeToRaw(g, menuKey("setB"));
    expect(qtyOf(rows, "beef")).toBe("250");
    expect(qtyOf(rows, "rice")).toBe("150");
  });

  it("G-22: two of the same component doubles it", () => {
    const g = graph(
      [raw("rice")],
      [
        menu("khao", 1, [{ productId: "rice", qty: 150 }]),
        menu("setB", 1, [{ menuId: "khao", qty: 2 }]),
      ]
    );
    expect(qtyOf(explodeToRaw(g, menuKey("setB")), "rice")).toBe("300");
  });

  it("G-23: the same raw material arriving by two paths is SUMMED, not overwritten", () => {
    const g = graph(
      [raw("oil"), preppedFromRecipe("jam", 100, [{ productId: "oil", qty: 30 }])],
      [
        menu("dish", 1, [
          { productId: "jam", qty: 100 },
          { productId: "oil", qty: 5 },
        ]),
      ]
    );
    expect(qtyOf(explodeToRaw(g, menuKey("dish")), "oil")).toBe("35");
  });

  it("G-24: a component menu with no recipe contributes nothing rather than throwing", () => {
    const g = graph(
      [raw("rice")],
      [
        menu("khao", 1, [{ productId: "rice", qty: 150 }]),
        menu("mystery", null),
        menu("setB", 1, [
          { menuId: "khao", qty: 1 },
          { menuId: "mystery", qty: 1 },
        ]),
      ]
    );
    const rows = explodeToRaw(g, menuKey("setB"));
    expect(qtyOf(rows, "rice")).toBe("150");
    expect(rows).toHaveLength(1);
  });
});

// ------------------------------------------------------------
// 6. Refusing to be quietly wrong
// ------------------------------------------------------------

describe("what the walker refuses to guess", () => {
  it("G-25: a node the loader forgot THROWS — a truncated explosion under-consumes silently", () => {
    const g = graph([], [menu("d", 1, [{ productId: "ghost", qty: 1 }])]);
    expect(() => explodeToRaw(g, menuKey("d"))).toThrow(GraphNodeMissingError);
  });

  it("G-26: a PREPPED product with NO method is emitted as a leaf, never dropped", () => {
    // Reachable for real: Q1 lets a product be made by a production recipe, so
    // there is a window between creating the product and writing that recipe.
    // Dropping it would make the dish consume less than it really does, with
    // every figure downstream quietly too good. As a leaf it reaches the FIFO
    // replay, comes back UNPRICED, and Q6 makes the whole recipe LOW and names
    // it — which is the system SAYING it does not know, instead of guessing.
    const orphan: GraphProduct = {
      id: "orphan",
      type: "PREPPED",
      yieldPercent: null,
      parentProductId: null,
      productionRecipe: null,
    };
    const g = graph([orphan], [menu("d", 1, [{ productId: "orphan", qty: 5 }])]);
    expect(qtyOf(explodeToRaw(g, menuKey("d")), "orphan")).toBe("5");
  });

  it("G-27: a prepped product whose yield is 0 throws rather than dividing by zero", () => {
    const g = graph(
      [raw("beef"), preppedFromParent("cut", "beef", 0)],
      [menu("d", 1, [{ productId: "cut", qty: 10 }])]
    );
    expect(() => explodeToRaw(g, menuKey("d"))).toThrow(RecipeMethodMissingError);
  });

  it("G-27b: a NULL yield throws too — it must not be read as 100%", () => {
    const noYield: GraphProduct = {
      id: "cut",
      type: "PREPPED",
      yieldPercent: null,
      parentProductId: "beef",
      productionRecipe: null,
    };
    const g = graph([raw("beef"), noYield], [
      menu("d", 1, [{ productId: "cut", qty: 10 }]),
    ]);
    expect(() => explodeToRaw(g, menuKey("d"))).toThrow(RecipeMethodMissingError);
  });

  it("G-28: a production recipe WINS over a stray parent — the more expressive notation", () => {
    // Q1 forbids holding both; if one somehow exists, the recipe is used rather
    // than silently ignored, because ignoring it would drop every ingredient
    // except one.
    const both: GraphProduct = {
      id: "jam",
      type: "PREPPED",
      yieldPercent: D(80),
      parentProductId: "chilli",
      productionRecipe: {
        id: "r",
        servings: D(100),
        ingredients: [
          { productId: "chilli", componentMenuId: null, qty: D(80), toBaseRatio: D(1) },
          { productId: "oil", componentMenuId: null, qty: D(40), toBaseRatio: D(1) },
        ],
      },
    };
    const g = graph([raw("chilli"), raw("oil"), both], [
      menu("d", 1, [{ productId: "jam", qty: 100 }]),
    ]);
    const rows = explodeToRaw(g, menuKey("d"));
    expect(qtyOf(rows, "chilli")).toBe("80");
    expect(qtyOf(rows, "oil")).toBe("40");
  });

  it("G-29: explodeToRaw refuses a cycle rather than looping", () => {
    const g = graph(
      [],
      [
        menu("a", 1, [{ menuId: "b", qty: 1 }]),
        menu("b", 1, [{ menuId: "a", qty: 1 }]),
      ]
    );
    expect(() => explodeToRaw(g, menuKey("a"))).toThrow(RecipeCycleError);
  });

  it("G-30: explodeToRaw refuses a chain past the depth cap", () => {
    const products: GraphProduct[] = [raw("p0")];
    for (let i = 1; i <= 6; i += 1) {
      products.push(preppedFromParent(`p${i}`, `p${i - 1}`, 100));
    }
    const g = graph(products, [menu("d", 1, [{ productId: "p6", qty: 1 }])]);
    expect(() => explodeToRaw(g, menuKey("d"))).toThrow(RecipeDepthExceededError);
  });
});

// ------------------------------------------------------------
// 7. Reachability — what the loader still owes
// ------------------------------------------------------------

describe("reachable", () => {
  it("G-31: lists every node of both kinds under a set menu", () => {
    const g = graph(
      [raw("beef"), preppedFromParent("cut", "beef", 80)],
      [
        menu("steak", 1, [{ productId: "cut", qty: 200 }]),
        menu("setB", 1, [{ menuId: "steak", qty: 1 }]),
      ]
    );
    expect([...reachable(g, menuKey("setB"))].sort()).toEqual(
      [
        menuKey("setB"),
        menuKey("steak"),
        productKey("cut"),
        productKey("beef"),
      ].sort()
    );
  });
});
