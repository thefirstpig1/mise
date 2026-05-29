// ============================================================
// Mise — productInputSchema unit tests (Sprint 1 Part 7a)
// ============================================================
// Pure zod validation (no DB). Mirrors tests/category-input-schema.test.ts.
// ============================================================

import { describe, it, expect } from "vitest";
import { productInputSchema } from "@/lib/validations/product";

const base = {
  name: "หมูสามชั้น",
  primaryDimension: "WEIGHT",
  baseUnitName: "kg",
};

describe("productInputSchema", () => {
  it("accepts a minimal valid input, defaults isActive true and sku null", () => {
    const r = productInputSchema.parse(base);
    expect(r.name).toBe("หมูสามชั้น");
    expect(r.isActive).toBe(true);
    expect(r.sku).toBeNull(); // blank → null → logic auto-generates
    expect(r.nameEn).toBeNull();
    expect(r.categoryId).toBeNull();
  });

  it("trims name and rejects an empty one", () => {
    expect(productInputSchema.parse({ ...base, name: "  ข้าว  " }).name).toBe("ข้าว");
    expect(productInputSchema.safeParse({ ...base, name: "   " }).success).toBe(false);
  });

  it("rejects an unknown primaryDimension and requires a base unit", () => {
    expect(productInputSchema.safeParse({ ...base, primaryDimension: "LENGTH" }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...base, baseUnitName: "" }).success).toBe(false);
  });

  it("normalizes blank sku/categoryId to null but validates a non-uuid categoryId", () => {
    expect(productInputSchema.parse({ ...base, sku: "  " }).sku).toBeNull();
    expect(productInputSchema.parse({ ...base, sku: " ABC-1 " }).sku).toBe("ABC-1");
    expect(productInputSchema.safeParse({ ...base, categoryId: "not-a-uuid" }).success).toBe(false);
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    expect(productInputSchema.parse({ ...base, categoryId: uuid }).categoryId).toBe(uuid);
  });

  // S1 — multi-unit (7b): additionalUnits[] + defaultBuyUnitName, with defaults
  it("defaults additionalUnits to [] and defaultBuyUnitName to null", () => {
    const r = productInputSchema.parse(base);
    expect(r.additionalUnits).toEqual([]);
    expect(r.defaultBuyUnitName).toBeNull();
  });

  it("accepts additionalUnits and coerces toBaseRatio from form strings", () => {
    const r = productInputSchema.parse({
      ...base,
      additionalUnits: [
        { unitName: " กระสอบ ", toBaseRatio: "25" }, // string from FormData, name trimmed
        { unitName: "ขีด", toBaseRatio: 0.1 },
      ],
      defaultBuyUnitName: "กระสอบ",
    });
    expect(r.additionalUnits).toEqual([
      { unitName: "กระสอบ", toBaseRatio: 25 },
      { unitName: "ขีด", toBaseRatio: 0.1 },
    ]);
    expect(r.defaultBuyUnitName).toBe("กระสอบ");
  });

  // S2 — an additional unit's ratio must be > 0
  it("rejects an additional unit with a non-positive toBaseRatio", () => {
    expect(
      productInputSchema.safeParse({ ...base, additionalUnits: [{ unitName: "กระสอบ", toBaseRatio: 0 }] }).success
    ).toBe(false);
    expect(
      productInputSchema.safeParse({ ...base, additionalUnits: [{ unitName: "กระสอบ", toBaseRatio: -5 }] }).success
    ).toBe(false);
  });

  // S3 — unit names (base + additional) must be unique within the product
  it("rejects duplicate unit names (base vs additional, and additional vs additional)", () => {
    // additional collides with the base
    expect(
      productInputSchema.safeParse({ ...base, additionalUnits: [{ unitName: "kg", toBaseRatio: 2 }] }).success
    ).toBe(false);
    // two additionals collide
    expect(
      productInputSchema.safeParse({
        ...base,
        additionalUnits: [
          { unitName: "กระสอบ", toBaseRatio: 25 },
          { unitName: "กระสอบ", toBaseRatio: 50 },
        ],
      }).success
    ).toBe(false);
  });

  // S4 — defaultBuyUnitName must name one of the product's units
  it("rejects a defaultBuyUnitName that is not among the units, accepts one that is", () => {
    expect(
      productInputSchema.safeParse({ ...base, defaultBuyUnitName: "ลัง" }).success
    ).toBe(false); // "ลัง" isn't base or an additional
    const ok = productInputSchema.parse({
      ...base,
      additionalUnits: [{ unitName: "ลัง", toBaseRatio: 12 }],
      defaultBuyUnitName: "ลัง",
    });
    expect(ok.defaultBuyUnitName).toBe("ลัง");
  });

  // ----- 7c: PREPPED (parentProductId + yieldPercent + type) -----
  const PARENT_UUID = "11111111-1111-1111-1111-111111111111";

  // S5 — type defaults to RAW, accepts RAW/PREPPED, rejects others
  it("defaults type to RAW; accepts RAW/PREPPED explicitly; rejects unknown values", () => {
    expect(productInputSchema.parse(base).type).toBe("RAW");
    expect(productInputSchema.parse({ ...base, type: "RAW" }).type).toBe("RAW");
    expect(
      productInputSchema.parse({
        ...base,
        type: "PREPPED",
        parentProductId: PARENT_UUID,
        yieldPercent: 80,
      }).type
    ).toBe("PREPPED");
    expect(productInputSchema.safeParse({ ...base, type: "OTHER" }).success).toBe(false);
  });

  // S6 — RAW must have both parentProductId and yieldPercent null
  it("rejects RAW with a non-null parentProductId or yieldPercent", () => {
    expect(
      productInputSchema.safeParse({ ...base, parentProductId: PARENT_UUID }).success
    ).toBe(false);
    expect(
      productInputSchema.safeParse({ ...base, yieldPercent: 80 }).success
    ).toBe(false);
    // Default RAW: blank parent/yield are fine (treated as null)
    const r = productInputSchema.parse({ ...base, parentProductId: "  ", yieldPercent: "" });
    expect(r.parentProductId).toBeNull();
    expect(r.yieldPercent).toBeNull();
  });

  // S7 — PREPPED must have BOTH parentProductId and yieldPercent
  it("rejects PREPPED missing parentProductId or yieldPercent", () => {
    // missing parent
    const noParent = productInputSchema.safeParse({
      ...base,
      type: "PREPPED",
      yieldPercent: 80,
    });
    expect(noParent.success).toBe(false);
    if (!noParent.success) {
      expect(noParent.error.issues.some((i) => i.path[0] === "parentProductId")).toBe(true);
    }
    // missing yield
    const noYield = productInputSchema.safeParse({
      ...base,
      type: "PREPPED",
      parentProductId: PARENT_UUID,
    });
    expect(noYield.success).toBe(false);
    if (!noYield.success) {
      expect(noYield.error.issues.some((i) => i.path[0] === "yieldPercent")).toBe(true);
    }
  });

  // S8 — PREPPED with a non-uuid parentProductId rejects on shape
  it("rejects PREPPED with a non-uuid parentProductId", () => {
    expect(
      productInputSchema.safeParse({
        ...base,
        type: "PREPPED",
        parentProductId: "not-a-uuid",
        yieldPercent: 80,
      }).success
    ).toBe(false);
  });

  // S9 — yieldPercent range: accepts 0.01–999.99 incl. >100; rejects 0, negative, >999.99
  it("enforces yieldPercent range 0.01–999.99 and ALLOWS values >100", () => {
    const mk = (y: unknown) =>
      productInputSchema.safeParse({
        ...base,
        type: "PREPPED",
        parentProductId: PARENT_UUID,
        yieldPercent: y,
      });
    expect(mk(0.01).success).toBe(true);
    expect(mk(100).success).toBe(true);
    expect(mk(250).success).toBe(true); // >100 allowed (cooked rice / soaked beans)
    expect(mk(999.99).success).toBe(true);
    expect(mk(0).success).toBe(false);
    expect(mk(-1).success).toBe(false);
    expect(mk(1000).success).toBe(false);
  });

  // S10 — PREPPED happy path: all fields set, parsed values preserved
  it("accepts a fully-specified PREPPED product", () => {
    const r = productInputSchema.parse({
      ...base,
      type: "PREPPED",
      parentProductId: PARENT_UUID,
      yieldPercent: 80,
    });
    expect(r.type).toBe("PREPPED");
    expect(r.parentProductId).toBe(PARENT_UUID);
    expect(r.yieldPercent).toBe(80);
  });

  // S11 — yieldPercent coerced from a FormData string
  it("coerces yieldPercent from a string (FormData) into a number", () => {
    const r = productInputSchema.parse({
      ...base,
      type: "PREPPED",
      parentProductId: PARENT_UUID,
      yieldPercent: "80.5",
    });
    expect(r.yieldPercent).toBe(80.5);
  });

  // ----- 7d: liquid density (liquidDensityTemplateId + densityGPerMlOverride) -----
  const TEMPLATE_UUID = "22222222-2222-2222-2222-222222222222";
  // Density is allowed on WEIGHT or VOLUME, never COUNT (Q3). Use a VOLUME base.
  const densityBase = { name: "นมสด", primaryDimension: "VOLUME", baseUnitName: "ml" };

  // S12 — XOR (Q2): template OR override OR neither, never both.
  it("enforces density XOR: template-only / override-only / neither pass; both fails on override", () => {
    // template only
    const t = productInputSchema.parse({ ...densityBase, liquidDensityTemplateId: TEMPLATE_UUID });
    expect(t.liquidDensityTemplateId).toBe(TEMPLATE_UUID);
    expect(t.densityGPerMlOverride).toBeNull();
    // override only
    const o = productInputSchema.parse({ ...densityBase, densityGPerMlOverride: 1.03 });
    expect(o.densityGPerMlOverride).toBe(1.03);
    expect(o.liquidDensityTemplateId).toBeNull();
    // neither
    const n = productInputSchema.parse(densityBase);
    expect(n.liquidDensityTemplateId).toBeNull();
    expect(n.densityGPerMlOverride).toBeNull();
    // both → fail, issue lands on the override (the field layered on top)
    const both = productInputSchema.safeParse({
      ...densityBase,
      liquidDensityTemplateId: TEMPLATE_UUID,
      densityGPerMlOverride: 1.03,
    });
    expect(both.success).toBe(false);
    if (!both.success) {
      expect(both.error.issues.some((i) => i.path[0] === "densityGPerMlOverride")).toBe(true);
    }
  });

  // S13 — COUNT gate (Q3): COUNT rejects any density; WEIGHT/VOLUME allow it.
  it("gates density to non-COUNT: COUNT+density fails on the offending field; WEIGHT/VOLUME pass", () => {
    // COUNT + template → fail on liquidDensityTemplateId
    const ct = productInputSchema.safeParse({
      ...base,
      primaryDimension: "COUNT",
      baseUnitName: "ชิ้น",
      liquidDensityTemplateId: TEMPLATE_UUID,
    });
    expect(ct.success).toBe(false);
    if (!ct.success) {
      expect(ct.error.issues.some((i) => i.path[0] === "liquidDensityTemplateId")).toBe(true);
    }
    // COUNT + override → fail on densityGPerMlOverride
    const co = productInputSchema.safeParse({
      ...base,
      primaryDimension: "COUNT",
      baseUnitName: "ชิ้น",
      densityGPerMlOverride: 1.03,
    });
    expect(co.success).toBe(false);
    if (!co.success) {
      expect(co.error.issues.some((i) => i.path[0] === "densityGPerMlOverride")).toBe(true);
    }
    // COUNT + neither → pass
    expect(
      productInputSchema.safeParse({ ...base, primaryDimension: "COUNT", baseUnitName: "ชิ้น" }).success
    ).toBe(true);
    // WEIGHT (base) + override → pass (granular solids may carry density)
    const w = productInputSchema.parse({ ...base, densityGPerMlOverride: 0.91 });
    expect(w.densityGPerMlOverride).toBe(0.91);
    // VOLUME + template → pass
    const v = productInputSchema.parse({ ...densityBase, liquidDensityTemplateId: TEMPLATE_UUID });
    expect(v.liquidDensityTemplateId).toBe(TEMPLATE_UUID);
  });

  // S14 — range (Q4): hard cap (0, 2.5]; the 1030-forgot-decimal typo is caught.
  it("enforces densityGPerMlOverride hard cap (0, 2.5]", () => {
    const mk = (d: unknown) =>
      productInputSchema.safeParse({ ...densityBase, densityGPerMlOverride: d });
    expect(mk(0).success).toBe(false); // positive() rejects 0
    expect(mk(-1).success).toBe(false);
    expect(mk(0.5).success).toBe(true); // lower edge (no hint at zod level)
    expect(mk(2.5).success).toBe(true); // upper edge, equals max
    expect(mk(2.51).success).toBe(false);
    expect(mk(1000).success).toBe(false); // "1030" typed for 1.030 — forgot the decimal
    // double violation: out-of-range override AND a template set — must not pass silently
    expect(
      productInputSchema.safeParse({
        ...densityBase,
        liquidDensityTemplateId: TEMPLATE_UUID,
        densityGPerMlOverride: 1500,
      }).success
    ).toBe(false);
  });
});
