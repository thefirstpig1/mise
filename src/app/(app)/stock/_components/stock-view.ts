// ============================================================
// Mise — Stock view serializers (Sprint 2 Part 10 L4)
// ============================================================
// The boundary where ledger rows become plain JSON for Client Components.
// Same job as products/_components/mapping-view.ts:
//
//   - Prisma.Decimal CANNOT cross to a Client Component (Pitfall #20) — every
//     qty/balance leaves here as a STRING. Not a number: qty is Decimal(15,3)
//     and a 12-digit integer part overflows JS float precision, so a round-trip
//     through Number would silently corrupt exactly the money-adjacent figures
//     this ledger exists to protect. The UI formats the string for display.
//   - Dates leave as ISO strings; the L5 components render them in Bangkok.
//
// No Thai labels here — those are the components' job (they already own the
// *_LABELS_TH maps from the zod layer). This file stays purely structural.
// ============================================================

import type { Prisma } from "@prisma/client";
import type {
  BranchStockBalance,
  ProductStockBalance,
  StockBalance,
  StockMovementHistoryRow,
} from "@/server/stock-movement";

const str = (d: Prisma.Decimal): string => d.toString();
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * Display date, rendered HERE (server) rather than in the components.
 *
 * The history list is appended to client-side as the user pages through it, so
 * if the component formatted dates itself, page 1 would be formatted in Node
 * during SSR and page 2 in the browser — different default locale/timezone, and
 * a hydration mismatch on the rows that exist in both passes. Sending a finished
 * string makes every row identical no matter which side produced it.
 */
const BANGKOK_DATE = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export type StockBalanceView = {
  productId: string;
  branchId: string;
  /** Signed, in the product's base unit. String — see Pitfall #20 above. */
  balance: string;
  /** true = the L5 red "ต้องตรวจสอบ" state (Q9 allows it, never blocks). */
  negative: boolean;
  lastMovementAt: string | null;
  movementCount: number;
};

export type ProductStockBalanceView = StockBalanceView & {
  product: ProductStockBalance["product"];
};

export type BranchStockBalanceView = StockBalanceView & {
  branch: BranchStockBalance["branch"];
};

export type StockMovementView = {
  id: string;
  /** Signed base-unit qty as a string; the sign drives the L5 colour. */
  qty: string;
  type: string;
  sourceType: string;
  sourceId: string;
  occurredAt: string;
  /** Bangkok-rendered `occurredAt` — see BANGKOK_DATE above. */
  occurredAtLabel: string;
  createdAt: string;
  notes: string | null;
  product: StockMovementHistoryRow["product"];
  branch: StockMovementHistoryRow["branch"];
  createdBy: StockMovementHistoryRow["createdBy"];
  adjustment: {
    id: string;
    reason: string;
    /** As entered by the user, in `inputUnitName` — not the base unit (Q1). */
    inputQty: string;
    inputUnitName: string;
  } | null;
  /** The GR line behind a PO_RECEIVE / PO_RECEIVE_REVERSAL row (Part 13). */
  goodsReceipt: {
    lineId: string;
    goodsReceiptId: string;
    grNumber: string;
    supplierName: string;
    invoiceNo: string | null;
    poNumber: string | null;
    /** As received, in `receivedUnitName` — not the base unit (Q1). */
    qtyReceivedActual: string;
    receivedUnitName: string;
    isReversal: boolean;
  } | null;
};

export function toStockBalanceView(b: StockBalance): StockBalanceView {
  return {
    productId: b.productId,
    branchId: b.branchId,
    balance: str(b.balance),
    negative: b.balance.lessThan(0),
    lastMovementAt: iso(b.lastMovementAt),
    movementCount: b.movementCount,
  };
}

export const toProductStockBalanceView = (
  b: ProductStockBalance
): ProductStockBalanceView => ({ ...toStockBalanceView(b), product: b.product });

export const toBranchStockBalanceView = (
  b: BranchStockBalance
): BranchStockBalanceView => ({ ...toStockBalanceView(b), branch: b.branch });

export function toStockMovementView(
  m: StockMovementHistoryRow
): StockMovementView {
  return {
    id: m.id,
    qty: str(m.qty),
    type: m.type,
    sourceType: m.sourceType,
    sourceId: m.sourceId,
    occurredAt: m.occurredAt.toISOString(),
    occurredAtLabel: BANGKOK_DATE.format(m.occurredAt),
    createdAt: m.createdAt.toISOString(),
    notes: m.notes,
    product: m.product,
    branch: m.branch,
    createdBy: m.createdBy,
    adjustment: m.adjustment
      ? {
          id: m.adjustment.id,
          reason: m.adjustment.reason,
          inputQty: str(m.adjustment.inputQty),
          inputUnitName: m.adjustment.inputUnitName,
        }
      : null,
    goodsReceipt: m.goodsReceipt
      ? {
          ...m.goodsReceipt,
          qtyReceivedActual: str(m.goodsReceipt.qtyReceivedActual),
        }
      : null,
  };
}
