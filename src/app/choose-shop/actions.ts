"use server";

// ============================================================
// Mise — switch the shop this browser works in (ADR 0029 Q3)
// ============================================================
// Shared by the เลือกร้าน page and the shop switcher at the top of the sidebar
// (Kong 2026-11-02: "สมมติมี 12 แบรนด์ จะกดสลับไปทีละตัวก็จะบ้าเกินไป").
// The posted id is a CHOICE from the person's own list, never trusted as is.
// ============================================================

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { findActiveMembershipForUser } from "@/lib/require-tenant";
import { ACTIVE_TENANT_COOKIE, ACTIVE_TENANT_COOKIE_MAX_AGE } from "@/lib/active-tenant";

export async function chooseShopAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const wanted = formData.get("tenant_id");
  if (typeof wanted !== "string") redirect("/choose-shop");

  // 🔴 The posted id is checked against THIS user's own memberships before it
  // is written anywhere. A tenant id from a browser is otherwise an invitation
  // to read somebody else's shop (rule A9) — and this is the one place a
  // tenant id arrives from outside at all.
  // Not a uuid is not a shop — and would reach Postgres as a cast error.
  if (!/^[0-9a-f-]{36}$/i.test(wanted)) redirect("/choose-shop");
  const membership = await findActiveMembershipForUser(session.user.id, wanted);
  if (!membership) redirect("/choose-shop");

  const jar = await cookies();
  jar.set(ACTIVE_TENANT_COOKIE, membership.tenantId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ACTIVE_TENANT_COOKIE_MAX_AGE,
  });

  revalidatePath("/", "layout");
  redirect("/home");
}
