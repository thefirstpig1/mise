// ============================================================
// Mise — expense zod schemas unit tests (Sprint 3 Part 16 L2)
// ============================================================
// Pure zod, no DB. ADR 0016 decisions exercised: no money is ever DERIVED here
// (the client sends what was typed, the server computes what it means — Q3) ·
// blank VAT rate means "this bill carries no VAT" · the WHT flag and its rate
// are one decision stated twice (Q6) · `PARTIAL` does not exist (Q6) · a
// recurring confirmation carries both halves of its identity or neither (Q5) ·
// `day_of_month` stops at 28 so February is never skipped.
// ============================================================

import { describe, it, expect } from "vitest";
import {
  EXPENSE_PAYMENT_STATUS_VALUES,
  EXPENSE_SOURCE_VALUES,
  MAX_EXPENSE_ITEMS,
  deleteExpenseInputSchema,
  expenseInputSchema,
  expenseItemInputSchema,
  getDueRecurringQuerySchema,
  getExpensesQuerySchema,
  recurringExpenseInputSchema,
  setExpensePaymentInputSchema,
  updateExpenseInputSchema,
  updateRecurringExpenseInputSchema,
} from "@/lib/validations/expense";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID2 = "223e4567-e89b-12d3-a456-426614174000";
const UUID3 = "323e4567-e89b-12d3-a456-426614174000";
const UUID4 = "423e4567-e89b-12d3-a456-426614174000";

const validItem = {
  categoryId: UUID2,
  departmentId: "",
  productId: "",
  productUnitId: "",
  description: "ค่าไฟฟ้าเดือนสิงหาคม",
  qty: "",
  unitPrice: "",
  lineTotal: 4280,
};

const validBill = {
  branchId: UUID,
  supplierId: "",
  billDate: "2026-08-15",
  billNo: "",
  vatInvoiceNo: "",
  vatRatePercent: "",
  subjectToWht: false,
  whtRatePercent: "",
  whtCertificateNo: "",
  paymentMethod: "",
  paidAt: "",
  recurringExpenseId: "",
  period: "",
  notes: "",
  items: [validItem],
};

/** First issue path as a dotted string — the shape the action layer maps to a field. */
const firstPath = (r: { success: boolean; error?: { issues: { path: (string | number)[] }[] } }) =>
  r.success ? null : r.error!.issues[0].path.join(".");

const messages = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? [] : r.error!.issues.map((i) => i.message);

// ------------------------------------------------------------
// The bill
// ------------------------------------------------------------

