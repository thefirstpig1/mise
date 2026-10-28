// ============================================================
// Mise — "เมนูที่น่าจะซ้ำ": the merge screen's opening list (Kong, 2026-10-28)
// ============================================================
// The old screen opened on an empty search box, although its whole job is to
// find duplicates — and a five-branch shop has one per dish per branch (ADR
// 0026: duplicates are the DEFAULT past one branch). This read finds them.
//
// ADR 0019 Q7 is unchanged: a score SUGGESTS. Nothing here merges anything; a
// group is a question the screen asks, and the person ticks which rows really
// are one dish before the merge action runs pair by pair.
//
// How a group is built — and why it is not plain "everything similar":
//  1. Pairs come only from DIFFERENT POS integrations. A duplicate exists
//     because each branch's POS sends its own code; two rows from one POS are
//     two dishes the shop typed twice on purpose (กะเพราหมู / กะเพราไก่).
//  2. Pairs join best-score first, and a group may hold at most ONE row per
//     POS. Without that rule กะเพราหมู(อารีย์) ~ กะเพราหมู(ลาดพร้าว) ~
//     กะเพราไก่(อารีย์) would chain into one group of two different dishes.
//  3. A row already folded into another (a loser) is never offered — it is
//     done. Its winner IS offered, carrying its spellings' POS as taken, so a
//     third branch joins the existing star instead of starting a second one.
// ============================================================

import type { PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";

type Tx = PrismaClient;

/** Higher than the search's 0.4: an opening list should be worth reading. */
export const MERGE_SUGGEST_THRESHOLD = 0.5;
/** Sales are shown for this many days, ending on the shop's latest sales day. */
export const MERGE_SALES_WINDOW_DAYS = 30;

export type MergeMenuFacts = {
  id: string;
  name: string;
  posMenuCode: string | null;
  posIntegrationId: string | null;
  branchId: string | null;
  branchName: string | null;
  isRetired: boolean;
  /** Sales of THIS row in the window — never folded, this screen never folds. */
  net: number;
  qty: number;
  hasRecipe: boolean;
  mergedIntoMenuId: string | null;
  spellingIds: string[];
};

export type MergeSuggestion = { kind: "exact" | "near"; menuIds: string[]; net: number };

export type MergeOverview = {
  menus: MergeMenuFacts[];
  suggestions: MergeSuggestion[];
  salesWindow: { from: string; to: string } | null;
};

/** Same dish typed with different spacing or brackets counts as "ชื่อตรงกัน". */
export function sameNameKey(name: string): string {
  return name
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s()（）[\]\-_.,/]+/g, "");
}

type Pair = { a: string; b: string; score: number };

/**
 * Pure: the grouping rules above, given the menus and the scored pairs. Kept
 * apart from the database so the two rules a test must pin — one row per POS,
 * losers never offered — can be pinned without one.
 */
