// /recipes/new — retired 2026-10-29 (Kong: "เอาที่มันทำงานถูกต้อง").
//
// A dish's recipe is written on จัดการเมนู (since 2026-10-04), and a prepped
// item's production recipe in its sheet on สินค้า/วัตถุดิบ — which now writes
// the first one too ("เขียนสูตรผลิต"), shows every version, and picks
// ingredients with the searchable picker instead of a <select> of every
// product. Old links land where the work is done.

import { redirect } from "next/navigation";
import type { Route } from "next";

export default async function NewRecipeRetired({
  searchParams,
}: {
  searchParams: Promise<{ menu?: string; product?: string }>;
}) {
  const sp = await searchParams;
  if (sp.menu) redirect(`/menus?menu=${encodeURIComponent(sp.menu)}` as Route);
  if (sp.product) redirect(`/products?product=${encodeURIComponent(sp.product)}` as Route);
  redirect("/products?filter=prepped" as Route);
}
