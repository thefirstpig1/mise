// Rules DC-MIX / DC-DOM (ADR 0042, Kong 2026-10-25).

import { describe, it, expect } from "vitest";
import { DOMINANT_MIN_DAYS, dominantPerHead, isWeekend, mixShares, type MixDay } from "@/lib/closing-insight";

const day = (date: string, guests: number | null, net: number | null, office: number, family: number): MixDay => ({
  date,
  guests,
  netRevenue: net,
  plates: guests ? guests * 2 : null,
  mix: [
    ...(office ? [{ customerTypeId: "office", parts: office }] : []),
    ...(family ? [{ customerTypeId: "family", parts: family }] : []),
  ],
});

describe("closing insight", () => {
  it("CI1: unassigned tenths stay unsure — 4+3 of 10 over one day is 40/30, not 57/43", () => {
    const { shares, days } = mixShares([day("2026-09-01", 100, 10000, 4, 3)]);
    expect(shares.get("office")).toBeCloseTo(0.4, 9);
    expect(shares.get("family")).toBeCloseTo(0.3, 9);
    expect(days).toBe(1);
  });

  it("CI2: a group needs five dominant days before its per head is shown, and uses real revenue ÷ real guests", () => {
    const office = Array.from({ length: DOMINANT_MIN_DAYS }, (_, i) => day(`2026-09-0${i + 1}`, 100, 15000, 6, 2));
    const family = Array.from({ length: DOMINANT_MIN_DAYS - 1 }, (_, i) => day(`2026-09-1${i}`, 100, 20000, 2, 6));
    const r = dominantPerHead([...office, ...family], ["office", "family"]);
    expect(r.byType[0]).toMatchObject({ customerTypeId: "office", days: 5, perHead: 150, platesPerGuest: 2 });
    expect(r.byType[1]).toMatchObject({ customerTypeId: "family", days: 4, perHead: null });
  });

  it("CI3: a day without a guest count is not used for per head at all", () => {
    const rows = Array.from({ length: 6 }, (_, i) => day(`2026-09-0${i + 1}`, i === 0 ? null : 100, 15000, 6, 0));
    expect(dominantPerHead(rows, ["office"]).byType[0].days).toBe(5);
  });

  it("CI4: Saturday and Sunday are the weekend", () => {
    expect(["2026-09-05", "2026-09-06", "2026-09-07"].map(isWeekend)).toEqual([true, true, false]);
  });
});
