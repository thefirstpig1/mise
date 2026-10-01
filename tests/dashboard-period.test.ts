// The dashboard's period and what each ↑↓ is compared with (Part 35 L5;
// "compare with the whole month" — Kong, 2026-10-01).
import { describe, it, expect } from "vitest";
import { periodFor, isoDay } from "@/app/(app)/dashboard/_components/dashboard-period";

const today = new Date(Date.UTC(2026, 9, 1)); // 2026-10-01
const span = (p: ReturnType<typeof periodFor>) => [isoDay(p.from), isoDay(p.to), isoDay(p.prevFrom), isoDay(p.prevTo)];

describe("dashboard period comparisons", () => {
  it("last month is compared with the whole month before it", () => {
    expect(span(periodFor("last-month", today))).toEqual(["2026-09-01", "2026-09-30", "2026-08-01", "2026-08-31"]);
  });

  it("a month picked on the chart is compared with the whole month before it", () => {
    expect(span(periodFor("2026-08", today))).toEqual(["2026-08-01", "2026-08-31", "2026-07-01", "2026-07-31"]);
  });

  it("this month so far is compared with the same days of last month", () => {
    const mid = new Date(Date.UTC(2026, 9, 12));
    expect(span(periodFor("month", mid))).toEqual(["2026-10-01", "2026-10-12", "2026-09-01", "2026-09-12"]);
  });

  it("this month so far never runs past the end of a shorter month", () => {
    const end = new Date(Date.UTC(2026, 2, 31)); // 31 March vs February
    expect(span(periodFor("month", end))).toEqual(["2026-03-01", "2026-03-31", "2026-02-01", "2026-02-28"]);
  });

  it("a rolling window is compared with the same number of days just before it", () => {
    expect(span(periodFor("30d", today))).toEqual(["2026-09-02", "2026-10-01", "2026-08-03", "2026-09-01"]);
  });
});
