// ============================================================
// Mise — post consumption straight after a sales import (ADR 0022 amendment)
// ============================================================
// Kong 2026-10-24 (duplication review D1): a shop should not have to remember a
// second press after every import. ADR 0022 Q2 kept posting OUT of the import
// transaction so a recipe problem could never sink a good file — that still
// holds: this runs AFTER the commit, one day per transaction, and a day that
// fails is reported, never thrown. The file is already in.
//
// Unchanged from ADR 0022: posting AGAIN after a recipe edit (Q7) stays a
// person's decision — this only posts days that have no standing run, which is
// every day the import just added and every day its re-import just voided.
// ============================================================

import { postConsumptionForDayLogic, ConsumptionAlreadyPostedError } from "@/server/consumption-post";
import { isWithinBackdateWindow } from "@/server/consumption";

const AUTO_POST_PARALLEL = 4;

export type AutoPostSummary = {
  /** Days posted with every sold menu covered by a recipe. */
  postedFull: number;
  /** Days posted with some menus skipped (no recipe, a bad yield…). */
  postedPartial: number;
  /** Distinct menus skipped across those days. */
  skippedMenus: number;
  /** Older than the 90-day window every document keeps — imported, not posted. */
  outsideWindow: number;
  /** A run already stood (someone posted at the same moment). */
  alreadyPosted: number;
  /** Errors — the day stays unposted and can be posted from /consumption. */
  failed: number;
};

export async function autoPostImportedDaysLogic(
  tenantId: string,
  input: { batchId: string; branchId: string; days: Date[] },
  userId: string
): Promise<AutoPostSummary> {
  const out: AutoPostSummary = { postedFull: 0, postedPartial: 0, skippedMenus: 0, outsideWindow: 0, alreadyPosted: 0, failed: 0 };
  const skipped = new Set<string>();

  const postOne = async (businessDate: Date) => {
    if (!isWithinBackdateWindow(businessDate)) {
      out.outsideWindow++;
      return;
    }
    try {
      // The batch id is the submit key: retrying the same commit derives the
      // same run id per day (runIdFor) and finds the run it already wrote.
      const res = await postConsumptionForDayLogic(
        tenantId,
        { submitKey: input.batchId, branchId: input.branchId, businessDate, acknowledgeRepost: false },
        userId
      );
      if (res.run.menusSkipped > 0) out.postedPartial++;
      else out.postedFull++;
      for (const s of res.demand.skipped) skipped.add(s.menuId);
    } catch (e) {
      if (e instanceof ConsumptionAlreadyPostedError) out.alreadyPosted++;
      else {
        out.failed++;
        console.error(`[auto-post] ${businessDate.toISOString().slice(0, 10)} failed`, e);
      }
    }
  };

  // Days are independent (one run, one transaction each — ADR 0022 Q2b), so a
  // few run side by side: one at a time held a 30-day file's import screen for
  // ~a minute (≈1.5–2 s a day to Neon Singapore).
  const queue = [...input.days];
  await Promise.all(
    Array.from({ length: Math.min(AUTO_POST_PARALLEL, queue.length) }, async () => {
      for (let d = queue.shift(); d !== undefined; d = queue.shift()) await postOne(d);
    })
  );
  out.skippedMenus = skipped.size;
  return out;
}