describe("expenseInputSchema — the bill (ADR 0016)", () => {
  it("S1: accepts a minimal hand-typed bill and applies the three defaults", () => {
    const r = expenseInputSchema.parse(validBill);

    // Thai bills usually quote the total, so inclusive is the default (Decision #36).
    expect(r.isPriceVatInclusive).toBe(true);
    expect(r.paymentStatus).toBe("UNPAID");
    expect(r.subjectToWht).toBe(false);
    expect(r.billDate).toBeInstanceOf(Date);
    expect(r.items).toHaveLength(1);
  });

  it("S2: a blank VAT rate means the bill carries no VAT — null, not 0", () => {
    const r = expenseInputSchema.parse(validBill);
    // 0 would mean "zero-rated and I checked"; null means "no VAT on this bill".
    expect(r.vatRatePercent).toBeNull();
    expect(expenseInputSchema.parse({ ...validBill, vatRatePercent: "7" }).vatRatePercent).toBe(7);
  });

  it("S3: rejects a VAT rate above 100 or with three decimals", () => {
    expect(expenseInputSchema.safeParse({ ...validBill, vatRatePercent: 101 }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ ...validBill, vatRatePercent: 7.005 }).success).toBe(false);
    // …while a legitimate 2-dp rate survives. `1.01 * 100` is 100.99999999999999
    // in binary floating point, so the multiply trick would reject this one —
    // the guard is a toFixed round-trip (Pitfall #30).
    expect(expenseInputSchema.safeParse({ ...validBill, vatRatePercent: 1.01 }).success).toBe(true);
  });

  it("S4: withholding without a rate is refused, on the rate's own field", () => {
    const r = expenseInputSchema.safeParse({ ...validBill, subjectToWht: true });
    expect(r.success).toBe(false);
    expect(firstPath(r)).toBe("whtRatePercent");
    expect(messages(r)).toContain("ต้องระบุอัตราภาษีหัก ณ ที่จ่าย");
  });

  it("S5: a 0% withholding rate is refused — it withholds nothing", () => {
    const r = expenseInputSchema.safeParse({
      ...validBill,
      subjectToWht: true,
      whtRatePercent: 0,
    });
    expect(r.success).toBe(false);
    expect(messages(r)).toContain("อัตราภาษีหัก ณ ที่จ่ายต้องมากกว่า 0");
  });

  it("S6: a rate without the flag is refused — nobody would apply it", () => {
    const r = expenseInputSchema.safeParse({
      ...validBill,
      subjectToWht: false,
      whtRatePercent: 3,
    });
    expect(r.success).toBe(false);
    expect(firstPath(r)).toBe("whtRatePercent");
  });

  it("S7: accepts a service bill withheld at 3%", () => {
    const r = expenseInputSchema.parse({
      ...validBill,
      vatRatePercent: 7,
      subjectToWht: true,
      whtRatePercent: 3,
      whtCertificateNo: "50TAWI-0001",
    });
    expect(r.whtRatePercent).toBe(3);
    // The AMOUNT is never accepted from the client — it is subtotal × rate/100,
    // computed server-side on the PRE-VAT base (Q6). Nothing here carries it.
    expect(r).not.toHaveProperty("whtAmount");
    expect(r).not.toHaveProperty("subtotalExclVat");
    expect(r).not.toHaveProperty("totalAmount");
    expect(r).not.toHaveProperty("netPaymentAmount");
  });

  it("S8: PAID may omit the date (the server stamps it), UNPAID may not carry one", () => {
    const paid = expenseInputSchema.parse({ ...validBill, paymentStatus: "PAID" });
    expect(paid.paidAt).toBeNull();

    const r = expenseInputSchema.safeParse({
      ...validBill,
      paymentStatus: "UNPAID",
      paidAt: "2026-08-16",
    });
    expect(r.success).toBe(false);
    expect(firstPath(r)).toBe("paidAt");
  });

  it("S9: `PARTIAL` is not a payment status this system has", () => {
    expect(EXPENSE_PAYMENT_STATUS_VALUES).toEqual(["UNPAID", "PAID"]);
    expect(
      expenseInputSchema.safeParse({ ...validBill, paymentStatus: "PARTIAL" }).success
    ).toBe(false);
  });

  it("S10: the recurring id and its period must be given as a pair", () => {
    const idOnly = expenseInputSchema.safeParse({ ...validBill, recurringExpenseId: UUID3 });
    expect(idOnly.success).toBe(false);
    expect(firstPath(idOnly)).toBe("period");

    const periodOnly = expenseInputSchema.safeParse({ ...validBill, period: "2026-08" });
    expect(periodOnly.success).toBe(false);
    expect(firstPath(periodOnly)).toBe("recurringExpenseId");

    const both = expenseInputSchema.parse({
      ...validBill,
      recurringExpenseId: UUID3,
      period: "2026-08",
    });
    expect(both.period).toBe("2026-08");
  });

  it("S11: a period is YYYY-MM, matching the DB CHECK exactly", () => {
    for (const bad of ["2026-8", "2026-13", "2026-00", "26-08", "2026/08"]) {
      const r = expenseInputSchema.safeParse({
        ...validBill,
        recurringExpenseId: UUID3,
        period: bad,
      });
      expect(r.success, `${bad} should be rejected`).toBe(false);
    }
    expect(
      expenseInputSchema.safeParse({
        ...validBill,
        recurringExpenseId: UUID3,
        period: "2026-12",
      }).success
    ).toBe(true);
  });

  it("S12: a bill needs at least one line and no more than the PO's cap", () => {
    expect(expenseInputSchema.safeParse({ ...validBill, items: [] }).success).toBe(false);

    // The cap must not be lower than a goods receipt's line count — confirming
    // one writes an expense item per received line (Q3).
    expect(MAX_EXPENSE_ITEMS).toBeGreaterThanOrEqual(200);
    const tooMany = Array.from({ length: MAX_EXPENSE_ITEMS + 1 }, () => validItem);
    expect(expenseInputSchema.safeParse({ ...validBill, items: tooMany }).success).toBe(false);
  });

  it("S13: an unbounded bill date — a bill that arrives three months late is still that bill's date", () => {
    const old = expenseInputSchema.parse({ ...validBill, billDate: "2025-01-05" });
    expect(old.billDate.getUTCFullYear()).toBe(2025);
    // Unlike the ledger's occurredAt, no 90-day window applies: an expense moves
    // no stock, so it rewrites no stock history.
    expect(expenseInputSchema.safeParse({ ...validBill, billDate: "2027-06-01" }).success).toBe(true);
  });
});

// ------------------------------------------------------------
// The line
// ------------------------------------------------------------

