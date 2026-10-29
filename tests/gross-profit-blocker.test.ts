// Rules PG2 (the two count windows) and PG3 (purchases that look unrecorded),
// pure parts. The windows are exercised against the database in
// consumption-gross-profit-logic.test.ts (G-09, G-11) and month-end-logic.test.ts.

import { describe, it, expect } from "vitest";
import { countWindows, purchasesLookLow } from "@/lib/gross-profit-blocker";
import { occurredAtFilter } from "@/server/stock-movement";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const bkk = (iso: string) => new Date(`${iso}T00:00:00+07:00`);

describe("rule PG2 — the two count windows", () => {
  const october = occurredAtFilter(day("2026-10-01"), day("2026-10-31")) as { gte: Date; lt: Date };

  it("a finished month: 23–30 Sep opens it, 24–31 Oct closes it", () => {
    const w = countWindows(october, bkk("2026-11-15"));
    expect(w.opening).toEqual({ gte: bkk("2026-09-23"), lt: bkk("2026-10-01") });
    expect(w.closing).toEqual({ gte: bkk("2026-10-24"), lt: bkk("2026-11-01") });
  });

  it("the count that closes September is a count that opens October", () => {
    const september = occurredAtFilter(day("2026-09-01"), day("2026-09-30")) as { gte: Date; lt: Date };
    expect(countWindows(september, bkk("2026-11-15")).closing).toEqual(countWindows(october, bkk("2026-11-15")).opening);
  });

  it("a month still running closes on today", () => {
    // today = 20 Oct: its end is the start of the 21st
    const w = countWindows(october, bkk("2026-10-21"));
    expect(w.closing).toEqual({ gte: bkk("2026-10-13"), lt: bkk("2026-10-21") });
  });

  it("a short period's closing count must fall inside it", () => {
    const week = occurredAtFilter(day("2026-10-24"), day("2026-10-30")) as { gte: Date; lt: Date };
    expect(countWindows(week, bkk("2026-11-15")).closing.gte).toEqual(bkk("2026-10-24"));
  });
});

describe("rule PG3 — purchases that look unrecorded", () => {
  const base = { revenue: 10_000, salesDays: 20, foodTargetPct: 35 };

  it("warns below half the shop's own food-cost target", () => {
    expect(purchasesLookLow({ ...base, purchases: 1_749 })).toBe(true);
    expect(purchasesLookLow({ ...base, purchases: 1_750 })).toBe(false);
  });

  it("follows the target the shop set, not a fixed share", () => {
    expect(purchasesLookLow({ ...base, foodTargetPct: 25, purchases: 1_300 })).toBe(false);
  });

  it("says nothing on too few days to judge, or with no sales", () => {
    expect(purchasesLookLow({ ...base, salesDays: 6, purchases: 0 })).toBe(false);
    expect(purchasesLookLow({ ...base, revenue: null, purchases: 0 })).toBe(false);
    expect(purchasesLookLow({ ...base, revenue: 0, purchases: 0 })).toBe(false);
  });
});