export function groupSuggestions(menus: readonly MergeMenuFacts[], pairs: readonly Pair[]): MergeSuggestion[] {
  const byId = new Map(menus.map((m) => [m.id, m]));
  const offerable = (id: string) => {
    const m = byId.get(id);
    return m !== undefined && m.mergedIntoMenuId === null;
  };
  // POS integrations a menu "occupies": its own, plus its spellings'.
  const posOf = (id: string): string[] => {
    const m = byId.get(id)!;
    const own = m.posIntegrationId ?? `mise:${m.id}`;
    return [own, ...m.spellingIds.map((s) => byId.get(s)?.posIntegrationId ?? `mise:${s}`)];
  };

  const groupOf = new Map<string, Set<string>>();
  const posIn = new Map<Set<string>, Set<string>>();
  const ensure = (id: string) => {
    let g = groupOf.get(id);
    if (!g) {
      g = new Set([id]);
      groupOf.set(id, g);
      posIn.set(g, new Set(posOf(id)));
    }
    return g;
  };

  for (const p of [...pairs].sort((x, y) => y.score - x.score)) {
    if (!offerable(p.a) || !offerable(p.b)) continue;
    const ga = ensure(p.a);
    const gb = ensure(p.b);
    if (ga === gb) continue;
    const pa = posIn.get(ga)!;
    const pb = posIn.get(gb)!;
    if ([...pb].some((x) => pa.has(x))) continue; // rule 2: one row per POS
    for (const id of gb) {
      ga.add(id);
      groupOf.set(id, ga);
    }
    for (const x of pb) pa.add(x);
    posIn.delete(gb);
  }

  const out: MergeSuggestion[] = [];
  for (const g of posIn.keys()) {
    if (g.size < 2) continue;
    const ids = [...g].sort((x, y) => (byId.get(y)!.net - byId.get(x)!.net) || x.localeCompare(y));
    const keys = new Set(ids.map((id) => sameNameKey(byId.get(id)!.name)));
    out.push({ kind: keys.size === 1 ? "exact" : "near", menuIds: ids, net: ids.reduce((t, id) => t + byId.get(id)!.net, 0) });
  }
  return out.sort((a, b) => b.net - a.net || a.menuIds[0].localeCompare(b.menuIds[0]));
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Which recipe-less dishes are probably another branch's copy of a dish that
 * HAS a recipe (Kong 2026-10-28/29): merging fixes those, writing a second
 * recipe does not. Keyed by the copy; the value is the group's best-selling
 * member with a recipe. A group where nobody has a recipe names nobody.
 */
export function likelyDuplicateOf(overview: Pick<MergeOverview, "menus" | "suggestions">): Record<string, { id: string; name: string; code: string | null }> {
  const byId = new Map(overview.menus.map((m) => [m.id, m]));
  const out: Record<string, { id: string; name: string; code: string | null }> = {};
  for (const g of overview.suggestions) {
    const members = g.menuIds.map((id) => byId.get(id)).filter((m): m is MergeMenuFacts => m !== undefined);
    const main = members.filter((m) => m.hasRecipe).sort((a, b) => b.net - a.net)[0];
    if (!main) continue;
    for (const m of members) if (!m.hasRecipe) out[m.id] = { id: main.id, name: main.name, code: main.posMenuCode };
  }
  return out;
}

/** Every menu with the facts a merge decision needs, and the suggested groups. */
export async function getMergeOverviewLogic(tenantId: string, client?: Tx): Promise<MergeOverview> {
  const run = async (tx: Tx): Promise<MergeOverview> => {
    const [menus, live, latest, recipes] = await Promise.all([
      tx.menu.findMany({
        where: { tenantId, deletedAt: null },
        select: {
          id: true,
          name: true,
          posMenuId: true,
          posIntegrationId: true,
          isActive: true,
          posIntegration: { select: { branchId: true, branch: { select: { name: true } } } },
        },
      }),
      tx.menuMerge.findMany({ where: { tenantId, revokedAt: null }, select: { losingMenuId: true, winningMenuId: true } }),
      tx.salesLine.aggregate({ where: { tenantId, supersededAt: null }, _max: { businessDate: true } }),
      tx.recipe.groupBy({ by: ["menuId"], where: { tenantId, menuId: { not: null }, supersededAt: null, isDraft: false, deletedAt: null } }),
    ]);

    const end = latest._max.businessDate;
    const window = end
      ? { from: new Date(end.getTime() - (MERGE_SALES_WINDOW_DAYS - 1) * 86_400_000), to: end }
      : null;
    const [sales, pairs] = await Promise.all([
      window
        ? tx.salesLine.groupBy({
            by: ["menuId"],
            where: { tenantId, supersededAt: null, businessDate: { gte: window.from, lte: window.to } },
            _sum: { netAmount: true, qty: true },
          })
        : Promise.resolve([]),
      tx.$queryRaw<{ a: string; b: string; score: number }[]>`
        SELECT a.id AS a, b.id AS b, similarity(a.name, b.name) AS score
        FROM menu a
        JOIN menu b ON b.tenant_id = a.tenant_id AND a.id < b.id
        WHERE a.tenant_id = ${tenantId}::uuid
          AND a.deleted_at IS NULL AND b.deleted_at IS NULL
          AND a.pos_integration_id IS DISTINCT FROM b.pos_integration_id
          AND similarity(a.name, b.name) > ${MERGE_SUGGEST_THRESHOLD}
      `,
    ]);

    const mergedInto = new Map(live.map((m) => [m.losingMenuId, m.winningMenuId]));
    const spellings = new Map<string, string[]>();
    for (const m of live) spellings.set(m.winningMenuId, [...(spellings.get(m.winningMenuId) ?? []), m.losingMenuId]);
    const sold = new Map(sales.map((s) => [s.menuId, s]));
    const withRecipe = new Set(recipes.map((r) => r.menuId));

    const facts: MergeMenuFacts[] = menus.map((m) => ({
      id: m.id,
      name: m.name,
      posMenuCode: m.posMenuId,
      posIntegrationId: m.posIntegrationId,
      branchId: m.posIntegration?.branchId ?? null,
      branchName: m.posIntegration?.branch.name ?? null,
      isRetired: !m.isActive,
      net: Number(sold.get(m.id)?._sum.netAmount ?? 0),
      qty: Number(sold.get(m.id)?._sum.qty ?? 0),
      hasRecipe: withRecipe.has(m.id),
      mergedIntoMenuId: mergedInto.get(m.id) ?? null,
      spellingIds: spellings.get(m.id) ?? [],
    }));

    return {
      menus: facts,
      suggestions: groupSuggestions(
        facts,
        pairs.map((p) => ({ a: p.a, b: p.b, score: Number(p.score) }))
      ),
      salesWindow: window ? { from: iso(window.from), to: iso(window.to) } : null,
    };
  };
  return client ? run(client) : withTenantContext(tenantId, run);
}

