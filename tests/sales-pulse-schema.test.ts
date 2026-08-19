// ============================================================
// Mise — daily pulse zod tests (Sprint 4 Part 20a L2)
// ============================================================
// Pure zod, no DB. ADR 0020 decisions exercised: the pulse is typed by a person
// so a blank must never become a zero (Q2) · the threshold is a rule about when
// to speak, and it has to hold at both ends of the scale (Q3, rule P29).
// ============================================================

import { describe, it, expect } from "vitest";
import { SalesPulseSource } from "@prisma/client";
import {
  MAX_PULSE_NOTE_LENGTH,
  PULSE_MISMATCH_MIN_BAHT,
  SALES_PULSE_SOURCE_LABELS_TH,
  SALES_PULSE_SOURCE_VALUES,
  isPulseMismatch,
  pulseMismatchThreshold,
  recordSalesPulseInputSchema,
} from "@/lib/validations/sales-pulse";
import { MAX_BACKDATE_DAYS } from "@/lib/validations/stock-movement";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";

const UUID = "11111111-1111-4111-8111-111111111111";
const asDay = (d: Date) => d.toISOString().slice(0, 10);
const today = () => asDay(computeBangkokToday());

const base = (over: Record<string, unknown> = {}) => ({
  branchId: UUID,
  businessDate: today(),
  amount: "42800",
  note: "",
  ...over,
});

const firstMessage = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? "" : (r.error?.issues[0]?.message ?? "");

describe("daily pulse schema (Part 20a L2)", () => {
  it("Q1: a well-formed pulse is accepted, and a blank note becomes null", () => {
    const r = recordSalesPulseInputSchema.safeParse(base());
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.amount).toBe(42800);
    expect(r.data.note).toBeNull();
  });

  it("Q2: a blank amount is refused — it must not arrive as a zero", () => {
    // Zero is legal (a shop can open and sell nothing), so there is no
    // .positive() to reject a coerced blank. Same trap as Part 18 L2/T14.
    for (const blank of ["", "   ", null, undefined]) {
      const r = recordSalesPulseInputSchema.safeParse(base({ amount: blank }));
      expect(r.success).toBe(false);
      expect(firstMessage(r)).toContain("ต้องระบุยอดขาย");
    }
  });

  it("Q3: a genuine zero IS accepted — open and sold nothing is a real day", () => {
    const r = recordSalesPulseInputSchema.safeParse(base({ amount: "0" }));
    expect(r.success && r.data.amount).toBe(0);
  });

  it("Q4: a negative pulse is refused — the opposite of what sales_line allows", () => {
    // sales_line mirrors the POS, where a refund really is negative. This is
    // typed by a person, where a leading minus is a slip.
    const r = recordSalesPulseInputSchema.safeParse(base({ amount: "-100" }));
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toContain("ติดลบ");
  });

  it("Q5: a thousands separator is read, and text is refused as the wrong type", () => {
    expect(recordSalesPulseInputSchema.safeParse(base({ amount: "42,800.50" })).success).toBe(true);
    const junk = recordSalesPulseInputSchema.safeParse(base({ amount: "สี่หมื่น" }));
    expect(junk.success).toBe(false);
    expect(firstMessage(junk)).toContain("ไม่ถูกต้อง");
  });

  it("Q6: satang only — three decimals is a typo, not a takings figure", () => {
    expect(recordSalesPulseInputSchema.safeParse(base({ amount: "100.555" })).success).toBe(false);
  });

  it("Q7: tomorrow cannot be recorded, and 90 days is the backdate limit", () => {
    const tomorrow = asDay(addDays(computeBangkokToday(), 1));
    expect(firstMessage(recordSalesPulseInputSchema.safeParse(base({ businessDate: tomorrow })))).toContain(
      "ยังมาไม่ถึง"
    );

    const tooOld = asDay(addDays(computeBangkokToday(), -(MAX_BACKDATE_DAYS + 1)));
    expect(recordSalesPulseInputSchema.safeParse(base({ businessDate: tooOld })).success).toBe(false);

    const justInside = asDay(addDays(computeBangkokToday(), -MAX_BACKDATE_DAYS));
    expect(recordSalesPulseInputSchema.safeParse(base({ businessDate: justInside })).success).toBe(true);
  });

  it("Q8: a note survives, and an over-long one is refused", () => {
    const r = recordSalesPulseInputSchema.safeParse(base({ note: "ตู้เย็นเสีย ปิดเร็ว" }));
    expect(r.success && r.data.note).toBe("ตู้เย็นเสีย ปิดเร็ว");
    expect(
      recordSalesPulseInputSchema.safeParse(base({ note: "ก".repeat(MAX_PULSE_NOTE_LENGTH + 1) }))
        .success
    ).toBe(false);
  });

  // ------------------------------------------------------------
  // The threshold
  // ------------------------------------------------------------

  it("Q9: a big day is judged by percentage, a small day by the floor", () => {
    // ฿40,000 → 1% = 400, which is above the floor.
    expect(pulseMismatchThreshold(40_000)).toBe(400);
    // ฿3,000 → 1% = 30, so the floor takes over and small days stop crying wolf.
    expect(pulseMismatchThreshold(3_000)).toBe(PULSE_MISMATCH_MIN_BAHT);
  });

  it("Q10: a rounding difference is silent, a missing evening is not", () => {
    // The case this exists for: an export that stopped at 6pm looks perfect from
    // the inside — every row real, header matching, no blank cells.
    expect(isPulseMismatch(40_050, 40_000)).toBe(false);
    expect(isPulseMismatch(40_000, 28_000)).toBe(true);
  });

  it("Q11: the gap is judged in both directions", () => {
    expect(isPulseMismatch(28_000, 40_000)).toBe(true);
    expect(isPulseMismatch(40_000, 40_000)).toBe(false);
  });

  it("Q12: a day with no takings at all does not divide by zero", () => {
    expect(pulseMismatchThreshold(0)).toBe(PULSE_MISMATCH_MIN_BAHT);
    expect(isPulseMismatch(0, 0)).toBe(false);
    expect(isPulseMismatch(5_000, 0)).toBe(true);
  });

  it("Q13: the source list is pinned to the database, and EMAIL is not in it yet", () => {
    expect([...SALES_PULSE_SOURCE_VALUES].sort()).toEqual(Object.values(SalesPulseSource).sort());
    expect(SALES_PULSE_SOURCE_VALUES).not.toContain("EMAIL");
    for (const v of SALES_PULSE_SOURCE_VALUES) {
      expect(SALES_PULSE_SOURCE_LABELS_TH[v].length).toBeGreaterThan(0);
    }
  });
});
