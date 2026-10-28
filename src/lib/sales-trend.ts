// ============================================================
// Mise — sales by MONTH, and "did the promotion work" (Kong, 2026-10-28)
// ============================================================
// Kong: "ในหน้ายอดขายเราไม่รู้ trend ของแต่ละหมวดหมู่หรือแต่ละเมนู … เดือนนี้ทำ
// โปรเมนูคู่รักก็ไม่รู้ว่าจริงๆ แล้วเมนูที่ทำโปรขายดีขึ้นหรือเปล่า (เทียบกันรายเดือน)".
//
// Pure arithmetic over the same menu × branch × day rows every /sales view
// reads (getSalesMenuDaysLogic — already FOLDED for merged menus), so a month
// here can never disagree with the same month on the rest of the page.
//
// Rules (docs/calculation-rules.md TR1–TR5):
//  - TR1 Every month is compared PER DAY WITH DATA (rule SI2): August had 19
//    days of files and September 26 — totals would call that growth.
//  - TR2 A month with no data is a GAP (null), never ฿0.
//  - TR3 Profit = net − plates × recipe cost, ONE cost map priced at the end
//    of the range, the same rule as the rest of /sales. A menu with no recipe
//    adds nothing to profit and its sales are reported as `unknownNet`.
//  - TR4 "ราคาลด" marks a month whose average price per plate is more than 5%
//    under that menu's usual (median) price in the range — a discount or a
//    promotion, read from the money, since no promotion is recorded anywhere.
//  - TR5 The promotion check compares per day: before / during / after, the
//    menu itself, the OTHER menus of its category, and the category's profit.
// ============================================================

import { costKey, type CostMap, type MenuDayRow, type MenuMeta } from "./sales-insight";

export type MonthKey = string; // "2026-09"

export type Point = {
  /** Days with any sale in the month (across the rows given). 0 = a gap. */
  days: number;
  net: number;
  qty: number;
  /** Known profit only. null when no sold menu had a recipe. */
  profit: number | null;
  /** Sales of menus with no recipe — what the profit figure could not see. */
  unknownNet: number;
};

export type TrendSeries = { key: string; label: string; points: Point[] };
export type MenuTrend = TrendSeries & { categoryKey: string };

export type SalesTrend = {
  months: { key: MonthKey; label: string; days: number }[];
  total: Point[];
  categories: TrendSeries[];
  menus: MenuTrend[];
};

export const TREND_DISCOUNT_BAND = 5; // TR4, percent

const empty = (): Point => ({ days: 0, net: 0, qty: 0, profit: null, unknownNet: 0 });

/** "2026-09" → "ก.ย. 69". */
export function monthLabelTh(key: MonthKey): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("th-TH", { month: "short", year: "2-digit", timeZone: "UTC" });
}

/** Every month from `from` to `to` inclusive ("2026-04", "2026-09"). */
export function monthsBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** `n` months ending at `end`, oldest first. */
export function lastMonths(end: MonthKey, n: number): MonthKey[] {
  const [y, m] = end.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - n, 1));
  return monthsBetween(`${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`, end);
}

/** First and last calendar day of a month range, as ISO dates. */
export function monthRangeDates(from: MonthKey, to: MonthKey): { from: string; to: string } {
  const [ty, tm] = to.split("-").map(Number);
  return { from: `${from}-01`, to: new Date(Date.UTC(ty, tm, 0)).toISOString().slice(0, 10) };
}

export function salesTrend(rows: readonly MenuDayRow[], menus: Map<string, MenuMeta>, costs: CostMap, months: MonthKey[]): SalesTrend {
  const at = new Map(months.map((k, i) => [k, i]));
  const daysIn = months.map(() => new Set<string>());
  const total = months.map(empty);
  const cats = new Map<string, Point[]>();
  const byMenu = new Map<string, Point[]>();

  const add = (p: Point, r: MenuDayRow) => {
    p.net += r.net;
    p.qty += r.qty;
    const c = costs.get(costKey(r.branchId, r.menuId));
    if (c) p.profit = (p.profit ?? 0) + r.net - r.qty * c.cost;
    else p.unknownNet += r.net;
  };

  for (const r of rows) {
    const i = at.get(r.day.slice(0, 7));
    if (i === undefined) continue;
    daysIn[i].add(r.day);
    const meta = menus.get(r.menuId);
    const catKey = meta?.categoryKey ?? "none";
    add(total[i], r);
    const c = cats.get(catKey) ?? months.map(empty);
    add(c[i], r);
    cats.set(catKey, c);
    const m = byMenu.get(r.menuId) ?? months.map(empty);
    add(m[i], r);
    byMenu.set(r.menuId, m);
  }

  // A month's per-day divisor is the days the WHOLE selection had data (SI2),
  // so a dish that sold on 3 of 26 days reads as 3/26 of a day's worth.
  const withDays = (ps: Point[]) => ps.map((p, i) => ({ ...p, days: daysIn[i].size }));
  const catLabel = (key: string) => [...menus.values()].find((m) => m.categoryKey === key)?.categoryName ?? "ยังไม่ระบุหมวด";
  const sum = (ps: Point[]) => ps.reduce((t, p) => t + p.net, 0);

  return {
    months: months.map((key, i) => ({ key, label: monthLabelTh(key), days: daysIn[i].size })),
    total: withDays(total),
    categories: [...cats.entries()]
      .map(([key, ps]) => ({ key, label: catLabel(key), points: withDays(ps) }))
      .sort((a, b) => sum(b.points) - sum(a.points)),
    menus: [...byMenu.entries()]
      .map(([id, ps]) => {
        const meta = menus.get(id);
        return { key: id, label: meta?.name ?? "เมนูที่ไม่รู้จัก", categoryKey: meta?.categoryKey ?? "none", points: withDays(ps) };
      })
      .sort((a, b) => sum(b.points) - sum(a.points)),
  };
}

