// ============================================================
// Mise — folding merged menus (Sprint 5 Part 25 L3b, ADR 0026)
// ============================================================
// One definition of "which menu does this one count as", used by every read
// that must fold and by none that must not.
//
// **THE DATE MEANS TWO DIFFERENT THINGS, AND THAT IS THE WHOLE OF Q5.**
//
//   Reporting  — `loadMergeFold(tx, tenantId)` with no date. Every live merge
//                folds, retroactively and always, because reporting stores
//                nothing and reverses instantly, and "these are the same dish"
//                is a fact about the dish rather than an event that happened on
//                a Tuesday.
//   The ledger — `loadMergeFold(tx, tenantId, asOf)`. Only merges effective on
//                or before that business date, because writing movements into a
//                past day changes what happened. This is used in exactly one
//                place: `recipe-resolve.ts`, the single route by which a recipe
//                reaches `stock_movement`.
//
// **ONE HOP, ALWAYS.** `mergeMenusLogic` refuses chains in both directions, so a
// canonical menu is never itself merged and the map never needs walking. If that
// guard were ever lost, this file would quietly return a half-folded answer —
// which is why the guard has its own tests rather than being assumed here.
//
// **READS THAT MUST NOT FOLD** are as load-bearing as the ones that must:
// `planMenuResolutionLogic` has to keep matching the real POS code or the next
// import lands nowhere, and the menu screen has to keep showing both rows or a
// merge is something nobody can see or undo.
// ============================================================

import type { PrismaClient } from "@prisma/client";

export type MergeFold = {
  /** losing menu → the menu it counts as. One hop; never a chain. */
  canonical: Map<string, string>;
  /** canonical menu → every menu that counts as it. */
  spellings: Map<string, string[]>;
};

export const EMPTY_FOLD: MergeFold = {
  canonical: new Map(),
  spellings: new Map(),
};

/**
 * Every merge that applies, as a pair of maps.
 *
 * Revoked merges are excluded at every date: a revoke means "this was never the
 * same dish after all", and unlike `effectiveFrom` it is not a fact with a
 * start — the row is kept so last month's report stays explainable, not so it
 * keeps applying.
 *
 * One query. A restaurant has hundreds of menus and a handful of merges, so the
 * whole set is loaded rather than asked per menu; if that ever stops being true
 * this is the function to revisit, and the fix is to pass the menu ids in.
 */
export async function loadMergeFold(
  tx: PrismaClient,
  tenantId: string,
  /** Business date for a LEDGER read. Omit for a reporting read. */
  asOf?: Date
): Promise<MergeFold> {
  const rows = await tx.menuMerge.findMany({
    where: {
      tenantId,
      revokedAt: null,
      ...(asOf === undefined ? {} : { effectiveFrom: { lte: asOf } }),
    },
    select: { losingMenuId: true, winningMenuId: true },
  });
  if (rows.length === 0) return EMPTY_FOLD;

  const canonical = new Map<string, string>();
  const spellings = new Map<string, string[]>();
  for (const r of rows) {
    canonical.set(r.losingMenuId, r.winningMenuId);
    const list = spellings.get(r.winningMenuId);
    if (list === undefined) spellings.set(r.winningMenuId, [r.losingMenuId]);
    else list.push(r.losingMenuId);
  }
  return { canonical, spellings };
}

/** What this menu counts as. Itself, when nothing was merged. */
export function foldMenuId(fold: MergeFold, menuId: string): string {
  return fold.canonical.get(menuId) ?? menuId;
}

/**
 * A menu plus every spelling of it — for a read that starts from the dish and
 * has to find sales filed under its other names.
 *
 * The direction matters: `foldMenuId` answers "what does this row count as",
 * this answers "which rows count as this". A read that used the wrong one
 * silently finds nothing rather than failing.
 */
export function expandMenuIds(
  fold: MergeFold,
  menuIds: readonly string[]
): string[] {
  const out = new Set<string>(menuIds);
  for (const id of menuIds) {
    for (const spelling of fold.spellings.get(id) ?? []) out.add(spelling);
  }
  return [...out];
}

/**
 * Collapse rows keyed by menu onto their canonical menus.
 *
 * `combine` is given the row already accumulated and the next one, and returns
 * the accumulation — the caller decides what adding two rows means, because
 * summing revenue and summing a quantity in different units are not the same
 * operation and this file has no business guessing.
 *
 * Order is preserved by first appearance, so a caller that sorted its query is
 * not silently re-ordered.
 */
export function foldRowsByMenu<T>(
  fold: MergeFold,
  rows: readonly T[],
  menuIdOf: (row: T) => string,
  combine: (into: T, next: T) => T
): T[] {
  if (fold.canonical.size === 0) return [...rows];

  const byCanonical = new Map<string, T>();
  for (const row of rows) {
    const key = foldMenuId(fold, menuIdOf(row));
    const existing = byCanonical.get(key);
    byCanonical.set(key, existing === undefined ? row : combine(existing, row));
  }
  return [...byCanonical.values()];
}
