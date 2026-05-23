// ============================================================
// Mise — categoryInputSchema unit tests (Sprint 1 Part 6)
// ============================================================
// Pure validation tests — no DB. account restricted to COGS/OpEx;
// accountingSection + groupName required + trimmed.
// ============================================================

import { describe, it, expect } from "vitest";
import { categoryInputSchema, ACCOUNT_VALUES } from "@/lib/validations/category";

const base = { account: "COGS", accountingSection: "Food", groupName: "Meat" };

describe("categoryInputSchema", () => {
  it("accepts a valid category", () => {
    const r = categoryInputSchema.parse(base);
    expect(r.account).toBe("COGS");
    expect(r.accountingSection).toBe("Food");
    expect(r.groupName).toBe("Meat");
  });

  it("restricts account to COGS/OpEx", () => {
    expect(ACCOUNT_VALUES).toEqual(["COGS", "OpEx"]);
    expect(categoryInputSchema.parse({ ...base, account: "OpEx" }).account).toBe("OpEx");
    expect(categoryInputSchema.safeParse({ ...base, account: "Misc" }).success).toBe(false);
    expect(categoryInputSchema.safeParse({ ...base, account: "" }).success).toBe(false);
    expect(categoryInputSchema.safeParse({ ...base, account: "cogs" }).success).toBe(false); // case-sensitive
  });

  it("requires and trims accountingSection and groupName", () => {
    expect(categoryInputSchema.parse({ ...base, accountingSection: "  Beverage  " }).accountingSection).toBe("Beverage");
    expect(categoryInputSchema.parse({ ...base, groupName: "  Coffee  " }).groupName).toBe("Coffee");
    expect(categoryInputSchema.safeParse({ ...base, accountingSection: "   " }).success).toBe(false);
    expect(categoryInputSchema.safeParse({ ...base, groupName: "" }).success).toBe(false);
    expect(categoryInputSchema.safeParse({ account: "COGS" }).success).toBe(false); // missing tiers
  });
});
