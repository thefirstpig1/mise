// ============================================================
// Mise — what the sales page can ANSWER (Kong, 2026-09-28)
// ============================================================
// Kong's four questions, none of which the page could answer:
//   1. On an average Saturday, what share is ต้ม ยำ ส้มตำ — more or less than
//      drinks, than beer?                          → categoryByWeekday
//   2. This month against last — did people come, did they drink more, on
//      weekdays?                                   → periodStats (per DAY)
//   3. Saturday the 29th against Saturday the 15th → periodStats, two sides
//   4. Which dishes carry the shop, which are rising, which to watch?
//                                                  → menuMovers
//
// Pure arithmetic over one shape of row (menu × branch × day), no database,
// so every rule here is pinned by a test instead of by a screenshot.
//
// THE RULE THAT MATTERS MOST — compare per DAY, never in totals. August had
// 19 days of data and September 26; set side by side in totals, August looks
// a third smaller when per day it was the better month. Every comparison here
// divides by the number of days that actually have data (calculation rule
// SI1).
//
// Three measures, switchable everywhere (Kong: "บางอย่างถึงยอดขายจะต่ำเตี้ย แต่
// มันก็คือของที่ลูกค้ากินประจำ"):
//   net    — after discount, excl VAT and service charge (Part 19)
//   qty    — dishes sold
//   profit — net − qty × cost per serving from the RECIPE (rule SI2). A menu
//            with no recipe has no profit: null, never 0, and every total
//            says how much revenue it could not account for.
// ============================================================

export type Metric = "net" | "qty" | "profit";
export const METRICS: Metric[] = ["net", "qty", "profit"];
export const METRIC_LABELS_TH: Record<Metric, string> = { net: "ยอดขาย", qty: "จำนวนจาน", profit: "กำไร" };

// The formatters live HERE, not beside the popups: those are "use client"
// modules, and a Server Component calling a function from one gets a client
// reference instead of the function ("Attempted to call fmtMetric() from the
// server") — the same trap the dashboard's SERIES fell into.
export const baht = (v: number) => `฿${v.toLocaleString("th-TH", { maximumFractionDigits: 0 })}`;
/** A figure in the page's measure; null is profit with no recipe behind it. */
export const fmtMetric = (by: Metric, v: number | null) =>
  v === null ? "ไม่มีสูตร" : by === "qty" ? `${v.toLocaleString("th-TH", { maximumFractionDigits: 1 })} จาน` : baht(v);

/** One menu at one branch on one day, as the database groups it. */
export type MenuDayRow = { day: string; branchId: string; menuId: string; net: number; qty: number };

export type MenuMeta = {
  id: string;
  name: string;
  categoryKey: string;
  categoryName: string;
  isPosStub: boolean;
};

/** Cost per serving from the recipe, keyed `${branchId}:${menuId}`. */
export type CostMap = Map<string, { cost: number; confidence: string; recipeId?: string | null }>;
export const costKey = (branchId: string, menuId: string) => `${branchId}:${menuId}`;

/** A row with everything a view needs. `profit` null = no recipe to cost it. */
export type Enriched = MenuDayRow & { weekday: number; categoryKey: string; profit: number | null };

export const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

export function enrich(rows: MenuDayRow[], menus: Map<string, MenuMeta>, costs: CostMap): Enriched[] {
  return rows.map((r) => {
    const c = costs.get(costKey(r.branchId, r.menuId));
    return {
      ...r,
      weekday: weekdayOf(r.day),
      categoryKey: menus.get(r.menuId)?.categoryKey ?? "none",
      profit: c ? r.net - r.qty * c.cost : null,
    };
  });
}

/** The value of a row in the chosen measure; null only for profit without a recipe. */
export const valueOf = (r: Pick<Enriched, "net" | "qty" | "profit">, by: Metric): number | null =>
  by === "net" ? r.net : by === "qty" ? r.qty : r.profit;

/** A running total that remembers what it could not count. */
export type Acc = { value: number; net: number; qty: number; unknownNet: number };
const emptyAcc = (): Acc => ({ value: 0, net: 0, qty: 0, unknownNet: 0 });
function add(acc: Acc, r: Enriched, by: Metric) {
  const v = valueOf(r, by);
  acc.net += r.net;
  acc.qty += r.qty;
  if (v === null) acc.unknownNet += r.net;
  else acc.value += v;
}

export const dayCount = (rows: { day: string }[]) => new Set(rows.map((r) => r.day)).size;

