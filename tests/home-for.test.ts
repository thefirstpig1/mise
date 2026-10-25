// Where each role lands after signing in (Kong 2026-10-25).
import { describe, it, expect } from "vitest";
import { homeFor } from "@/lib/permissions/home";
import { hasCapability } from "@/lib/permissions/service";

describe("homeFor", () => {
  it("HF1: each role lands on the page it works in", () => {
    const on = { dailyCloseEnabled: true };
    expect(homeFor("cashier", on)).toBe("/closing/day");
    expect(homeFor("cashier", { dailyCloseEnabled: false })).toBe("/sales/import");
    expect(homeFor("kitchen_staff", on)).toBe("/stock");
    expect(homeFor("dept_head", on)).toBe("/stock");
    expect(homeFor("purchaser", on)).toBe("/purchase-requests/cut");
    expect(homeFor("accountant", on)).toBe("/expenses");
    for (const r of ["owner", "admin", "manager", "viewer"]) expect(homeFor(r, on)).toBe("/dashboard");
  });

  it("HF2: nobody is sent to a page their role cannot open", () => {
    const need: Record<string, Parameters<typeof hasCapability>[1]> = {
      "/closing/day": "any:member",
      "/sales/import": "sales:import",
      "/stock": "any:member",
      "/purchase-requests/cut": "purchase:approve",
      "/expenses": "expense:view",
      "/dashboard": "any:member",
    };
    for (const role of ["owner", "admin", "manager", "purchaser", "kitchen_staff", "dept_head", "cashier", "accountant", "viewer"]) {
      for (const close of [true, false]) {
        const home = homeFor(role, { dailyCloseEnabled: close });
        expect(hasCapability(role, need[home]), `${role} → ${home}`).toBe(true);
      }
    }
  });
});