describe("expenseItemInputSchema — one line of a bill", () => {
  it("S14: a zero line total is real; a negative one is not", () => {
    expect(expenseItemInputSchema.parse({ ...validItem, lineTotal: 0 }).lineTotal).toBe(0);
    expect(expenseItemInputSchema.safeParse({ ...validItem, lineTotal: -1 }).success).toBe(false);
    expect(expenseItemInputSchema.safeParse({ ...validItem, lineTotal: 10.005 }).success).toBe(false);
  });

  it("S15: qty and unitPrice are optional and independent — rent has neither", () => {
    const rent = expenseItemInputSchema.parse(validItem);
    expect(rent.qty).toBeNull();
    expect(rent.unitPrice).toBeNull();

    // "20 ลิตร, ฿980 total" is a real bill line: a qty with no unit price.
    const fuel = expenseItemInputSchema.parse({ ...validItem, qty: 20, lineTotal: 980 });
    expect(fuel.qty).toBe(20);
    expect(fuel.unitPrice).toBeNull();

    // The line total is authoritative and is NOT cross-checked against qty ×
    // unitPrice — "3 × 100, less discount = 290" is a real bill too.
    const discounted = expenseItemInputSchema.parse({
      ...validItem,
      qty: 3,
      unitPrice: 100,
      lineTotal: 290,
    });
    expect(discounted.lineTotal).toBe(290);
  });

  it("S16: a product unit without its product is a dangling reference", () => {
    const r = expenseItemInputSchema.safeParse({ ...validItem, productUnitId: UUID4 });
    expect(r.success).toBe(false);
    expect(firstPath(r)).toBe("productUnitId");

    expect(
      expenseItemInputSchema.safeParse({
        ...validItem,
        productId: UUID3,
        productUnitId: UUID4,
      }).success
    ).toBe(true);
  });

  it("S17: the category is required — it is what puts the line on COGS or OpEx", () => {
    const { categoryId: _drop, ...noCategory } = validItem;
    void _drop;
    expect(expenseItemInputSchema.safeParse(noCategory).success).toBe(false);
  });
});

// ------------------------------------------------------------
// Edit / delete / payment
// ------------------------------------------------------------

