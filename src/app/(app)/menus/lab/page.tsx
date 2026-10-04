// /menus/lab — "ทดลองเมนู" (Kong 2026-10-04, mockup approved): every draft in
// one table with what it costs a plate, the price being considered and the
// food-cost % between them; the whole row opens a sheet where the draft is
// written, priced and published without leaving the list.
//
// Still its own page, not a filter on "จัดการเมนู" (Kong: "แยกไว้เลย"): a
// draft is true on no day and must never be mistaken for the recipe that cuts
// stock (ADR 0025).
//
// Figures while typing come from the branch's price book (the same book
// "จัดการเมนู" uses); after each save the engine costs the saved draft
// (`/api/menus?what=lab`) and that figure, with its confidence, is the one
// shown — the book never becomes a second cost engine (ADR 0025 Q4).
//
// `searchParams` is a PROMISE in Next 15.

import { requireTenant } from "@/lib/require-tenant";
import { withTenantContext } from "@/lib/db";
import { getBranchesLogic } from "@/server/branch";
import { freshestCostBranch } from "@/server/menu-lab-read";
import { getLabDraftsLogic } from "@/server/menu-manager";
import { getMenuListFactsLogic, MENU_FACT_DAYS } from "@/server/menu-list-facts";
import { getMenuCategoriesLogic } from "@/server/menu";
import { computeBangkokToday } from "@/lib/bangkok-date";
import LabManager, { type LabMenu } from "./_components/LabManager";

export default async function MenuLabPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantId, reach, costAccess, canEditShared } = await requireTenant("recipe:write");
  const params = await searchParams;
  const one = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]);

  const [branches, freshest, drafts, facts, categories, menus] = await Promise.all([
    getBranchesLogic(tenantId, reach),
    freshestCostBranch(tenantId, reach).catch(() => null),
    getLabDraftsLogic(tenantId),
    getMenuListFactsLogic(tenantId, reach),
    getMenuCategoriesLogic(tenantId),
    withTenantContext(tenantId, (tx) =>
      tx.menu.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        select: { id: true, name: true, posMenuId: true, menuCategory: { select: { name: true } } },
        orderBy: { name: "asc" },
      })
    ),
  ]);

  const menuRows: LabMenu[] = menus.map((m) => {
    const f = facts.facts.get(m.id);
    return {
      id: m.id,
      name: m.name,
      posCode: m.posMenuId,
      category: m.menuCategory?.name ?? null,
      qty: f?.qty ?? 0,
      net: f?.net ?? 0,
      hasRecipe: (f?.recipeId ?? null) !== null,
    };
  });

  return (
    <LabManager
      drafts={drafts}
      menus={menuRows}
      factDays={MENU_FACT_DAYS}
      categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      defaultBranchId={freshest?.id ?? branches[0]?.id ?? null}
      today={computeBangkokToday().toISOString().slice(0, 10)}
      costHidden={costAccess === null}
      canPublish={canEditShared}
      openDraftId={one("draft") ?? null}
      openNew={one("new") === "1"}
    />
  );
}
