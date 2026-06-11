// ============================================================
// Mise — product-restore zod schemas unit tests (Sprint 1 Part 8.5 L2)
// ============================================================
// Pure zod validation (no DB). Mirrors tests/product-input-schema.test.ts.
// Locked decisions exercised: newSku required+non-empty; currentUnitPrice
// positive() > 0 (not nonnegative); keep+updates = silent ignore. See ADR 0010.
// ============================================================

import { describe, it, expect } from "vitest";
import {
  newSkuSchema,
  mappingUpdateSchema,
  restoreProductInputSchema,
  fuzzySearchInputSchema,
} from "@/lib/validations/product-restore";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID2 = "223e4567-e89b-12d3-a456-426614174000";

describe("newSkuSchema", () => {
  it("accepts a valid sku and trims it", () => {
    expect(newSkuSchema.parse(" PORK01-restored ")).toBe("PORK01-restored");
  });

  it("rejects empty / whitespace-only (required, non-empty)", () => {
    expect(newSkuSchema.safeParse("").success).toBe(false);
    expect(newSkuSchema.safeParse("   ").success).toBe(false);
  });

  it("rejects > 64 chars", () => {
    expect(newSkuSchema.safeParse("A".repeat(64)).success).toBe(true);
    expect(newSkuSchema.safeParse("A".repeat(65)).success).toBe(false);
  });
});

describe("mappingUpdateSchema", () => {
  const validUpdates = { currentUnitPrice: 120, minOrderQty: 10, leadTimeDays: 3 };

  it("accepts action=keep without updates", () => {
    expect(mappingUpdateSchema.safeParse({ mappingId: UUID, action: "keep" }).success).toBe(true);
  });

  it("accepts action=keep WITH stray well-formed updates (silent ignore, no error)", () => {
    expect(
      mappingUpdateSchema.safeParse({ mappingId: UUID, action: "keep", updates: validUpdates }).success
    ).toBe(true);
  });

  it("rejects action=update WITHOUT updates", () => {
    expect(mappingUpdateSchema.safeParse({ mappingId: UUID, action: "update" }).success).toBe(false);
  });

  it("accepts action=update with valid updates", () => {
    const r = mappingUpdateSchema.safeParse({ mappingId: UUID, action: "update", updates: validUpdates });
    expect(r.success).toBe(true);
  });

  it("rejects update with a negative price", () => {
    expect(
      mappingUpdateSchema.safeParse({
        mappingId: UUID,
        action: "update",
        updates: { ...validUpdates, currentUnitPrice: -5 },
      }).success
    ).toBe(false);
  });

  it("rejects update with currentUnitPrice = 0 (Decision 2: positive, not nonnegative)", () => {
    expect(
      mappingUpdateSchema.safeParse({
        mappingId: UUID,
        action: "update",
        updates: { ...validUpdates, currentUnitPrice: 0 },
      }).success
    ).toBe(false);
  });

  it("rejects update with leadTimeDays > 365", () => {
    expect(
      mappingUpdateSchema.safeParse({
        mappingId: UUID,
        action: "update",
        updates: { ...validUpdates, leadTimeDays: 366 },
      }).success
    ).toBe(false);
  });

  it("rejects a non-uuid mappingId", () => {
    expect(mappingUpdateSchema.safeParse({ mappingId: "nope", action: "keep" }).success).toBe(false);
  });
});

describe("restoreProductInputSchema", () => {
  it("accepts a minimal valid input, defaults mappingUpdates to []", () => {
    const r = restoreProductInputSchema.parse({ productId: UUID });
    expect(r.productId).toBe(UUID);
    expect(r.newSku).toBeUndefined();
    expect(r.mappingUpdates).toEqual([]);
  });

  it("treats a blank newSku as omitted (undefined), keeps a real one", () => {
    expect(restoreProductInputSchema.parse({ productId: UUID, newSku: "   " }).newSku).toBeUndefined();
    expect(restoreProductInputSchema.parse({ productId: UUID, newSku: "PORK01-restored" }).newSku).toBe(
      "PORK01-restored"
    );
  });

  it("accepts mappingUpdates entries", () => {
    const r = restoreProductInputSchema.safeParse({
      productId: UUID,
      mappingUpdates: [
        { mappingId: UUID2, action: "update", updates: { currentUnitPrice: 130, minOrderQty: 5, leadTimeDays: 2 } },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an invalid productId", () => {
    expect(restoreProductInputSchema.safeParse({ productId: "not-a-uuid" }).success).toBe(false);
  });
});

describe("fuzzySearchInputSchema", () => {
  it("rejects < 3 chars (after trim)", () => {
    expect(fuzzySearchInputSchema.safeParse({ searchTerm: "ab" }).success).toBe(false);
    expect(fuzzySearchInputSchema.safeParse({ searchTerm: " a " }).success).toBe(false);
  });

  it("accepts exactly 3 chars", () => {
    expect(fuzzySearchInputSchema.safeParse({ searchTerm: "หมูสาม" }).success).toBe(true);
    expect(fuzzySearchInputSchema.parse({ searchTerm: " abc " }).searchTerm).toBe("abc");
  });

  it("rejects > 200 chars", () => {
    expect(fuzzySearchInputSchema.safeParse({ searchTerm: "ก".repeat(201) }).success).toBe(false);
  });
});
