// ============================================================
// Mise — Menu Lab zod schemas unit tests (Sprint 5 Part 24 L2)
// ============================================================
// Pure zod, no DB. ADR 0025 decisions exercised: the typed price is nullable and
// refuses zero (Q2) · a draft hangs off an existing menu OR a name Mise will
// create a menu for, never both and never neither (Q3) · a SAVED draft needs an
// ingredient while the LIVE calculator may hold none · coverage is a bounded
// list that never asks to group anything (Q5).
// ============================================================

import { describe, it, expect } from "vitest";
import {
  DEFAULT_COVERAGE_ROWS,
  MAX_COVERAGE_ROWS,
  PLANNED_PRICE_LABEL_TH,
  PLANNED_PRICE_MAX,
  discardDraftInputSchema,
  draftRecipeInputSchema,
  labWhatIfQuerySchema,
  publishDraftInputSchema,
  recipeCoverageQuerySchema,
} from "@/lib/validations/menu-lab";
import { MAX_INGREDIENTS } from "@/lib/validations/recipe";

const MENU = "123e4567-e89b-12d3-a456-426614174000";
const MENU2 = "223e4567-e89b-12d3-a456-426614174000";
const PRODUCT = "323e4567-e89b-12d3-a456-426614174000";
const PRODUCT2 = "423e4567-e89b-12d3-a456-426614174000";
const UNIT = "523e4567-e89b-12d3-a456-426614174000";
const KEY = "623e4567-e89b-12d3-a456-426614174000";
const BRANCH = "723e4567-e89b-12d3-a456-426614174000";
const RECIPE = "823e4567-e89b-12d3-a456-426614174000";
const CATEGORY = "923e4567-e89b-12d3-a456-426614174000";

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

/** A draft of a change to a dish that already exists. */
const draft = (over: Record<string, unknown> = {}) => ({
  submitKey: KEY,
  menuId: MENU,
  newMenuName: null,
  menuCategoryId: null,
  servings: 1,
  plannedPrice: null,
  ingredients: [productLine()],
  notes: null,
  ...over,
});

const messages = (r: {
  success: boolean;
  error?: { issues: { message: string }[] };
}) => (r.success ? [] : (r.error?.issues ?? []).map((i) => i.message));

// ------------------------------------------------------------
// The typed price (Q2)
// ------------------------------------------------------------

describe("ราคาที่ตั้งใจ", () => {
  it("is optional — a draft asking 'what does this cost?' has no price yet", () => {
    const blank = draftRecipeInputSchema.safeParse(
      draft({ plannedPrice: "" })
    );
    expect(blank.success).toBe(true);
    if (blank.success) expect(blank.data.plannedPrice).toBeNull();

    const absent = draftRecipeInputSchema.safeParse(
      (() => {
        const { plannedPrice: _omitted, ...rest } = draft();
        return rest;
      })()
    );
    expect(absent.success).toBe(true);
    if (absent.success) expect(absent.data.plannedPrice).toBeNull();
  });

  it("accepts two decimals, from a string as a form sends it", () => {
    const r = draftRecipeInputSchema.safeParse(
      draft({ plannedPrice: "89.50" })
    );
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.plannedPrice).toBe(89.5);
  });

  it("refuses zero — an empty box that got submitted, not a giveaway", () => {
    const r = draftRecipeInputSchema.safeParse(draft({ plannedPrice: 0 }));
    expect(r.success).toBe(false);
    expect(messages(r).join()).toContain("ราคาที่ตั้งใจต้องมากกว่า 0");
  });

  it("refuses a negative price and more than two decimals", () => {
    expect(
      draftRecipeInputSchema.safeParse(draft({ plannedPrice: -1 })).success
    ).toBe(false);

    const tooPrecise = draftRecipeInputSchema.safeParse(
      draft({ plannedPrice: 89.555 })
    );
    expect(tooPrecise.success).toBe(false);
    expect(messages(tooPrecise).join()).toContain("ทศนิยมได้ไม่เกิน 2 ตำแหน่ง");
  });

  it("refuses more than the column holds", () => {
    const r = draftRecipeInputSchema.safeParse(
      draft({ plannedPrice: PLANNED_PRICE_MAX + 1 })
    );
    expect(r.success).toBe(false);
  });

  it("is labelled ราคาที่ตั้งใจ, never ราคา", () => {
    expect(PLANNED_PRICE_LABEL_TH).toBe("ราคาที่ตั้งใจ");
  });
});

