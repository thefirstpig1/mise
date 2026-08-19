// ============================================================
// Mise — sales view serializers (Sprint 4 Part 19 L4)
// ============================================================
// Same rules as every other view file: Decimals cross as STRINGS (Pitfall #20 —
// a Prisma Decimal cannot cross into a Client Component), dates as ISO plus a
// Bangkok-rendered label computed here.
//
// One thing this file does that the others do not: it turns the import preview
// into the sentences the confirmation screen shows. Those sentences are the
// whole of Section D.4's protection — "no unannounced auto-creation" and rule
// P3's "a re-import replaces the day" are only kept if somebody read them — so
// they are built server-side, next to the numbers they describe, rather than
// assembled out of fragments in the browser.
// ============================================================

import type { Prisma } from "@prisma/client";
import type { ImportPreview, ReplacedDay, SalesRowError } from "@/server/sales-import";
import type {
  SalesAvailability,
  SalesByCategory,
  SalesByDay,
  SalesByMenu,
  SalesByWeekday,
  SalesDayRow,
  SalesSummary,
} from "@/server/sales";

const str = (d: Prisma.Decimal): string => d.toString();

const BANGKOK_DATE = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const BANGKOK_DATETIME = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * A `business_date` is a plain DATE stored as UTC midnight, so it must be
 * formatted in UTC. Running it through the Bangkok formatter would shift it back
 * seven hours and print the previous day — the bug rule P15 exists to keep out
 * of this codebase.
 */
