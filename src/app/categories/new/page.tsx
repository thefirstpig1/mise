// Sprint 1 Part 6, Step 6.4 — create a category.
import { requireTenant } from "@/lib/require-tenant";
import { createCategory } from "../actions";
import CategoryForm from "../_components/CategoryForm";

export default async function NewCategoryPage() {
  await requireTenant(); // auth gate; tenantId resolved inside the action
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">เพิ่มหมวดบัญชี</h2>
      <CategoryForm action={createCategory} submitLabel="บันทึก" />
    </div>
  );
}
