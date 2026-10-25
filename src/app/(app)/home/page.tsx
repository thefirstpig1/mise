// /home — sends a signed-in person to the page their role works in
// (src/lib/permissions/home.ts). Sign-in, shop selection and the logo all
// land here, so the choice is made in one place.

import { redirect } from "next/navigation";
import type { Route } from "next";
import { requireTenant } from "@/lib/require-tenant";
import { homeFor } from "@/lib/permissions/home";

export default async function HomeRedirect() {
  const { membership } = await requireTenant("any:member");
  redirect(homeFor(membership.role, { dailyCloseEnabled: membership.tenant.dailyCloseEnabled }) as Route);
}
