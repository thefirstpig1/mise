// ============================================================
// Mise — the staff-meal month, for the สรุป tab (Kong 2026-10-28)
// ============================================================
// Served by GET /api/staff-meals (mise-ui-review §5c). Who ate how much is a
// question about people, so it needs `staff:view`; the money taken out of
// stock needs cost access on top; the share of sales needs `sales:view`. Each
// is left out rather than shown as zero when the reader may not see it.
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getSalesTotalsLogic } from "@/server/sales";
import { getStaffMealSummaryLogic, type StaffMealSummary } from "@/server/staff-meal-read";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StaffMealSummaryResult =
  | { ok: true; summary: StaffMealSummary; sales: number | null; canSeeCost: boolean; month: string; days: number }
  | { ok: false; formError: string; stale?: boolean };

export async function readStaffMealSummary(input: { month: string; branchId?: string }): Promise<StaffMealSummaryResult> {
  const { tenantId, reach, can, costAccess, assertBranch } = await requireTenant("staffmeal:write");
  if (!can("staff:view")) return { ok: false, formError: "ไม่มีสิทธิ์ดูสรุปรายคน" };
  if (!MONTH.test(input.month)) return { ok: false, formError: "เดือนไม่ถูกต้อง" };
  if (input.branchId && !UUID.test(input.branchId)) return { ok: false, formError: "สาขาไม่ถูกต้อง" };
  if (input.branchId) assertBranch(input.branchId);

  const [y, m] = input.month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0));
  const branchIds = input.branchId ? [input.branchId] : (await getBranchesLogic(tenantId, reach)).map((b) => b.id);

  const [summary, totals] = await Promise.all([
    getStaffMealSummaryLogic(tenantId, { branchIds, from, to, withCost: costAccess !== null }),
    can("sales:view")
      ? getSalesTotalsLogic(tenantId, { reach, branchId: input.branchId, from, to, includeSuperseded: false })
      : Promise.resolve(null),
  ]);
  return {
    ok: true,
    summary,
    sales: totals ? Number(totals.net) : null,
    canSeeCost: costAccess !== null,
    month: input.month,
    days: to.getUTCDate(),
  };
}
