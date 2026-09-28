// Sprint 1 Part 7a — product list (Server Component).
// Loads the tenant's live products (soft-deleted excluded, sorted
// account→section→group→name) and serializes each through toProductView before
// handing them to the client ProductBrowser (Pitfall #20 — Decimal can't cross).
// 2026-09-28: the tree became a filterable card grid (ProductBrowser).
import { requireTenant } from "@/lib/require-tenant";
import { getProductsLogic } from "@/server/product";
import { toProductView } from "./_components/product-view";
import ProductBrowser from "./_components/ProductBrowser";

export default async function ProductsPage() {
  const { tenantId } = await requireTenant("any:member");
  const products = await getProductsLogic(tenantId);
  return <ProductBrowser products={products.map(toProductView)} />;
}
