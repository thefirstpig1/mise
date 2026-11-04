// Sprint 1 Part 6, Step 6.4 — create a category.
// Queue item 9: the form is a popup over the list now; this address opens it.
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";

export default async function NewCategoryPage() {
  await requireTenant("master:write");
  redirect("/categories?new=1");
}
