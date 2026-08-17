// ============================================================
// Mise — waste zod schemas unit tests (Sprint 3 Part 17 L2)
// ============================================================
// Pure zod, no DB. ADR 0017 decisions exercised: the reason list IS the yield
// boundary — SPOILAGE/PREP_LOSS/STAFF_MEAL are not values here (Q3) · qty is a
// positive MAGNITUDE, because direction comes from reversal_of_id and never from
// a sign (Q2) · waste writes the ledger, so its date obeys the ledger's backdate
// window (ADR 0011 Q5), unlike a stock count's document name · voiding demands a
// reason, and voids the whole row rather than part of it.
// ============================================================

import { describe, it, expect } from "vitest";
import {
  MAX_WASTE_NOTE_LENGTH,
  QTY_MAX,
  WASTE_REASON_VALUES,
  createWasteInputSchema,
  getWasteQuerySchema,
  voidWasteInputSchema,
} from "@/lib/validations/waste";
import { MAX_BACKDATE_DAYS } from "@/lib/validations/stock-movement";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID2 = "223e4567-e89b-12d3-a456-426614174000";
const UUID3 = "323e4567-e89b-12d3-a456-426614174000";
const UUID4 = "423e4567-e89b-12d3-a456-426614174000";

const today = () => computeBangkokToday();
const iso = (d: Date) => d.toISOString();

const validWaste = {
  submitKey: UUID,
  productId: UUID2,
  branchId: UUID3,
  reason: "SPOILED",
  inputQty: 2.5,
  inputUnitId: UUID4,
  occurredAt: iso(computeBangkokToday()),
  wastedByName: null,
  notes: null,
};

describe("createWasteInputSchema (ADR 0017)", () => {
  it("W1: accepts one thing thrown away, blanks collapsing to null", () => {
    const r = createWasteInputSchema.parse({
      ...validWaste,
      wastedByName: "   ",
      notes: "",
    });
    expect(r.reason).toBe("SPOILED");
    expect(r.inputQty).toBe(2.5);
    // Optional in a one-person shop — the FK already says who (Q7).
    expect(r.wastedByName).toBeNull();
    expect(r.notes).toBeNull();
  });

  it("W2: the reason list IS the yield boundary — no PREP_LOSS, no STAFF_MEAL (Q3)", () => {
    expect([...WASTE_REASON_VALUES]).toEqual([
      "SPOILED",
      "DAMAGED",
      "COOKING_ERROR",
      "CUSTOMER_RETURN",
      "OTHER",
    ]);
    // PREP_LOSS belongs to yield_percent (Decision #59): a shop that lowers yield
    // to "cover" spoilage buries a fixable recurring loss inside a constant.
    for (const absent of ["PREP_LOSS", "STAFF_MEAL", "SPOILAGE", "DAMAGE"]) {
      expect(
        createWasteInputSchema.safeParse({ ...validWaste, reason: absent }).success
      ).toBe(false);
    }
  });

  it("W3: qty is a positive MAGNITUDE — 0 and negative are refused (Q2)", () => {
    // Direction comes from reversal_of_id, not from a sign, and the DB agrees
    // (waste_log_input_qty_check). Throwing away nothing is not an event.
    expect(
      createWasteInputSchema.safeParse({ ...validWaste, inputQty: 0 }).success
    ).toBe(false);
    expect(
      createWasteInputSchema.safeParse({ ...validWaste, inputQty: -1 }).success
    ).toBe(false);
    expect(
      createWasteInputSchema.safeParse({ ...validWaste, inputQty: QTY_MAX + 1 })
        .success
    ).toBe(false);
  });

  it("W4: exactly 3 decimals passes, a 4th does not (Pitfall #30)", () => {
    // 1.005 is the value the `n * 1000` trick wrongly rejects.
    expect(
      createWasteInputSchema.safeParse({ ...validWaste, inputQty: 1.005 }).success
    ).toBe(true);
    expect(
      createWasteInputSchema.safeParse({ ...validWaste, inputQty: 1.0005 }).success
    ).toBe(false);
  });

  it("W5: the date obeys the LEDGER's backdate window, unlike a count's name", () => {
    // Waste posts a movement, so ADR 0011 Q5 applies here exactly as it does to a
    // manual adjustment — this is not a document label (ADR 0015 Q8).
    const tooOld = addDays(today(), -(MAX_BACKDATE_DAYS + 1));
    const yesterday = addDays(today(), -1);
    const tomorrow = addDays(today(), 1);

    expect(
      createWasteInputSchema.safeParse({ ...validWaste, occurredAt: iso(yesterday) })
        .success
    ).toBe(true);
    expect(
      createWasteInputSchema.safeParse({ ...validWaste, occurredAt: iso(tooOld) })
        .success
    ).toBe(false);
    expect(
      createWasteInputSchema.safeParse({ ...validWaste, occurredAt: iso(tomorrow) })
        .success
    ).toBe(false);
  });

  it("W6: submitKey is required and is a uuid — it becomes the row's id", () => {
    // Part 13.5's pattern: the client mints one uuid per submission and the
    // server uses it AS waste_log.id, which is what makes the ledger's
    // UNIQUE(source_type, source_id) reachable from this producer.
    const { submitKey: _omitted, ...withoutKey } = validWaste;
    expect(createWasteInputSchema.safeParse(withoutKey).success).toBe(false);
    expect(
      createWasteInputSchema.safeParse({ ...validWaste, submitKey: "not-a-uuid" })
        .success
    ).toBe(false);
  });

  it("W7: free-text fields are bounded", () => {
    expect(
      createWasteInputSchema.safeParse({
        ...validWaste,
        wastedByName: "ก".repeat(101),
      }).success
    ).toBe(false);
    expect(
      createWasteInputSchema.safeParse({
        ...validWaste,
        notes: "ก".repeat(MAX_WASTE_NOTE_LENGTH + 1),
      }).success
    ).toBe(false);
  });
});

