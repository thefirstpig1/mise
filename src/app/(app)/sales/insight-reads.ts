// ============================================================
// Mise — sales insight reads (Kong, 2026-09-28)
// ============================================================
// Thin glue: requireTenant → validate → read → src/lib/sales-insight.ts. The
// popups ask for exactly one thing each, when opened, rather than the page
// shipping every dish's history to the browser up front.
//
// Served by GET /api/sales since 2026-10-04, no longer as Server Actions:
// Next queues actions one at a time and can drop an answer on a URL change
// (mise-ui-review §5c). The browser calls them through insight-client.ts.
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { getSalesMenuDaysLogic, getSalesMenuDaysWithComparisonLogic } from "@/server/sales";
import { getMenuCostMapLogic } from "@/server/sales-insight-read";
import { getBranchesLogic } from "@/server/branch";
import type { CostAccess } from "@/lib/permissions/cost-access";
import type { BranchReach } from "@/lib/permissions/service";
import type { CostMap } from "@/lib/sales-insight";
import { toneOf } from "@/components/charts/chart-theme";
import {
  monthRangeDates,
  monthsBetween,
  promoSide,
  promoVerdict,
  promoWindows,
  salesTrend,
  type PromoCheck,
  type SalesTrend,
} from "@/lib/sales-trend";
import { buildSalesView, tonesFor, type SalesView } from "./_components/sales-views";
import {
  enrich,
  inSide,
  menuInsight,
  periodLabelTh,
  periodStats,
  comparisonRange,
  previousRange,
  type CompareSide,
  type MenuInsight,
  type MenuMeta,
  type Metric,
  type PeriodStats,
} from "@/lib/sales-insight";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const METRIC = new Set<Metric>(["net", "qty", "profit"]);
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * Sales rows and their serving costs, fetched SIDE BY SIDE (2026-10-01).
 *
 * The cost map used to wait for the rows, only to learn which branches they
 * came from. It now starts at once for the branches the reader can see (or the
 * one branch asked for), and only a branch the rows bring that is not on that
 * list — a since-deleted branch with old sales — is priced afterwards. Every
 * row therefore finds exactly the cost it found before; a branch with no rows
 * only adds keys nothing looks up.
 */
async function rowsWithCosts<T extends { rows: { branchId: string }[] }>(
  tenantId: string,
  reach: BranchReach,
  branchId: string | undefined,
  asOf: Date,
  cost: CostAccess | null,
  rowsP: Promise<T>
): Promise<{ data: T; costs: CostMap }> {
  if (cost === null) return { data: await rowsP, costs: new Map() };
  const firstIds = branchId
    ? Promise.resolve([branchId])
    : getBranchesLogic(tenantId, reach).then((bs) => bs.map((b) => b.id));
  const firstP = firstIds.then(async (ids) => ({ ids, map: await getMenuCostMapLogic(tenantId, ids, asOf, cost) }));
  const [data, first] = await Promise.all([rowsP, firstP]);
  const missing = [...new Set(data.rows.map((r) => r.branchId))].filter((id) => !first.ids.includes(id));
  if (missing.length === 0) return { data, costs: first.map };
  const more = await getMenuCostMapLogic(tenantId, missing, asOf, cost);
  return { data, costs: new Map([...first.map, ...more]) };
}
const thai = (iso: string) =>
  d(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });

export type MenuInsightResult =
  | { ok: true; insight: MenuInsight; canSeeCost: boolean; costAsOf: string; prevLabel: string; curLabel: string }
  | { ok: false; formError: string; stale?: boolean };

/**
 * One dish's popup. Always in ยอดขาย (Kong, 2026-09-29: one dish needs no
 * measure switch — its cost, profit and plates are all on the same screen).
 *
 * `withCost: false` skips the recipe walk — the slow part, which prices every
 * menu of every branch — because the page already holds this dish's cost in
 * its profit view and applies it in the browser (`withDishCost`). Nothing the
 * browser sends is trusted as a figure: it only chooses whether the server
 * prices the dish itself.
 */
