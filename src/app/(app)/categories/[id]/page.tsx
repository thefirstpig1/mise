// Sprint 1 Part 6, Step 6.4 — edit / delete one category.
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { getCategoryByIdLogic } from "@/server/category";
import { updateCategory } from "../actions";
import CategoryForm from "../_components/CategoryForm";
import DeleteCategoryButton from "../_components/DeleteCategoryButton";

// Next 15: route params are async (await before use).
export default async function EditCategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tenantId } = await requireTenant("master:write");

  const category = await getCategoryByIdLogic(tenantId, id);
  if (!category) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-bold">แก้ไขหมวดบัญชี</h2>
        <DeleteCategoryButton id={category.id} />
      </div>
      <CategoryForm
        action={updateCategory.bind(null, category.id)}
        initial={category}
        submitLabel="บันทึกการแก้ไข"
      />
    </div>
  );
}
