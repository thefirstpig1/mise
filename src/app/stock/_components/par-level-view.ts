// ============================================================
// Mise — par level view serializer (Sprint 3 Part 17 L4)
// ============================================================
// Same rules as stock-view.ts: Decimals leave as strings (Pitfall #20), dates as
// ISO plus a Bangkok-rendered label computed here.
//
// One thing this file does that the others do not: it turns `lastCountedAt` into
// the sentence the row actually shows — "นับล่าสุด 9 วันก่อน" / "ยังไม่เคยนับ".
// That is ADR 0017 Q6b's freshness line, and it is computed SERVER-SIDE for the
// usual hydration reason and one more: "how many days ago" depends on what
// "today" is, and today in Bangkok is not today in the browser's timezone.
// ============================================================

import type { Prisma } from "@prisma/client";
import type { ParLevelRow, ParState } from "@/server/par-level";

const str = (d: Prisma.Decimal): string => d.toString();

const BANGKOK_DATE = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/** Thai gloss per state (ADR 0017 Q6's three, plus the quiet one). */
export const PAR_STATE_LABELS_TH: Record<ParState, string> = {
  OK: "พอ",
  NEEDS_ORDER: "ต้องสั่ง",
  ON_ORDER: "สั่งแล้ว รอของ",
  OVERDUE: "ตามของ",
};

const MS_PER_DAY = 86_400_000;

export type ParLevelRowView = {
  id: string;
  productId: string;
  branchId: string;
  parQty: string;
  inputQty: string;
  inputUnitName: string;
  onHand: string;
  /** `parQty − onHand`. Positive when short; the row shows it only when below. */
  gap: string;
  isBelow: boolean;
  state: ParState;
  stateLabel: string;
  openOrder: {
    qtyOutstanding: string;
    expectedDeliveryDate: string | null;
    expectedDeliveryLabel: string | null;
    purchaseOrderId: string;
    poNumber: string;
    supplierName: string;
    orderCount: number;
  } | null;
  lastCountedAt: string | null;
  /**
   * Whole days since the last count, in Bangkok terms. `null` = never counted.
   * The row sorts on the server; this is for display only.
   */
  daysSinceCount: number | null;
  /**
   * The freshness line itself. NOT decoration — with a monthly count and no
   * consumption deduction (Q6b), it is this row's own health warning: the figure
   * beside it was true on count day and has been drifting since.
   */
  freshnessLabel: string;
  product: ParLevelRow["product"];
  branch: ParLevelRow["branch"];
};

export function toParLevelRowView(
  row: ParLevelRow,
  now: Date = new Date()
): ParLevelRowView {
  const daysSinceCount = row.lastCountedAt
    ? Math.max(
        0,
        Math.floor((now.getTime() - row.lastCountedAt.getTime()) / MS_PER_DAY)
      )
    : null;

  return {
    id: row.id,
    productId: row.productId,
    branchId: row.branchId,
    parQty: str(row.parQty),
    inputQty: str(row.inputQty),
    inputUnitName: row.inputUnitName,
    onHand: str(row.onHand),
    gap: str(row.gap),
    isBelow: row.isBelow,
    state: row.state,
    stateLabel: PAR_STATE_LABELS_TH[row.state],
    openOrder: row.openOrder
      ? {
          qtyOutstanding: str(row.openOrder.qtyOutstanding),
          expectedDeliveryDate:
            row.openOrder.expectedDeliveryDate?.toISOString() ?? null,
          expectedDeliveryLabel: row.openOrder.expectedDeliveryDate
            ? BANGKOK_DATE.format(row.openOrder.expectedDeliveryDate)
            : null,
          purchaseOrderId: row.openOrder.purchaseOrderId,
          poNumber: row.openOrder.poNumber,
          supplierName: row.openOrder.supplierName,
          orderCount: row.openOrder.orderCount,
        }
      : null,
    lastCountedAt: row.lastCountedAt?.toISOString() ?? null,
    daysSinceCount,
    freshnessLabel:
      daysSinceCount === null
        ? "ยังไม่เคยนับ"
        : daysSinceCount === 0
          ? "นับวันนี้"
          : `นับล่าสุด ${daysSinceCount} วันก่อน`,
    product: row.product,
    branch: row.branch,
  };
}
