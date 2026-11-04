// Sprint 1 Part 6, Step 6.4 — category tree (Server Component).
// Loads the tenant's live categories (soft-deleted excluded, sorted
// account→section→group) and hands them to CategoryTree. Category has no
// Decimal field, so the rows cross to the client component as-is.
import { requireTenant } from "@/lib/require-tenant";
import { getCategoriesLogic } from "@/server/category";
import CategoryTree from "./_components/CategoryTree";

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; edit?: string }>;
}) {
  const { tenantId, can } = await requireTenant("any:member");
  const sp = await searchParams;
  const categories = await getCategoriesLogic(tenantId);
  return (
    <CategoryTree
      categories={categories}
      // Writing is gated on master:write; a button nobody can use is noise.
      canWrite={can("master:write")}
      // /categories/new and /categories/<id> redirect here to open the popup.
      initialOpen={sp.new ? "new" : (sp.edit ?? null)}
    />
  );
}