export async function readMenuInsight(input: {
  menuId: string;
  from: string;
  to: string;
  branchId?: string;
  withCost: boolean;
}): Promise<MenuInsightResult> {
  const { tenantId, assertBranch, costAccess, reach } = await requireTenant("sales:view");
  if (!ISO.test(input.from) || !ISO.test(input.to) || input.from > input.to) {
    return { ok: false, formError: "ช่วงวันที่ไม่ถูกต้อง" };
  }
  if (input.branchId) assertBranch(input.branchId);
  const by: Metric = "net";

  const prev = previousRange(input.from, input.to);
  const data = await getSalesMenuDaysLogic(tenantId, {
    reach,
    branchId: input.branchId || undefined,
    from: d(prev.from),
    to: d(input.to),
  });
  const menus = new Map<string, MenuMeta>(data.menus.map((m) => [m.id, m]));
  if (!menus.has(input.menuId)) return { ok: false, formError: "ไม่พบยอดขายของเมนูนี้ในช่วงนี้" };

  const branchIds = [...new Set(data.rows.filter((r) => r.menuId === input.menuId).map((r) => r.branchId))];
  const costs = input.withCost ? await getMenuCostMapLogic(tenantId, branchIds, d(input.to), costAccess) : new Map();
  const rows = enrich(data.rows, menus, costs);
  const cur = rows.filter((r) => r.day >= input.from && r.day <= input.to);
  const before = rows.filter((r) => r.day >= prev.from && r.day <= prev.to);

  const insight = menuInsight(input.menuId, cur, before, menus, costs, by);
  if (!insight) return { ok: false, formError: "ไม่พบเมนูนี้" };
  return {
    ok: true,
    insight,
    canSeeCost: costAccess !== null,
    costAsOf: thai(input.to),
    prevLabel: periodLabelTh(prev.from, prev.to),
    curLabel: periodLabelTh(input.from, input.to),
  };
}

// ------------------------------------------------------------
// A against B (Kong's questions 2 and 3)
// ------------------------------------------------------------
export type CompareResult =
  | { ok: true; a: PeriodStats; b: PeriodStats; labels: Record<string, string> }
  | { ok: false; formError: string; stale?: boolean };

export async function readSalesCompare(input: {
  a: CompareSide;
  b: CompareSide;
  branchId?: string;
  by: Metric;
}): Promise<CompareResult> {
  const { tenantId, assertBranch, costAccess, reach } = await requireTenant("sales:view");
  for (const s of [input.a, input.b]) {
    if (!ISO.test(s.from) || !ISO.test(s.to) || s.from > s.to) return { ok: false, formError: "ช่วงวันที่ไม่ถูกต้อง" };
    if (s.weekdays && s.weekdays.some((w) => !Number.isInteger(w) || w < 0 || w > 6)) {
      return { ok: false, formError: "วันในสัปดาห์ไม่ถูกต้อง" };
    }
  }
  if (!METRIC.has(input.by)) return { ok: false, formError: "มุมมองไม่ถูกต้อง" };
  if (input.branchId) assertBranch(input.branchId);
  const by: Metric = input.by === "profit" && costAccess === null ? "net" : input.by;

  const from = input.a.from < input.b.from ? input.a.from : input.b.from;
  const to = input.a.to > input.b.to ? input.a.to : input.b.to;
  // One cost date for both sides, so a difference is the SALES moving, not the
  // price of pork between two dates (rule SI2).
  const { data, costs } = await rowsWithCosts(
    tenantId,
    reach,
    input.branchId || undefined,
    d(to),
    by === "profit" ? costAccess : null,
    getSalesMenuDaysLogic(tenantId, { reach, branchId: input.branchId || undefined, from: d(from), to: d(to) })
  );
  const menus = new Map<string, MenuMeta>(data.menus.map((m) => [m.id, m]));
  const rows = enrich(data.rows, menus, costs);

  return {
    ok: true,
    a: periodStats(rows.filter((r) => inSide(r, input.a)), menus, by),
    b: periodStats(rows.filter((r) => inSide(r, input.b)), menus, by),
    labels: Object.fromEntries(data.menus.map((m) => [m.categoryKey, m.categoryName])),
  };
}