const DAY_LABEL = new Intl.DateTimeFormat("th-TH", {
  timeZone: "UTC",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/** Sunday-first, matching `Date.getUTCDay()`. */
export const WEEKDAY_LABELS_TH = [
  "อาทิตย์",
  "จันทร์",
  "อังคาร",
  "พุธ",
  "พฤหัสบดี",
  "ศุกร์",
  "เสาร์",
] as const;

// ------------------------------------------------------------
// Sales figures
// ------------------------------------------------------------

export type SalesByDayView = {
  businessDate: string;
  dayLabel: string;
  weekdayLabel: string;
  net: string;
  qty: string;
};

export type SalesByWeekdayView = {
  weekday: number;
  weekdayLabel: string;
  net: string;
  qty: string;
  dayCount: number;
  /** Total ÷ number of that weekday in range. Three Mondays is not one Monday. */
  averageNet: string;
};

export type SalesByCategoryView = {
  menuCategoryId: string | null;
  name: string;
  net: string;
  qty: string;
  /** Share of the period's revenue, 0–100, one decimal. */
  sharePercent: string;
};

export type SalesByMenuView = {
  menuId: string;
  name: string;
  menuCategoryName: string | null;
  isPosStub: boolean;
  net: string;
  qty: string;
};

export type SalesAvailabilityView = SalesAvailability & {
  /**
   * What to print where a bill-level or time-level figure would go.
   *
   * Rule P11: a screen must say the file does not contain something, never show
   * a 0 that reads as "none were sold".
   */
  billNotice: string | null;
  timeNotice: string | null;
};

export type SalesSummaryView = {
  totals: {
    net: string;
    gross: string;
    discount: string;
    serviceCharge: string;
    vat: string;
    qty: string;
    rows: number;
    days: number;
    discountPercent: string;
  };
  byDay: SalesByDayView[];
  byWeekday: SalesByWeekdayView[];
  byCategory: SalesByCategoryView[];
  topMenus: SalesByMenuView[];
  availability: SalesAvailabilityView;
  unidentifiedMenuCount: number;
};

const NO_BILLS_NOTICE =
  "ไฟล์ที่นำเข้าเป็นสรุปรายวัน จึงไม่มีเลขบิล — ดูจำนวนบิลและยอดต่อบิลไม่ได้";
const NO_TIMES_NOTICE =
  "ไฟล์ที่นำเข้าไม่มีเวลาขาย — ดูช่วงเวลาที่ขายดีในวันไม่ได้";

const percent = (part: Prisma.Decimal, whole: Prisma.Decimal): string => {
  if (whole.isZero()) return "0.0";
  return part.dividedBy(whole).times(100).toFixed(1);
};

export function toSalesSummaryView(s: SalesSummary): SalesSummaryView {
  return {
    totals: {
      net: str(s.totals.net),
      gross: str(s.totals.gross),
      discount: str(s.totals.discount),
      serviceCharge: str(s.totals.serviceCharge),
      vat: str(s.totals.vat),
      qty: str(s.totals.qty),
      rows: s.totals.rows,
      days: s.totals.days,
      // Of the pre-discount total, which is what a shop means by "we discounted
      // 8% this month" — not of the money actually taken.
      discountPercent: percent(s.totals.discount, s.totals.gross),
    },
    byDay: s.byDay.map(toSalesByDayView),
    byWeekday: s.byWeekday.map(toSalesByWeekdayView),
    byCategory: s.byCategory.map((c) => toSalesByCategoryView(c, s.totals.net)),
    topMenus: s.topMenus.map(toSalesByMenuView),
    availability: {
      ...s.availability,
      billNotice: s.availability.hasBillIds ? null : NO_BILLS_NOTICE,
      timeNotice: s.availability.hasTimes ? null : NO_TIMES_NOTICE,
    },
    unidentifiedMenuCount: s.unidentifiedMenuCount,
  };
}

export function toSalesByDayView(d: SalesByDay): SalesByDayView {
  return {
    businessDate: d.businessDate.toISOString(),
    dayLabel: DAY_LABEL.format(d.businessDate),
    weekdayLabel: WEEKDAY_LABELS_TH[d.businessDate.getUTCDay()],
    net: str(d.net),
    qty: str(d.qty),
  };
}

export function toSalesByWeekdayView(w: SalesByWeekday): SalesByWeekdayView {
  return {
    weekday: w.weekday,
    weekdayLabel: WEEKDAY_LABELS_TH[w.weekday],
    net: str(w.net),
    qty: str(w.qty),
    dayCount: w.dayCount,
    averageNet: w.dayCount === 0 ? "0" : w.net.dividedBy(w.dayCount).toFixed(2),
  };
}

export function toSalesByCategoryView(
  c: SalesByCategory,
  total: Prisma.Decimal
): SalesByCategoryView {
  return {
    menuCategoryId: c.menuCategoryId,
    name: c.name,
    net: str(c.net),
    qty: str(c.qty),
    sharePercent: percent(c.net, total),
  };
}

export function toSalesByMenuView(m: SalesByMenu): SalesByMenuView {
  return {
    menuId: m.menuId,
    name: m.name,
    menuCategoryName: m.menuCategoryName,
    isPosStub: m.isPosStub,
    net: str(m.net),
    qty: str(m.qty),
  };
}

export type SalesDayRowView = {
  businessDate: string;
  dayLabel: string;
  weekdayLabel: string;
  net: string;
  rows: number;
  /** "จาก sales-2025-12.csv นำเข้า 3 ม.ค. 2569 14:02" — rule P3's provenance. */
  sourceLabel: string;
};

export function toSalesDayRowView(d: SalesDayRow): SalesDayRowView {
  return {
    businessDate: d.businessDate.toISOString(),
    dayLabel: DAY_LABEL.format(d.businessDate),
    weekdayLabel: WEEKDAY_LABELS_TH[d.businessDate.getUTCDay()],
    net: str(d.net),
    rows: d.rows,
    sourceLabel:
      d.fileName && d.importedAt
        ? `จาก ${d.fileName} · นำเข้า ${BANGKOK_DATETIME.format(d.importedAt)}`
        : "ยังไม่มีไฟล์ที่นำเข้า",
  };
}

// ------------------------------------------------------------
// The import preview
// ------------------------------------------------------------

export type ReplacedDayView = {
  businessDate: string;
  dayLabel: string;
  existingRows: number;
  existingNet: string;
  /** The full warning sentence, built here so nothing can drop half of it. */
  warning: string;
};

export type ImportPreviewView = {
  batchId: string;
  fileName: string;
  coveredFrom: string;
  coveredTo: string;
  coveredLabel: string;
  rowCount: number;
  blankRowsSkipped: number;
  totalNet: string;
  totalQty: string;
  replacedDays: ReplacedDayView[];
  newDayCount: number;
  newMenus: { key: string; label: string; suggestions: MenuSuggestionView[] }[];
  newCategories: string[];
  /** The counts the commit form echoes back, so a stale preview is refused. */
  acknowledgedReplacedDays: number;
  acknowledgedNewMenus: number;
  acknowledgedNewCategories: number;
  /** Non-null when the VAT / service-charge flags look wrong (rule P10). */
  consistencyWarning: string | null;
  blankRowNotice: string | null;
};

export type MenuSuggestionView = {
  id: string;
  name: string;
  /** ตรงกันมาก / ใกล้เคียง / อาจเกี่ยวข้อง — never the raw score (ADR 0010). */
  badge: string;
  isPosStub: boolean;
};

/** ADR 0010's three bands, reused so one fuzzy vocabulary exists, not two. */
export function similarityBadge(score: number): string {
  if (score > 0.7) return "ตรงกันมาก";
  if (score >= 0.5) return "ใกล้เคียง";
  return "อาจเกี่ยวข้อง";
}

export function toImportPreviewView(p: ImportPreview): ImportPreviewView {
  const replacedDays = p.replacedDays.map(toReplacedDayView);

  return {
    batchId: p.batchId,
    fileName: p.fileName,
    coveredFrom: p.coveredFrom.toISOString(),
    coveredTo: p.coveredTo.toISOString(),
    coveredLabel:
      p.coveredFrom.getTime() === p.coveredTo.getTime()
        ? DAY_LABEL.format(p.coveredFrom)
        : `${DAY_LABEL.format(p.coveredFrom)} – ${DAY_LABEL.format(p.coveredTo)}`,
    rowCount: p.rowCount,
    blankRowsSkipped: p.blankRowsSkipped,
    totalNet: str(p.totalNet),
    totalQty: str(p.totalQty),
    replacedDays,
    newDayCount: p.newDays.length,
    newMenus: p.newMenus.map((m) => {
      const key = `${m.code ?? ""} ${m.matchKey}`;
      return {
        key,
        label: m.rawName ?? m.code ?? "(ไม่มีชื่อ)",
        suggestions: (p.suggestions.get(key) ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          badge: similarityBadge(s.score),
          isPosStub: s.isPosStub,
        })),
      };
    }),
    newCategories: p.newCategories,
    acknowledgedReplacedDays: replacedDays.length,
    acknowledgedNewMenus: p.newMenus.length,
    acknowledgedNewCategories: p.newCategories.length,
    consistencyWarning:
      p.inconsistentRows > 0
        ? `พบ ${p.inconsistentRows.toLocaleString("th-TH")} แถวที่ ยอดก่อนหัก − ส่วนลด ไม่เท่ากับ ยอดสุทธิ ` +
          `(ต่างมากสุด ${p.largestConsistencyDelta.toFixed(2)} บาท) — ` +
          "มักเกิดจากตั้งค่า “ตัวเลขรวม VAT / Service charge แล้วหรือยัง” ไม่ตรงกับไฟล์"
        : null,
    blankRowNotice:
      p.blankRowsSkipped > 0
        ? `ข้ามแถวว่าง ${p.blankRowsSkipped.toLocaleString("th-TH")} แถว`
        : null,
  };
}

