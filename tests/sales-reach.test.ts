// /sales "ทุกสาขา" must mean every branch THE READER MAY SEE (rule A5).
// Before 2026-09-28 it summed every branch in the shop.

import { describe, expect, it } from "vitest";
import { branchWhere } from "@/server/sales";

const all = { allBranches: true, allowedBranchIds: [] as string[] };
const one = { allBranches: false, allowedBranchIds: ["b1"] };

describe("branchWhere — the reach narrows every sales read", () => {
  it("a reader with every branch: all branches, or the one asked for", () => {
    expect(branchWhere(all)).toEqual({});
    expect(branchWhere(all, "b2")).toEqual({ branchId: "b2" });
  });
  it("'all branches' for a one-branch reader is THEIR branch, not the shop", () => {
    expect(branchWhere(one)).toEqual({ branchId: { in: ["b1"] } });
  });
  it("a branch outside the reach matches nothing, even if a caller forgot to assert it", () => {
    expect(branchWhere(one, "b2")).toEqual({ branchId: { in: [] } });
    expect(branchWhere(one, "b1")).toEqual({ branchId: "b1" });
  });
});
