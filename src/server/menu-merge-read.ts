// ============================================================
// Mise — menu merging reads (Sprint 5 Part 25 L4, ADR 0026)
// ============================================================
// The two reads the merge screen needs, and neither of them folds.
//
// **THIS FILE IS ON THE "NEVER FOLDS" SIDE OF Q6'S TABLE**, together with
// `planMenuResolutionLogic` and the menu screen. Every other read in Part 25
// exists to make two rows look like one dish; these two exist to show the two
// rows. A merge screen that folded would hide the very row a person came to
// point at, and a merge nobody can see is a merge nobody can undo.
//
// So `loadMergeFold` is deliberately not imported here. What IS loaded is the
// merges themselves — as facts about candidates, not as a rewriting of them:
// each candidate carries whether it is already somebody's spelling and how many
// spellings it already owns, because those are exactly the two states
// `mergeMenusLogic` refuses (Q4), and the screen should say so before the person
// presses the button rather than after.
//
// Money appears nowhere here, as in Parts 21, 24 and L3a.
// ============================================================

import type { MenuSource, Prisma, PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { MenuNotFoundError, suggestMenusLogic } from "@/server/menu";
import type {
  MenuMergeListQuery,
  MergeCandidatesQuery,
} from "@/lib/validations/menu-merge";

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

// ------------------------------------------------------------
// The merges themselves
// ------------------------------------------------------------

/**
 * A merge with both menus attached.
 *
 * Both ends are always loaded, never just the loser: the whole content of the
 * row is a relationship, and a screen showing one end of it would be asking
 * somebody to remember the other.
 */
export type MenuMergeWithMenus = Prisma.MenuMergeGetPayload<{
  include: {
    losingMenu: { include: { posIntegration: { include: { branch: true } } } };
    winningMenu: { include: { posIntegration: { include: { branch: true } } } };
  };
}>;

const MERGE_INCLUDE = {
  losingMenu: { include: { posIntegration: { include: { branch: true } } } },
  winningMenu: { include: { posIntegration: { include: { branch: true } } } },
} as const;

/**
 * A restaurant has hundreds of menus and a handful of merges, so there is no
 * paging here — the same assumption `loadMergeFold` makes, and the same function
 * to revisit if it ever stops being true.
 */
export const MAX_MERGE_ROWS = 500;

/**
 * Every merge, live first.
 *
 * `includeRevoked` is off by default because a revoked merge is history, and
 * history sitting in a list of live things is a row somebody acts on by mistake.
 * When it IS asked for, revoked rows sort last: they are kept so last month's
 * report stays explainable, not so they keep applying.
 */
export async function getMenuMergesLogic(
  tenantId: string,
  query: MenuMergeListQuery,
  client?: Tx
): Promise<MenuMergeWithMenus[]> {
  const run = async (tx: Tx) =>
    tx.menuMerge.findMany({
      where: {
        tenantId,
        ...(query.includeRevoked ? {} : { revokedAt: null }),
        ...(query.winningMenuId ? { winningMenuId: query.winningMenuId } : {}),
      },
      include: MERGE_INCLUDE,
      // Live before revoked, then grouped under the dish, then oldest spelling
      // first — the order the menu screen nests them in (Q6).
      orderBy: [
        { revokedAt: { sort: "asc", nulls: "first" } },
        { winningMenuId: "asc" },
        { createdAt: "asc" },
      ],
      take: MAX_MERGE_ROWS,
    });

  return client ? run(client) : withTenantContext(tenantId, run);
}

// ------------------------------------------------------------
// Candidates
// ------------------------------------------------------------

/**
 * A dish this menu might be another spelling of — plus the two facts that decide
 * whether it may be picked, and in which role.
 *
 * ⚠️ `score` is a `pg_trgm` similarity and carries ADR 0019 Q7's standing rule
 * unchanged: it SUGGESTS. *ผัดกะเพราหมู* and *ผัดกะเพราไก่* score high and are
 * different dishes, so nothing downstream may treat the top row as an answer,
 * and no code path may ever turn this list into a merge without a person.
 */
export interface MergeCandidate {
  id: string;
  name: string;
  posMenuName: string | null;
  /** The POS code this row holds for ever (Context 3) — null for a MISE menu. */
  posMenuCode: string | null;
  source: MenuSource;
  /**
   * The branch whose POS sends this row. Q7: the screen offers a cross-branch
   * merge and explains the difference, and the difference IS the branch — for a
   * multi-branch shop that is the entire reason the duplicate exists.
   */
  branchId: string | null;
  branchName: string | null;
  isPosStub: boolean;
  score: number;
  /**
   * The dish this candidate is ALREADY a spelling of, if any.
   *
   * Non-null means two things at once: it cannot be merged again (the partial
   * unique says so), and choosing it as the WINNER would be the chain Q4
   * forbids. Both refusals live in `mergeMenusLogic`; this is so the screen can
   * say it first.
   */
  mergedIntoMenuId: string | null;
  /**
   * How many spellings already fold into this candidate.
   *
   * `> 0` means it may still be chosen as the winner — a star may grow — but it
   * may never be the loser.
   */
  spellingCount: number;
}

/** The menu the question was asked about, in the same shape as its candidates. */
export type MergeSubject = Omit<MergeCandidate, "score">;

export interface MergeCandidateResult {
  subject: MergeSubject;
  candidates: MergeCandidate[];
}

type MenuWithBranch = Prisma.MenuGetPayload<{
  include: { posIntegration: { include: { branch: true } } };
}>;

const MENU_INCLUDE = {
  posIntegration: { include: { branch: true } },
} as const;

function toSubject(
  m: MenuWithBranch,
  mergedIntoMenuId: string | null,
  spellingCount: number
): MergeSubject {
  return {
    id: m.id,
    name: m.name,
    posMenuName: m.posMenuName,
    posMenuCode: m.posMenuId,
    source: m.source,
    branchId: m.posIntegration?.branchId ?? null,
    branchName: m.posIntegration?.branch.name ?? null,
    isPosStub: m.isPosStub,
    mergedIntoMenuId,
    spellingCount,
  };
}

/**
 * "What else might this dish be?"
 *
 * Part 19's search, pointed at one menu's own name rather than at a name off a
 * file. It is a separate step from the merge itself for the reason ADR 0019 Q7
 * gives: a score suggests, a person decides.
 *
 * Three things are dropped before the list is returned, in this order:
 *
 *  1. **The menu itself**, which always scores 1.0 against its own name.
 *  2. **Menus already merged into something**, unless asked for — offering one
 *     invites the chain Q4 forbids, and picking it as a loser would collide with
 *     `menu_merge_live_losing_unique` anyway.
 *  3. **Everything past `limit`.** Trimmed LAST, so the cap limits what is worth
 *     reading rather than what was searched — otherwise excluding the subject
 *     would silently shorten the list by one.
 *
 * What is deliberately NOT dropped is a candidate that already owns spellings:
 * it is the ordinary winner for a shop merging its third branch in, and hiding
 * it would push people into starting a second star for the same dish.
 */
export async function getMergeCandidatesLogic(
  tenantId: string,
  query: MergeCandidatesQuery,
  client?: Tx
): Promise<MergeCandidateResult> {
  const run = async (tx: Tx): Promise<MergeCandidateResult> => {
    const subject = await tx.menu.findFirst({
      where: { id: query.menuId, tenantId, deletedAt: null },
      include: MENU_INCLUDE,
    });
    if (subject === null) throw new MenuNotFoundError(query.menuId);

    // Every live merge, once. A handful of rows, and needed twice over: for the
    // subject's own state and for every candidate's.
    const live = await tx.menuMerge.findMany({
      where: { tenantId, revokedAt: null },
      select: { losingMenuId: true, winningMenuId: true },
    });
    const mergedInto = new Map<string, string>();
    const spellings = new Map<string, number>();
    for (const m of live) {
      mergedInto.set(m.losingMenuId, m.winningMenuId);
      spellings.set(m.winningMenuId, (spellings.get(m.winningMenuId) ?? 0) + 1);
    }

    const subjectView = toSubject(
      subject,
      mergedInto.get(subject.id) ?? null,
      spellings.get(subject.id) ?? 0
    );

    // The POS name is searched too when it differs: the duplicate a multi-branch
    // shop is looking for is usually the row whose POS spells it differently,
    // which is exactly the row Mise's own name has drifted away from.
    const terms = [subject.name];
    if (subject.posMenuName && subject.posMenuName !== subject.name) {
      terms.push(subject.posMenuName);
    }

    const bestScore = new Map<string, number>();
    for (const term of terms) {
      for (const s of await suggestMenusLogic(tenantId, term, tx)) {
        const seen = bestScore.get(s.id);
        if (seen === undefined || s.score > seen) bestScore.set(s.id, s.score);
      }
    }
    bestScore.delete(subject.id);

    const ids = [...bestScore.keys()].filter(
      (id) => query.includeMerged || !mergedInto.has(id)
    );
    if (ids.length === 0) return { subject: subjectView, candidates: [] };

    const rows = await tx.menu.findMany({
      where: { id: { in: ids }, tenantId, deletedAt: null },
      include: MENU_INCLUDE,
    });

    const candidates = rows
      .map((m) => ({
        ...toSubject(m, mergedInto.get(m.id) ?? null, spellings.get(m.id) ?? 0),
        score: bestScore.get(m.id) ?? 0,
      }))
      // Best first, then a stable tiebreak, so two identical scores do not swap
      // places between two loads of the same screen.
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "th"))
      .slice(0, query.limit);

    return { subject: subjectView, candidates };
  };

  return client ? run(client) : withTenantContext(tenantId, run);
}