export function toReplacedDayView(d: ReplacedDay): ReplacedDayView {
  const label = DAY_LABEL.format(d.businessDate);
  const from = d.currentFileName ? ` (จาก ${d.currentFileName})` : "";
  return {
    businessDate: d.businessDate.toISOString(),
    dayLabel: label,
    existingRows: d.existingRows,
    existingNet: str(d.existingNet),
    warning:
      `${label} มีข้อมูลอยู่แล้ว ${d.existingRows.toLocaleString("th-TH")} รายการ ` +
      `รวม ${d.existingNet.toFixed(2)} บาท${from} — จะถูกแทนที่ทั้งวัน`,
  };
}

// ------------------------------------------------------------
// Rejections
// ------------------------------------------------------------

export type SalesRowErrorView = {
  rowNumber: number;
  field: string | null;
  message: string;
  /** "แถวที่ 42 · คอลัมน์จำนวน" — where to look, before what is wrong. */
  locationLabel: string;
};

export function toSalesRowErrorView(e: SalesRowError): SalesRowErrorView {
  return {
    rowNumber: e.rowNumber,
    field: e.field,
    message: e.message,
    locationLabel: e.field ? `แถวที่ ${e.rowNumber} · ${e.field}` : `แถวที่ ${e.rowNumber}`,
  };
}

export { BANGKOK_DATE, BANGKOK_DATETIME, DAY_LABEL };
