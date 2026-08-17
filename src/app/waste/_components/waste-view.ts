// ============================================================
// Mise — waste view serializers (Sprint 3 Part 17 L4)
// ============================================================
// Where waste rows become plain JSON for Client Components. Same two rules as
// stock-view.ts:
//
//   - Prisma.Decimal CANNOT cross to a Client Component (Pitfall #20) — every
//     quantity leaves here as a STRING, never a number: Decimal(15,3) with a
//     12-digit integer part overflows JS float precision.
//   - Dates leave as ISO strings, plus a Bangkok-rendered label computed HERE.
//     A list appended client-side would otherwise format page 1 in Node and page
//     2 in the browser, with a hydration mismatch on the rows in both.
// ============================================================

import type { Prisma } from "@prisma/client";
import type { WasteLogDetail } from "@/server/waste";

const str = (d: Prisma.Decimal): string => d.toString();

const BANGKOK_DATE = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export type WasteLogView = {
  id: string;
  reason: string;
  /** As entered, in `inputUnitName` — not the base unit (ADR 0011 Q1). */
  inputQty: string;
  inputUnitName: string;
  occurredAt: string;
  occurredAtLabel: string;
  /** Who the account says, and who actually did it (ADR 0017 Q7). */
  wastedByName: string | null;
  wastedByAccount: string | null;
  notes: string | null;
  /** Non-null once corrected — the original stays readable (Q2). */
  voidedAt: string | null;
  voidedAtLabel: string | null;
  voidReason: string | null;
  /** true when this row IS the correction rather than the thing corrected. */
  isReversal: boolean;
  product: {
    id: string;
    name: string;
    sku: string;
    baseUnitName: string | null;
  };
  branch: { id: string; name: string };
};

export function toWasteLogView(w: WasteLogDetail): WasteLogView {
  return {
    id: w.id,
    reason: w.reason,
    inputQty: str(w.inputQty),
    inputUnitName: w.inputUnit.unitName,
    occurredAt: w.occurredAt.toISOString(),
    occurredAtLabel: BANGKOK_DATE.format(w.occurredAt),
    wastedByName: w.wastedByName,
    wastedByAccount: w.wastedByUser.name ?? w.wastedByUser.email,
    notes: w.notes,
    voidedAt: w.voidedAt?.toISOString() ?? null,
    voidedAtLabel: w.voidedAt ? BANGKOK_DATE.format(w.voidedAt) : null,
    voidReason: w.voidReason,
    isReversal: w.reversalOfId !== null,
    product: {
      id: w.product.id,
      name: w.product.name,
      sku: w.product.sku,
      baseUnitName: w.product.productUnits[0]?.unitName ?? null,
    },
    branch: w.branch,
  };
}