describe("update + payment schemas", () => {
  it("S18: the update schema demands an id and carries the SAME cross-field rules", () => {
    expect(updateExpenseInputSchema.safeParse(validBill).success).toBe(false);
    expect(updateExpenseInputSchema.parse({ ...validBill, id: UUID3 }).id).toBe(UUID3);

    // An edit that could reach a state a create refuses would be a hole in the
    // table /cost reads its spend from.
    const r = updateExpenseInputSchema.safeParse({
      ...validBill,
      id: UUID3,
      subjectToWht: true,
    });
    expect(r.success).toBe(false);
    expect(firstPath(r)).toBe("whtRatePercent");
  });

  it("S19: marking paid needs no date, un-marking may not keep one", () => {
    const paid = setExpensePaymentInputSchema.parse({
      id: UUID,
      paymentStatus: "PAID",
      paidAt: "",
      paymentMethod: "โอน",
    });
    expect(paid.paidAt).toBeNull();
    expect(paid.paymentMethod).toBe("โอน");

    const r = setExpensePaymentInputSchema.safeParse({
      id: UUID,
      paymentStatus: "UNPAID",
      paidAt: "2026-08-16",
      paymentMethod: "",
    });
    expect(r.success).toBe(false);
    expect(firstPath(r)).toBe("paidAt");
  });

  it("S20: delete takes an id and nothing else", () => {
    expect(deleteExpenseInputSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
    expect(deleteExpenseInputSchema.parse({ id: UUID }).id).toBe(UUID);
  });
});

// ------------------------------------------------------------
// The recurring template
// ------------------------------------------------------------

const validTemplate = {
  branchId: UUID,
  supplierId: "",
  categoryId: UUID2,
  description: "ค่าเช่าร้าน",
  defaultAmount: 35000,
  vatRatePercent: "",
  subjectToWht: true,
  whtRatePercent: 5,
  dayOfMonth: 5,
  startPeriod: "2026-09",
  endPeriod: "",
};

describe("recurringExpenseInputSchema (ADR 0016 Q5)", () => {
  it("S21: accepts a rent template with its defaults", () => {
    const r = recurringExpenseInputSchema.parse(validTemplate);
    expect(r.isActive).toBe(true);
    expect(r.isPriceVatInclusive).toBe(true);
    expect(r.endPeriod).toBeNull();
    expect(r.defaultAmount).toBe(35000);
    // A template GENERATES nothing — there is no period, amount or expense id
    // here to generate with. What is due is computed (Q5).
    expect(r).not.toHaveProperty("period");
  });

  it("S22: the due day stops at 28, so February is never skipped", () => {
    expect(recurringExpenseInputSchema.parse({ ...validTemplate, dayOfMonth: 28 }).dayOfMonth).toBe(28);
    expect(recurringExpenseInputSchema.safeParse({ ...validTemplate, dayOfMonth: 29 }).success).toBe(false);
    expect(recurringExpenseInputSchema.safeParse({ ...validTemplate, dayOfMonth: 31 }).success).toBe(false);
    expect(recurringExpenseInputSchema.safeParse({ ...validTemplate, dayOfMonth: 0 }).success).toBe(false);
    expect(recurringExpenseInputSchema.safeParse({ ...validTemplate, dayOfMonth: 5.5 }).success).toBe(false);
  });

  it("S23: the active window may end where it starts, but never before", () => {
    expect(
      recurringExpenseInputSchema.parse({ ...validTemplate, endPeriod: "2026-09" }).endPeriod
    ).toBe("2026-09");

    const r = recurringExpenseInputSchema.safeParse({
      ...validTemplate,
      startPeriod: "2026-09",
      endPeriod: "2026-08",
    });
    expect(r.success).toBe(false);
    expect(firstPath(r)).toBe("endPeriod");
  });

  it("S24: both periods are YYYY-MM labels, not dates", () => {
    expect(recurringExpenseInputSchema.safeParse({ ...validTemplate, startPeriod: "2026-09-01" }).success).toBe(false);
    expect(recurringExpenseInputSchema.safeParse({ ...validTemplate, endPeriod: "2026-13" }).success).toBe(false);
  });

  it("S25: the WHT pair rule is the same one the bill uses", () => {
    const noRate = recurringExpenseInputSchema.safeParse({
      ...validTemplate,
      whtRatePercent: "",
    });
    expect(noRate.success).toBe(false);
    expect(firstPath(noRate)).toBe("whtRatePercent");

    const rateWithoutFlag = recurringExpenseInputSchema.safeParse({
      ...validTemplate,
      subjectToWht: false,
    });
    expect(rateWithoutFlag.success).toBe(false);
  });

  it("S26: a zero default amount is honest for a bill that is never the same twice", () => {
    expect(recurringExpenseInputSchema.parse({ ...validTemplate, defaultAmount: 0 }).defaultAmount).toBe(0);
    expect(recurringExpenseInputSchema.safeParse({ ...validTemplate, defaultAmount: -1 }).success).toBe(false);
  });

  it("S27: the update variant demands an id and keeps the same rules", () => {
    expect(updateRecurringExpenseInputSchema.safeParse(validTemplate).success).toBe(false);
    expect(updateRecurringExpenseInputSchema.parse({ ...validTemplate, id: UUID3 }).id).toBe(UUID3);
    expect(
      updateRecurringExpenseInputSchema.safeParse({
        ...validTemplate,
        id: UUID3,
        endPeriod: "2020-01",
      }).success
    ).toBe(false);
  });
});

// ------------------------------------------------------------
// Read queries
// ------------------------------------------------------------

describe("read queries", () => {
  it("S28: every filter is optional, and blanks become undefined (not empty strings)", () => {
    const r = getExpensesQuerySchema.parse({
      branchId: "",
      supplierId: "",
      source: "",
      paymentStatus: "",
      from: "",
      to: "",
    });
    expect(r).toEqual({
      branchId: undefined,
      supplierId: undefined,
      source: undefined,
      paymentStatus: undefined,
      from: undefined,
      to: undefined,
    });
  });

  it("S29: the date range must not run backwards", () => {
    const r = getExpensesQuerySchema.safeParse({ from: "2026-08-31", to: "2026-08-01" });
    expect(r.success).toBe(false);
    expect(firstPath(r)).toBe("to");

    expect(getExpensesQuerySchema.safeParse({ from: "2026-08-01", to: "2026-08-31" }).success).toBe(true);
  });

  it("S30: the source filter knows exactly two origins", () => {
    expect(EXPENSE_SOURCE_VALUES).toEqual(["MANUAL", "FROM_GOODS_RECEIPT"]);
    expect(getExpensesQuerySchema.parse({ source: "FROM_GOODS_RECEIPT" }).source).toBe("FROM_GOODS_RECEIPT");
    expect(getExpensesQuerySchema.safeParse({ source: "IMPORTED" }).success).toBe(false);
  });

  it("S31: the due panel takes a period, so 'what is due' is a function of its input, not the clock", () => {
    expect(getDueRecurringQuerySchema.parse({ branchId: "", asOfPeriod: "" })).toEqual({
      branchId: undefined,
      asOfPeriod: undefined,
    });
    expect(getDueRecurringQuerySchema.parse({ asOfPeriod: "2026-09" }).asOfPeriod).toBe("2026-09");
    expect(getDueRecurringQuerySchema.safeParse({ asOfPeriod: "2026-9" }).success).toBe(false);
  });
});
