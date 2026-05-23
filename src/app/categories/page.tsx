// Sprint 1 Part 6, Step 6.4 — category tree (Server Component).
// Loads the tenant's live categories (soft-deleted excluded, sorted
// account→section→group) and hands them to CategoryTree. Category has no
// Decimal field, so the rows cross to the client component as-is.
import { requireTenant } from "@/lib/require-tenant";
import { getCategoriesLogic } from "@/server/category";
import CategoryTree from "./_components/CategoryTree";

export default async function CategoriesPage() {
  const { tenantId } = await requireTenant();
  const categories = await getCategoriesLogic(tenantId);
  return <CategoryTree categories={categories} />;
}