// ------------------------------------------------------------
// What a draft hangs off (Q3)
// ------------------------------------------------------------

describe("draftRecipeInputSchema — the target", () => {
  it("accepts an existing menu", () => {
    expect(draftRecipeInputSchema.safeParse(draft()).success).toBe(true);
  });

  it("accepts a name for a dish that does not exist yet", () => {
    const r = draftRecipeInputSchema.safeParse(
      draft({ menuId: null, newMenuName: "  ข้าวผัดปูใหม่  " })
    );
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.newMenuName).toBe("ข้าวผัดปูใหม่");
  });

  it("refuses both, and refuses neither", () => {
    const both = draftRecipeInputSchema.safeParse(
      draft({ newMenuName: "ข้าวผัดใหม่" })
    );
    expect(both.success).toBe(false);
    expect(messages(both).join()).toContain("เลือกได้อย่างเดียว");

    const neither = draftRecipeInputSchema.safeParse(draft({ menuId: null }));
    expect(neither.success).toBe(false);
    expect(messages(neither).join()).toContain("ต้องเลือกเมนูที่มีอยู่");
  });

  it("takes a category only for the menu it is about to create", () => {
    const onNew = draftRecipeInputSchema.safeParse(
      draft({ menuId: null, newMenuName: "ข้าวผัดใหม่", menuCategoryId: CATEGORY })
    );
    expect(onNew.success).toBe(true);

    const onExisting = draftRecipeInputSchema.safeParse(
      draft({ menuCategoryId: CATEGORY })
    );
    expect(onExisting.success).toBe(false);
    expect(messages(onExisting).join()).toContain("แก้ได้ที่หน้าเมนู");
  });
});

// ------------------------------------------------------------
// The lines
// ------------------------------------------------------------

describe("draftRecipeInputSchema — ingredients", () => {
  it("needs at least one — a saved recipe costing ฿0 would be a lie", () => {
    const r = draftRecipeInputSchema.safeParse(draft({ ingredients: [] }));
    expect(r.success).toBe(false);
    expect(messages(r).join()).toContain("อย่างน้อย 1 รายการ");
  });

  it("refuses more than the recipe cap", () => {
    const many = Array.from({ length: MAX_INGREDIENTS + 1 }, (_, i) =>
      productLine({ sortOrder: i })
    );
    expect(
      draftRecipeInputSchema.safeParse(draft({ ingredients: many })).success
    ).toBe(false);
  });

  it("refuses a set menu that lists itself", () => {
    const r = draftRecipeInputSchema.safeParse(
      draft({ ingredients: [menuLine({ componentMenuId: MENU })] })
    );
    expect(r.success).toBe(false);
    expect(messages(r).join()).toContain("เมนูใส่ตัวเองเป็นส่วนประกอบไม่ได้");
  });

  it("refuses the same thing twice, product or menu", () => {
    const twiceProduct = draftRecipeInputSchema.safeParse(
      draft({ ingredients: [productLine(), productLine({ qty: 30 })] })
    );
    expect(twiceProduct.success).toBe(false);
    expect(messages(twiceProduct).join()).toContain("ซ้ำกับที่ใส่ไว้แล้ว");

    const twiceMenu = draftRecipeInputSchema.safeParse(
      draft({ ingredients: [menuLine(), menuLine({ qty: 2 })] })
    );
    expect(twiceMenu.success).toBe(false);

    const different = draftRecipeInputSchema.safeParse(
      draft({
        ingredients: [productLine(), productLine({ productId: PRODUCT2 })],
      })
    );
    expect(different.success).toBe(true);
  });

  it("keeps ADR 0021's unit rule: a product line carries one, a menu line does not", () => {
    const noUnit = draftRecipeInputSchema.safeParse(
      draft({ ingredients: [productLine({ productUnitId: null })] })
    );
    expect(noUnit.success).toBe(false);

    const menuWithUnit = draftRecipeInputSchema.safeParse(
      draft({ ingredients: [menuLine({ productUnitId: UNIT })] })
    );
    expect(menuWithUnit.success).toBe(false);
  });

  it("defaults servings to 1 and refuses zero", () => {
    const absent = draftRecipeInputSchema.safeParse(
      (() => {
        const { servings: _omitted, ...rest } = draft();
        return rest;
      })()
    );
    expect(absent.success).toBe(true);
    if (absent.success) expect(absent.data.servings).toBe(1);

    expect(
      draftRecipeInputSchema.safeParse(draft({ servings: 0 })).success
    ).toBe(false);
  });
});