export type TrendMetric = "net" | "qty" | "profit";

/** Per day with data (TR1). null = a gap, or profit nobody can know (TR2/TR3). */
export function perDay(p: Point, metric: TrendMetric): number | null {
  if (p.days === 0) return null;
  const v = metric === "net" ? p.net : metric === "qty" ? p.qty : p.profit;
  return v === null ? null : v / p.days;
}

/** % change between two values, null when either side is missing or zero. */
export function changePct(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

/** TR4 — indexes of months sold more than 5% under the menu's usual price. */
export function discountedMonths(points: readonly Point[]): number[] {
  const prices = points.map((p) => (p.qty > 0 ? p.net / p.qty : null));
  const known = prices.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (known.length < 2) return [];
  const mid = Math.floor(known.length / 2);
  const usual = known.length % 2 ? known[mid] : (known[mid - 1] + known[mid]) / 2;
  return prices.flatMap((v, i) => (v !== null && v < usual * (1 - TREND_DISCOUNT_BAND / 100) ? [i] : []));
}

// ------------------------------------------------------------
// TR5 — did the promotion work
// ------------------------------------------------------------

export type PromoSide = {
  from: string;
  to: string;
  days: number;
  /** All per day with data. */
  menuQty: number;
  menuNet: number;
  otherQty: number;
  categoryQty: number;
  /** null without cost access, or with no recipe anywhere in the category. */
  categoryProfit: number | null;
};

export type PromoVerdict = "worked" | "moved" | "profit_down" | "no_lift" | "not_enough";

export type PromoCheck = { before: PromoSide; during: PromoSide; after: PromoSide | null; verdict: PromoVerdict };

/** Fewer days than this on a side and the check refuses to judge. */
export const PROMO_MIN_DAYS = { before: 7, during: 3 } as const;
/** The menu must sell at least this much more per day to count as a lift. */
export const PROMO_LIFT_PCT = 5;
/** Other menus losing at least this share of the menu's gain = "moved". */
export const PROMO_MOVED_SHARE = 0.6;

export function promoSide(
  rows: readonly MenuDayRow[],
  menuId: string,
  categoryMenuIds: ReadonlySet<string>,
  costs: CostMap | null,
  from: string,
  to: string
): PromoSide {
  const days = new Set<string>();
  let menuQty = 0;
  let menuNet = 0;
  let catQty = 0;
  let profit: number | null = null;
  for (const r of rows) {
    if (r.day < from || r.day > to) continue;
    days.add(r.day);
    if (!categoryMenuIds.has(r.menuId)) continue;
    catQty += r.qty;
    if (r.menuId === menuId) {
      menuQty += r.qty;
      menuNet += r.net;
    }
    const c = costs?.get(costKey(r.branchId, r.menuId));
    if (c) profit = (profit ?? 0) + r.net - r.qty * c.cost;
  }
  const n = days.size;
  const per = (v: number) => (n ? v / n : 0);
  return {
    from,
    to,
    days: n,
    menuQty: per(menuQty),
    menuNet: per(menuNet),
    otherQty: per(catQty - menuQty),
    categoryQty: per(catQty),
    categoryProfit: profit === null || n === 0 ? null : profit / n,
  };
}

export function promoVerdict(before: PromoSide, during: PromoSide): PromoVerdict {
  if (before.days < PROMO_MIN_DAYS.before || during.days < PROMO_MIN_DAYS.during) return "not_enough";
  const gain = during.menuQty - before.menuQty;
  const lift = changePct(during.menuQty, before.menuQty);
  if (gain <= 0 || (lift !== null && lift < PROMO_LIFT_PCT)) return "no_lift";
  if (before.categoryProfit !== null && during.categoryProfit !== null && during.categoryProfit < before.categoryProfit) return "profit_down";
  const lost = before.otherQty - during.otherQty;
  if (lost >= gain * PROMO_MOVED_SHARE) return "moved";
  return "worked";
}

/** The day before an ISO date, and `n` days before/after helpers. */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The comparison windows for a promotion from `from` to `to`:
 * before = the 3 calendar months (or 1) ending the day before it starts;
 * after = as many days as the promotion ran, starting the day after it ends.
 */
export function promoWindows(from: string, to: string, base: "3m" | "1m") {
  const start = new Date(`${from}T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - (base === "3m" ? 3 : 1));
  const length = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  return {
    before: { from: start.toISOString().slice(0, 10), to: addDays(from, -1) },
    during: { from, to },
    after: { from: addDays(to, 1), to: addDays(to, 1 + length) },
  };
}
