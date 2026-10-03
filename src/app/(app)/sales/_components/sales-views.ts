// ============================================================
// Mise — everything on /sales that depends on the MEASURE, built at once
// ============================================================
// Kong (2026-09-28): "ขนาดแค่สับสวิตช์มุมมองยังช้า". Switching ยอดขาย ↔
// จำนวนจาน used to re-render the whole page on the server: ~43 queries, each a
// 32 ms round trip from Thailand to Neon, ~0.9 s for figures the server had
// already fetched. Both measures come from the SAME rows, so the page now
// builds both views in one pass and the browser switches between them
// instantly. Profit needs the recipe cost walk (the slow part, ~1–2 s), so its
// view is built in the background after the page appears (see
// getSalesProfitViewAction) and is usually ready before anyone presses กำไร.
//
// Server-only in practice (it is handed Prisma-free inputs), but a plain module
// — never "use client" — so a Server Component can call it (see the
// mise-ui-review skill: a value imported from a client file is a reference).
// ============================================================

import { solid } from "@/components/charts/chart-theme";
import {
  WEEK_ORDER,
  categoryByWeekday,
  menuCostPerDish,
  menuChanges,
  menusOnWeekday,
  periodStats,
  sumBy,
  type CostMap,
  type DishCost,
  type Enriched,
  type MenuMeta,
  type Metric,
  type MenuChanges,
  type Totals,
} from "@/lib/sales-insight";
import type { Tone } from "@/components/charts/chart-theme";
import type { BreakdownCategory, BreakdownMenu } from "./Breakdown";
import type { DayBar, MenuRow, WeekdayBar } from "./SalesCharts";
import type { HeatMenus, HeatRow } from "./CategoryWeekdayHeatmap";
import { WEEKDAY_LABELS_TH } from "./sales-view";

export type SalesView = {
  by: Metric;
  daily: DayBar[];
  weekday: WeekdayBar[];
  categories: BreakdownCategory[];
  menus: BreakdownMenu[];
  total: number;
  heat: { rows: HeatRow[]; weekdays: number[]; daysPerWeekday: Record<number, number>; menusByCell: HeatMenus };
  /** Every dish's per-day change against the comparison period (Kong, 2026-10-03). */
  changes: MenuChanges;
  table: MenuRow[];
  /** Profit only: the period's recipe gross profit and what it could not count. */
  profit: { total: number; perDay: number; unknownNet: number; days: number } | null;
  /** The open day's breakdown, when a day popup is open. */
  day: { categories: BreakdownCategory[]; menus: BreakdownMenu[] } | null;
};

export type SalesViewInput = {
  cur: Enriched[];
  before: Enriched[];
  menuMeta: Map<string, MenuMeta>;
  costs: CostMap;
  tones: Record<string, Tone>;
  day: string | null;
};

const dayLabelOf = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

/** One colour per category, fixed by SALES order so it survives a measure switch. */
export function tonesFor(cur: Enriched[], toneOf: (i: number) => Tone): Record<string, Tone> {
  return Object.fromEntries(
    sumBy(cur, (r) => r.categoryKey, "net")
      .sort((a, b) => b.net - a.net)
      .map((c, i) => [c.key, toneOf(i)])
  );
}

export function buildSalesView(input: SalesViewInput, by: Metric): SalesView {
  const { cur, before, menuMeta, costs, tones, day } = input;
  const catName = (k: string) => [...menuMeta.values()].find((m) => m.categoryKey === k)?.categoryName ?? "ยังไม่ระบุหมวด";
  const byValue = (a: Totals, b: Totals) => (b.value ?? -Infinity) - (a.value ?? -Infinity);
  const toCats = (t: Totals[]): BreakdownCategory[] =>
    t.sort(byValue).map((c) => ({ key: c.key, label: catName(c.key), value: c.value, qty: c.qty }));
  const toMenus = (t: Totals[]): BreakdownMenu[] =>
    t.map((m) => ({
      id: m.key,
      name: menuMeta.get(m.key)?.name ?? "(ไม่พบเมนู)",
      categoryKey: menuMeta.get(m.key)?.categoryKey ?? "none",
      value: m.value,
      qty: m.qty,
    }));

  const categories = toCats(sumBy(cur, (r) => r.categoryKey, by));
  const menuTotals = sumBy(cur, (r) => r.menuId, by);
  const total = categories.reduce((t, c) => t + (c.value ?? 0), 0);

  const daily: DayBar[] = sumBy(cur, (r) => r.day, by)
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((d) => ({
      day: d.key,
      label: dayLabelOf(d.key),
      weekday: WEEKDAY_LABELS_TH[new Date(`${d.key}T00:00:00Z`).getUTCDay()],
      value: d.value,
      net: d.net,
      qty: d.qty,
      profit: by === "profit" ? d.value : null,
    }));
  const weekday: WeekdayBar[] = WEEK_ORDER.map((w) => {
    const ds = daily.filter((d) => new Date(`${d.day}T00:00:00Z`).getUTCDay() === w && d.value !== null);
    return { label: WEEKDAY_LABELS_TH[w], average: ds.length ? ds.reduce((t, d) => t + (d.value ?? 0), 0) / ds.length : 0, days: ds.length };
  }).filter((w) => w.days > 0);

  const heat = categoryByWeekday(cur, menuMeta, by);
  const menusByCell: HeatMenus = Object.fromEntries(
    heat.categories.flatMap((c) => WEEK_ORDER.map((w) => [`${c.key}|${w}`, menusOnWeekday(cur, menuMeta, by, c.key, w)]))
  );

  const costPerDish = by === "profit" ? menuCostPerDish(cur, costs) : new Map<string, DishCost>();
  const table: MenuRow[] = menuTotals.map((m) => {
    const meta = menuMeta.get(m.key);
    const c = costPerDish.get(m.key);
    return {
      id: m.key,
      name: meta?.name ?? "(ไม่พบเมนู)",
      code: meta?.code ?? null,
      category: meta && meta.categoryKey !== "none" ? meta.categoryName : "—",
      categoryKey: meta?.categoryKey ?? "none",
      color: meta && meta.categoryKey !== "none" ? solid(tones[meta.categoryKey] ?? "olive") : null,
      qty: m.qty,
      net: m.net,
      value: m.value,
      costPerDish: c?.cost ?? null,
      profitPerDish: c && m.qty > 0 ? m.net / m.qty - c.cost : null,
      confidence: c?.confidence ?? null,
      recipeId: c?.recipeId ?? null,
      stub: meta?.isPosStub ?? false,
    };
  });

  const ps = by === "profit" ? periodStats(cur, menuMeta, "profit") : null;
  const dayRows = day ? cur.filter((r) => r.day === day) : null;

  return {
    by,
    daily,
    weekday,
    categories,
    menus: toMenus(menuTotals),
    total,
    heat: { rows: heat.categories, weekdays: heat.weekdays, daysPerWeekday: heat.daysPerWeekday, menusByCell },
    changes: menuChanges(cur, before, menuMeta, by),
    table,
    profit: ps
      ? { total: (ps.perDay.profit ?? 0) * ps.days, perDay: ps.perDay.profit ?? 0, unknownNet: ps.unknownNetPerDay * ps.days, days: ps.days }
      : null,
    day: dayRows
      ? { categories: toCats(sumBy(dayRows, (r) => r.categoryKey, by)), menus: toMenus(sumBy(dayRows, (r) => r.menuId, by)) }
      : null,
  };
}
