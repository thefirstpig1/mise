// The cashier role (Kong 2026-10-25): closes the shop, uploads the POS file,
// records waste and staff meals — and sees no money it did not key itself.

import { describe, it, expect } from "vitest";
import { canGrantRole, hasCapability } from "@/lib/permissions/service";
import { costAccessFor } from "@/lib/permissions/cost-access";

describe("cashier role", () => {
  it("CA1: does the daily close work, including the automatic stock posting", () => {
    for (const c of ["sales:import", "consumption:post", "waste:write", "staffmeal:write"] as const) {
      expect(hasCapability("cashier", c), c).toBe(true);
    }
  });

  it("CA2: cannot adjust or move stock, and sees no cost, revenue or expense", () => {
    for (const c of ["stock:write", "cost:view", "sales:view", "expense:view", "recipe:write", "member:manage"] as const) {
      expect(hasCapability("cashier", c), c).toBe(false);
    }
    expect(costAccessFor("cashier")).toBeNull();
  });

  it("CA3: waste is its own permission — the kitchen keeps it and keeps stock adjustment (Kong: ก.)", () => {
    expect(hasCapability("kitchen_staff", "waste:write")).toBe(true);
    expect(hasCapability("kitchen_staff", "stock:write")).toBe(true);
    expect(hasCapability("dept_head", "waste:write")).toBe(true);
    expect(hasCapability("accountant", "waste:write")).toBe(false);
  });

  it("CA4: a manager may invite a cashier (subset containment holds)", () => {
    expect(canGrantRole("manager", "cashier")).toBe(true);
    expect(canGrantRole("cashier", "kitchen_staff")).toBe(false);
  });
});
