// /products — สินค้า/วัตถุดิบ (Kong 2026-10-21, mockup
// https://claude.ai/artifact/AJiZcD1N3HUJAz6wkkVeSf): a table (or big-picture
// cards) with what a shop actually looks things up for, and a sheet where the
// product is edited. The page awaits the catalogue only; the branch's figures
// and price book are STARTED here and stream in (Kong 2026-10-22, the /menus
// pattern) — they used to begin only after the page had painted.
//
// `searchParams` is a PROMISE in Next 15.

import { requireTenant } from "@/lib/require-tenant";
import { getProductsLogic } from "@/server/product";
import { getProductListFactsLogic } from "@/server/product-list";
import { getMenuPriceBookLogic } from "@/server/menu-manager";
import { getBranchesLogic } from "@/server/branch";
import { freshestCostBranch } from "@/server/menu-lab-read";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { toProductView } from "./_components/product-view";
import ProductsManager from "./_components/ProductsManager";

const STATUSES = ["active", "raw", "prepped", "low", "near", "out", "idle", "inactive", "all"] as const;
type Status = (typeof STATUSES)[number];

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantId, reach, can, costAccess, canEditShared } = await requireTenant("any:member");
  const params = await searchParams;
  const one = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]);

  const [products, branches, freshest] = await Promise.all([
    getProductsLogic(tenantId),
    getBranchesLogic(tenantId, reach),
    freshestCostBranch(tenantId, reach).catch(() => null),
  ]);
  const filter = one("filter");
  const branchId = freshest?.id ?? branches[0]?.id ?? null;
  const initial =
    branchId === null
      ? null
      : {
          branchId,
          list: getProductListFactsLogic(tenantId, branchId, costAccess).catch(() => null),
          book: costAccess === null ? Promise.resolve(null) : getMenuPriceBookLogic(tenantId, branchId, costAccess).catch(() => null),
        };

  return (
    <ProductsManager
      products={products.map(toProductView)}
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      defaultBranchId={branchId}
      initial={initial}
      today={computeBangkokToday().toISOString().slice(0, 10)}
      costHidden={costAccess === null}
      perm={{
        editMenu: false,
        deleteMenu: false,
        recipe: can("recipe:write"),
        recipeShared: can("recipe:write") && canEditShared,
        yield: can("master:write") && canEditShared,
      }}
      canEditInfo={can("master:write")}
      canEditPar={can("stock:write")}
      canRequest={can("purchase:request")}
      initialProductId={one("product") ?? null}
      initialNew={one("new") === "1"}
      initialSort={one("sort") === "value" ? "value" : "name"}
      initialStatus={(STATUSES as readonly string[]).includes(filter ?? "") ? (filter as Status) : "active"}
    />
  );
}
