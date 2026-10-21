// /products — สินค้า/วัตถุดิบ (Kong 2026-10-21, mockup
// https://claude.ai/artifact/AJiZcD1N3HUJAz6wkkVeSf): a table (or big-picture
// cards) with what a shop actually looks things up for, and a sheet where the
// product is edited. The page loads the catalogue only; the branch's figures
// load after paint (ProductsManager).
//
// `searchParams` is a PROMISE in Next 15.

import { requireTenant } from "@/lib/require-tenant";
import { getProductsLogic } from "@/server/product";
import { getBranchesLogic } from "@/server/branch";
import { freshestCostBranch } from "@/server/menu-lab-read";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { toProductView } from "./_components/product-view";
import ProductsManager from "./_components/ProductsManager";

const STATUSES = ["active", "raw", "prepped", "low", "near", "inactive", "all"] as const;
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

  return (
    <ProductsManager
      products={products.map(toProductView)}
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      defaultBranchId={freshest?.id ?? branches[0]?.id ?? null}
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
      initialStatus={(STATUSES as readonly string[]).includes(filter ?? "") ? (filter as Status) : "active"}
    />
  );
}
