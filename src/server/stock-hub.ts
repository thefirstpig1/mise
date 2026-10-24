// ============================================================
// Mise — งานสต๊อก (/stock) at a glance (Kong 2026-10-24, duplication review B6)
// ============================================================
// /stock stopped being a second product list (that is /products now) and
// became the door to stock WORK. Each tile says one fact about its job, read
// here in one transaction: when this branch last counted, how much waste was
// logged this month, and which sales days still need (re-)posting.
// ============================================================

import { withTenantContext } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { getConsumptionDayStatusLogic } from "@/server/consumption-read";

export type StockHubFacts = {
  /** Last CLOSED count at this branch, yyyy-mm-dd; null = never counted. */
  lastCountDate: string | null;
  wasteThisMonth: number;
  /** Days with sales in the last 30 days, inside the window, with no standing run. */
  unpostedDays: number;
  /** Posted days a recipe written afterwards now contradicts (rule N11). */
  staleDays: number;
};

const BKK_MS = 7 * 3_600_000;

export async function getStockHubFactsLogic(tenantId: string, branchId: string): Promise<StockHubFacts> {
  const today = computeBangkokToday();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1) - BKK_MS);
  const [base, days] = await Promise.all([
    withTenantContext(tenantId, (tx) =>
      Promise.all([
        tx.stockCount.findFirst({ where: { tenantId, branchId, status: "CLOSED" }, orderBy: { closedAt: "desc" }, select: { closedAt: true } }),
        tx.wasteLog.count({ where: { tenantId, branchId, reversalOfId: null, voidedAt: null, occurredAt: { gte: monthStart } } }),
      ])
    ),
    // The SAME read /consumption shows (rules N9, N11), so the tile and that
    // page can never disagree about what is left to post.
    getConsumptionDayStatusLogic(tenantId, { branchId, from: addDays(today, -30), to: today }),
  ]);
  const [count, waste] = base;
  return {
    lastCountDate: count?.closedAt ? new Date(count.closedAt.getTime() + BKK_MS).toISOString().slice(0, 10) : null,
    wasteThisMonth: waste,
    unpostedDays: days.filter((d) => d.runId === null && d.withinWindow).length,
    staleDays: days.filter((d) => d.runId !== null && d.recipeChangedSincePosting).length,
  };
}
