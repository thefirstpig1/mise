// ============================================================
// คิดครัว — why นับสต๊อก cannot name a gross profit yet (rules PG1, PG2)
// ============================================================
// Kong 2026-10-30, after setting up a shop from scratch: the dashboard read
// "กำไรสุทธิ 100% ของยอดขาย" for a shop that had never recorded a purchase.
// stock-cost.ts now withholds the figure; this is the sentence that goes with
// the null, shared so /cost and the dashboard say the same thing.
// Plain module on purpose — server pages import it (no "use client" here).
// ============================================================

/**
 * Rule PG2: a count measures a period's end only if it falls within this many
 * days before the boundary day — the same 7 days the month-end page asks for.
 */
export const COUNT_WINDOW_DAYS = 7;

const DAY_MS = 86_400_000;

/**
 * Rule PG2's two windows for a period given as instants (`gte` = its first
 * Bangkok day's start, `lt` = the end of its last day). Each spans the
 * boundary day and the COUNT_WINDOW_DAYS before it — for the opening, the
 * day before the period began (the instant the opening replay cuts at), for
 * the close its last day, or today while it runs — so the count that closes
 * one month also opens the next. A closing count before the period began
 * measures none of it.
 */
export function countWindows(bounds: { gte: Date; lt: Date }, todayEnd: Date) {
  const span = (COUNT_WINDOW_DAYS + 1) * DAY_MS;
  const closeEnd = Math.min(bounds.lt.getTime(), todayEnd.getTime());
  return {
    opening: { gte: new Date(bounds.gte.getTime() - span), lt: bounds.gte },
    closing: { gte: new Date(Math.max(bounds.gte.getTime(), closeEnd - span)), lt: new Date(closeEnd) },
  };
}

export type GrossProfitBlocker =
  /** No closed count within COUNT_WINDOW_DAYS before the period began. */
  | { kind: "NO_OPENING_COUNT" }
  /** No closed count within COUNT_WINDOW_DAYS before the period's last day (today, while it runs). */
  | { kind: "NO_CLOSING_COUNT" }
  /** Stock at the opening or the close holds layers nobody has priced. */
  | { kind: "UNPRICED_STOCK"; products: number };

/** The full sentence, for the line under the figure on /cost. */
export function grossProfitBlockerNote(b: GrossProfitBlocker): string {
  switch (b.kind) {
    case "NO_OPENING_COUNT":
      return `ยังไม่ได้นับสต๊อกต้นงวด — วิธีนับสต๊อกต้องนับภายใน ${COUNT_WINDOW_DAYS} วันก่อนวันแรกของช่วงที่ดู จึงจะรู้ว่าต้นงวดมีของเท่าไร · แนะนำนับคืนสุดท้ายของเดือนหลังปิดร้าน`;
    case "NO_CLOSING_COUNT":
      return `ยังไม่ได้นับสต๊อกปิดงวด — วิธีนับสต๊อกต้องนับภายใน ${COUNT_WINDOW_DAYS} วันก่อนวันสุดท้ายของช่วงที่ดู จึงจะรู้ว่าใช้ของไปเท่าไร ระหว่างเดือนจึงยังคิดกำไรขั้นต้นไม่ได้ · นับปิดเดือนคืนสุดท้ายของเดือนแล้วตัวเลขจะขึ้น`;
    case "UNPRICED_STOCK":
      return `ของในสต๊อก ${b.products.toLocaleString("th-TH")} รายการยังไม่มีราคา — มูลค่าสต๊อกจึงต่ำกว่าจริงและกำไรจะดูดีเกินจริง ใส่ราคาทุนของรายการเหล่านั้นก่อน`;
  }
}

/** A few words, for a card that names several branches. */
export function grossProfitBlockerShort(b: GrossProfitBlocker): string {
  switch (b.kind) {
    case "NO_OPENING_COUNT":
      return "ยังไม่ได้นับสต๊อกต้นงวด";
    case "NO_CLOSING_COUNT":
      return "ยังไม่ได้นับสต๊อกปิดงวด";
    case "UNPRICED_STOCK":
      return `ของ ${b.products.toLocaleString("th-TH")} รายการยังไม่มีราคา`;
  }
}

/** Was the figure withheld for want of a count (not of a price)? */
export const isCountBlocker = (b: GrossProfitBlocker | null): boolean =>
  b?.kind === "NO_OPENING_COUNT" || b?.kind === "NO_CLOSING_COUNT";

/**
 * Rule PG3 (Kong 2026-10-30): materials recorded at under half the shop's own
 * food-cost target, as a share of sales, almost always means purchases went
 * unrecorded — cash at the market most of all — and the food cost reads too
 * good. A warning only; the figure stays. Judged only on a stretch long enough
 * for buying to even out (7 days with sales, not a single week's view).
 */
export function purchasesLookLow(p: { purchases: number; revenue: number | null; salesDays: number; foodTargetPct: number }): boolean {
  return p.revenue !== null && p.revenue > 0 && p.salesDays >= 7 && p.purchases < (p.revenue * p.foodTargetPct) / 200;
}
