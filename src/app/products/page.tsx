// Sprint 1 Part 7a — product tree (Server Component).
// Loads the tenant's live products (soft-deleted excluded, sorted
// account→section→group→name) and serializes each through toProductView before
// handing them to the client ProductTree (Pitfall #20 — Decimal can't cross).
import { requireTenant } from "@/lib/require-tenant";
import { getProductsLogic } from "@/server/product";
import { toProductView } from "./_components/product-view";
import ProductTree from "./_components/ProductTree";

export default async function ProductsPage() {
  const { tenantId } = await requireTenant();
  const products = await getProductsLogic(tenantId);
  return <ProductTree products={products.map(toProductView)} />;
}
