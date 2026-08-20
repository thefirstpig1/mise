// ============================================================
// Mise — recipe zod schemas unit tests (Sprint 5 Part 21 L2)
// ============================================================
// Pure zod, no DB. ADR 0021 decisions exercised: one recipe makes exactly one
// thing (Q1/Q2) · an ingredient points at a THING — a product or a menu — and
// never at a recipe version, with the unit bound to the product half (Q3) ·
// `effectiveFrom` obeys the LEDGER's backdate window, because Part 22 has to be
// able to post compensating movements at that date (Q4) · a substitution across
// type or unit refuses to invent a quantity (Q15) · and unlike everything in
// sales, this file IS allowed to lean on `.positive()` (contrast rule P21).
// ============================================================

import { describe, it, expect } from "vitest";
import {
  MAX_INGREDIENTS,
  MAX_RECIPE_DEPTH,
  QTY_MAX,
  copyRecipeToBranchesInputSchema,
  recipeCostQuerySchema,
  recipeIngredientInputSchema,
  recipeInputSchema,
  substituteIngredientInputSchema,
} from "@/lib/validations/recipe";
import { MAX_BACKDATE_DAYS } from "@/lib/validations/stock-movement";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";

const MENU = "123e4567-e89b-12d3-a456-426614174000";
const MENU2 = "223e4567-e89b-12d3-a456-426614174000";
const PRODUCT = "323e4567-e89b-12d3-a456-426614174000";
const PRODUCT2 = "423e4567-e89b-12d3-a456-426614174000";
const UNIT = "523e4567-e89b-12d3-a456-426614174000";
const KEY = "623e4567-e89b-12d3-a456-426614174000";
const BRANCH = "723e4567-e89b-12d3-a456-426614174000";
const RECIPE = "823e4567-e89b-12d3-a456-426614174000";

const today = () => computeBangkokToday();
const iso = (d: Date) => d.toISOString();

const productLine = (over: Record<string, unknown> = {}) => ({
  productId: PRODUCT,
  componentMenuId: null,
  qty: 120,
  productUnitId: UNIT,
  sortOrder: 0,
  notes: null,
  ...over,
});

const menuLine = (over: Record<string, unknown> = {}) => ({
  productId: null,
  componentMenuId: MENU2,
  qty: 1,
  productUnitId: null,
  sortOrder: 0,
  notes: null,
  ...over,
});

const recipe = (over: Record<string, unknown> = {}) => ({
  submitKey: KEY,
  menuId: MENU,
  outputProductId: null,
  servings: 1,
  effectiveFrom: iso(today()),
  ingredients: [productLine()],
  notes: null,
  ...over,
});

const messages = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? [] : (r.error?.issues ?? []).map((i) => i.message);

// ------------------------------------------------------------
// 1. One recipe makes exactly one thing (Q1/Q2)
// ------------------------------------------------------------

describe("recipeInputSchema — the target is exclusive (Q1/Q2)", () => {
  it("R-S1: a menu recipe is accepted", () => {
    expect(recipeInputSchema.safeParse(recipe()).success).toBe(true);
  });

  it("R-S2: a production recipe (output product) is accepted", () => {
    const r = recipeInputSchema.safeParse(
      recipe({ menuId: null, outputProductId: PRODUCT2 })
    );
    expect(r.success).toBe(true);
  });

  it("R-S3: naming BOTH a menu and an output product is refused — a recipe makes one thing", () => {
    const r = recipeInputSchema.safeParse(recipe({ outputProductId: PRODUCT2 }));
    expect(r.success).toBe(false);
    expect(messages(r).join()).toContain("อย่างเดียว");
  });

  it("R-S4: naming NEITHER is refused", () => {
    const r = recipeInputSchema.safeParse(
      recipe({ menuId: null, outputProductId: null })
    );
    expect(r.success).toBe(false);
  });
});

// ------------------------------------------------------------
// 2. An ingredient points at a THING (Q3)
// ------------------------------------------------------------

