// /sales "รายวัน" — one row per DATE however many branches sold on it
// (Kong, 2026-09-28). Pure view logic; no database.

import { describe, expect, it } from "vitest";
import {
  groupSalesDaysByDate,
  type SalesDayRowView,
} from "@/app/(app)/sales/_components/sales-view";

const row = (over: Partial<SalesDayRowView>): SalesDayRowView => ({
  businessDate: "2026-09-26T00:00:00.000Z",
  branchId: "b1",
  branchName: "สาขาอารีย์",
  fileName: "a.csv",
  importedAtLabel: "27 ก.ย. 2569 21:31",
  dayLabel: "26 ก.ย. 2569",
  weekdayLabel: "เสาร์",
  net: "1000",
  rows: 10,
  sourceLabel: "",
  pulseAmount: null,
  pulseDifference: null,
  pulseIsMismatch: false,
  pulseNote: null,
  ...over,
});

describe("groupSalesDaysByDate", () => {
  it("folds two branches on one date into ONE row that keeps both", () => {
    const groups = groupSalesDaysByDate([
      row({ branchId: "b1", branchName: "สาขาอารีย์", net: "1000", rows: 10 }),
      row({ branchId: "b2", branchName: "สาขาลาดพร้าว", net: "500", rows: 4, fileName: "b.csv" }),
      row({ businessDate: "2026-09-25T00:00:00.000Z", net: "700" }),
    ]);
    expect(groups.map((g) => g.day)).toEqual(["2026-09-26", "2026-09-25"]);
    expect(groups[0].net).toBe("1500");
    expect(groups[0].rows).toBe(14);
    expect(groups[0].branches.map((b) => b.branchName)).toEqual(["สาขาลาดพร้าว", "สาขาอารีย์"]);
    expect(groups[0].fileNames).toEqual(["b.csv", "a.csv"]);
  });

  it("prints a keyed total only when EVERY branch keyed one", () => {
    const partial = groupSalesDaysByDate([
      row({ branchId: "b1", pulseAmount: "1100", pulseDifference: "-100" }),
      row({ branchId: "b2", branchName: "สาขาลาดพร้าว" }),
    ])[0];
    // A sum of one branch beside a file of two would read as a shortfall.
    expect(partial.pulseAmount).toBeNull();
    expect(partial.pulseDifference).toBeNull();
    expect(partial.pulseKeyedCount).toBe(1);

    const full = groupSalesDaysByDate([
      row({ branchId: "b1", pulseAmount: "1100", pulseDifference: "-100" }),
      row({ branchId: "b2", branchName: "สาขาลาดพร้าว", pulseAmount: "500", pulseDifference: "20" }),
    ])[0];
    expect(full.pulseAmount).toBe("1600");
    expect(full.pulseDifference).toBe("-80");
  });

  it("flags the date when any one branch's till disagrees with its file", () => {
    const g = groupSalesDaysByDate([
      row({ branchId: "b1" }),
      row({ branchId: "b2", branchName: "สาขาลาดพร้าว", pulseIsMismatch: true }),
    ])[0];
    expect(g.pulseIsMismatch).toBe(true);
  });
});
