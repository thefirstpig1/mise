// ============================================================
// Mise — stock ledger zod schemas unit tests (Sprint 2 Part 10 L2)
// ============================================================
// Pure zod validation (no DB). Mirrors tests/product-restore-schema.test.ts.
// ADR 0011 decisions exercised: unsigned inputQty + direction from `type` (Q1/Q2),
// adjustment restricted to ADJUST_GAIN/ADJUST_LOSS (Q10), the [today−90d, today]
// Bangkok backdate window (Q5), and asOf deliberately exempt from that window (Q8).
// ============================================================

import { describe, it, expect } from "vitest";
import {
  createStockAdjustmentInputSchema,
  getStockBalanceQuerySchema,
  getStockMovementHistoryQuerySchema,
  MAX_BACKDATE_DAYS,
  QTY_MAX,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
} from "@/lib/validations/stock-movement";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID2 = "223e4567-e89b-12d3-a456-426614174000";
const UUID3 = "323e4567-e89b-12d3-a456-426614174000";

/** A valid adjustment; individual tests override one field at a time. */
const validAdjustment = {
  productId: UUID,
  branchId: UUID2,
  type: "ADJUST_LOSS",
  reason: "SPOILAGE",
  inputQty: 2.5,
  inputUnitId: UUID3,
  occurredAt: computeBangkokToday(),
  notes: "หมูสามชั้นเน่า",
};

describe("createStockAdjustmentInputSchema — fields", () => {
  it("accepts a valid adjustment", () => {
    const r = createStockAdjustmentInputSchema.safeParse(validAdjustment);
    expect(r.success).toBe(true);
  });

  it("rejects a non-uuid productId / branchId / inputUnitId", () => {
    for (const field of ["productId", "branchId", "inputUnitId"] as const) {
      const r = createStockAdjustmentInputSchema.safeParse({
        ...validAdjustment,
        [field]: "nope",
      });
      expect(r.success, field).toBe(false);
    }
  });

  it("rejects PO_RECEIVE — a manual adjustment is GAIN/LOSS only (Q10)", () => {
    expect(
      createStockAdjustmentInputSchema.safeParse({
        ...validAdjustment,
        type: "PO_RECEIVE",
      }).success
    ).toBe(false);
  });

  it("accepts both ADJUST_GAIN and ADJUST_LOSS", () => {
    for (const type of ["ADJUST_GAIN", "ADJUST_LOSS"]) {
      expect(
        createStockAdjustmentInputSchema.safeParse({ ...validAdjustment, type })
          .success,
        type
      ).toBe(true);
    }
  });

  it("accepts every AdjustmentReason and rejects an unknown one", () => {
    for (const reason of ["RECOUNT", "SPOILAGE", "DAMAGE", "OTHER"]) {
      expect(
        createStockAdjustmentInputSchema.safeParse({ ...validAdjustment, reason })
          .success,
        reason
      ).toBe(true);
    }
    expect(
      createStockAdjustmentInputSchema.safeParse({
        ...validAdjustment,
        reason: "WASTE",
      }).success
    ).toBe(false);
  });

  it("rejects a blank / missing notes into null, keeps a real one trimmed", () => {
    expect(
      createStockAdjustmentInputSchema.parse({ ...validAdjustment, notes: "   " })
        .notes
    ).toBeNull();
    expect(
      createStockAdjustmentInputSchema.parse({ ...validAdjustment, notes: undefined })
        .notes
    ).toBeNull();
    expect(
      createStockAdjustmentInputSchema.parse({ ...validAdjustment, notes: " ok " })
        .notes
    ).toBe("ok");
  });

  it("rejects notes over 500 chars", () => {
    expect(
      createStockAdjustmentInputSchema.safeParse({
        ...validAdjustment,
        notes: "ก".repeat(500),
      }).success
    ).toBe(true);
    expect(
      createStockAdjustmentInputSchema.safeParse({
        ...validAdjustment,
        notes: "ก".repeat(501),
      }).success
    ).toBe(false);
  });
});

describe("createStockAdjustmentInputSchema — inputQty (unsigned magnitude, Q1/Q2)", () => {
  it("rejects 0 and negatives — direction comes from `type`, never the sign", () => {
    for (const inputQty of [0, -1, -0.5]) {
      expect(
        createStockAdjustmentInputSchema.safeParse({ ...validAdjustment, inputQty })
          .success,
        String(inputQty)
      ).toBe(false);
    }
  });

  it("coerces a FormData string", () => {
    const r = createStockAdjustmentInputSchema.parse({
      ...validAdjustment,
      inputQty: "12.75",
    });
    expect(r.inputQty).toBe(12.75);
  });

  it("accepts exactly 3 decimal places, rejects 4 (Decimal(15,3) would truncate)", () => {
    expect(
      createStockAdjustmentInputSchema.safeParse({
        ...validAdjustment,
        inputQty: 1.234,
      }).success
    ).toBe(true);
    expect(
      createStockAdjustmentInputSchema.safeParse({
        ...validAdjustment,
        inputQty: 1.2345,
      }).success
    ).toBe(false);
  });

  it("rejects a magnitude past the Decimal(15,3) precision cap", () => {
    expect(
      createStockAdjustmentInputSchema.safeParse({
        ...validAdjustment,
        inputQty: QTY_MAX + 1,
      }).success
    ).toBe(false);
  });
});

