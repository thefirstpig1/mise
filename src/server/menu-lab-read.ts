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
import { getWhatIfCostLogic, type RecipeCost } from "@/server/recipe-cost";
import type {
  LabWhatIfQuery,
  RecipeCoverageQuery,
} from "@/lib/validations/menu-lab";

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

// ------------------------------------------------------------
// The drafts somebody is in the middle of (L5a)
// ------------------------------------------------------------

/**
 * A draft on its way to a list.
 *
 * No cost on it. Costing N drafts is N graph walks against a FIFO replay, and a
 * list is not where a person weighs a price — the lab screen is, one dish at a
 * time, with the branch named beside the figure (Q6). A cheap number on a list
 * would be the one figure in this Part that arrives without its confidence.
 */
export type DraftRow = {
  recipeId: string;
  menuId: string;
  menuName: string;
  /**
   * The menu was created by the lab, so no POS knows it (Q3). Until Part 25 can
   * merge, these accumulate — and a person looking at the list should be able
   * to see which dishes are experiments and which are things the shop sells.
   */
  menuIsMise: boolean;
  plannedPrice: Prisma.Decimal | null;
  servings: Prisma.Decimal;
  ingredientCount: number;
  updatedAt: Date;
  /**
   * The dish already has a live CENTRAL recipe, which publishing takes over.
   * Non-null is not a problem — drafting a change to a dish that sells is half
   * of what the lab is for — but the screen must say so before the button, not
   * after: nothing about tomorrow's figures looks different, because yesterday
   * stays costed against yesterday's recipe.
   */
  liveRecipeId: string | null;
  /**
   * The dish has sales. Q2: from then on the SOLD price is the price, and
   * ราคาที่ตั้งใจ sits beside it as a comparison, never in place of it. This is
   * what `PLANNED_PRICE_VS_SOLD_HINT_TH` is for.
   */
  hasSales: boolean;
};

/**
 * Every draft in the tenant, newest first.
 *
 * Drafts are not scoped to a branch: a draft resolves on no day at no branch
 * (L3b), so there is no branch whose question this list would be answering.
 */
