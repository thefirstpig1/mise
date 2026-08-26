// ============================================================
// Mise — recipe coverage (Sprint 5 Part 24 L3c, ADR 0025 Q5)
// ============================================================
// One question: **how much of my gross profit is currently guessed?**
//
// A shop on the นับสต๊อก method gets a gross profit from opening + purchases −
// closing, which works with no recipes at all. The moment it switches to
// สูตรอาหาร, every dish without a recipe is a hole — Part 22 prints the figure
// with its coverage precisely so the hole is visible. This list is the other end
// of that sentence: which dishes to write a recipe for FIRST.
//
// So it ranks by REVENUE. Not by how often a dish sells, not alphabetically:
// the ฿180 curry sold 40 times a month matters more to the number being guessed
// than the ฿15 soda sold 400 times, and the ordering has to match the reason
// somebody sat down.
//
// **NOTHING IS GROUPED, HIDDEN OR MERGED.** A POS that reports ข้าวผัด three ways
// produces three rows. Each carries a per-row hint — "อาจซ้ำกับ …" — from the
// `pg_trgm` search built for Part 19, under ADR 0019's standing rule: a
// similarity score SUGGESTS, a person decides. Merging is Part 25, and until it
// exists the screen says so rather than quietly folding rows together.
// ============================================================

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { MAX_SUGGESTION_LOOKUPS, suggestMenusLogic } from "@/server/menu";
import { resolveRecipeIds } from "@/server/recipe-resolve";
import type { RecipeCoverageQuery } from "@/lib/validations/menu-lab";

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

/**
 * The default window when the caller names none. Thirty days is what a shop
 * means by "lately" — long enough that a slow Tuesday does not reorder the list,
 * short enough that a dish taken off the menu last month stops asking for a
 * recipe.
 */
const DEFAULT_PERIOD_DAYS = 30;

/** A dish that might be the same food under another spelling. Never an answer. */
export type DuplicateHint = {
  menuId: string;
  name: string;
  /** `similarity()`, 0–1. Shown, not thresholded a second time. */
  score: number;
  /**
   * Whether THAT menu already has a recipe — the difference between "you have
   * written this one already" and "you have two of the same problem".
   */
  hasRecipe: boolean;
};

export type CoverageRow = {
  menuId: string;
  name: string;
  /** Revenue: after discount, excluding VAT and service charge (Part 19). */
  revenue: Prisma.Decimal;
  qty: Prisma.Decimal;
  /** This dish's share of the period's revenue, as a percentage. */
  shareOfRevenue: Prisma.Decimal;
  /** Somebody is already working on it — a draft is not coverage (ADR 0025 Q4). */
  hasDraft: boolean;
  /** Sales exist and the dish does not any more. It cannot be worked on. */
  isDeleted: boolean;
  duplicateHint: DuplicateHint | null;
};

export type RecipeCoverage = {
  branchId: string | null;
  from: Date;
  to: Date;
  totalRevenue: Prisma.Decimal;
  coveredRevenue: Prisma.Decimal;
  uncoveredRevenue: Prisma.Decimal;
  /**
   * The headline, as a percentage of REVENUE — `null` when the period has no
   * revenue at all, because 0% would read as "nothing is covered" when the truth
   * is "there is nothing to cover yet". The same refusal Part 22 makes when it
   * prints gross profit by สูตรอาหาร with its coverage.
   */
  coveragePercent: Prisma.Decimal | null;
  /** Uncovered dishes, ranked by revenue, capped by `limit`. */
  rows: CoverageRow[];
  /** How many uncovered dishes there are in total — the list may be shorter. */
  uncoveredMenuCount: number;
  /**
   * Duplicate hints cost one trigram query each, so they stop after this many
   * rows. An ABSENT hint therefore means "not looked at", never "no duplicate" —
   * the screen must not let the difference disappear.
   */
  hintedRowCount: number;
};

