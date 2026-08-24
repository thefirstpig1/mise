// ============================================================
// Mise — what has been posted, and what has not (Part 22 L4a, ADR 0022)
// ============================================================
// One read, answering the three questions every Part 22 screen asks:
//
//   the posting panel — "if I press this, which days will it touch?"
//   the coverage report — "how much of this period is accounted for?"
//   the queue         — "which days still owe me a posting?"
//
// They are one read because they are one row: a business day with sales, and
// whatever a posting has or has not done to it. Splitting them would mean three
// walks over the same sales table, on a page a shop opens every morning.
// ============================================================

import { Prisma, type PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import type { ConsumptionSkipReason } from "@/lib/validations/consumption";
import { isWithinBackdateWindow } from "@/server/consumption";

const ZERO = new Prisma.Decimal(0);

/** One dish a run could not post, read back from the run's own record. */
export type ConsumptionSkipRecord = {
  menuId: string;
  menuName: string;
  qty: string;
  netAmount: string;
  reason: ConsumptionSkipReason;
  detail: string | null;
};

export type ConsumptionDayStatus = {
  branchId: string;
  businessDate: Date;
  /** The day's revenue as it stands now — live rows only. */
  netAmount: Prisma.Decimal;
  /** How many live sales rows the day holds. Zero days are not returned. */
  lineCount: number;

  /** The live run, when the day has one. */
  runId: string | null;
  postedAt: Date | null;
  coveredNetAmount: Prisma.Decimal | null;
  menusPosted: number | null;
  menusSkipped: number | null;
  skipped: ConsumptionSkipRecord[];

  /**
   * Rule N9. False means the day imported fine and can never post: it is older
   * than the ledger's backdate window. Shown as a reason, never as an error.
   */
  withinWindow: boolean;

  /**
   * Rule N11. A recipe covering this day was written AFTER the day was posted —
   * either edited backwards, or written for a dish that had none at the time.
   *
   * One signal for both, because they are one fact and one remedy: what the day
   * consumed is no longer what the recipes say it did, and posting it again
   * fixes it. The system does NOT do that by itself — it would rewrite a period
   * the shop may have closed, and Part 21 stands on recipes never reaching back
   * and touching something quietly.
   */
  recipeChangedSincePosting: boolean;
};

/**
 * Every day with sales in the range, and what a posting has done to it.
 *
 * A day with no sales is absent rather than present-and-empty: there is nothing
 * to post, nothing to report, and a queue padded with the shop's days off is a
 * queue nobody reads.
 */
export async function getConsumptionDayStatusLogic(
  tenantId: string,
  query: { branchId?: string; from: Date; to: Date }
): Promise<ConsumptionDayStatus[]> {
  return withTenantContext(tenantId, async (tx) => {
    const branchFilter = query.branchId ? { branchId: query.branchId } : {};

    const days = await tx.salesLine.groupBy({
      by: ["branchId", "businessDate"],
      where: {
        tenantId,
        supersededAt: null,
        ...branchFilter,
        businessDate: { gte: query.from, lte: query.to },
      },
      _sum: { netAmount: true },
      _count: { _all: true },
    });
    if (days.length === 0) return [];

    const runs = await tx.salesConsumptionRun.findMany({
      where: {
        tenantId,
        voidedAt: null,
        ...branchFilter,
        businessDate: { gte: query.from, lte: query.to },
      },
      select: {
        id: true,
        branchId: true,
        businessDate: true,
        postedAt: true,
        coveredNetAmount: true,
        menusPosted: true,
        menusSkipped: true,
        skippedMenus: true,
      },
    });
    const runByKey = new Map(
      runs.map((r) => [`${r.branchId}|${r.businessDate.getTime()}`, r])
    );

    const stale = await staleDays(tx, tenantId, runs);

    return days
      .map((d) => {
        const key = `${d.branchId}|${d.businessDate.getTime()}`;
        const run = runByKey.get(key);
        return {
          branchId: d.branchId,
          businessDate: d.businessDate,
          netAmount: d._sum.netAmount ?? ZERO,
          lineCount: d._count._all,
          runId: run?.id ?? null,
          postedAt: run?.postedAt ?? null,
          coveredNetAmount: run?.coveredNetAmount ?? null,
          menusPosted: run?.menusPosted ?? null,
          menusSkipped: run?.menusSkipped ?? null,
          skipped: run ? readSkipped(run.skippedMenus) : [],
          withinWindow: isWithinBackdateWindow(d.businessDate),
          recipeChangedSincePosting: run ? stale.has(run.id) : false,
        };
      })
      .sort(
        (a, b) =>
          a.businessDate.getTime() - b.businessDate.getTime() ||
          (a.branchId < b.branchId ? -1 : 1)
      );
  });
}

/**
 * Which of these runs were overtaken by a recipe written after they posted.
 *
 * Two queries regardless of how many days are asked about. The menus SOLD on a
 * day are needed as well as the recipes: a recipe written for a dish this branch
 * has never sold changes nothing about that day, and a warning that cannot be
 * acted on is worse than none — it teaches people to ignore the banner.
 */
async function staleDays(
  tx: PrismaClient,
  tenantId: string,
  runs: { id: string; branchId: string; businessDate: Date; postedAt: Date }[]
): Promise<Set<string>> {
  const stale = new Set<string>();
  if (runs.length === 0) return stale;

  const earliestPost = runs.reduce(
    (min, r) => (r.postedAt < min ? r.postedAt : min),
    runs[0].postedAt
  );
  const latestDay = runs.reduce(
    (max, r) => (r.businessDate > max ? r.businessDate : max),
    runs[0].businessDate
  );

  const recipes = await tx.recipe.findMany({
    where: {
      tenantId,
      deletedAt: null,
      supersededAt: null,
      menuId: { not: null },
      createdAt: { gt: earliestPost },
      effectiveFrom: { lte: latestDay },
    },
    select: { menuId: true, effectiveFrom: true, createdAt: true },
  });
  if (recipes.length === 0) return stale;

  const soldRows = await tx.salesLine.groupBy({
    by: ["branchId", "businessDate", "menuId"],
    where: {
      tenantId,
      supersededAt: null,
      branchId: { in: [...new Set(runs.map((r) => r.branchId))] },
      businessDate: { in: runs.map((r) => r.businessDate) },
      menuId: { in: recipes.map((r) => r.menuId as string) },
    },
  });
  const soldByDay = new Map<string, Set<string>>();
  for (const row of soldRows) {
    const key = `${row.branchId}|${row.businessDate.getTime()}`;
    const set = soldByDay.get(key) ?? new Set<string>();
    set.add(row.menuId);
    soldByDay.set(key, set);
  }

  for (const run of runs) {
    const sold = soldByDay.get(`${run.branchId}|${run.businessDate.getTime()}`);
    if (sold === undefined) continue;
    const overtaken = recipes.some(
      (r) =>
        sold.has(r.menuId as string) &&
        r.createdAt > run.postedAt &&
        r.effectiveFrom <= run.businessDate
    );
    if (overtaken) stale.add(run.id);
  }
  return stale;
}

/** The run's own JSONB record of what it could not post. */
function readSkipped(raw: Prisma.JsonValue | null): ConsumptionSkipRecord[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).map((entry) => {
    const s = entry as Record<string, string | null>;
    return {
      menuId: (s.menuId ?? "") as string,
      menuName: (s.menuName ?? "") as string,
      qty: (s.qty ?? "0") as string,
      netAmount: (s.netAmount ?? "0") as string,
      reason: s.reason as ConsumptionSkipReason,
      detail: s.detail ?? null,
    };
  });
}