export async function getDraftsLogic(tenantId: string): Promise<DraftRow[]> {
  return withTenantContext(tenantId, async (tx) => {
    const drafts = await tx.recipe.findMany({
      where: { tenantId, isDraft: true, deletedAt: null },
      select: {
        id: true,
        menuId: true,
        servings: true,
        plannedPrice: true,
        updatedAt: true,
        menu: { select: { id: true, name: true, source: true } },
        _count: { select: { ingredients: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    if (drafts.length === 0) return [];

    // A draft always hangs off a menu — `createDraftLogic` makes one when the
    // dish does not exist — but `recipe.menuId` is nullable for the production
    // recipes Part 21 writes, so the narrowing is real rather than ceremonial.
    const menuIds = [
      ...new Set(
        drafts
          .map((d) => d.menuId)
          .filter((id): id is string => id !== null)
      ),
    ];

    const [liveRows, links, sold] = await Promise.all([
      // The same rule `liveLinesFor` applies, asked once for the whole list
      // instead of once per row: live, not superseded, NOT A DRAFT.
      tx.recipe.findMany({
        where: {
          tenantId,
          deletedAt: null,
          supersededAt: null,
          isDraft: false,
          menuId: { in: menuIds },
        },
        select: { id: true, lineId: true, menuId: true },
      }),
      tx.recipeBranch.findMany({ where: { tenantId }, select: { lineId: true } }),
      // A replaced day's rows are evidence, not sales — the same filter the
      // coverage read applies, for the same reason.
      tx.salesLine.groupBy({
        by: ["menuId"],
        where: { tenantId, menuId: { in: menuIds }, supersededAt: null },
        _count: { _all: true },
      }),
    ]);

    const linked = new Set(links.map((l) => l.lineId));
    const liveCentralByMenu = new Map<string, string>();
    for (const r of liveRows) {
      // A branch recipe is not what publishing displaces (Q8): a branch that
      // copied a recipe stopped following central, and central is what a draft
      // replaces.
      if (r.menuId === null || linked.has(r.lineId)) continue;
      liveCentralByMenu.set(r.menuId, r.id);
    }
    const hasSales = new Set(sold.map((s) => s.menuId));

    return drafts.map((d) => ({
      recipeId: d.id,
      menuId: d.menuId ?? "",
      menuName: d.menu?.name ?? "",
      menuIsMise: d.menu?.source === "MISE",
      plannedPrice: d.plannedPrice,
      servings: d.servings,
      ingredientCount: d._count.ingredients,
      updatedAt: d.updatedAt,
      liveRecipeId: d.menuId === null ? null : (liveCentralByMenu.get(d.menuId) ?? null),
      hasSales: d.menuId !== null && hasSales.has(d.menuId),
    }));
  });
}

// ------------------------------------------------------------
// The live calculator (Q3, Q6)
// ------------------------------------------------------------

/** A tenant with no branch cannot be asked what anything costs (ADR 0014 Q9). */
export class NoBranchForCostError extends Error {
  constructor() {
    super("This tenant has no branch to cost against");
    this.name = "NoBranchForCostError";
  }
}

export type LabWhatIf = {
  /** Walked by the same engine as every other recipe — never a second one. */
  cost: RecipeCost;
  branchId: string;
  /** Q6: the branch's NAME sits beside the number, not in a setting. */
  branchName: string;
  /** True when the branch was chosen for the person rather than by them. */
  branchWasDefaulted: boolean;
  plannedPrice: Prisma.Decimal | null;
  /**
   * `costPerServing ÷ ราคาที่ตั้งใจ × 100` — the number the whole screen exists
   * for. `null` without a planned price, never 0: a food cost of 0% would be
   * the most flattering possible answer to a question nobody asked.
   *
   * It carries `cost.confidence` wherever it is shown. A 22% food cost over
   * ingredients half of which are UNPRICED is not a 22% food cost.
   */
  foodCostPercent: Prisma.Decimal | null;
  grossProfitPerServing: Prisma.Decimal | null;
};

/**
 * Cost the lines somebody is typing, at one branch, with the price they are
 * considering.
 *
 * The branch is not optional to the ENGINE — a two-branch shop buying pork at
 * two prices has two answers (ADR 0014 Q9) — so when the caller names none, the
 * one with the freshest purchases is chosen and said out loud.
 */
export async function getLabWhatIfLogic(
  tenantId: string,
  query: LabWhatIfQuery
): Promise<LabWhatIf> {
  const chosen =
    query.branchId === undefined
      ? await freshestCostBranch(tenantId)
      : await namedBranch(tenantId, query.branchId);

  const cost = await getWhatIfCostLogic(tenantId, {
    lines: query.ingredients.map((l) => ({
      productId: l.productId,
      componentMenuId: l.componentMenuId,
      qty: l.qty,
      productUnitId: l.productUnitId,
      sortOrder: l.sortOrder,
    })),
    servings: query.servings,
    branchId: chosen.id,
  });

  const plannedPrice =
    query.plannedPrice === null ? null : new Prisma.Decimal(query.plannedPrice);

  return {
    cost,
    branchId: chosen.id,
    branchName: chosen.name,
    branchWasDefaulted: query.branchId === undefined,
    plannedPrice,
    foodCostPercent:
      plannedPrice === null || plannedPrice.isZero()
        ? null
        : cost.costPerServing.dividedBy(plannedPrice).times(HUNDRED),
    grossProfitPerServing:
      plannedPrice === null ? null : plannedPrice.minus(cost.costPerServing),
  };
}

/**
 * The branch whose cost data is freshest — the most recent PURCHASE, because
 * that is where FIFO money comes from. A branch that has only ever transferred
 * stock in is priced by whatever the sending branch paid, which is a frozen
 * figure rather than a fresh one (ADR 0018).
 *
 * A shop that has never received anything falls back to its first branch by
 * name: every ingredient will read UNPRICED, which is the honest state of a
 * dish nobody has bought anything for, and the confidence badge says so.
 */
async function freshestCostBranch(
  tenantId: string
): Promise<{ id: string; name: string }> {
  return withTenantContext(tenantId, async (tx) => {
    const branches = await tx.branch.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    if (branches.length === 0) throw new NoBranchForCostError();
    if (branches.length === 1) return branches[0];

    const latest = await tx.stockMovement.groupBy({
      by: ["branchId"],
      where: { tenantId, type: "PO_RECEIVE" },
      _max: { occurredAt: true },
    });
    if (latest.length === 0) return branches[0];

    const at = (r: (typeof latest)[number]) =>
      r._max?.occurredAt?.getTime() ?? 0;
    const best = latest.reduce((a, b) => (at(b) > at(a) ? b : a));
    return branches.find((b) => b.id === best.branchId) ?? branches[0];
  });
}

async function namedBranch(
  tenantId: string,
  branchId: string
): Promise<{ id: string; name: string }> {
  return withTenantContext(tenantId, async (tx) => {
    const branch = await tx.branch.findFirst({
      where: { id: branchId, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (branch === null) throw new NoBranchForCostError();
    return branch;
  });
}
