// ============================================================
// Mise — stock count zod schemas unit tests (Sprint 3 Part 15 L2)
// ============================================================
// Pure zod, no DB. ADR 0015 decisions exercised: a saved line IS a count and a
// total of zero is a real observation (Q7) · the same unit cannot be entered
// twice · voiding demands a reason where cancelling a PO does not · `countDate`
// is a document name and is therefore NOT bound by the ledger's backdate window
// (Q8) · `qty_expected` is never accepted from the client (Q3).
// ============================================================

import { describe, it, expect } from "vitest";
import {
  MAX_COUNT_LINES,
  QTY_MAX,
  STOCK_COUNT_STATUS_VALUES,
  closeStockCountInputSchema,
  getStockCountsQuerySchema,
  openStockCountInputSchema,
  saveStockCountLineInputSchema,
  voidStockCountInputSchema,
} from "@/lib/validations/stock-count";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID2 = "223e4567-e89b-12d3-a456-426614174000";
const UUID3 = "323e4567-e89b-12d3-a456-426614174000";

const validLine = {
  stockCountId: UUID,
  productId: UUID2,
  entries: [{ productUnitId: UUID3, qtyInUnit: 2 }],
  countedByName: null,
  notes: null,
};

describe("openStockCountInputSchema (ADR 0015)", () => {
  it("S1: accepts a sheet, defaulting the blind-count switch to SHOW", () => {
    const r = openStockCountInputSchema.parse({
      branchId: UUID,
      countDate: "2026-08-20",
      notes: "",
    });
    // Q7: the MVP's counter is usually the owner, for whom hiding the expected
    // figure is friction that controls nothing.
    expect(r.showExpected).toBe(true);
    expect(r.notes).toBeNull();
  });

  it("S2: countDate is a document NAME — a year ago is fine (Q8)", () => {
    // Deliberately unlike the adjustment's occurredAt, which zod bounds to 90
    // days: naming a sheet is not writing history.
    expect(
      openStockCountInputSchema.safeParse({
        branchId: UUID,
        countDate: "2025-01-05",
        notes: null,
      }).success
    ).toBe(true);
  });

  it("S3: rejects a missing branch — a count is always of one place", () => {
    expect(
      openStockCountInputSchema.safeParse({ countDate: "2026-08-20", notes: null })
        .success
    ).toBe(false);
  });
});

describe("saveStockCountLineInputSchema (Q7)", () => {
  it("S4: a total of ZERO is a real observation, not an error", () => {
    const r = saveStockCountLineInputSchema.safeParse({
      ...validLine,
      entries: [{ productUnitId: UUID3, qtyInUnit: 0 }],
    });
    expect(r.success).toBe(true);
  });

  it("S5: refuses a line with no entries at all", () => {
    // Not a count of zero — an abandoned row. Saving it would turn an unfinished
    // sheet into a stock write-off.
    const r = saveStockCountLineInputSchema.safeParse({ ...validLine, entries: [] });
    expect(r.success).toBe(false);
  });

  it("S6: refuses the same unit twice — a mis-tap, not a sum", () => {
    const r = saveStockCountLineInputSchema.safeParse({
      ...validLine,
      entries: [
        { productUnitId: UUID3, qtyInUnit: 2 },
        { productUnitId: UUID3, qtyInUnit: 3 },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path[0]).toBe("entries");
  });

  it("S7: accepts several DIFFERENT units — '2 กระสอบ + 3 kg' is one line", () => {
    const r = saveStockCountLineInputSchema.safeParse({
      ...validLine,
      entries: [
        { productUnitId: UUID3, qtyInUnit: 2 },
        { productUnitId: UUID2, qtyInUnit: 3 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("S8: rejects a negative quantity and one past the column's ceiling", () => {
    for (const qtyInUnit of [-1, QTY_MAX + 1]) {
      expect(
        saveStockCountLineInputSchema.safeParse({
          ...validLine,
          entries: [{ productUnitId: UUID3, qtyInUnit }],
        }).success,
        String(qtyInUnit)
      ).toBe(false);
    }
  });

  it("S9: rejects a 4th decimal (toFixed round-trip, Pitfall #30)", () => {
    expect(
      saveStockCountLineInputSchema.safeParse({
        ...validLine,
        entries: [{ productUnitId: UUID3, qtyInUnit: 1.234 }],
      }).success
    ).toBe(true);
    expect(
      saveStockCountLineInputSchema.safeParse({
        ...validLine,
        entries: [{ productUnitId: UUID3, qtyInUnit: 1.0005 }],
      }).success
    ).toBe(false);
  });

  it("S10: never accepts qty_expected from the client (Q3)", () => {
    const r = saveStockCountLineInputSchema.parse({
      ...validLine,
      qtyExpected: 9999,
      qtyCounted: 9999,
    } as never);
    // Stripped, not honoured — the expected figure is the ledger's answer and the
    // browser has no business telling the server what the server already knows.
    expect(r).not.toHaveProperty("qtyExpected");
    expect(r).not.toHaveProperty("qtyCounted");
  });

  it("S11: keeps the counter's name when given, and blanks it to null", () => {
    expect(
      saveStockCountLineInputSchema.parse({ ...validLine, countedByName: "  น้องเบียร์  " })
        .countedByName
    ).toBe("น้องเบียร์");
    expect(
      saveStockCountLineInputSchema.parse({ ...validLine, countedByName: "   " })
        .countedByName
    ).toBeNull();
  });
});

describe("closing and voiding (Q6)", () => {
  it("S12: closing needs only the document — the partial-count warning is the UI's", () => {
    expect(closeStockCountInputSchema.safeParse({ id: UUID }).success).toBe(true);
  });

  it("S13: voiding REQUIRES a reason, unlike cancelling a PO", () => {
    expect(voidStockCountInputSchema.safeParse({ id: UUID }).success).toBe(false);
    expect(
      voidStockCountInputSchema.safeParse({ id: UUID, voidReason: "   " }).success
    ).toBe(false);
    expect(
      voidStockCountInputSchema.safeParse({ id: UUID, voidReason: "นับซ้ำช่องเดิม" })
        .success
    ).toBe(true);
  });
});

describe("read query + enums", () => {
  it("S14: filters are optional and blank-tolerant", () => {
    const r = getStockCountsQuerySchema.parse({ branchId: "", status: "" });
    expect(r.branchId).toBeUndefined();
    expect(r.status).toBeUndefined();
    expect(
      getStockCountsQuerySchema.safeParse({ status: "COUNTING" }).success
    ).toBe(false);
  });

  it("S15: the status enum is the three ADR 0015 kept, not the spec's four", () => {
    expect([...STOCK_COUNT_STATUS_VALUES]).toEqual(["DRAFT", "CLOSED", "VOIDED"]);
    expect(MAX_COUNT_LINES).toBeGreaterThan(0);
  });
});
