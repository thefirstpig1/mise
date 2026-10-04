// /menus — "จัดการเมนู" (Kong, 2026-10-04): /menus, /recipes and
// /menus/coverage as ONE screen. Every dish the shop sells, what it sold, at
// what price, what it costs at one branch and whether it has a recipe; the
// whole row opens a sheet (MenuSheet) where the dish and its recipe are edited
// without leaving the list. Mockup Kong approved:
// https://claude.ai/artifact/NquaaTFahRgeSmPsyzxor5
//
// What the page loads is what the LIST needs; a sheet loads its own recipe,
// stock facts and price list when it opens (manager-actions.ts).
//
// Kept from the old /menus, deliberately: the รอตรวจ queue (`?stubs=true`, the
// import screen links into it), retired dishes one tap away (ADR 0027 Q2), and
// merged spellings nested under their dish, never hidden (ADR 0026 Q6).
//
// Cost needs a branch (ADR 0014 Q9): `?branch=` or the branch with the freshest
// purchases (the Lab's rule, ADR 0025), named beside every figure.
//
// `searchParams` is a PROMISE in Next 15 — the plain-object signature
// type-checks under `pnpm tsc` and fails `pnpm build` (Sprint 0's fix).

import { requireTenant } from "@/lib/require-tenant";
import { withTenantContext } from "@/lib/db";
import { getMenuCategoriesLogic, getMenusLogic, getPosIntegrationsLogic } from "@/server/menu";
import { getMenuMergesLogic } from "@/server/menu-merge-read";
import { getMenuListFactsLogic, MENU_FACT_DAYS } from "@/server/menu-list-facts";
import { getBranchesLogic } from "@/server/branch";
import { freshestCostBranch } from "@/server/menu-lab-read";
import { getMenuRecipeStatusLogic } from "@/server/menu-manager";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { solid, toneOf } from "@/components/charts/chart-theme";
import { toMenuRowView } from "./_components/menu-view";
import { groupMergesByWinner, toMenuMergeRowView } from "./_components/menu-merge-view";
import MenuManager, { type ManagerRow } from "./_components/MenuManager";

export default async function MenusPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantId, membership, reach, can, costAccess, canEditShared } = await requireTenant("any:member");
  const params = await searchParams;
  const one = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]);
  const departmentsEnabled = membership.tenant.enableDepartments;

  // Both at once: the fallback branch does not depend on the list.
  const asked = one("branch");
  const [branches, freshest] = await Promise.all([
    getBranchesLogic(tenantId, reach),
    freshestCostBranch(tenantId, reach).catch(() => null),
  ]);
  const branch = branches.find((b) => b.id === asked) ?? freshest;

  const [menus, categories, integrations, departments, merges, facts, recipeStatus] = await Promise.all([
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
    // Which dishes have a recipe here — no prices. Prices (the slow part: the
    // recipe walk and the FIFO replay) load AFTER the list paints, once per
    // branch, through getPriceBookAction (Kong 2026-10-04, "หน้าไหนโหลดช้า").
    branch === null ? Promise.resolve({} as Record<string, { recipeId: string; own: boolean }>) : getMenuRecipeStatusLogic(tenantId, branch.id),
  ]);

  const mergeRows = merges.map(toMenuMergeRowView);
  const spellingsByWinner = groupMergesByWinner(mergeRows);
  const winnerOf: Record<string, { id: string; label: string }> = {};
  for (const m of mergeRows) winnerOf[m.loser.id] = { id: m.winner.id, label: m.winner.label };
  const spellings: Record<string, ReturnType<typeof toMenuMergeRowView>["loser"][]> = {};
  for (const [winner, list] of spellingsByWinner) spellings[winner] = list.map((x) => x.loser);

  // A category keeps ONE colour across the app's sales screens; here the
  // order is the categories' own (ก–ฮ), which is how this list sorts them.
  const toneByCategory = new Map(
    [...categories].sort((a, b) => a.name.localeCompare(b.name, "th")).map((c, i) => [c.id, solid(toneOf(i))])
  );

  const rows: ManagerRow[] = menus.map((m) => {
    const view = toMenuRowView(m, departmentsEnabled);
    const f = facts.facts.get(m.id);
    const r = recipeStatus[m.id];
    return {
      ...view,
      qty: f?.qty ?? 0,
      net: f?.net ?? 0,
      hasDraft: f?.hasDraft ?? false,
      recipeId: r?.recipeId ?? null,
      recipeOwn: r?.own ?? false,
      tone: (m.menuCategoryId && toneByCategory.get(m.menuCategoryId)) || "#AEB784",
    };
  });

  return (
    <MenuManager
      rows={rows}
      factDays={MENU_FACT_DAYS}
      spellingsByWinner={spellings}
      winnerOf={winnerOf}
      categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      departments={departments.map((d) => ({ id: d.id, name: d.name }))}
      departmentsEnabled={departmentsEnabled}
      posIntegrationId={integrations[0]?.id ?? null}
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      branch={branch}
      today={computeBangkokToday().toISOString().slice(0, 10)}
      initialStatus={one("stubs") === "true" ? "review" : one("retired") === "true" ? "retired" : one("filter") === "none" ? "none" : "all"}
      initialMenuId={one("menu") ?? null}
      costHidden={costAccess === null}
      perm={{
        // The actions check the same things; a control nobody can use is noise.
        editMenu: can("master:write") && canEditShared,
        deleteMenu: can("recipe:write") && canEditShared,
        recipe: can("recipe:write"),
        recipeShared: can("recipe:write") && canEditShared,
        yield: can("master:write") && canEditShared,
      }}
    />
  );
}
