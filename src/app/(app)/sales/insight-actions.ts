"use server";

// ============================================================
// Mise — sales insight Server Actions (Kong, 2026-09-28)
// ============================================================
// Thin glue: requireTenant → validate → read → src/lib/sales-insight.ts. The
// popups ask for exactly one thing each, when opened, rather than the page
// shipping every dish's history to the browser up front.
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { getSalesMenuDaysLogic, getSalesMenuDaysWithComparisonLogic } from "@/server/sales";
import { getMenuCostMapLogic } from "@/server/sales-insight-read";
import { getBranchesLogic } from "@/server/branch";
import type { CostAccess } from "@/lib/permissions/cost-access";
import type { BranchReach } from "@/lib/permissions/service";
import type { CostMap } from "@/lib/sales-insight";
import { toneOf } from "@/components/charts/chart-theme";
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
export async function getMenuInsightAction(input: {
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

export async function getSalesCompareAction(input: {
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
export async function getSalesProfitViewAction(input: {
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