describe("voidWasteInputSchema (Q2)", () => {
  it("W8: a reason is REQUIRED to void", () => {
    // Same rule as voiding a count (ADR 0015 Q6) and for the same reason: the
    // void credits stock back, and "why did this not happen after all" is asked
    // exactly once — at the moment anyone still knows.
    expect(voidWasteInputSchema.safeParse({ id: UUID }).success).toBe(false);
    expect(
      voidWasteInputSchema.safeParse({ id: UUID, voidReason: "   " }).success
    ).toBe(false);
    const r = voidWasteInputSchema.parse({ id: UUID, voidReason: " คีย์ผิด " });
    expect(r.voidReason).toBe("คีย์ผิด");
  });

  it("W9: a void takes no quantity — it reverses the WHOLE row", () => {
    // Throwing away less than was recorded is not a partial void; it is a wrong
    // entry, which is voided and re-entered. Any qty sent is dropped, not obeyed.
    const r = voidWasteInputSchema.parse({
      id: UUID,
      voidReason: "คีย์ผิด",
      inputQty: 1,
    });
    expect(r).not.toHaveProperty("inputQty");
  });
});

describe("getWasteQuerySchema", () => {
  it("W10: blank filters mean 'no filter', not a failed parse", () => {
    const r = getWasteQuerySchema.parse({
      branchId: "",
      productId: "",
      reason: "",
      from: "",
      to: "",
    });
    expect(r.branchId).toBeUndefined();
    expect(r.reason).toBeUndefined();
    expect(r.from).toBeUndefined();
  });

  it("W11: a junk reason is refused rather than silently ignored", () => {
    expect(getWasteQuerySchema.safeParse({ reason: "STAFF_MEAL" }).success).toBe(
      false
    );
    expect(getWasteQuerySchema.safeParse({ reason: "SPOILED" }).success).toBe(true);
  });

  it("W12: includeVoided reads 'false' as FALSE (z.coerce.boolean cannot)", () => {
    // A link carrying ?includeVoided=false must not show voided rows —
    // z.coerce.boolean treats the non-empty string "false" as true.
    expect(getWasteQuerySchema.parse({ includeVoided: "false" }).includeVoided).toBe(
      false
    );
    expect(getWasteQuerySchema.parse({ includeVoided: "true" }).includeVoided).toBe(
      true
    );
    expect(getWasteQuerySchema.parse({ includeVoided: "on" }).includeVoided).toBe(
      true
    );
    // Default: a voided entry is a correction, and the list is about what was
    // actually thrown away.
    expect(getWasteQuerySchema.parse({}).includeVoided).toBe(false);
  });
});