// ------------------------------------------------------------
// Publishing / discarding
// ------------------------------------------------------------

describe("publishDraftInputSchema", () => {
  it("defaults the acknowledgement to false — nobody has seen the warning yet", () => {
    const r = publishDraftInputSchema.safeParse({ recipeId: RECIPE });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.acknowledgeReplace).toBe(false);
  });

  it("reads a checkbox that arrived without JS", () => {
    const r = publishDraftInputSchema.safeParse({
      recipeId: RECIPE,
      acknowledgeReplace: "on",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.acknowledgeReplace).toBe(true);
  });

  it("refuses anything that is not a recipe id", () => {
    expect(publishDraftInputSchema.safeParse({ recipeId: "nope" }).success).toBe(
      false
    );
    expect(discardDraftInputSchema.safeParse({ recipeId: "" }).success).toBe(
      false
    );
    expect(
      discardDraftInputSchema.safeParse({ recipeId: RECIPE }).success
    ).toBe(true);
  });
});

// ------------------------------------------------------------
// The live calculator
// ------------------------------------------------------------

describe("labWhatIfQuerySchema", () => {
  it("accepts no ingredients — a screen somebody just opened", () => {
    const r = labWhatIfQuerySchema.safeParse({ ingredients: [] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.servings).toBe(1);
      expect(r.data.branchId).toBeUndefined();
      expect(r.data.plannedPrice).toBeNull();
    }
  });

  it("takes a branch when the person picks one", () => {
    const r = labWhatIfQuerySchema.safeParse({
      branchId: BRANCH,
      ingredients: [productLine()],
      plannedPrice: "99",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.branchId).toBe(BRANCH);
      expect(r.data.plannedPrice).toBe(99);
    }
  });

  it("blank branch means the freshest one, not an error", () => {
    const r = labWhatIfQuerySchema.safeParse({
      branchId: "",
      ingredients: [productLine()],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.branchId).toBeUndefined();
  });

  it("still validates the lines it is handed", () => {
    const r = labWhatIfQuerySchema.safeParse({
      ingredients: [productLine({ qty: -1 })],
    });
    expect(r.success).toBe(false);
  });
});

// ------------------------------------------------------------
// Coverage (Q5)
// ------------------------------------------------------------

describe("recipeCoverageQuerySchema", () => {
  it("is a bounded list with a default size", () => {
    const r = recipeCoverageQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.limit).toBe(DEFAULT_COVERAGE_ROWS);
      expect(r.data.hideWithDrafts).toBe(false);
      expect(r.data.branchId).toBeUndefined();
      expect(r.data.from).toBeUndefined();
      expect(r.data.to).toBeUndefined();
    }
  });

  it("refuses a limit past the cap", () => {
    expect(
      recipeCoverageQuerySchema.safeParse({ limit: MAX_COVERAGE_ROWS + 1 })
        .success
    ).toBe(false);
    expect(
      recipeCoverageQuerySchema.safeParse({ limit: MAX_COVERAGE_ROWS }).success
    ).toBe(true);
  });

  it("reads a period and a branch from query strings", () => {
    const r = recipeCoverageQuerySchema.safeParse({
      branchId: BRANCH,
      from: "2026-08-01",
      to: "2026-08-25",
      limit: "10",
      hideWithDrafts: "on",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.limit).toBe(10);
      expect(r.data.hideWithDrafts).toBe(true);
      expect(r.data.from?.toISOString().slice(0, 10)).toBe("2026-08-01");
    }
  });

  it("refuses a date it cannot read", () => {
    expect(
      recipeCoverageQuerySchema.safeParse({ from: "เมื่อวาน" }).success
    ).toBe(false);
  });
});
