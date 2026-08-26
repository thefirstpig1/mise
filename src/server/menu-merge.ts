// ============================================================
// Mise — menu merging writes (Sprint 5 Part 25 L3a, ADR 0026)
// ============================================================
// Two writes, and both of them write exactly one row.
//
// **A MERGE MOVES NOTHING.** No `sales_line` is repointed and none is
// superseded: that table takes no write after INSERT except the supersede pair,
// and it carries no `updatedAt` to record one (Part 19 Q5). Nor would moving
// them help — `menu_pos_identity_unique` has no `deleted_at` predicate, so the
// losing menu holds its POS code for ever, goes on matching byCode, and goes on
// collecting sales after the merge. A rewrite would have to re-run after every
// import, for ever.
//
// **NO RECIPE IS TOUCHED, EVER.** Q2: resolution gains a third fallback level
// (L3b), so a losing menu that already has a recipe keeps using it — for every
// past day it was posted against and every future one. Merging can only ADD
// costing where there was none. That is why nothing here asks which recipe
// survives, and why a merge cannot falsify a day that was already posted.
//
// **THE ONE THING THAT CAN CHANGE AN ALREADY-POSTED DAY** is a backdated
// `effectiveFrom` over days whose sales were skipped for want of a recipe: post
// them again and they would now deduct. That is a correction, not a
// falsification — the prawns were used — but it is not ours to make silently,
// so it refuses once and names the days.
//
// Money appears nowhere here, as in Parts 21 and 24.
// ============================================================

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { MenuNotFoundError } from "@/server/menu";
import type {
  MergeMenusInput,
  RevokeMergeInput,
} from "@/lib/validations/menu-merge";

/** A merge writes one row, but reads four times before it does. */
export const MERGE_WRITE_TIMEOUT_MS = 20_000;

export type MenuMergeRow = Prisma.MenuMergeGetPayload<object>;

// ------------------------------------------------------------
// Typed errors
// ------------------------------------------------------------

/**
 * This menu is already the spelling of some other dish.
 *
 * The database says the same through `menu_merge_live_losing_unique`, but a
 * constraint violation names nothing a person can act on, and the thing they
 * need is the merge that already exists — usually so they can revoke it and
 * point it somewhere else.
 */
export class MenuAlreadyMergedError extends Error {
  constructor(
    public readonly menuId: string,
    public readonly existingMergeId: string,
    public readonly existingWinningMenuId: string
  ) {
    super(`Menu "${menuId}" is already merged into "${existingWinningMenuId}"`);
    this.name = "MenuAlreadyMergedError";
  }
}

/**
 * The merge would make a chain: A → B where B → C, or A → B where somebody
 * already points at A.
 *
 * Refused so that folding is always ONE HOP — no loop to walk, no cycle to
 * guard, no depth to cap. A star is fine and is the ordinary case for a shop
 * with five branches; a chain is not. This spans rows, so no CHECK can see it
 * (the migration says so where the CHECKs are), exactly as the one-central-
 * recipe rule is application code for the same reason.
 */
export class MergeChainError extends Error {
  constructor(
    public readonly menuId: string,
    /** `winner` — the menu chosen as the dish is itself a spelling of something.
     *  `loser` — the menu being folded already has spellings of its own. */
    public readonly role: "winner" | "loser",
    public readonly otherMenuId: string
  ) {
    super(`Merging "${menuId}" as ${role} would create a chain`);
    this.name = "MergeChainError";
  }
}

/**
 * A backdated merge that reaches days whose stock deduction already stands.
 *
 * Not a failure — it is the first half of a two-step. Nothing on those days
 * changes until somebody posts them again, but that is precisely the trap: the
 * change would arrive later, from a different button, with nothing on screen
 * connecting it to this decision.
 */
export class MergeAffectsPostedDaysError extends Error {
  constructor(
    public readonly postedDayCount: number,
    public readonly earliestBusinessDate: Date
  ) {
    super(`Backdating this merge reaches ${postedDayCount} posted day(s)`);
    this.name = "MergeAffectsPostedDaysError";
  }
}