/**
 * Which dishes sold, and which of them nothing can cost.
 *
 * **Covered means covered FOR THIS BRANCH when a branch is named.** A recipe
 * that exists centrally but was copied away by another branch is not this
 * branch's recipe (ADR 0021 Q8), so the question is put to the same resolver the
 * ledger uses. With no branch named the question is weaker on purpose — does any
 * live recipe exist for this dish — because a tenant-wide list that called a
 * dish uncovered wherever one branch had diverged would send people to write
 * recipes that already exist.
 *
 * A draft does NOT count as coverage. It cannot cost a day and cannot consume
 * stock, so a list that counted it would report profit as known while the ledger
 * still guessed it.
 */
export async function getRecipeCoverageLogic(
  tenantId: string,
  query: RecipeCoverageQuery
): Promise<RecipeCoverage> {
  const today = computeBangkokToday();
  const to = query.to ?? today;
  const from = query.from ?? addDays(to, -(DEFAULT_PERIOD_DAYS - 1));
  const branchId = query.branchId ?? null;

  return withTenantContext(tenantId, async (tx) => {
    const grouped = await tx.salesLine.groupBy({
      by: ["menuId"],
      where: {
        tenantId,
        // A replaced day's rows are kept as evidence (Part 19 Q5) and must not
        // be counted twice — or a re-imported day would double its own dishes to
        // the top of the list.
        supersededAt: null,
        businessDate: { gte: from, lte: to },
        ...(branchId === null ? {} : { branchId }),
      },
      _sum: { netAmount: true, qty: true },
    });

    const empty: RecipeCoverage = {
      branchId,
      from,
      to,
      totalRevenue: ZERO,
      coveredRevenue: ZERO,
      uncoveredRevenue: ZERO,
      coveragePercent: null,
      rows: [],
      uncoveredMenuCount: 0,
      hintedRowCount: 0,
    };
    if (grouped.length === 0) return empty;

    const menuIds = grouped.map((g) => g.menuId);
    const covered = await coveredMenuIds(tx, tenantId, menuIds, branchId, to);
    const drafted = await draftedMenuIds(tx, tenantId, menuIds);

    const menus = await tx.menu.findMany({
      where: { tenantId, id: { in: menuIds } },
      select: { id: true, name: true, deletedAt: true },
    });
    const menuById = new Map(menus.map((m) => [m.id, m]));

    let totalRevenue = ZERO;
    let coveredRevenue = ZERO;

    type Draft = Omit<CoverageRow, "shareOfRevenue" | "duplicateHint">;
    const uncovered: Draft[] = [];

    for (const g of grouped) {
      const revenue = g._sum.netAmount ?? ZERO;
      totalRevenue = totalRevenue.plus(revenue);

      if (covered.has(g.menuId)) {
        coveredRevenue = coveredRevenue.plus(revenue);
        continue;
      }

      const menu = menuById.get(g.menuId);
      uncovered.push({
        menuId: g.menuId,
        // A menu row that vanished under a sales line is a broken FK, not a
        // display problem — but a READ never throws for data reasons.
        name: menu?.name ?? "(ไม่พบเมนู)",
        revenue,
        qty: g._sum.qty ?? ZERO,
        hasDraft: drafted.has(g.menuId),
        isDeleted: menu?.deletedAt != null,
      });
    }

    const uncoveredRevenue = totalRevenue.minus(coveredRevenue);

    const ranked = uncovered
      .filter((r) => (query.hideWithDrafts ? !r.hasDraft : true))
      // Revenue, then name, so an ordering over equal figures is stable rather
      // than shuffling between refreshes.
      .sort((a, b) => {
        const byRevenue = b.revenue.comparedTo(a.revenue);
        return byRevenue !== 0 ? byRevenue : a.name.localeCompare(b.name, "th");
      });

    const shown = ranked.slice(0, query.limit);
    const hintable = Math.min(shown.length, MAX_SUGGESTION_LOOKUPS);
    const hints = await duplicateHints(
      tx,
      tenantId,
      shown.slice(0, hintable),
      branchId,
      to
    );

    return {
      branchId,
      from,
      to,
      totalRevenue,
      coveredRevenue,
      uncoveredRevenue,
      coveragePercent: totalRevenue.isZero()
        ? null
        : coveredRevenue.dividedBy(totalRevenue).times(HUNDRED),
      rows: shown.map((r) => ({
        ...r,
        shareOfRevenue: totalRevenue.isZero()
          ? ZERO
          : r.revenue.dividedBy(totalRevenue).times(HUNDRED),
        duplicateHint: hints.get(r.menuId) ?? null,
      })),
      uncoveredMenuCount: ranked.length,
      hintedRowCount: hintable,
    };
  });
}

