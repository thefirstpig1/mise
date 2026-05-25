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
});