describe("recipeIngredientInputSchema — product XOR menu, unit bound to product (Q3)", () => {
  it("R-S5: a product line with a unit is accepted", () => {
    expect(recipeIngredientInputSchema.safeParse(productLine()).success).toBe(true);
  });

  it("R-S6: a menu line with NO unit is accepted — a set contains '1 steak', not '1 kg of steak'", () => {
    expect(recipeIngredientInputSchema.safeParse(menuLine()).success).toBe(true);
  });

  it("R-S7: a product line WITHOUT a unit is refused — the number is meaningless without it", () => {
    const r = recipeIngredientInputSchema.safeParse(
      productLine({ productUnitId: null })
    );
    expect(r.success).toBe(false);
    expect(messages(r).join()).toContain("หน่วย");
  });

  it("R-S8: a menu line WITH a unit is refused — it would belong to some other product", () => {
    const r = recipeIngredientInputSchema.safeParse(
      menuLine({ productUnitId: UNIT })
    );
    expect(r.success).toBe(false);
    expect(messages(r).join()).toContain("หน่วย");
  });

  it("R-S9: pointing at both a product and a menu is refused", () => {
    const r = recipeIngredientInputSchema.safeParse(
      productLine({ componentMenuId: MENU2 })
    );
    expect(r.success).toBe(false);
  });

  it("R-S10: pointing at neither is refused", () => {
    const r = recipeIngredientInputSchema.safeParse(
      productLine({ productId: null, productUnitId: null })
    );
    expect(r.success).toBe(false);
  });
});

// ------------------------------------------------------------
// 3. Quantity — and the one place .positive() is legitimate
// ------------------------------------------------------------

describe("quantities — 0 is NOT a legal answer here (contrast rule P21)", () => {
  it("R-S11: qty 0 is refused — a recipe that uses none of something has no line", () => {
    const r = recipeIngredientInputSchema.safeParse(productLine({ qty: 0 }));
    expect(r.success).toBe(false);
  });

  it("R-S12: a negative qty is refused", () => {
    const r = recipeIngredientInputSchema.safeParse(productLine({ qty: -1 }));
    expect(r.success).toBe(false);
  });

  it("R-S13: a BLANK qty is refused and never coerced to 0 — the Part 18/19 lesson", () => {
    // z.coerce.number() reads "" as 0. Here 0 is already refused, which is what
    // closes the hole: on the sales tables 0 is legal, which is why rule P21
    // has to stop a blank BEFORE coercion instead of leaning on .positive().
    for (const blank of ["", null, undefined]) {
      const r = recipeIngredientInputSchema.safeParse(productLine({ qty: blank }));
      expect(r.success).toBe(false);
    }
  });

  it("R-S14: exactly 3 decimals is accepted — including values binary float gets wrong (Pitfall #30)", () => {
    // 1.005 * 1000 === 1004.9999999999999. The toFixed round-trip gets it right;
    // the multiply-and-compare that Part 10 shipped did not.
    for (const q of [1.005, 1.001, 2.675, 17.5, 0.001]) {
      const r = recipeIngredientInputSchema.safeParse(productLine({ qty: q }));
      expect(r.success, `qty ${q} should be accepted`).toBe(true);
    }
  });

  it("R-S15: a 4th decimal place is still refused", () => {
    const r = recipeIngredientInputSchema.safeParse(productLine({ qty: 1.0005 }));
    expect(r.success).toBe(false);
  });

  it("R-S16: qty beyond the column's range is refused", () => {
    const r = recipeIngredientInputSchema.safeParse(
      productLine({ qty: QTY_MAX + 1000 })
    );
    expect(r.success).toBe(false);
  });
});

// ------------------------------------------------------------
// 4. Servings — the divisor that is not a yield (Q16)
// ------------------------------------------------------------

describe("servings (Q16) — splits a pot into plates, and is NOT the yield", () => {
  it("R-S17: defaults to 1, so a dish cooked to order needs no thought", () => {
    const { servings, ...rest } = recipe();
    void servings;
    const r = recipeInputSchema.safeParse(rest);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.servings).toBe(1);
  });

  it("R-S18: a pot of 20 is accepted", () => {
    const r = recipeInputSchema.safeParse(recipe({ servings: 20 }));
    expect(r.success).toBe(true);
  });

  it("R-S19: 0 servings is refused — it would divide by zero on every cost read", () => {
    const r = recipeInputSchema.safeParse(recipe({ servings: 0 }));
    expect(r.success).toBe(false);
  });

  it("R-S20: a negative serving count is refused", () => {
    expect(recipeInputSchema.safeParse(recipe({ servings: -4 })).success).toBe(false);
  });
});

// ------------------------------------------------------------
// 5. effectiveFrom — the quiet field that Part 22 depends on (Q4)
// ------------------------------------------------------------

