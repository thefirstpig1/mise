// Part 39 (ADR 0036 Q7, rule PR3) — splitting VAT-inclusive quoted lines. Pure.

import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { exclUnitPrice, quotedUnitPrice, splitQuotedLines } from "@/server/vat-split";

const D = (n: number | string) => new Prisma.Decimal(n);
const sum = (xs: Prisma.Decimal[]) => xs.reduce((s, x) => s.plus(x), D(0));

describe("PR3 — a quoted bill split into excluding-VAT lines", () => {
  it("฿107 at 7% is ฿100 + ฿7", () => {
    const s = splitQuotedLines([D(107)], 7);
    expect(s.exclLines[0].toString()).toBe("100");
    expect(s.vatAmount.toString()).toBe("7");
    expect(s.totalAmount.toString()).toBe("107");
  });

  it("the lines always add up: Σ excl = subtotal, subtotal + VAT = what the bill says", () => {
    // Amounts chosen so per-line rounding drifts from the rounded subtotal.
    const quoted = [D("45.00"), D("45.00"), D("45.00"), D("19.99"), D("0.35")];
    const s = splitQuotedLines(quoted, 7);
    expect(sum(s.exclLines).equals(s.subtotalExclVat)).toBe(true);
    expect(s.subtotalExclVat.plus(s.vatAmount).equals(sum(quoted))).toBe(true);
    expect(s.totalAmount.equals(sum(quoted))).toBe(true);
    // VAT is taken ONCE from the total, the way a tax invoice does it.
    expect(s.vatAmount.toString()).toBe(sum(quoted).mul(7).div(107).toDecimalPlaces(2).toString());
  });

  it("no VAT on the bill: the quoted price IS the price", () => {
    const s = splitQuotedLines([D("50.5"), D(20)], null);
    expect(s.exclLines.map(String)).toEqual(["50.5", "20"]);
    expect(s.vatAmount.toString()).toBe("0");
    expect(splitQuotedLines([D(10)], 0).exclLines[0].toString()).toBe("10");
  });

  it("unit prices convert both ways to 4 places", () => {
    expect(exclUnitPrice(D(107), 7).toString()).toBe("100");
    expect(exclUnitPrice(D(45), 7).toString()).toBe("42.0561");
    expect(quotedUnitPrice(D(100), 7).toString()).toBe("107");
    expect(exclUnitPrice(D(45), null).toString()).toBe("45");
  });
});
