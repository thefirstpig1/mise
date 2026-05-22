// ============================================================
// Mise — supplierInputSchema unit tests (Sprint 1 Part 5, Q5b)
// ============================================================
// Pure validation tests — no DB, no auth. Verifies the locked Q5b
// rules: required nameFull, blank->null, email/taxId/rate formats,
// and the conditional VAT/WHT requirements.
// ============================================================

import { describe, it, expect } from "vitest";
import { supplierInputSchema } from "@/lib/validations/supplier";

/** Minimal valid raw input — only the required field set. */
const base = { nameFull: "บริษัท ทดสอบ จำกัด" };

describe("supplierInputSchema", () => {
  it("accepts a minimal supplier (only nameFull) and applies defaults", () => {
    const r = supplierInputSchema.parse(base);
    expect(r.nameFull).toBe("บริษัท ทดสอบ จำกัด");
    expect(r.isActive).toBe(true); // default
    expect(r.isVatRegistered).toBe(false); // default
    expect(r.defaultSubjectToWht).toBe(false); // default
    // unset optionals normalize to null
    expect(r.code).toBeNull();
    expect(r.contactEmail).toBeNull();
    expect(r.defaultVatRatePercent).toBeNull();
  });

  it("trims nameFull and rejects blank / whitespace-only", () => {
    expect(supplierInputSchema.parse({ nameFull: "  ABC Co  " }).nameFull).toBe("ABC Co");
    expect(supplierInputSchema.safeParse({ nameFull: "   " }).success).toBe(false);
    expect(supplierInputSchema.safeParse({ nameFull: "" }).success).toBe(false);
    expect(supplierInputSchema.safeParse({}).success).toBe(false);
  });

  it("normalizes blank optional strings to null and trims real values", () => {
    const r = supplierInputSchema.parse({
      ...base,
      code: "  SUP-01  ",
      nameShort: "",
      address: "   ",
    });
    expect(r.code).toBe("SUP-01");
    expect(r.nameShort).toBeNull();
    expect(r.address).toBeNull();
  });

  it("validates contactEmail only when present", () => {
    expect(supplierInputSchema.safeParse({ ...base, contactEmail: "not-an-email" }).success).toBe(false);
    expect(supplierInputSchema.parse({ ...base, contactEmail: "a@b.com" }).contactEmail).toBe("a@b.com");
    expect(supplierInputSchema.parse({ ...base, contactEmail: "" }).contactEmail).toBeNull();
  });

  it("requires taxId to be exactly 13 digits when present", () => {
    expect(supplierInputSchema.parse({ ...base, taxId: "1234567890123" }).taxId).toBe("1234567890123");
    expect(supplierInputSchema.safeParse({ ...base, taxId: "123" }).success).toBe(false);
    expect(supplierInputSchema.safeParse({ ...base, taxId: "12345678901234" }).success).toBe(false);
    expect(supplierInputSchema.safeParse({ ...base, taxId: "abcdefghijklm" }).success).toBe(false);
    expect(supplierInputSchema.parse({ ...base, taxId: "" }).taxId).toBeNull();
  });

  it("coerces rate strings, enforces 0-100 and max 2 decimals", () => {
    // string -> number
    expect(supplierInputSchema.parse({ ...base, isVatRegistered: true, defaultVatRatePercent: "7.00" }).defaultVatRatePercent).toBe(7);
    // number passes through
    expect(supplierInputSchema.parse({ ...base, isVatRegistered: true, defaultVatRatePercent: 7 }).defaultVatRatePercent).toBe(7);
    // out of range
    expect(supplierInputSchema.safeParse({ ...base, isVatRegistered: true, defaultVatRatePercent: 150 }).success).toBe(false);
    expect(supplierInputSchema.safeParse({ ...base, isVatRegistered: true, defaultVatRatePercent: -1 }).success).toBe(false);
    // too many decimals (float-precision guard)
    expect(supplierInputSchema.safeParse({ ...base, isVatRegistered: true, defaultVatRatePercent: "7.123" }).success).toBe(false);
    // non-numeric string
    expect(supplierInputSchema.safeParse({ ...base, isVatRegistered: true, defaultVatRatePercent: "abc" }).success).toBe(false);
  });

  it("requires VAT rate when isVatRegistered is true", () => {
    const fail = supplierInputSchema.safeParse({ ...base, isVatRegistered: true });
    expect(fail.success).toBe(false);
    if (!fail.success) {
      expect(fail.error.issues.some((i) => i.path[0] === "defaultVatRatePercent")).toBe(true);
    }
    expect(supplierInputSchema.safeParse({ ...base, isVatRegistered: true, defaultVatRatePercent: 7 }).success).toBe(true);
  });

  it("requires WHT rate when defaultSubjectToWht is true", () => {
    const fail = supplierInputSchema.safeParse({ ...base, defaultSubjectToWht: true });
    expect(fail.success).toBe(false);
    if (!fail.success) {
      expect(fail.error.issues.some((i) => i.path[0] === "defaultWhtRatePercent")).toBe(true);
    }
    expect(supplierInputSchema.safeParse({ ...base, defaultSubjectToWht: true, defaultWhtRatePercent: 3 }).success).toBe(true);
  });

  it("does not require rates when the corresponding flag is off", () => {
    const r = supplierInputSchema.parse({ ...base, isVatRegistered: false, defaultSubjectToWht: false });
    expect(r.defaultVatRatePercent).toBeNull();
    expect(r.defaultWhtRatePercent).toBeNull();
  });
});
