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
import { auth, signOut } from "@/lib/auth";
import { listActiveMembershipsForUser } from "@/lib/require-tenant";
import { chooseShopAction } from "./actions";
import { ROLE_LABELS_TH } from "@/lib/validations/membership";
import type { Role } from "@/lib/permissions/service";
import Logo from "@/components/layout/Logo";

async function signOutHere() {
  "use server";
  await signOut({ redirectTo: "/login" });
}

export default async function ChooseShopPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const memberships = await listActiveMembershipsForUser(session.user.id);

  if (memberships.length === 0) redirect("/signup");
  // Nothing to choose between — going back would be a dead end with one button.
  if (memberships.length === 1) redirect("/home");

  return (
    <main className="flex min-h-screen justify-center px-5 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center gap-2.5">
          <Logo size={36} />
          <span className="font-display text-[22px] font-semibold text-primary">คิดครัว</span>
        </div>
        <div>
          <h1 className="text-2xl font-bold">เลือกร้าน</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            บัญชีของคุณอยู่ใน {memberships.length} ร้าน เลือกร้านที่จะทำงานตอนนี้ · สลับทีหลังได้จากชื่อร้านบนสุดของเมนูข้าง
          </p>
        </div>

        <div className="space-y-2.5">
          {memberships.map((m) => {
            const branches = m.branchAccess.filter((a) => a.branch.deletedAt === null).map((a) => a.branch.name);
            const reach = m.allBranches ? "ทุกสาขา" : branches.length ? branches.join(" · ") : "ยังไม่ได้กำหนดสาขา";
            return (
              <form key={m.tenantId} action={chooseShopAction}>
                <input type="hidden" name="tenant_id" value={m.tenantId} />
                <button
                  type="submit"
                  className="flex w-full items-center gap-3.5 rounded-[18px] border border-border/70 bg-surface shadow-card p-4 text-left transition-colors hover:bg-muted/40"
                >
                  <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                      <path d="M4 10h16v10H4zM3 10l2-6h14l2 6M9 20v-5h6v5" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold">{m.tenant.name}</span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">
                      {ROLE_LABELS_TH[m.role as Role] ?? m.role} · {reach}
                    </span>
                  </span>
                </button>
              </form>
            );
          })}
        </div>

        {/* Kong 2026-10-31: another brand on the same account — owners only. */}
        {memberships.some((m) => m.role === "owner") ? (
          <a
            href="/signup"
            className="flex h-12 w-full items-center justify-center rounded-[18px] border border-dashed border-primary-line text-sm font-semibold text-primary hover:bg-primary-soft"
          >
            + เปิดร้านใหม่
          </a>
        ) : null}

        <form action={signOutHere} className="text-center">
          <button type="submit" className="h-11 text-sm font-semibold text-primary underline">
            ออกจากระบบ
          </button>
        </form>
      </div>
    </main>
  );
}
