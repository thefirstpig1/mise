// ============================================================
// Mise — staff meal view serializers (Sprint 5 Part 26 L5, ADR 0028)
// ============================================================
// Where staff meal rows become plain JSON for Client Components. The same two
// rules as waste-view.ts:
//
//   - Prisma.Decimal CANNOT cross to a Client Component (Pitfall #20) — every
//     quantity and every baht figure leaves here as a STRING, never a number.
//   - Dates leave as ISO strings, plus a Bangkok-rendered label computed HERE,
//     so a row never gets formatted in Node on one render and in the browser on
//     the next.
//
// One rule of this Part's own: **a value that is not known leaves as `null`,
// never as "0"** (rule S3). A dish that has never sold has no price, and a
// screen that prints ฿0 for it says the meal was free.
// ============================================================

import type { Prisma } from "@prisma/client";
import type { StaffMealRow, StaffMealQuotaStatus } from "@/server/staff-meal-read";

const BANGKOK_DATE = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const dateLabel = (d: Date): string => BANGKOK_DATE.format(d);

export type StaffMealRowView = {
  id: string;
  businessDate: string;
  businessDateLabel: string;
  branchName: string;
  /** Null for a pot the kitchen cooked for everybody — the screen says so. */
  staffMemberName: string | null;
  /** A label on the row, never a reason to hide it (rule S7). */
  staffMemberRetired: boolean;
  menuName: string | null;
  servings: string;
  unitPrice: string | null;
  priceSource: "SOLD" | "PLANNED" | "NONE";
  value: string | null;
  /** The dish's frozen price is above the shop's ceiling — shown, never blocked. */
  overCeiling: boolean;
  itemCount: number;
  recordedByName: string | null;
  notes: string | null;
  voidedAt: string | null;
  voidedAtLabel: string | null;
  voidReason: string | null;
};

/**
 * `maxMenuPrice` is compared HERE rather than stored on the row, and that is a
 * decision (ADR 0028 Q9 as built). The ceiling is a policy in force TODAY; the
 * frozen price is a historical fact. Storing the verdict would freeze a policy
 * onto the past, and re-deriving it means the label always reflects the rule the
 * shop is actually running — which is what a person reading the list wants to
 * know. The screen prints the ceiling beside the label so the figure is never a
 * bare claim.
 */
export function toStaffMealRowView(
  row: StaffMealRow,
  maxMenuPrice: Prisma.Decimal | null
): StaffMealRowView {
  return {
    id: row.id,
    businessDate: row.businessDate.toISOString(),
    businessDateLabel: dateLabel(row.businessDate),
    branchName: row.branchName,
    staffMemberName: row.staffMemberName,
    staffMemberRetired: row.staffMemberRetired,
    menuName: row.menuName,
    servings: row.servings.toString(),
    unitPrice: row.unitPrice === null ? null : row.unitPrice.toString(),
    priceSource: row.priceSource,
    value: row.value === null ? null : row.value.toString(),
    overCeiling:
      maxMenuPrice !== null &&
      row.unitPrice !== null &&
      row.unitPrice.greaterThan(maxMenuPrice),
    itemCount: row.itemCount,
    recordedByName: row.recordedByName,
    notes: row.notes,
    voidedAt: row.voidedAt === null ? null : row.voidedAt.toISOString(),
    voidedAtLabel: row.voidedAt === null ? null : dateLabel(row.voidedAt),
    voidReason: row.voidReason,
  };
}

export type StaffMealQuotaView = {
  staffMemberName: string;
  quota: string | null;
  quotaSource: "PERSON" | "TENANT" | "NONE";
  used: string;
  /**
   * Meals today this shop cannot price. While this is non-zero, `used` is a
   * FLOOR and the screen must say so rather than printing "฿120 / ฿150" as if
   * the comparison were complete.
   */
  unpricedCount: number;
  over: boolean;
};

export function toStaffMealQuotaView(q: StaffMealQuotaStatus): StaffMealQuotaView {
  return {
    staffMemberName: q.staffMemberName,
    quota: q.quota === null ? null : q.quota.toString(),
    quotaSource: q.quotaSource,
    used: q.used.toString(),
    unpricedCount: q.unpricedCount,
    over: q.over,
  };
}