// ------------------------------------------------------------
// The profit view, built in the background (Kong, 2026-09-28: "สับสวิตช์ยังช้า")
// ------------------------------------------------------------
export type ProfitViewResult = { ok: true; view: SalesView } | { ok: false; formError: string; stale?: boolean };

/**
 * /sales ships ยอดขาย and จำนวนจาน ready to switch; profit needs the recipe
 * cost walk, so the page asks for it here right after it appears, and the
 * กำไร button is usually ready by the time anyone presses it.
 *
 * Same inputs, same builder, same tones as the page (tones are fixed by
 * sales order, so recomputing them here gives the page's colours).
 */
export async function readSalesProfitView(input: {
  from: string;
  to: string;
  branchId?: string;
  categoryId?: string;
  day?: string | null;
  /** The comparison the page is showing (Kong, 2026-10-03); absent = previous period. */
  vsFrom?: string | null;
  vsTo?: string | null;
}): Promise<ProfitViewResult> {
  const { tenantId, assertBranch, costAccess, reach } = await requireTenant("sales:view");
  if (costAccess === null) return { ok: false, formError: "ไม่มีสิทธิ์ดูต้นทุน" };
  if (!ISO.test(input.from) || !ISO.test(input.to) || input.from > input.to) {
    return { ok: false, formError: "ช่วงวันที่ไม่ถูกต้อง" };
  }
  if (input.branchId) assertBranch(input.branchId);
  const day = input.day && ISO.test(input.day) ? input.day : null;

  const prev = comparisonRange(input.from, input.to, { from: input.vsFrom, to: input.vsTo });
  const { data, costs } = await rowsWithCosts(
    tenantId,
    reach,
    input.branchId || undefined,
    d(input.to),
    costAccess,
    getSalesMenuDaysWithComparisonLogic(
      tenantId,
      { reach, branchId: input.branchId || undefined, menuCategoryId: input.categoryId || undefined },
      { from: d(input.from), to: d(input.to) },
      { from: d(prev.from), to: d(prev.to) }
    )
  );
  const menuMeta = new Map<string, MenuMeta>(data.menus.map((m) => [m.id, m]));
  const rows = enrich(data.rows, menuMeta, costs);
  const cur = rows.filter((r) => r.day >= input.from && r.day <= input.to);
  const before = rows.filter((r) => r.day >= prev.from && r.day <= prev.to);
  return {
    ok: true,
    view: buildSalesView({ cur, before, menuMeta, costs, tones: tonesFor(cur, toneOf), day }, "profit"),
  };
}

// ------------------------------------------------------------
// Sales by month, and "did the promotion work" (Kong, 2026-10-28)
// ------------------------------------------------------------
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Two years is the longest range the custom picker offers. */
const MAX_TREND_MONTHS = 24;

export type SalesTrendResult =
  | { ok: true; trend: SalesTrend; canSeeCost: boolean; withProfit: boolean; costAsOf: string }
  | { ok: false; formError: string; stale?: boolean };

/**
 * Every category and menu, month by month, for the branch(es) in view. Profit
 * is the slow part (the recipe walk), so it comes only when asked for, priced
 * once at the END of the range (rule TR3) like every other /sales figure.
 */
