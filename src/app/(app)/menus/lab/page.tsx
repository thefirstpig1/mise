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
import { getLabDraftsLogic, getMenuPriceBookLogic } from "@/server/menu-manager";
import { getMenuListFactsLogic, MENU_FACT_DAYS } from "@/server/menu-list-facts";
import { getMenuCategoriesLogic } from "@/server/menu";
import { getMergeOverviewLogic, likelyDuplicateOf } from "@/server/menu-merge-suggest";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { MAX_BACKDATE_DAYS } from "@/lib/validations/stock-movement";
import LabManager, { type LabMenu } from "./_components/LabManager";

export default async function MenuLabPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // A cook drafts too (ADR 0041); what they may do with a draft is decided per button.
  const { tenantId, membership, reach, costAccess, can, canEditShared } = await requireTenant("recipe:draft");
  const params = await searchParams;
  const one = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]);

  const [branches, freshest, drafts, facts, categories, menus, overview, firstSale] = await Promise.all([
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
    // Round 2, F (Kong 2026-10-29): a dish that is another branch's copy of one
    // WITH a recipe should be merged, not drafted a second recipe.
    getMergeOverviewLogic(tenantId).catch(() => null),
    // The day imported recipes usually start from (Kong 2026-10-30).
    withTenantContext(tenantId, (tx) => tx.salesDay.findFirst({ where: { tenantId }, orderBy: { businessDate: "asc" }, select: { businessDate: true } })),
  ]);
  const dupOf = overview ? likelyDuplicateOf(overview) : {};

  // Started here and NOT awaited (Kong 2026-10-22, the /menus pattern): the
  // drafts' costs used to wait for the page to paint and hydrate first.
  const bookBranch = freshest?.id ?? branches[0]?.id ?? null;
  const initialBook =
    bookBranch !== null && costAccess !== null
      ? { branchId: bookBranch, book: getMenuPriceBookLogic(tenantId, bookBranch, costAccess).catch(() => null) }
      : null;

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
      dupOf: dupOf[m.id] ?? null,
    };
  });

  return (
    <LabManager
      drafts={drafts}
      menus={menuRows}
      factDays={MENU_FACT_DAYS}
      categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      defaultBranchId={bookBranch}
      initialBook={initialBook}
      today={computeBangkokToday().toISOString().slice(0, 10)}
      firstSalesDay={firstSale ? firstSale.businessDate.toISOString().slice(0, 10) : null}
      earliestDay={addDays(computeBangkokToday(), -MAX_BACKDATE_DAYS).toISOString().slice(0, 10)}
      costHidden={costAccess === null}
      canPublish={can("recipe:write") && canEditShared}
      canWrite={can("recipe:write")}
      canMerge={can("master:write") && canEditShared}
      viewerId={membership.userId}
      openDraftId={one("draft") ?? null}
      openNew={one("new") === "1"}
      openMenuId={one("menu") ?? null}
      openTargetPct={(() => {
        const t = Number(one("target"));
        return Number.isFinite(t) && t >= 5 && t <= 90 ? t : null;
      })()}
    />
  );
}