// ------------------------------------------------------------
// Question 1 — category × day of week
// ------------------------------------------------------------
export type WeekdayCell = { perDay: number; share: number | null; days: number };
export type CategoryWeekday = {
  /** Monday first, the way a shop's week runs. */
  weekdays: number[];
  /** How many real dates of each weekday are in the data. */
  daysPerWeekday: Record<number, number>;
  categories: { key: string; label: string; cells: Record<number, WeekdayCell> }[];
};

export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * For every category and weekday: the average per such day (a total over
 * three Saturdays is divided by three — rule SI1) and its share of that
 * weekday's total. Share is null when the weekday totalled nothing.
 */
export function categoryByWeekday(
  rows: Enriched[],
  menus: Map<string, MenuMeta>,
  by: Metric
): CategoryWeekday {
  const daysPer: Record<number, Set<string>> = {};
  const total: Record<number, number> = {};
  const cell = new Map<string, Acc>();
  const labels = new Map<string, string>();
  for (const r of rows) {
    (daysPer[r.weekday] ??= new Set()).add(r.day);
    const v = valueOf(r, by);
    if (v !== null) total[r.weekday] = (total[r.weekday] ?? 0) + v;
    const k = `${r.categoryKey}|${r.weekday}`;
    const acc = cell.get(k) ?? emptyAcc();
    add(acc, r, by);
    cell.set(k, acc);
    if (!labels.has(r.categoryKey)) labels.set(r.categoryKey, menus.get(r.menuId)?.categoryName ?? "ยังไม่ระบุหมวด");
  }
  const daysPerWeekday = Object.fromEntries(WEEK_ORDER.map((w) => [w, daysPer[w]?.size ?? 0]));
  const catTotals = new Map<string, number>();
  for (const [k, acc] of cell) {
    const key = k.split("|")[0];
    catTotals.set(key, (catTotals.get(key) ?? 0) + acc.value);
  }
  const categories = [...labels.entries()]
    .sort((a, b) => (catTotals.get(b[0]) ?? 0) - (catTotals.get(a[0]) ?? 0))
    .map(([key, label]) => ({
      key,
      label,
      cells: Object.fromEntries(
        WEEK_ORDER.map((w) => {
          const acc = cell.get(`${key}|${w}`);
          const days = daysPerWeekday[w];
          const value = acc?.value ?? 0;
          return [
            w,
            {
              perDay: days ? value / days : 0,
              share: total[w] ? (value / total[w]) * 100 : null,
              days,
            },
          ];
        })
      ),
    }));
  return { weekdays: WEEK_ORDER, daysPerWeekday, categories };
}

/** The menus of one category on one weekday, averaged per such day. */
export function menusOnWeekday(
  rows: Enriched[],
  menus: Map<string, MenuMeta>,
  by: Metric,
  categoryKey: string,
  weekday: number
): { id: string; name: string; perDay: number; qtyPerDay: number }[] {
  const pick = rows.filter((r) => r.weekday === weekday && r.categoryKey === categoryKey);
  const days = dayCount(rows.filter((r) => r.weekday === weekday));
  const acc = new Map<string, Acc>();
  for (const r of pick) {
    const a = acc.get(r.menuId) ?? emptyAcc();
    add(a, r, by);
    acc.set(r.menuId, a);
  }
  return [...acc.entries()]
    .map(([id, a]) => ({
      id,
      name: menus.get(id)?.name ?? "(ไม่พบเมนู)",
      perDay: days ? a.value / days : 0,
      qtyPerDay: days ? a.qty / days : 0,
    }))
    .sort((a, b) => b.perDay - a.perDay);
}

// ------------------------------------------------------------
// Questions 2 and 3 — a period, per day
// ------------------------------------------------------------
export type PeriodStats = {
  days: number;
  perDay: { net: number; qty: number; profit: number | null; value: number | null };
  /** Revenue whose profit could not be worked out (no recipe), per day. */
  unknownNetPerDay: number;
  categories: { key: string; label: string; perDay: number; share: number | null; qtyPerDay: number }[];
  menus: { id: string; name: string; categoryKey: string; perDay: number; qtyPerDay: number; share: number | null }[];
};