describe("effectiveFrom (Q4) — obeys the LEDGER's backdate window", () => {
  it("R-S21: today is accepted — the value the form stamps without asking", () => {
    expect(recipeInputSchema.safeParse(recipe()).success).toBe(true);
  });

  it("R-S22: backdating within the window is accepted — the 'แก้ย้อนหลัง' path", () => {
    const r = recipeInputSchema.safeParse(
      recipe({ effectiveFrom: iso(addDays(today(), -MAX_BACKDATE_DAYS + 1)) })
    );
    expect(r.success).toBe(true);
  });

  it("R-S23: past the ledger's window is refused — Part 22 could not post a compensating movement there", () => {
    const r = recipeInputSchema.safeParse(
      recipe({ effectiveFrom: iso(addDays(today(), -MAX_BACKDATE_DAYS - 1)) })
    );
    expect(r.success).toBe(false);
    expect(messages(r).join()).toContain("ย้อนหลัง");
  });

  it("R-S24: a future date is refused — scheduling a recipe change is not built", () => {
    const r = recipeInputSchema.safeParse(
      recipe({ effectiveFrom: iso(addDays(today(), 1)) })
    );
    expect(r.success).toBe(false);
    expect(messages(r).join()).toContain("อนาคต");
  });
});

// ------------------------------------------------------------
// 6. The cycles and duplicates zod can see without the database
// ------------------------------------------------------------

describe("what can be caught without reading a row", () => {
  it("R-S25: a menu listing ITSELF as an ingredient is refused", () => {
    const r = recipeInputSchema.safeParse(
      recipe({ ingredients: [menuLine({ componentMenuId: MENU })] })
    );
    expect(r.success).toBe(false);
    expect(messages(r).join()).toContain("ตัวเอง");
  });

  it("R-S26: a production recipe listing its own output as an input is refused", () => {
    const r = recipeInputSchema.safeParse(
      recipe({
        menuId: null,
        outputProductId: PRODUCT,
        ingredients: [productLine({ productId: PRODUCT })],
      })
    );
    expect(r.success).toBe(false);
  });

  it("R-S27: the same product twice in one recipe is refused, not silently summed", () => {
    const r = recipeInputSchema.safeParse(
      recipe({ ingredients: [productLine(), productLine({ qty: 50 })] })
    );
    expect(r.success).toBe(false);
    expect(messages(r).join()).toContain("ซ้ำ");
  });

  it("R-S28: the same component menu twice is refused too", () => {
    const r = recipeInputSchema.safeParse(
      recipe({ ingredients: [menuLine(), menuLine({ qty: 2 })] })
    );
    expect(r.success).toBe(false);
  });

  it("R-S29: two DIFFERENT products are fine", () => {
    const r = recipeInputSchema.safeParse(
      recipe({
        ingredients: [productLine(), productLine({ productId: PRODUCT2 })],
      })
    );
    expect(r.success).toBe(true);
  });

  it("R-S30: a recipe with no ingredients is refused — it would read as a dish with no food cost", () => {
    const r = recipeInputSchema.safeParse(recipe({ ingredients: [] }));
    expect(r.success).toBe(false);
  });

  it("R-S31: exactly the ingredient cap is accepted — proving R-S31b fails on the CAP, not on bad uuids", () => {
    const lines = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        productLine({
          productId: `${i}`.padStart(8, "0") + "-e89b-12d3-a456-426614174000",
        })
      );
    const r = recipeInputSchema.safeParse(
      recipe({ ingredients: lines(MAX_INGREDIENTS) })
    );
    expect(r.success).toBe(true);
  });

  it("R-S31b: one past the cap is refused", () => {
    const many = Array.from({ length: MAX_INGREDIENTS + 1 }, (_, i) =>
      productLine({
        productId: `${i}`.padStart(8, "0") + "-e89b-12d3-a456-426614174000",
      })
    );
    expect(recipeInputSchema.safeParse(recipe({ ingredients: many })).success).toBe(
      false
    );
  });
});

// ------------------------------------------------------------
// 7. Copying to branches (Q8)
// ------------------------------------------------------------

describe("copyRecipeToBranchesInputSchema (Q8) — the moment a branch stops following central", () => {
  const base = {
    submitKey: KEY,
    sourceRecipeId: RECIPE,
    branchIds: [BRANCH],
    acknowledgeOverwrite: false,
  };

  it("R-S32: copying to one branch is accepted", () => {
    expect(copyRecipeToBranchesInputSchema.safeParse(base).success).toBe(true);
  });

  it("R-S33: copying to no branches is refused", () => {
    const r = copyRecipeToBranchesInputSchema.safeParse({ ...base, branchIds: [] });
    expect(r.success).toBe(false);
  });

  it("R-S34: acknowledgeOverwrite defaults to false — the second pass must carry proof, never assume it", () => {
    const { acknowledgeOverwrite, ...rest } = base;
    void acknowledgeOverwrite;
    const r = copyRecipeToBranchesInputSchema.safeParse(rest);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.acknowledgeOverwrite).toBe(false);
  });
});

