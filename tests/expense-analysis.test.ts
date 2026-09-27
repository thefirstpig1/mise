// ============================================================
// Mise — วิเคราะห์รายจ่าย (Part 35 B): the pure analysis
// ============================================================

import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { analyse, type AnalysisLine } from "@/server/expense-analysis";

const D = (n: number) => new Prisma.Decimal(n);
let seq = 0;
function line(over: Partial<AnalysisLine>): AnalysisLine {
  seq++;
  return {
    expenseId: "bill-1",
    billDate: new Date("2026-09-10T00:00:00Z"),
    billNo: "INV-1",
    branchName: "สาขาอารีย์",
    supplierId: "sup-makro",
    supplierName: "แม็คโคร",
    account: "COGS",
    section: "อาหาร",
    group: "เนื้อสัตว์",
    productId: `p${seq}`,
    productName: `p${seq}`,
    description: "x",
    qty: D(1),
    unitName: "กก.",
    total: D(100),
    ...over,
  };
}

const rice = line({ productId: "rice", productName: "ข้าว", group: "ของแห้ง", qty: D(15), total: D(690) });
const beer = line({ productId: "beer", productName: "เบียร์", section: "เครื่องดื่ม", group: "แอลกอฮอล์", qty: D(12), unitName: "ขวด", total: D(780) });
const rent = line({ expenseId: "bill-2", supplierId: null, supplierName: null, account: "OpEx", section: "ค่าเช่า", group: "ค่าเช่าร้าน", productId: null, productName: null, qty: null, unitName: null, total: D(45000) });
const rice2 = line({ expenseId: "bill-3", productId: "rice", productName: "ข้าว", group: "ของแห้ง", qty: D(15), total: D(720), billDate: new Date("2026-09-12T00:00:00Z") });
const ALL = [rice, beer, rent, rice2];

describe("analyse", () => {
  it("a filter narrows the LINES, not the bills — a mixed bill counts only what matches", () => {
    const a = analyse(ALL, { section: "เครื่องดื่ม" });
    expect(a.total.toString()).toBe("780");
    expect(a.bills).toHaveLength(1);
    expect(a.bills[0].amount.toString()).toBe("780"); // bill-1 also holds rice
  });

  it("the filter rows offer choices from ABOVE their own level, so a picked section can be switched", () => {
    const a = analyse(ALL, { account: "COGS", section: "อาหาร" });
    expect(a.options.sections).toEqual(expect.arrayContaining(["อาหาร", "เครื่องดื่ม"]));
    expect(a.options.sections).not.toContain("ค่าเช่า");
  });

  it("bills with no supplier group under one honest label, and filter by 'none'", () => {
    const a = analyse(ALL, {});
    expect(a.bySupplier.map((s) => s.key)).toContain("none");
    const none = analyse(ALL, { supplier: "none" });
    expect(none.total.toString()).toBe("45000");
  });

  it("average price per unit is shown only when every line used the same unit", () => {
    const a = analyse(ALL, { group: "ของแห้ง" });
    const r = a.products.find((p) => p.productId === "rice")!;
    expect(r.qty.toString()).toBe("30");
    expect(r.avgPrice!.toFixed(2)).toBe("47.00");
    const mixed = analyse([rice, line({ productId: "rice", productName: "ข้าว", group: "ของแห้ง", unitName: "กระสอบ", qty: D(1), total: D(700) })], {});
    expect(mixed.products[0].avgPrice).toBeNull();
    expect(mixed.products[0].unitName).toBeNull();
  });

  it("everything adds up to the same total", () => {
    const a = analyse(ALL, {});
    const sum = (xs: { amount: Prisma.Decimal }[]) => xs.reduce((s, x) => s.plus(x.amount), D(0)).toString();
    expect(sum(a.bySection)).toBe(a.total.toString());
    expect(sum(a.bySupplier)).toBe(a.total.toString());
    expect(sum(a.byDay)).toBe(a.total.toString());
    expect(sum(a.bills)).toBe(a.total.toString());
  });
});