export function periodStats(rows: Enriched[], menus: Map<string, MenuMeta>, by: Metric): PeriodStats {
  const days = dayCount(rows);
  const all = emptyAcc();
  const profitAcc = emptyAcc();
  const cats = new Map<string, Acc>();
  const byMenu = new Map<string, Acc>();
  for (const r of rows) {
    add(all, r, by);
    add(profitAcc, r, "profit");
    const c = cats.get(r.categoryKey) ?? emptyAcc();
    add(c, r, by);
    cats.set(r.categoryKey, c);
    const m = byMenu.get(r.menuId) ?? emptyAcc();
    add(m, r, by);
    byMenu.set(r.menuId, m);
  }
  const per = (n: number) => (days ? n / days : 0);
  const share = (n: number) => (all.value ? (n / all.value) * 100 : null);
  const anyProfit = rows.some((r) => r.profit !== null);
  return {
    days,
    perDay: {
      net: per(all.net),
      qty: per(all.qty),
      profit: anyProfit ? per(profitAcc.value) : null,
      value: by === "profit" && !anyProfit ? null : per(all.value),
    },
    unknownNetPerDay: per(profitAcc.unknownNet),
    categories: [...cats.entries()]
      .map(([key, a]) => {
        const anyMenu = rows.find((r) => r.categoryKey === key);
        return {
          key,
          label: anyMenu ? menus.get(anyMenu.menuId)?.categoryName ?? "ยังไม่ระบุหมวด" : "ยังไม่ระบุหมวด",
          perDay: per(a.value),
          share: share(a.value),
          qtyPerDay: per(a.qty),
        };
      })
      .sort((a, b) => b.perDay - a.perDay),
    menus: [...byMenu.entries()]
      .map(([id, a]) => ({
        id,
        name: menus.get(id)?.name ?? "(ไม่พบเมนู)",
        categoryKey: menus.get(id)?.categoryKey ?? "none",
        perDay: per(a.value),
        qtyPerDay: per(a.qty),
        share: share(a.value),
      }))
      .sort((a, b) => b.perDay - a.perDay),
  };
}

// ------------------------------------------------------------
// Question 4 — which dishes carry the shop, rise, or need watching
// ------------------------------------------------------------
/**
 * A dish must sell at least this many plates a day, in BOTH periods, to be
 * called rising or falling. Without it, 1 plate → 2 plates is "+100%" and tops
 * the list over a dish that went from 40 to 48 (rule SI3). ★ A starting value.
 */
export const MOVER_MIN_QTY_PER_DAY = 1;

export type Mover = {
  id: string;
  name: string;
  categoryKey: string;
  perDay: number;
  prevPerDay: number | null;
  qtyPerDay: number;
  /** % change per day against the previous period; null when it did not sell then. */
  change: number | null;
};

export type Movers = { stars: Mover[]; rising: Mover[]; watch: Mover[]; gone: Mover[] };

export function menuMovers(
  cur: Enriched[],
  prev: Enriched[],
  menus: Map<string, MenuMeta>,
  by: Metric,
  limit = 5
): Movers {
  const a = periodStats(cur, menus, by);
  const b = periodStats(prev, menus, by);
  const prevById = new Map(b.menus.map((m) => [m.id, m]));
  const list: Mover[] = a.menus
    .filter((m) => by !== "profit" || cur.some((r) => r.menuId === m.id && r.profit !== null))
    .map((m) => {
      const p = prevById.get(m.id);
      return {
        id: m.id,
        name: m.name,
        categoryKey: m.categoryKey,
        perDay: m.perDay,
        prevPerDay: p ? p.perDay : null,
        qtyPerDay: m.qtyPerDay,
        change: p && p.perDay > 0 ? ((m.perDay - p.perDay) / p.perDay) * 100 : null,
      };
    });
  const steady = list.filter(
    (m) =>
      m.change !== null &&
      m.qtyPerDay >= MOVER_MIN_QTY_PER_DAY &&
      (prevById.get(m.id)?.qtyPerDay ?? 0) >= MOVER_MIN_QTY_PER_DAY
  );
  const selling = new Set(a.menus.map((m) => m.id));
  return {
    stars: list.slice(0, limit),
    rising: steady.filter((m) => (m.change ?? 0) > 0).sort((x, y) => (y.change ?? 0) - (x.change ?? 0)).slice(0, limit),
    watch: steady.filter((m) => (m.change ?? 0) < 0).sort((x, y) => (x.change ?? 0) - (y.change ?? 0)).slice(0, limit),
    // Sold last period, nothing this period — the loudest warning there is.
    gone: b.menus
      .filter((m) => !selling.has(m.id) && m.qtyPerDay >= MOVER_MIN_QTY_PER_DAY)
      .map((m) => ({ id: m.id, name: m.name, categoryKey: m.categoryKey, perDay: 0, prevPerDay: m.perDay, qtyPerDay: 0, change: -100 }))
      .slice(0, limit),
  };
}