describe("createStockAdjustmentInputSchema — occurredAt backdate window (Q5)", () => {
  const today = computeBangkokToday();

  it("accepts today (Bangkok)", () => {
    expect(
      createStockAdjustmentInputSchema.safeParse({
        ...validAdjustment,
        occurredAt: today,
      }).success
    ).toBe(true);
  });

  it("accepts a later hour of today — the bound is the end of the Bangkok day", () => {
    const laterToday = new Date(today.getTime() + 23 * 3600 * 1000);
    expect(
      createStockAdjustmentInputSchema.safeParse({
        ...validAdjustment,
        occurredAt: laterToday,
      }).success
    ).toBe(true);
  });

  it(`accepts exactly today − ${MAX_BACKDATE_DAYS} days (inclusive edge)`, () => {
    expect(
      createStockAdjustmentInputSchema.safeParse({
        ...validAdjustment,
        occurredAt: addDays(today, -MAX_BACKDATE_DAYS),
      }).success
    ).toBe(true);
  });

  it(`rejects today − ${MAX_BACKDATE_DAYS + 1} days`, () => {
    expect(
      createStockAdjustmentInputSchema.safeParse({
        ...validAdjustment,
        occurredAt: addDays(today, -(MAX_BACKDATE_DAYS + 1)),
      }).success
    ).toBe(false);
  });

  it("rejects tomorrow (no future business time)", () => {
    expect(
      createStockAdjustmentInputSchema.safeParse({
        ...validAdjustment,
        occurredAt: addDays(today, 1),
      }).success
    ).toBe(false);
  });

  it("coerces a yyyy-mm-dd string and rejects an unparseable date", () => {
    const iso = today.toISOString().slice(0, 10);
    const r = createStockAdjustmentInputSchema.safeParse({
      ...validAdjustment,
      occurredAt: iso,
    });
    expect(r.success).toBe(true);
    expect(
      createStockAdjustmentInputSchema.safeParse({
        ...validAdjustment,
        occurredAt: "not-a-date",
      }).success
    ).toBe(false);
  });
});

describe("getStockBalanceQuerySchema", () => {
  it("accepts product + branch without asOf", () => {
    const r = getStockBalanceQuerySchema.parse({
      productId: UUID,
      branchId: UUID2,
    });
    expect(r.asOf).toBeUndefined();
  });

  it("requires both productId and branchId (branch_id is NOT NULL — Q6)", () => {
    expect(getStockBalanceQuerySchema.safeParse({ productId: UUID }).success).toBe(
      false
    );
    expect(getStockBalanceQuerySchema.safeParse({ branchId: UUID2 }).success).toBe(
      false
    );
  });

  it("treats a blank asOf as omitted", () => {
    expect(
      getStockBalanceQuerySchema.parse({
        productId: UUID,
        branchId: UUID2,
        asOf: "",
      }).asOf
    ).toBeUndefined();
  });

  it("allows an asOf older than the write backdate window — reads time-travel freely (Q8)", () => {
    expect(
      getStockBalanceQuerySchema.safeParse({
        productId: UUID,
        branchId: UUID2,
        asOf: addDays(computeBangkokToday(), -(MAX_BACKDATE_DAYS + 400)),
      }).success
    ).toBe(true);
  });
});

describe("getStockMovementHistoryQuerySchema", () => {
  it("accepts a fully empty query and defaults the limit", () => {
    const r = getStockMovementHistoryQuerySchema.parse({});
    expect(r.limit).toBe(HISTORY_DEFAULT_LIMIT);
    expect(r.productId).toBeUndefined();
    expect(r.cursor).toBeUndefined();
  });

  it("accepts every filter together", () => {
    const r = getStockMovementHistoryQuerySchema.safeParse({
      productId: UUID,
      branchId: UUID2,
      type: "PO_RECEIVE",
      sourceType: "GR_LINE",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-13",
      limit: 20,
      cursor: UUID3,
    });
    expect(r.success).toBe(true);
  });

  it("allows PO_RECEIVE as a read filter (unlike the adjustment write path)", () => {
    expect(
      getStockMovementHistoryQuerySchema.safeParse({ type: "PO_RECEIVE" }).success
    ).toBe(true);
  });

  it("rejects an unknown type / sourceType", () => {
    expect(
      getStockMovementHistoryQuerySchema.safeParse({ type: "RECIPE_CONSUME" }).success
    ).toBe(false);
    expect(
      getStockMovementHistoryQuerySchema.safeParse({ sourceType: "INVOICE" }).success
    ).toBe(false);
  });

  it("rejects dateTo before dateFrom, with the issue on dateTo", () => {
    const r = getStockMovementHistoryQuerySchema.safeParse({
      dateFrom: "2026-08-13",
      dateTo: "2026-08-01",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].path).toEqual(["dateTo"]);
    }
  });

  it("allows dateFrom == dateTo (inclusive single-day filter)", () => {
    expect(
      getStockMovementHistoryQuerySchema.safeParse({
        dateFrom: "2026-08-13",
        dateTo: "2026-08-13",
      }).success
    ).toBe(true);
  });

  it("caps the limit and rejects 0 / non-integer", () => {
    expect(
      getStockMovementHistoryQuerySchema.safeParse({ limit: HISTORY_MAX_LIMIT })
        .success
    ).toBe(true);
    expect(
      getStockMovementHistoryQuerySchema.safeParse({ limit: HISTORY_MAX_LIMIT + 1 })
        .success
    ).toBe(false);
    expect(getStockMovementHistoryQuerySchema.safeParse({ limit: 0 }).success).toBe(
      false
    );
    expect(getStockMovementHistoryQuerySchema.safeParse({ limit: 1.5 }).success).toBe(
      false
    );
  });

  it("rejects a non-uuid cursor", () => {
    expect(
      getStockMovementHistoryQuerySchema.safeParse({ cursor: "page2" }).success
    ).toBe(false);
  });
});