export async function readSalesTrend(input: {
  fromMonth: string;
  toMonth: string;
  branchId?: string;
  categoryId?: string;
  withProfit: boolean;
}): Promise<SalesTrendResult> {
  const { tenantId, assertBranch, costAccess, reach } = await requireTenant("sales:view");
  if (!MONTH.test(input.fromMonth) || !MONTH.test(input.toMonth) || input.fromMonth > input.toMonth) {
    return { ok: false, formError: "ช่วงเดือนไม่ถูกต้อง" };
  }
  const months = monthsBetween(input.fromMonth, input.toMonth);
  if (input.categoryId && !UUID_RE.test(input.categoryId)) return { ok: false, formError: "คำขอไม่ถูกต้อง" };
  if (months.length > MAX_TREND_MONTHS) return { ok: false, formError: `เลือกได้ไม่เกิน ${MAX_TREND_MONTHS} เดือน` };
  if (input.branchId) assertBranch(input.branchId);
  const range = monthRangeDates(input.fromMonth, input.toMonth);
  const withProfit = input.withProfit && costAccess !== null;

  const { data, costs } = await rowsWithCosts(
    tenantId,
    reach,
    input.branchId || undefined,
    d(range.to),
    withProfit ? costAccess : null,
    getSalesMenuDaysLogic(tenantId, {
      reach,
      branchId: input.branchId || undefined,
      menuCategoryId: input.categoryId || undefined,
      from: d(range.from),
      to: d(range.to),
    })
  );
  const menus = new Map<string, MenuMeta>(data.menus.map((m) => [m.id, m]));
  return {
    ok: true,
    trend: salesTrend(data.rows, menus, costs, months),
    canSeeCost: costAccess !== null,
    withProfit,
    costAsOf: thai(range.to),
  };
}

export type PromoCheckResult =
  | { ok: true; check: PromoCheck; menuName: string; categoryName: string; canSeeCost: boolean; costAsOf: string }
  | { ok: false; formError: string; stale?: boolean };

/**
 * One menu's promotion, judged per day against the time before it (rule TR5):
 * the menu itself, the OTHER menus of its category, and the category's profit.
 * Nothing records a promotion yet, so the reader says when it ran.
 */
export async function readPromoCheck(input: {
  menuId: string;
  from: string;
  to: string;
  base: "3m" | "1m";
  branchId?: string;
}): Promise<PromoCheckResult> {
  const { tenantId, assertBranch, costAccess, reach } = await requireTenant("sales:view");
  if (!ISO.test(input.from) || !ISO.test(input.to) || input.from > input.to) {
    return { ok: false, formError: "ช่วงวันที่ไม่ถูกต้อง" };
  }
  if (!UUID_RE.test(input.menuId)) return { ok: false, formError: "ไม่พบเมนูนี้" };
  if (input.base !== "3m" && input.base !== "1m") return { ok: false, formError: "คำขอไม่ถูกต้อง" };
  if (input.branchId) assertBranch(input.branchId);

  const w = promoWindows(input.from, input.to, input.base);
  const { data, costs } = await rowsWithCosts(
    tenantId,
    reach,
    input.branchId || undefined,
    d(input.to),
    costAccess,
    getSalesMenuDaysLogic(tenantId, { reach, branchId: input.branchId || undefined, from: d(w.before.from), to: d(w.after.to) })
  );
  const menus = new Map<string, MenuMeta>(data.menus.map((m) => [m.id, m]));
  const me = menus.get(input.menuId);
  if (!me) return { ok: false, formError: "ไม่พบยอดขายของเมนูนี้ในช่วงนี้" };
  const inCategory = new Set([...menus.values()].filter((m) => m.categoryKey === me.categoryKey).map((m) => m.id));
  const side = (s: { from: string; to: string }) => promoSide(data.rows, input.menuId, inCategory, costAccess ? costs : null, s.from, s.to);

  const before = side(w.before);
  const during = side(w.during);
  const afterSide = side(w.after);
  return {
    ok: true,
    check: { before, during, after: afterSide.days > 0 ? afterSide : null, verdict: promoVerdict(before, during) },
    menuName: me.name,
    categoryName: me.categoryName,
    canSeeCost: costAccess !== null,
    costAsOf: thai(input.to),
  };
}