// ------------------------------------------------------------
// 8. Substitution (Q14/Q15)
// ------------------------------------------------------------

describe("substituteIngredientInputSchema (Q14/Q15)", () => {
  const base = {
    submitKey: KEY,
    fromProductId: PRODUCT,
    toProductId: PRODUCT2,
    toComponentMenuId: null,
    targets: [{ recipeId: RECIPE, qty: 20, productUnitId: UNIT }],
    effectiveFrom: iso(today()),
    acknowledgeBranchRecipes: false,
  };

  it("R-S35: replacing one product with another across one recipe is accepted", () => {
    expect(substituteIngredientInputSchema.safeParse(base).success).toBe(true);
  });

  it("R-S36: the schema NEVER invents a quantity — a missing one is refused, not defaulted (Q15)", () => {
    const r = substituteIngredientInputSchema.safeParse({
      ...base,
      targets: [{ recipeId: RECIPE, productUnitId: UNIT }],
    });
    expect(r.success).toBe(false);
  });

  it("R-S37: substituting a product for itself is refused", () => {
    const r = substituteIngredientInputSchema.safeParse({
      ...base,
      toProductId: PRODUCT,
    });
    expect(r.success).toBe(false);
    expect(messages(r).join()).toContain("ซ้ำ");
  });

  it("R-S38: naming both a replacement product and a replacement menu is refused", () => {
    const r = substituteIngredientInputSchema.safeParse({
      ...base,
      toComponentMenuId: MENU2,
    });
    expect(r.success).toBe(false);
  });

  it("R-S39: a product replacement with no unit on a target is refused", () => {
    const r = substituteIngredientInputSchema.safeParse({
      ...base,
      targets: [{ recipeId: RECIPE, qty: 20, productUnitId: null }],
    });
    expect(r.success).toBe(false);
  });

  it("R-S40: a MENU replacement must not carry a unit", () => {
    const r = substituteIngredientInputSchema.safeParse({
      ...base,
      toProductId: null,
      toComponentMenuId: MENU2,
      targets: [{ recipeId: RECIPE, qty: 1, productUnitId: UNIT }],
    });
    expect(r.success).toBe(false);
  });

  it("R-S41: the same recipe ticked twice is refused", () => {
    const r = substituteIngredientInputSchema.safeParse({
      ...base,
      targets: [
        { recipeId: RECIPE, qty: 20, productUnitId: UNIT },
        { recipeId: RECIPE, qty: 30, productUnitId: UNIT },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("R-S42: no recipes ticked is refused", () => {
    const r = substituteIngredientInputSchema.safeParse({ ...base, targets: [] });
    expect(r.success).toBe(false);
  });

  it("R-S43: acknowledgeBranchRecipes defaults to false — Q8's autonomy is never waived by omission", () => {
    const { acknowledgeBranchRecipes, ...rest } = base;
    void acknowledgeBranchRecipes;
    const r = substituteIngredientInputSchema.safeParse(rest);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.acknowledgeBranchRecipes).toBe(false);
  });
});

// ------------------------------------------------------------
// 9. Reads
// ------------------------------------------------------------

describe("recipeCostQuerySchema (Q5) — a branch is not optional", () => {
  it("R-S44: a branch is required, because a recipe cost is one number PER BRANCH", () => {
    expect(
      recipeCostQuerySchema.safeParse({ recipeId: RECIPE, branchId: BRANCH }).success
    ).toBe(true);
    expect(recipeCostQuerySchema.safeParse({ recipeId: RECIPE }).success).toBe(false);
  });

  it("R-S45: asOf is optional and blank means absent, not epoch", () => {
    const r = recipeCostQuerySchema.safeParse({
      recipeId: RECIPE,
      branchId: BRANCH,
      asOf: "",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.asOf).toBeUndefined();
  });
});

// ------------------------------------------------------------
// 10. The depth budget is one number, shared
// ------------------------------------------------------------

describe("MAX_RECIPE_DEPTH", () => {
  it("R-S46: is 5, matching the product graph's cap exactly (Decision #58, ADR 0007)", () => {
    // ADR 0007 chose the product-graph cap so the two line up with no off-by-one.
    // If this ever changes, `assertParentValid` in src/server/product.ts must
    // change with it — it still hard-codes the literal.
    expect(MAX_RECIPE_DEPTH).toBe(5);
  });
});
