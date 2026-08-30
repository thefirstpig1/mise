// ============================================================
// Mise — เลือกร้าน (Sprint 6 Part 29 L3c, ADR 0029 Q3)
// ============================================================
// The one screen in the product that must NOT call `requireTenant`. It is where
// `requireTenant` sends people, so calling it here would bounce off itself for
// ever. It does its own authentication and its own membership listing, and it
// is the only place allowed to.
//
// Almost nobody sees this. A person with one membership — every shop in Mise
// today — is never sent here, and once a choice is remembered it stays
// remembered for a year. It exists for the outside bookkeeper who keeps the
// books for three restaurants, and for whoever signed Mise up for their own
// place and was later invited to a friend's.
// ============================================================

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  ACTIVE_TENANT_COOKIE,
  ACTIVE_TENANT_COOKIE_MAX_AGE,
} from "@/lib/active-tenant";
import { ROLE_LABELS_TH } from "@/lib/validations/membership";
import type { Role } from "@/lib/permissions/service";

async function chooseShop(formData: FormData) {
  "use server";

  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const wanted = formData.get("tenant_id");
  if (typeof wanted !== "string") redirect("/choose-shop");

  // 🔴 The posted id is checked against THIS user's own memberships before it
  // is written anywhere. A tenant id from a browser is otherwise an invitation
  // to read somebody else's shop (rule A9) — and this is the one place a
  // tenant id arrives from outside at all.
  const membership = await prisma.tenantMembership.findFirst({
    where: { userId: session.user.id, tenantId: wanted, isActive: true },
    select: { tenantId: true },
  });
  if (!membership) redirect("/choose-shop");

  const jar = await cookies();
  jar.set(ACTIVE_TENANT_COOKIE, membership.tenantId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ACTIVE_TENANT_COOKIE_MAX_AGE,
  });

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export default async function ChooseShopPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const memberships = await prisma.tenantMembership.findMany({
    where: { userId: session.user.id, isActive: true },
    select: {
      tenantId: true,
      role: true,
      tenant: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (memberships.length === 0) redirect("/signup");
  // Nothing to choose between — going back would be a dead end with one button.
  if (memberships.length === 1) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <h1 className="mb-2 text-2xl font-bold">เลือกร้าน</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          บัญชีของคุณอยู่ใน {memberships.length} ร้าน — เลือกร้านที่จะทำงานด้วยตอนนี้
          เปลี่ยนทีหลังได้จากหน้าหลัก
        </p>

        <div className="space-y-2">
          {memberships.map((m) => (
            <form key={m.tenantId} action={chooseShop}>
              <input type="hidden" name="tenant_id" value={m.tenantId} />
              <button
                type="submit"
                className="w-full rounded-lg border border-border px-4 py-3 text-left hover:bg-muted/40"
              >
                <div className="font-medium">{m.tenant.name}</div>
                <div className="text-xs text-muted-foreground">
                  {ROLE_LABELS_TH[m.role as Role] ?? m.role}
                </div>
              </button>
            </form>
          ))}
        </div>
      </div>
    </main>
  );
}
