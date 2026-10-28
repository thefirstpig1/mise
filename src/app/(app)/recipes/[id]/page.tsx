// /recipes/[id] — retired 2026-10-29 (Kong: "เอาที่มันทำงานถูกต้อง").
//
// A dish's recipe lives on จัดการเมนู; a prepped item's production recipe in
// its sheet on สินค้า/วัตถุดิบ, which now carries the version history this page
// was the only place to see. Old links (a history row, a bookmark) land on the
// sheet that edits the line this version belongs to.
//
// Not carried over, on purpose: a BRANCH copy of a production recipe. The
// sheet says a prepped recipe is shared by every branch, no shop has ever made
// a branch one (checked 2026-10-29: 0), and this page was the only way to.

import { notFound, redirect } from "next/navigation";
import type { Route } from "next";
import { requireTenant } from "@/lib/require-tenant";
import { getRecipeByIdLogic } from "@/server/recipe-read";

export default async function RecipeRetired({ params }: { params: Promise<{ id: string }> }) {
  const { tenantId } = await requireTenant("any:member");
  const { id } = await params;
  const recipe = await getRecipeByIdLogic(tenantId, id);
  if (recipe === null) notFound();
  if (recipe.menuId !== null) redirect(`/menus?menu=${recipe.menuId}` as Route);
  redirect(`/products?product=${recipe.outputProductId}` as Route);
}
