// Sprint 4 Part 19 L5 — /menus: the dishes, and the queue of ones nobody has
// looked at yet (ADR 0019 Q8).
//
// UI run-through 2026-10-02: the page loads EVERY dish once (retired ones
// included) and MenuBrowser filters in the browser — category, status and search
// answer at once instead of a form with a "ดู" button that reloaded the page.
// `?stubs=true` still opens on the รอตรวจ queue, because the import screen links
// straight into it after a commit that created any — a queue nobody sees is a
// queue nobody works.
//
// `searchParams` is a PROMISE in Next 15 — the plain-object signature
// type-checks under `pnpm tsc` and fails `pnpm build` (Sprint 0's fix).

import { requireTenant } from "@/lib/require-tenant";
import { getMenuCategoriesLogic, getMenusLogic, getPosIntegrationsLogic } from "@/server/menu";
import { withTenantContext } from "@/lib/db";
import { getMenuMergesLogic } from "@/server/menu-merge-read";
import { getMenuListFactsLogic, MENU_FACT_DAYS } from "@/server/menu-list-facts";
import { toMenuRowView } from "./_components/menu-view";
import { groupMergesByWinner, toMenuMergeRowView } from "./_components/menu-merge-view";
import MenuBrowser from "./_components/MenuBrowser";
import type { MenuFactView } from "./_components/MenuEditPopup";

export default async function MenusPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantId, membership, reach, can } = await requireTenant("any:member");
  const params = await searchParams;
  const one = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]);
  const departmentsEnabled = membership.tenant.enableDepartments;

  const [menus, categories, integrations, departments, merges, facts] = await Promise.all([
    getMenusLogic(tenantId, {
      posIntegrationId: undefined,
      menuCategoryId: undefined,
      stubsOnly: false,
      includeRetired: true,
      search: undefined,
    }),
    getMenuCategoriesLogic(tenantId),
    getPosIntegrationsLogic(tenantId),
    withTenantContext(tenantId, (tx) =>
      tx.department.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        orderBy: { name: "asc" },
      })
    ),
    // NOT a fold. This screen shows both rows — a merge nobody can see is a
    // merge nobody can undo (ADR 0026 Q6) — it only NESTS one under the other.
    getMenuMergesLogic(tenantId, { winningMenuId: undefined, includeRevoked: false }),
    getMenuListFactsLogic(tenantId, reach),
  ]);

  const mergeRows = merges.map(toMenuMergeRowView);
  const spellingsByWinner = groupMergesByWinner(mergeRows);
  // Which dish each spelling counts as. MenuBrowser nests a spelling under its
  // dish ONLY while that dish is on screen under the current filter; otherwise
  // the spelling stays an ordinary, labelled row — it still collects sales every
  // day and must never simply disappear (ADR 0026 Q6).
  const winnerOf: Record<string, { id: string; label: string }> = {};
  for (const m of mergeRows) winnerOf[m.loser.id] = { id: m.winner.id, label: m.winner.label };

  const rows = menus.map((m) => toMenuRowView(m, departmentsEnabled));

  const factView: Record<string, MenuFactView> = {};
  for (const [id, f] of facts.facts) factView[id] = f;

  const spellings: Record<string, ReturnType<typeof toMenuMergeRowView>["loser"][]> = {};
  for (const [winner, list] of spellingsByWinner) spellings[winner] = list.map((x) => x.loser);

  return (
    <MenuBrowser
      rows={rows}
      facts={factView}
      factDays={MENU_FACT_DAYS}
      spellingsByWinner={spellings}
      winnerOf={winnerOf}
      categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      departments={departments.map((d) => ({ id: d.id, name: d.name }))}
      departmentsEnabled={departmentsEnabled}
      posIntegrationId={integrations[0]?.id ?? null}
      initialStatus={one("stubs") === "true" ? "review" : one("retired") === "true" ? "all" : "selling"}
      // The actions check the same capabilities; a button nobody can use is noise.
      canEdit={can("master:write")}
      canDelete={can("recipe:write")}
      canRecipe={can("recipe:write")}
    />
  );
}
