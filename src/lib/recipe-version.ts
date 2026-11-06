// ============================================================
// คิดครัว — which version of a recipe line serves a given day
// ============================================================
// A change of recipe leaves the old version LIVE for the days it covered
// (schema note on Recipe.supersededAt), so "every live version" is a history,
// not today's kitchen. The rule from the schema: of a line's live rows with
// effectiveFrom <= D, the one with the latest effectiveFrom, then the latest
// createdAt. Pure, so a count of today's recipes and the resolver agree.
// ============================================================

export type VersionRow = { id: string; lineId: string; effectiveFrom: Date; createdAt: Date };

/** The id of the version each line serves on `day` (rows already live: not deleted, not superseded, not draft). */
export function currentVersionIds(rows: readonly VersionRow[], day: Date): Set<string> {
  const best = new Map<string, VersionRow>();
  for (const r of rows) {
    if (r.effectiveFrom.getTime() > day.getTime()) continue;
    const cur = best.get(r.lineId);
    if (
      !cur ||
      r.effectiveFrom.getTime() > cur.effectiveFrom.getTime() ||
      (r.effectiveFrom.getTime() === cur.effectiveFrom.getTime() && r.createdAt.getTime() > cur.createdAt.getTime())
    )
      best.set(r.lineId, r);
  }
  return new Set([...best.values()].map((r) => r.id));
}