// ------------------------------------------------------------
// One dish
// ------------------------------------------------------------
export type MenuInsight = {
  id: string;
  name: string;
  categoryKey: string;
  categoryName: string;
  days: number;
  net: number;
  qty: number;
  netPerDay: number;
  qtyPerDay: number;
  /** After discount, excl VAT and service charge. */
  avgPrice: number | null;
  /** Weighted by plates sold at each branch; null when there is no recipe. */
  costPerDish: number | null;
  confidence: string | null;
  /** A recipe that prices this dish at one of its branches — for a link. */
  recipeId: string | null;
  profitPerDish: number | null;
  marginPercent: number | null;
  /** 1 = the category's best seller in the chosen measure. */
  rankInCategory: number;
  categorySize: number;
  shareOfCategory: number | null;
  shareOfAll: number | null;
  daily: { day: string; value: number | null; qty: number }[];
  weekday: { weekday: number; perDay: number | null; qtyPerDay: number }[];
  prev: { netPerDay: number; qtyPerDay: number } | null;
};

export function menuInsight(
  menuId: string,
  cur: Enriched[],
  prev: Enriched[],
  menus: Map<string, MenuMeta>,
  costs: CostMap,
  by: Metric
): MenuInsight | null {
  const meta = menus.get(menuId);
  if (!meta) return null;
  const mine = cur.filter((r) => r.menuId === menuId);
  const days = dayCount(cur);
  const net = mine.reduce((t, r) => t + r.net, 0);
  const qty = mine.reduce((t, r) => t + r.qty, 0);

  let costQty = 0;
  let costSum = 0;
  let confidence: string | null = null;
  let recipeId: string | null = null;
  for (const r of mine) {
    const c = costs.get(costKey(r.branchId, r.menuId));
    if (!c) continue;
    recipeId ??= c.recipeId ?? null;
    costQty += r.qty;
    costSum += r.qty * c.cost;
    // The weakest link speaks for the whole: LOW beats MEDIUM beats HIGH.
    confidence = weaker(confidence, c.confidence);
  }
  const costPerDish = costQty > 0 ? costSum / costQty : null;
  const avgPrice = qty > 0 ? net / qty : null;
  const profitPerDish = costPerDish !== null && avgPrice !== null ? avgPrice - costPerDish : null;

  const stats = periodStats(cur, menus, by);
  const inCat = stats.menus.filter((m) => m.categoryKey === meta.categoryKey);
  const catTotal = inCat.reduce((t, m) => t + m.perDay, 0);
  const me = stats.menus.find((m) => m.id === menuId);

  const byDay = new Map<string, { value: number | null; qty: number }>();
  for (const r of mine) {
    const d = byDay.get(r.day) ?? { value: 0, qty: 0 };
    const v = valueOf(r, by);
    d.value = d.value === null || v === null ? null : d.value + v;
    d.qty += r.qty;
    byDay.set(r.day, d);
  }
  const allDays = [...new Set(cur.map((r) => r.day))].sort();

  const wdDays: Record<number, number> = {};
  for (const d of allDays) wdDays[weekdayOf(d)] = (wdDays[weekdayOf(d)] ?? 0) + 1;

  const prevMine = prev.filter((r) => r.menuId === menuId);
  const prevDays = dayCount(prev);

  return {
    id: menuId,
    name: meta.name,
    categoryKey: meta.categoryKey,
    categoryName: meta.categoryName,
    days,
    net,
    qty,
    netPerDay: days ? net / days : 0,
    qtyPerDay: days ? qty / days : 0,
    avgPrice,
    costPerDish,
    confidence,
    recipeId,
    profitPerDish,
    marginPercent: profitPerDish !== null && avgPrice ? (profitPerDish / avgPrice) * 100 : null,
    rankInCategory: inCat.findIndex((m) => m.id === menuId) + 1,
    categorySize: inCat.length,
    shareOfCategory: me && catTotal ? (me.perDay / catTotal) * 100 : null,
    shareOfAll: me?.share ?? null,
    daily: allDays.map((d) => ({ day: d, value: byDay.get(d)?.value ?? 0, qty: byDay.get(d)?.qty ?? 0 })),
    weekday: WEEK_ORDER.map((w) => {
      const rs = mine.filter((r) => r.weekday === w);
      const vals = rs.map((r) => valueOf(r, by));
      const n = wdDays[w] ?? 0;
      return {
        weekday: w,
        perDay: !n ? 0 : vals.some((v) => v === null) ? null : vals.reduce<number>((t, v) => t + (v ?? 0), 0) / n,
        qtyPerDay: n ? rs.reduce((t, r) => t + r.qty, 0) / n : 0,
      };
    }),
    prev:
      prevDays > 0
        ? {
            netPerDay: prevMine.reduce((t, r) => t + r.net, 0) / prevDays,
            qtyPerDay: prevMine.reduce((t, r) => t + r.qty, 0) / prevDays,
          }
        : null,
  };
}

const RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
function weaker(a: string | null, b: string): string {
  if (a === null) return b;
  return (RANK[b] ?? 0) < (RANK[a] ?? 0) ? b : a;
}

// ------------------------------------------------------------
// Periods
// ------------------------------------------------------------
/** The same number of days, immediately before. A whole month → the month before. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  const isMonthStart = f.getUTCDate() === 1;
  if (isMonthStart) {
    const pf = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - 1, 1));
    const pt = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), 0));
    return { from: iso(pf), to: iso(pt) };
  }
  const len = Math.round((t.getTime() - f.getTime()) / 864e5) + 1;
  const pt = new Date(f.getTime() - 864e5);
  const pf = new Date(pt.getTime() - (len - 1) * 864e5);
  return { from: iso(pf), to: iso(pt) };
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * A period as a person says it: a whole month is "ส.ค. 69", anything else is
 * "1–7 ก.ย. 69". Every "▼ 9.9%" on the page names its comparison with this
 * (Kong, 2026-09-28: "ช่วงก่อนคือช่วงไหน บางคนกดไว้แล้วลืม").
 */
export function periodLabelTh(from: string, to: string): string {
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  const monthYear = (d: Date) => d.toLocaleDateString("th-TH", { month: "short", year: "2-digit", timeZone: "UTC" });
  const lastOfMonth = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  if (f.getUTCDate() === 1 && t.getUTCDate() === lastOfMonth && f.getUTCMonth() === t.getUTCMonth()) return monthYear(f);
  if (from === to) return `${f.getUTCDate()} ${monthYear(f)}`;
  if (f.getUTCMonth() === t.getUTCMonth() && f.getUTCFullYear() === t.getUTCFullYear()) {
    return `${f.getUTCDate()}–${t.getUTCDate()} ${monthYear(t)}`;
  }
  return `${f.getUTCDate()} ${monthYear(f)} – ${t.getUTCDate()} ${monthYear(t)}`;
}

/** One side of a comparison: a date range, optionally only some weekdays. */
export type CompareSide = { from: string; to: string; weekdays: number[] | null; label: string };
export const inSide = (r: { day: string; weekday: number }, s: CompareSide) =>
  r.day >= s.from && r.day <= s.to && (s.weekdays === null || s.weekdays.includes(r.weekday));

// ------------------------------------------------------------
// Totals by any key, in the chosen measure
// ------------------------------------------------------------
export type Totals = { key: string; value: number | null; net: number; qty: number; unknownNet: number };

/**
 * Sum rows by a key. `value` is null only when the measure is profit and NOT
 * ONE row under the key has a recipe — a partly-costed key keeps the costed
 * part and reports the rest in `unknownNet` (rule SI2).
 */
export function sumBy(rows: Enriched[], keyOf: (r: Enriched) => string, by: Metric): Totals[] {
  const acc = new Map<string, Acc & { known: boolean }>();
  for (const r of rows) {
    const k = keyOf(r);
    const a = acc.get(k) ?? { ...emptyAcc(), known: false };
    add(a, r, by);
    if (valueOf(r, by) !== null) a.known = true;
    acc.set(k, a);
  }
  return [...acc.entries()].map(([key, a]) => ({
    key,
    value: a.known ? a.value : null,
    net: a.net,
    qty: a.qty,
    unknownNet: a.unknownNet,
  }));
}

/**
 * Cost per dish for every menu at once, weighted by plates sold at each
 * branch, with the weakest branch's confidence (rule SI2). A menu absent from
 * the map has no recipe anywhere it sold.
 */
export function menuCostPerDish(rows: Enriched[], costs: CostMap): Map<string, { cost: number; confidence: string }> {
  const acc = new Map<string, { qty: number; sum: number; confidence: string | null }>();
  for (const r of rows) {
    const c = costs.get(costKey(r.branchId, r.menuId));
    if (!c) continue;
    const a = acc.get(r.menuId) ?? { qty: 0, sum: 0, confidence: null };
    a.qty += r.qty;
    a.sum += r.qty * c.cost;
    a.confidence = weaker(a.confidence, c.confidence);
    acc.set(r.menuId, a);
  }
  return new Map(
    [...acc.entries()]
      .filter(([, a]) => a.qty > 0)
      .map(([id, a]) => [id, { cost: a.sum / a.qty, confidence: a.confidence ?? "LOW" }])
  );
}
