"use server";

// ============================================================
// Mise — the dashboard's monthly trend, fetched once per branch choice
// ============================================================
// Kong (2026-09-29): "หน้าแดชบอร์ดโหลดนานมากในการ … interact กับอะไรสักอย่าง".
// The six-month chart is six full P&Ls. While it was a Server Component every
// click on the page — a period preset, a month bar, a branch chip — recomputed
// all six, although only the BRANCH choice changes them (the period only moves
// the highlight). As an action called from the chart, it runs when the branches
// change and not otherwise; picking a month is then two P&Ls, not eight.
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { getMonthlyPnlLogic } from "@/server/pnl";
import { recentMonths } from "./_components/dashboard-period";
import type { MonthPoint } from "./_components/Charts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MonthlyTrendResult = { ok: true; points: MonthPoint[] } | { ok: false; formError: string };

const num = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));
const label = (key: string) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString("th-TH", { month: "short", year: "2-digit", timeZone: "UTC" });

export async function getMonthlyTrendAction(input: { branchIds: string[] }): Promise<MonthlyTrendResult> {
  const { tenantId, reach, can } = await requireTenant("sales:view");
  // It prints net profit, which is built from all three (ADR 0029 Q7).
  if (!can("cost:view") || !can("expense:view")) return { ok: false, formError: "ไม่มีสิทธิ์ดูกำไรสุทธิ" };
  if (!Array.isArray(input.branchIds) || input.branchIds.some((id) => typeof id !== "string" || !UUID.test(id))) {
    return { ok: false, formError: "สาขาไม่ถูกต้อง" };
  }
  // getPnlLogic narrows the ids to the reader's reach; an id outside it is dropped, never trusted.
  const pts = await getMonthlyPnlLogic(tenantId, recentMonths(6), input.branchIds, reach);
  return {
    ok: true,
    points: pts.map((p) => ({
      key: p.key,
      label: label(p.key),
      revenue: num(p.revenue),
      expenses: num(p.expenses),
      net: num(p.netProfit),
      note: p.unknownReason === "GROSS_PROFIT_UNKNOWN" ? "ต้นทุนขายยังคำนวณไม่ได้" : null,
    })),
  };
}