// ------------------------------------------------------------
// The two questions behind "covered"
// ------------------------------------------------------------

async function coveredMenuIds(
  tx: PrismaClient,
  tenantId: string,
  menuIds: string[],
  branchId: string | null,
  asOf: Date
): Promise<Set<string>> {
  if (branchId !== null) {
    // The resolver: the same route the ledger takes, so "covered" here means
    // exactly what "postable" means there — drafts excluded, superseded
    // versions excluded, the branch's own recipe preferred over central.
    const resolved = await resolveRecipeIds(
      tx,
      tenantId,
      menuIds.map((id) => ({ kind: "menu" as const, id })),
      branchId,
      asOf
    );
    return new Set(
      menuIds.filter((id) => resolved.has(`menu:${id}`))
    );
  }

  const rows = await tx.recipe.findMany({
    where: {
      tenantId,
      menuId: { in: menuIds },
      deletedAt: null,
      supersededAt: null,
      isDraft: false,
      effectiveFrom: { lte: asOf },
    },
    select: { menuId: true },
  });
  return new Set(rows.map((r) => r.menuId as string));
}

async function draftedMenuIds(
  tx: PrismaClient,
  tenantId: string,
  menuIds: string[]
): Promise<Set<string>> {
  const rows = await tx.recipe.findMany({
    where: {
      tenantId,
      menuId: { in: menuIds },
      deletedAt: null,
      supersededAt: null,
      isDraft: true,
    },
    select: { menuId: true },
  });
  return new Set(rows.map((r) => r.menuId as string));
}

// ------------------------------------------------------------
// "อาจซ้ำกับ …"
// ------------------------------------------------------------

/**
 * One trigram lookup per row, capped by the caller — the same cap and the same
 * reason as Part 19's import preview (`MAX_SUGGESTION_LOOKUPS`).
 *
 * The dish itself is never its own hint, and the strongest OTHER match wins.
 * Whether that match already HAS a recipe is carried along, because the two
 * cases lead somewhere different: one is a recipe to copy, the other is two
 * dishes that both still need writing.
 */
async function duplicateHints(
  tx: PrismaClient,
  tenantId: string,
  rows: { menuId: string; name: string }[],
  branchId: string | null,
  asOf: Date
): Promise<Map<string, DuplicateHint>> {
  const best = new Map<string, Omit<DuplicateHint, "hasRecipe">>();
  for (const row of rows) {
    const hits = await suggestMenusLogic(tenantId, row.name, tx);
    const hit = hits.find((h) => h.id !== row.menuId);
    if (hit === undefined) continue;
    best.set(row.menuId, { menuId: hit.id, name: hit.name, score: hit.score });
  }
  if (best.size === 0) return new Map();

  // Asked separately, and not read off the coverage set: a dish that looks like
  // a duplicate may not have sold in this period at all, and a hint saying "no
  // recipe" about a recipe that exists is the one thing this line must not do.
  const hinted = [...new Set([...best.values()].map((b) => b.menuId))];
  const withRecipe = await coveredMenuIds(tx, tenantId, hinted, branchId, asOf);

  return new Map(
    [...best].map(([menuId, b]) => [
      menuId,
      { ...b, hasRecipe: withRecipe.has(b.menuId) },
    ])
  );
}
