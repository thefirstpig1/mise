// ============================================================
// Mise — consumption serializers (Part 22 L4b, ADR 0022)
// ============================================================
// Decimal → string and Date → ISO + a Bangkok label, so a Client Component can
// render a day without a Prisma type crossing the boundary (Pitfall #20).
//
// The Thai vocabulary itself lives in `validations/consumption.ts`, not here:
// the server names a reason and the browser renders it, and neither should be
// the only place the words exist.
// ============================================================

import type { Prisma } from "@prisma/client";
import type {
  ConsumptionDayStatus,
  ConsumptionSkipRecord,
} from "@/server/consumption-read";
import type { ConsumptionSkipReason } from "@/lib/validations/consumption";

const BANGKOK_DATE = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const BANGKOK_STAMP = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export type ConsumptionSkipView = {
  menuId: string;
  menuName: string;
  qty: string;
  netAmount: string;
  reason: ConsumptionSkipReason;
  detail: string | null;
};

export type ConsumptionDayView = {
  branchId: string;
  businessDate: string;
  businessDateLabel: string;
  netAmount: string;
  lineCount: number;

  runId: string | null;
  postedAtLabel: string | null;
  coveredNetAmount: string | null;
  menusPosted: number | null;
  menusSkipped: number | null;
  skipped: ConsumptionSkipView[];

  withinWindow: boolean;
  recipeChangedSincePosting: boolean;

  /**
   * Share of the day's revenue that posted, 0–100, or null when there is no
   * revenue to be a share of — a day that took nothing has no coverage, which
   * reads differently from 0% coverage (rule N3).
   */
  coveragePercent: number | null;
  /** Posted, posted-but-stale, partly posted, or not posted at all. */
  state: ConsumptionDayState;
};

export type ConsumptionDayState =
  | "NOT_POSTED"
  | "OUT_OF_WINDOW"
  | "POSTED"
  | "POSTED_PARTIAL"
  | "POSTED_STALE";

export const CONSUMPTION_DAY_STATE_LABELS_TH: Record<
  ConsumptionDayState,
  string
> = {
  NOT_POSTED: "ยังไม่ได้ตัดสต๊อก",
  OUT_OF_WINDOW: "เกินหน้าต่างย้อนหลัง ตัดไม่ได้",
  POSTED: "ตัดสต๊อกแล้ว",
  POSTED_PARTIAL: "ตัดแล้วบางส่วน",
  POSTED_STALE: "ตัดแล้ว แต่สูตรเปลี่ยนหลังจากนั้น",
};

export const CONSUMPTION_DAY_STATE_HINTS_TH: Record<
  ConsumptionDayState,
  string
> = {
  NOT_POSTED: "ยอดขายวันนี้ยังไม่ถูกนับเป็นต้นทุน",
  OUT_OF_WINDOW:
    "ยอดขายยังดูได้ตามปกติ แต่บัญชีสต๊อกย้อนกลับไปแก้วันนี้ไม่ได้แล้ว",
  POSTED: "วัตถุดิบของทุกเมนูที่ขายวันนี้ถูกตัดออกจากสต๊อกแล้ว",
  POSTED_PARTIAL: "บางเมนูตัดไม่ได้ — ดูเหตุผลรายตัวแล้วแก้ที่ต้นเหตุ",
  POSTED_STALE:
    "มีสูตรที่มีผลกับวันนี้ถูกเขียนหรือแก้หลังจากตัดไปแล้ว — กดตัดใหม่เพื่อให้ตรงกับสูตรปัจจุบัน",
};

const pct = (part: Prisma.Decimal | null, whole: Prisma.Decimal): number | null => {
  if (part === null || whole.isZero()) return null;
  return Number(part.div(whole).mul(100).toFixed(1));
};

/**
 * Which of five things this day is.
 *
 * Order matters. A day out of the window can never post, so it is not "not
 * posted yet" — offering a button that cannot work is worse than saying why.
 * And a stale posting outranks a partial one: both want the same press, but
 * "the recipe changed" is the reason a shop would not otherwise guess.
 */
function stateOf(row: ConsumptionDayStatus): ConsumptionDayState {
  if (row.runId === null) {
    return row.withinWindow ? "NOT_POSTED" : "OUT_OF_WINDOW";
  }
  if (row.recipeChangedSincePosting) return "POSTED_STALE";
  return (row.menusSkipped ?? 0) > 0 ? "POSTED_PARTIAL" : "POSTED";
}

export const toConsumptionDayView = (
  row: ConsumptionDayStatus
): ConsumptionDayView => ({
  branchId: row.branchId,
  businessDate: row.businessDate.toISOString().slice(0, 10),
  businessDateLabel: BANGKOK_DATE.format(row.businessDate),
  netAmount: row.netAmount.toString(),
  lineCount: row.lineCount,
  runId: row.runId,
  postedAtLabel: row.postedAt ? BANGKOK_STAMP.format(row.postedAt) : null,
  coveredNetAmount: row.coveredNetAmount?.toString() ?? null,
  menusPosted: row.menusPosted,
  menusSkipped: row.menusSkipped,
  skipped: row.skipped.map(toConsumptionSkipView),
  withinWindow: row.withinWindow,
  recipeChangedSincePosting: row.recipeChangedSincePosting,
  coveragePercent: pct(row.coveredNetAmount, row.netAmount),
  state: stateOf(row),
});

export const toConsumptionSkipView = (
  s: ConsumptionSkipRecord
): ConsumptionSkipView => ({
  menuId: s.menuId,
  menuName: s.menuName,
  qty: s.qty,
  netAmount: s.netAmount,
  reason: s.reason,
  detail: s.detail,
});

/** One day a press is about to replace, for the confirmation that names them. */
export type PostedDaySummaryView = {
  businessDate: string;
  businessDateLabel: string;
  postedAtLabel: string;
  coveredNetAmount: string;
  totalNetAmount: string;
};

export const toPostedDaySummaryView = (row: {
  businessDate: Date;
  postedAt: Date;
  coveredNetAmount: Prisma.Decimal;
  totalNetAmount: Prisma.Decimal;
}): PostedDaySummaryView => ({
  businessDate: row.businessDate.toISOString().slice(0, 10),
  businessDateLabel: BANGKOK_DATE.format(row.businessDate),
  postedAtLabel: BANGKOK_STAMP.format(row.postedAt),
  coveredNetAmount: row.coveredNetAmount.toString(),
  totalNetAmount: row.totalNetAmount.toString(),
});

/** What one day's posting achieved, for the result panel. */
export type PostedDayResultView = {
  businessDate: string;
  businessDateLabel: string;
  menusPosted: number;
  menusSkipped: number;
  coveredNetAmount: string;
  totalNetAmount: string;
  coveragePercent: number | null;
  /** Whether this press took an earlier posting back first (Q2b). */
  replaced: boolean;
  skipped: ConsumptionSkipView[];
};