/** Revoking a merge that already deducted stock through the winner's recipe. */
export class RevokeAffectsPostedDaysError extends Error {
  constructor(public readonly postedDayCount: number) {
    super(`Revoking leaves ${postedDayCount} posted day(s) deducted as merged`);
    this.name = "RevokeAffectsPostedDaysError";
  }
}

export class MenuMergeNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Menu merge "${id}" not found`);
    this.name = "MenuMergeNotFoundError";
  }
}

// ------------------------------------------------------------
// Shared reads
// ------------------------------------------------------------

async function assertMenuBelongsToTenant(
  tx: PrismaClient,
  tenantId: string,
  menuId: string
): Promise<void> {
  const row = await tx.menu.findFirst({
    where: { id: menuId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (row === null) throw new MenuNotFoundError(menuId);
}

/**
 * How many days would deduct differently if they were posted again.
 *
 * The question is asked of the DOCUMENTS, not of the ledger — the same move
 * Part 22 L3d made for `cogsSold`. A day whose run was voided by a re-import no
 * longer stands, so it is not a day anybody would be surprised to see change;
 * counting movements by date would include it and overstate the warning.
 *
 * Only the losing menu's own sales days matter: those are the only rows whose
 * recipe resolution this merge can alter.
 */
async function postedDaysReached(
  tx: PrismaClient,
  tenantId: string,
  losingMenuId: string,
  from: Date
): Promise<{ count: number; earliest: Date | null }> {
  const soldOn = await tx.salesLine.groupBy({
    by: ["branchId", "businessDate"],
    where: {
      tenantId,
      menuId: losingMenuId,
      // A replaced day's rows are evidence, not sales — the filter every read
      // in this system applies.
      supersededAt: null,
      businessDate: { gte: from },
    },
  });
  if (soldOn.length === 0) return { count: 0, earliest: null };

  const runs = await tx.salesConsumptionRun.findMany({
    where: {
      tenantId,
      voidedAt: null,
      OR: soldOn.map((s) => ({
        branchId: s.branchId,
        businessDate: s.businessDate,
      })),
    },
    select: { businessDate: true },
    orderBy: { businessDate: "asc" },
  });

  return {
    count: runs.length,
    earliest: runs.length === 0 ? null : runs[0].businessDate,
  };
}

/** The live merge this menu is the LOSER of, if any. */
async function liveMergeAsLoser(
  tx: PrismaClient,
  tenantId: string,
  menuId: string
): Promise<{ id: string; winningMenuId: string } | null> {
  return tx.menuMerge.findFirst({
    where: { tenantId, losingMenuId: menuId, revokedAt: null },
    select: { id: true, winningMenuId: true },
  });
}

/** The live merge this menu is the WINNER of, if any. */
async function liveMergeAsWinner(
  tx: PrismaClient,
  tenantId: string,
  menuId: string
): Promise<{ id: string; losingMenuId: string } | null> {
  return tx.menuMerge.findFirst({
    where: { tenantId, winningMenuId: menuId, revokedAt: null },
    select: { id: true, losingMenuId: true },
  });
}

// ------------------------------------------------------------
// Merge
// ------------------------------------------------------------

/**
 * Declare that `losingMenuId` is `winningMenuId`'s spelling of the same dish.
 *
 * Order matters and is deliberate:
 *
 *  1. **Replay first.** Part 13.5's pattern — the `submitKey` IS the row id, so
 *     a double POST finds the row it already wrote and returns it rather than
 *     tripping the guards a second time and reporting a chain that is its own.
 *  2. **Both menus exist and are this tenant's.** Before anything is judged
 *     about them.
 *  3. **The chain rules**, which need both directions asked separately: a
 *     winner that is somebody's loser, and a loser that is somebody's winner.
 *  4. **The already-merged rule**, which the partial unique also enforces —
 *     checked here so the answer is a sentence naming the existing merge.
 *  5. **The posted-days warning LAST**, because it is the only refusal a person
 *     can override, and refusing it before the structural rules would let
 *     somebody acknowledge their way into a chain.
 */
export async function mergeMenusLogic(
  tenantId: string,
  input: MergeMenusInput,
  mergedBy: string
): Promise<MenuMergeRow> {
  return withTenantContext(
    tenantId,
    async (tx) => {
      const replay = await tx.menuMerge.findFirst({
        where: { tenantId, id: input.submitKey },
      });
      if (replay !== null) return replay;

      await assertMenuBelongsToTenant(tx, tenantId, input.losingMenuId);
      await assertMenuBelongsToTenant(tx, tenantId, input.winningMenuId);

      // The dish chosen as canonical must not itself be a spelling of something.
      const winnerIsALoser = await liveMergeAsLoser(
        tx,
        tenantId,
        input.winningMenuId
      );
      if (winnerIsALoser !== null) {
        throw new MergeChainError(
          input.winningMenuId,
          "winner",
          winnerIsALoser.winningMenuId
        );
      }

      // The menu being folded must not already have spellings folded into it.
      const loserIsAWinner = await liveMergeAsWinner(
        tx,
        tenantId,
        input.losingMenuId
      );
      if (loserIsAWinner !== null) {
        throw new MergeChainError(
          input.losingMenuId,
          "loser",
          loserIsAWinner.losingMenuId
        );
      }

      const already = await liveMergeAsLoser(tx, tenantId, input.losingMenuId);
      if (already !== null) {
        throw new MenuAlreadyMergedError(
          input.losingMenuId,
          already.id,
          already.winningMenuId
        );
      }

      const today = computeBangkokToday();
      if (input.effectiveFrom.getTime() < today.getTime()) {
        const reached = await postedDaysReached(
          tx,
          tenantId,
          input.losingMenuId,
          input.effectiveFrom
        );
        if (reached.count > 0 && !input.acknowledgeBackdate) {
          throw new MergeAffectsPostedDaysError(
            reached.count,
            reached.earliest as Date
          );
        }
      }

      return tx.menuMerge.create({
        data: {
          id: input.submitKey,
          tenantId,
          losingMenuId: input.losingMenuId,
          winningMenuId: input.winningMenuId,
          effectiveFrom: input.effectiveFrom,
          mergedBy,
        },
      });
    },
    { timeout: MERGE_WRITE_TIMEOUT_MS }
  );
}

// ------------------------------------------------------------
// Revoke
// ------------------------------------------------------------

/**
 * Stop treating one menu as another's spelling.
 *
 * The row is never deleted — `revokedAt`/`revokedBy` are set — so what the
 * reports said last month stays explainable. That pair is all-or-nothing in the
 * database (`menu_merge_revoked_pair_check`); a revoke with nobody responsible
 * is the shape `sales_line_superseded_pair_check` refuses one table over.
 *
 * **Revoking does not undo what was already deducted.** The ledger is
 * append-only, so stock taken through the winner's recipe stays taken until the
 * day is voided and posted afresh. Where such days exist the first attempt
 * refuses and names how many, and the acknowledgement is the screen's proof it
 * said so.
 *
 * Revoking something already revoked returns it. Not a guard against a double
 * click so much as a refusal to have a second, quieter meaning for the button.
 */
export async function revokeMergeLogic(
  tenantId: string,
  input: RevokeMergeInput,
  revokedBy: string
): Promise<MenuMergeRow> {
  return withTenantContext(
    tenantId,
    async (tx) => {
      const merge = await tx.menuMerge.findFirst({
        where: { id: input.mergeId, tenantId },
      });
      if (merge === null) throw new MenuMergeNotFoundError(input.mergeId);
      if (merge.revokedAt !== null) return merge;

      // Days that deducted while this merge stood — the ones a revoke cannot
      // reach. Asked from the merge's own effective date, because before it the
      // ledger never folded anything anyway.
      const reached = await postedDaysReached(
        tx,
        tenantId,
        merge.losingMenuId,
        merge.effectiveFrom
      );
      if (reached.count > 0 && !input.acknowledgePosted) {
        throw new RevokeAffectsPostedDaysError(reached.count);
      }

      return tx.menuMerge.update({
        where: { id: merge.id },
        data: { revokedAt: new Date(), revokedBy },
      });
    },
    { timeout: MERGE_WRITE_TIMEOUT_MS }
  );
}
