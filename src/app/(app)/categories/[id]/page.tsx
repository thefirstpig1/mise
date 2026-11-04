// Sprint 1 Part 6, Step 6.4 — edit / delete one category.
// Queue item 9: the form is a popup over the list now; this address opens it.
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { uuidParams } from "@/lib/route-params";

// Next 15: route params are async (await before use).
export default async function EditCategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await uuidParams(params);
  await requireTenant("master:write");
  redirect(`/categories?edit=${id}`);
}
