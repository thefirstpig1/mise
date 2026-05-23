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
});
