// Rules GH-HEAD / GH-COV (Kong 2026-10-25): per head over branch-days that have
// both figures; shown only when enough of the sales days carry a guest count.

import { describe, it, expect } from "vitest";
import { GUEST_COVERAGE_MIN, guestStats, guestWeeks, perHeadByWeekday, type GuestDay } from "@/lib/guest-stats";

const d = (day: string, net: number, plates: number, guests: number | null, branchId = "a"): GuestDay => ({ day, branchId, net, plates, guests });

describe("guest stats", () => {
  it("GH1: a day with sales and no count is left out of BOTH sides, never treated as zero customers", () => {
    const s = guestStats([d("2026-09-01", 1000, 20, 10), d("2026-09-02", 3000, 60, null)]);
    expect(s.perHead).toBe(100); // 1000 / 10, not 4000 / 10
    expect(s.platesPerGuest).toBe(2);
    expect(s.salesDays).toBe(2);
    expect(s.guestDays).toBe(1);
    expect(s.coverage).toBe(0.5);
    expect(s.enough).toBe(false);
  });

  it("GH2: two branches on one date are summed, and 'per day' divides by dates, not branch-days", () => {
    const s = guestStats([d("2026-09-01", 1000, 20, 10, "a"), d("2026-09-01", 2000, 40, 20, "b")]);
    expect(s.perHead).toBe(100);
    expect(s.guestsPerDay).toBe(30);
  });

  it("GH3: the coverage gate sits at exactly the threshold", () => {
    const rows = Array.from({ length: 10 }, (_, i) => d(`2026-09-${String(i + 1).padStart(2, "0")}`, 100, 1, i < 8 ? 1 : null));
    expect(GUEST_COVERAGE_MIN).toBe(0.8);
    expect(guestStats(rows).enough).toBe(true);
    expect(guestStats(rows.slice(0, 9).map((r, i) => (i === 7 ? { ...r, guests: null } : r))).enough).toBe(false);
  });

  it("GH4: no counts at all is null, not ฿0 per head", () => {
    const s = guestStats([d("2026-09-01", 1000, 20, null)]);
    expect(s.perHead).toBeNull();
    expect(s.guestsPerDay).toBeNull();
  });

  it("GH5: weekday is Monday-first and weeks start on Monday", () => {
    // 2026-09-05 is a Saturday, 2026-09-07 a Monday.
    const rows = [d("2026-09-05", 300, 6, 2), d("2026-09-07", 100, 2, 1)];
    const w = perHeadByWeekday(rows);
    expect(w.map((x) => x.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(w[0].perHead).toBe(100);
    expect(w[5].perHead).toBe(150);
    expect(guestWeeks(rows).map((x) => [x.from, x.to])).toEqual([
      ["2026-09-05", "2026-09-05"],
      ["2026-09-07", "2026-09-07"],
    ]);
  });
});
