// ============================================================
// Mise — prices quoted WITH VAT inside (Part 39, ADR 0036 Q7, rule PR3)
// ============================================================
// A supplier's ฿107 is ฿100 of goods and ฿7 of VAT. This file turns lines as
// the supplier QUOTED them into the excluding-VAT figures every existing money
// column holds, so no reader of those columns ever has to know the difference.
//
// It owns no arithmetic of its own: the split is `computeExpenseAmounts` in the
// inclusive direction — Decision #36, already the rule for a bill typed by hand
// — so an order, its receipt and the expense the receipt writes cannot disagree
// by a satang. VAT is taken ONCE from the total (total × rate/(100+rate), the
// way a Thai tax invoice does it), and the rounding remainder goes to the
// largest line, so Σ excluding-VAT lines = total − VAT exactly.
// ============================================================

import { Prisma } from "@prisma/client";
import { computeExpenseAmounts } from "@/server/expense";

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

export type QuotedSplit = {
  /** Per line, excluding VAT, in the order given. Σ = subtotal exactly. */
  exclLines: Prisma.Decimal[];
  subtotalExclVat: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  /** = Σ quoted lines: what the supplier's bill says. */
  totalAmount: Prisma.Decimal;
};

const hasVat = (rate: Prisma.Decimal | number | null): rate is Prisma.Decimal | number =>
  rate !== null && !new Prisma.Decimal(rate).isZero();

/** Split quoted (VAT-inclusive) line totals into their excluding-VAT parts. */
export function splitQuotedLines(quoted: Prisma.Decimal[], vatRatePercent: Prisma.Decimal | number | null): QuotedSplit {
  if (!hasVat(vatRatePercent)) {
    // No VAT on the bill: the quoted figure IS the price.
    const total = quoted.reduce((s, q) => s.plus(q), ZERO);
    return { exclLines: quoted, subtotalExclVat: total, vatAmount: ZERO, totalAmount: total };
  }
  const a = computeExpenseAmounts({
    items: quoted.map((q) => ({ lineTotal: q })),
    vatRatePercent,
    isPriceVatInclusive: true,
    subjectToWht: false,
    whtRatePercent: null,
  });
  return {
    exclLines: a.items.map((i) => i.totalPrice),
    subtotalExclVat: a.subtotalExclVat,
    vatAmount: a.vatAmount,
    totalAmount: a.totalAmount,
  };
}

/**
 * A quoted unit price, excluding VAT, to 4 places — informational on the line
 * (the line's money is its share of the split above, which is exact).
 */
export function exclUnitPrice(quotedUnit: Prisma.Decimal, vatRatePercent: Prisma.Decimal | number | null): Prisma.Decimal {
  if (!hasVat(vatRatePercent)) return quotedUnit;
  const rate = new Prisma.Decimal(vatRatePercent);
  return quotedUnit.mul(HUNDRED).div(HUNDRED.plus(rate)).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

/** The reverse, for a price the purchaser typed excluding VAT on a VAT-inclusive supplier's order. */
export function quotedUnitPrice(exclUnit: Prisma.Decimal, vatRatePercent: Prisma.Decimal | number | null): Prisma.Decimal {
  if (!hasVat(vatRatePercent)) return exclUnit;
  const rate = new Prisma.Decimal(vatRatePercent);
  return exclUnit.mul(HUNDRED.plus(rate)).div(HUNDRED).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}
