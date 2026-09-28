"use server";

// ============================================================
// Mise — sales insight Server Actions (Kong, 2026-09-28)
// ============================================================
// Thin glue: requireTenant → validate → read → src/lib/sales-insight.ts. The
// popups ask for exactly one thing each, when opened, rather than the page
// shipping every dish's history to the browser up front.
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { getSalesMenuDaysLogic } from "@/server/sales";
import { getMenuCostMapLogic } from "@/server/sales-insight-read";
import {
  enrich,
  inSide,
  menuInsight,
  periodLabelTh,
  periodStats,
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
const thai = (iso: string) =>
  d(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });

export type MenuInsightResult =
  | { ok: true; insight: MenuInsight; canSeeCost: boolean; costAsOf: string; prevLabel: string; curLabel: string }
  | { ok: false; formError: string };

export async function getMenuInsightAction(input: {
  menuId: string;
  from: string;
  to: string;
  branchId?: string;
  by: Metric;
}): Promise<MenuInsightResult> {
  const { tenantId, assertBranch, costAccess } = await requireTenant("sales:view");
  if (!ISO.test(input.from) || !ISO.test(input.to) || input.from > input.to || !METRIC.has(input.by)) {
    return { ok: false, formError: "ช่วงวันที่ไม่ถูกต้อง" };
  }
  if (input.branchId) assertBranch(input.branchId);
  const by: Metric = input.by === "profit" && costAccess === null ? "net" : input.by;

  const prev = previousRange(input.from, input.to);
  const data = await getSalesMenuDaysLogic(tenantId, {
    branchId: input.branchId || undefined,
    from: d(prev.from),
    to: d(input.to),
  });
  const menus = new Map<string, MenuMeta>(data.menus.map((m) => [m.id, m]));
  if (!menus.has(input.menuId)) return { ok: false, formError: "ไม่พบยอดขายของเมนูนี้ในช่วงนี้" };

  const branchIds = [...new Set(data.rows.map((r) => r.branchId))];
  const costs = await getMenuCostMapLogic(tenantId, branchIds, d(input.to), costAccess);
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
  | { ok: false; formError: string };

export async function getSalesCompareAction(input: {
  a: CompareSide;
  b: CompareSide;
  branchId?: string;
  by: Metric;
}): Promise<CompareResult> {
  const { tenantId, assertBranch, costAccess } = await requireTenant("sales:view");
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
  const data = await getSalesMenuDaysLogic(tenantId, { branchId: input.branchId || undefined, from: d(from), to: d(to) });
  const menus = new Map<string, MenuMeta>(data.menus.map((m) => [m.id, m]));
  const branchIds = [...new Set(data.rows.map((r) => r.branchId))];
  // One cost date for both sides, so a difference is the SALES moving, not the
  // price of pork between two dates (rule SI2).
  const costs = by === "profit" ? await getMenuCostMapLogic(tenantId, branchIds, d(to), costAccess) : new Map();
  const rows = enrich(data.rows, menus, costs);

  return {
    ok: true,
    a: periodStats(rows.filter((r) => inSide(r, input.a)), menus, by),
    b: periodStats(rows.filter((r) => inSide(r, input.b)), menus, by),
    labels: Object.fromEntries(data.menus.map((m) => [m.categoryKey, m.categoryName])),
  };
}
