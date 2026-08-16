// ============================================================
// Mise — cost zod schemas unit tests (Sprint 2 Part 14 L2)
// ============================================================
// Pure zod, no DB. ADR 0014 decisions exercised: a declaration is typed in the
// user's own unit and zero is a legal cost (Q6/Q10), a cost may only be declared
// against stock coming IN (Q6), `branchId` is mandatory on every cost read (Q9),
// and `asOf` is deliberately exempt from the 90-day backdate window the write
// path enforces (Q4, mirroring Part 10 Q8).
// ============================================================

import { describe, it, expect } from "vitest";
import {
  COST_SOURCE_VALUES,
  UNIT_COST_MAX,
  costDeclarationBodySchema,
  declareStockCostInputSchema,
  getBranchCostSummaryQuerySchema,
  getProductCostQuerySchema,
  getProductCostsQuerySchema,
} from "@/lib/validations/stock-cost";
import { createStockAdjustmentInputSchema } from "@/lib/validations/stock-movement";
import { computeBangkokToday } from "@/lib/bangkok-date";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID2 = "223e4567-e89b-12d3-a456-426614174000";
const UUID3 = "323e4567-e89b-12d3-a456-426614174000";
const UUID4 = "423e4567-e89b-12d3-a456-426614174000";

const validBody = { unitCost: 4500, unitId: UUID, note: "ใบส่งของ 15 ส.ค." };

describe("costDeclarationBodySchema (ADR 0014 Q6)", () => {
  it("C1: accepts a cost typed in the user's own unit", () => {
    const r = costDeclarationBodySchema.parse(validBody);
    expect(r.unitCost).toBe(4500);
    expect(r.unitId).toBe(UUID);
  });

  it("C2: accepts ZERO — a free sample is not a validation error", () => {
    expect(costDeclarationBodySchema.safeParse({ ...validBody, unitCost: 0 }).success).toBe(
      true
    );
  });

  it("C3: rejects a negative cost — stock cannot cost less than nothing", () => {
    expect(costDeclarationBodySchema.safeParse({ ...validBody, unitCost: -1 }).success).toBe(
      false
    );
  });

  it("C4: rejects a cost past the Decimal(15,4) ceiling", () => {
    expect(
      costDeclarationBodySchema.safeParse({ ...validBody, unitCost: UNIT_COST_MAX + 1 })
        .success
    ).toBe(false);
  });

  it("C5: accepts exactly 4 decimals and rejects 5 (toFixed round-trip, Pitfall #30)", () => {
    expect(
      costDeclarationBodySchema.safeParse({ ...validBody, unitCost: 11.1111 }).success
    ).toBe(true);
    // 1.00005 is the class of value the `n * 10000` trick would have mis-handled.
    expect(
      costDeclarationBodySchema.safeParse({ ...validBody, unitCost: 1.00005 }).success
    ).toBe(false);
  });

  it("C6: coerces a form string, and blanks the note to null", () => {
    const r = costDeclarationBodySchema.parse({
      unitCost: "180.50",
      unitId: UUID,
      note: "   ",
    });
    expect(r.unitCost).toBe(180.5);
    expect(r.note).toBeNull();
  });

  it("C7: rejects a note longer than 500 characters", () => {
    expect(
      costDeclarationBodySchema.safeParse({ ...validBody, note: "ก".repeat(501) }).success
    ).toBe(false);
  });

  it("C8: declareStockCostInputSchema additionally requires a movementId", () => {
    expect(declareStockCostInputSchema.safeParse(validBody).success).toBe(false);
    expect(
      declareStockCostInputSchema.safeParse({ ...validBody, movementId: UUID2 }).success
    ).toBe(true);
  });
});

describe("createStockAdjustmentInputSchema — the optional cost field (Q6)", () => {
  const base = {
    submitKey: UUID4,
    productId: UUID,
    branchId: UUID2,
    inputQty: 5,
    inputUnitId: UUID3,
    occurredAt: computeBangkokToday(),
    notes: null,
    reason: "RECOUNT",
  };

  it("C9: a declaration is optional — omitting it parses to null", () => {
    const r = createStockAdjustmentInputSchema.parse({ ...base, type: "ADJUST_GAIN" });
    expect(r.costDeclaration).toBeNull();
  });

  it("C10: a GAIN may carry a cost", () => {
    const r = createStockAdjustmentInputSchema.parse({
      ...base,
      type: "ADJUST_GAIN",
      costDeclaration: validBody,
    });
    expect(r.costDeclaration?.unitCost).toBe(4500);
  });

  it("C11: a LOSS may NOT — a field that is silently ignored is a field that lies", () => {
    const r = createStockAdjustmentInputSchema.safeParse({
      ...base,
      type: "ADJUST_LOSS",
      costDeclaration: validBody,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].path[0]).toBe("costDeclaration");
    }
  });

  it("C12: a LOSS without a cost is untouched by the new rule", () => {
    expect(
      createStockAdjustmentInputSchema.safeParse({ ...base, type: "ADJUST_LOSS" }).success
    ).toBe(true);
  });
});

describe("cost read queries (Q9)", () => {
  it("C13: branchId is mandatory — there is no business-wide product cost", () => {
    expect(getProductCostQuerySchema.safeParse({ productId: UUID }).success).toBe(false);
    expect(
      getProductCostQuerySchema.safeParse({ productId: UUID, branchId: UUID2 }).success
    ).toBe(true);
  });

  it("C14: asOf is optional, blank-tolerant, and NOT bounded by the 90-day window", () => {
    const blank = getProductCostQuerySchema.parse({
      productId: UUID,
      branchId: UUID2,
      asOf: "",
    });
    expect(blank.asOf).toBeUndefined();

    // Two years back: illegal for an adjustment's occurredAt, legal to ask about.
    const old = getProductCostQuerySchema.safeParse({
      productId: UUID,
      branchId: UUID2,
      asOf: "2024-01-15",
    });
    expect(old.success).toBe(true);
  });

  it("C15: the batch query takes many products and one branch", () => {
    const r = getProductCostsQuerySchema.parse({
      productIds: [UUID, UUID2],
      branchId: UUID3,
    });
    expect(r.productIds).toHaveLength(2);
    expect(
      getProductCostsQuerySchema.safeParse({
        productIds: Array(1001).fill(UUID),
        branchId: UUID3,
      }).success
    ).toBe(false);
  });

  it("C16: the branch summary needs a real period, and refuses a backwards one", () => {
    expect(
      getBranchCostSummaryQuerySchema.safeParse({ from: "2026-08-01", to: "2026-08-31" })
        .success
    ).toBe(true);
    expect(getBranchCostSummaryQuerySchema.safeParse({ from: "2026-08-01" }).success).toBe(
      false
    );
    const backwards = getBranchCostSummaryQuerySchema.safeParse({
      from: "2026-08-31",
      to: "2026-08-01",
    });
    expect(backwards.success).toBe(false);
    if (!backwards.success) expect(backwards.error.issues[0].path[0]).toBe("to");
  });
});

describe("costSource (Q10)", () => {
  it("C17: the four provenance values Sprint 5 computes confidence from", () => {
    expect([...COST_SOURCE_VALUES]).toEqual([
      "FRONT_LAYER",
      "DECLARED",
      "LAST_KNOWN",
      "UNPRICED",
    ]);
  });
});
