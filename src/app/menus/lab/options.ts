// Sprint 5 Part 24 L5b — what the lab form needs to offer, loaded once.
//
// Not a page and not an action: both lab pages (new + edit) need the same four
// lists, and a second copy of this query set is a second place for the menu
// picker to start disagreeing with the ingredient picker about what a menu is.

import { withTenantContext } from "@/lib/db";
import { getProductsLogic } from "@/server/product";
import { getMenusLogic } from "@/server/menu";
import { getMenuCategoriesLogic } from "@/server/menu";
import type {
  LabBranchOption,
  LabCategoryOption,
  LabMenuOption,
  LabProductOption,
} from "@/app/menus/_components/LabForm";

export type LabOptions = {
  products: LabProductOption[];
  menus: LabMenuOption[];
  categories: LabCategoryOption[];
  branches: LabBranchOption[];
};

export async function loadLabOptions(tenantId: string): Promise<LabOptions> {
  const [products, menus, categories, branches, live] = await Promise.all([
    getProductsLogic(tenantId),
    getMenusLogic(tenantId, { stubsOnly: false }),
    getMenuCategoriesLogic(tenantId),
    withTenantContext(tenantId, (tx) =>
      tx.branch.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    ),
    // Which dishes already have a live recipe — shown in the picker so nobody
    // drafts a change without knowing there is something to change. NOT a
    // filter: drafting over a dish that sells is half of what the lab is for.
    withTenantContext(tenantId, (tx) =>
      tx.recipe.findMany({
        where: {
          tenantId,
          deletedAt: null,
          supersededAt: null,
          isDraft: false,
          menuId: { not: null },
        },
        select: { menuId: true },
      })
    ),
  ]);

  const withRecipe = new Set(
    live.map((r) => r.menuId).filter((id): id is string => id !== null)
  );

  return {
    products: products
      .map((p) => ({
        id: p.id,
        name: p.name,
        units: p.productUnits
          .map((u) => ({ id: u.id, unitName: u.unitName, isBase: u.isBase }))
          // Base unit first — the unit stock is kept in.
          .sort((a, b) => Number(b.isBase) - Number(a.isBase)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "th")),
    menus: menus
      .map((m) => ({ id: m.id, name: m.name, hasRecipe: withRecipe.has(m.id) }))
      .sort((a, b) => a.name.localeCompare(b.name, "th")),
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    branches,
  };
}
