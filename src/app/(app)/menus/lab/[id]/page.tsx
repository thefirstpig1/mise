// The lab opens a draft in a sheet over its list now (Kong 2026-10-04); this
// address stays for old links. A draft that has since been published belongs
// to "จัดการเมนู", so a tab left open across a publish lands on the dish.
//
// `params` is a PROMISE in Next 15.

import { notFound, redirect } from "next/navigation";
import type { Route } from "next";
import { requireTenant } from "@/lib/require-tenant";
import { withTenantContext } from "@/lib/db";

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { tenantId } = await requireTenant("recipe:write");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const row = await withTenantContext(tenantId, (tx) =>
    tx.recipe.findFirst({ where: { id, tenantId, deletedAt: null }, select: { isDraft: true, menuId: true } })
  );
  if (row === null) notFound();
  redirect((row.isDraft ? `/menus/lab?draft=${id}` : row.menuId ? `/menus?menu=${row.menuId}` : "/menus") as Route);
}
