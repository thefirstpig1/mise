import { Suspense, type ReactNode } from "react";
import { signOut } from "@/lib/auth";
import { requireTenant } from "@/lib/require-tenant";
import Sidebar from "@/components/layout/Sidebar";
import VersionBanner from "@/components/layout/VersionBanner";
import { NAV_GROUPS } from "@/components/layout/nav";
import { isPlatformAdminEmail } from "@/lib/platform-admin";
import SetupBar from "@/components/layout/SetupBar";
import AdminStrip from "@/components/layout/AdminStrip";
import { getOnboardingForRequest } from "@/server/onboarding";
import { getLiveAnnouncements } from "@/server/announcements";
import AnnouncementBar from "@/components/layout/AnnouncementBar";

// ============================================================
// Mise — the frame around every signed-in page (Part 35 L4)
// ============================================================
// A route GROUP: the URLs are unchanged, `(app)` is invisible in them. What
// sits outside it — /login, /signup, /choose-shop, /denied — has no sidebar,
// because none of those pages has a shop to show a menu for yet.
//
// `any:member` because the frame itself asks nothing more than membership;
// every page inside still names its own capability.
//
// 2026-10-31 (friend's-shop feedback): the setup bar rides on every page for
// whoever may change settings, until setup is done or they hide it. It is
// read in its own Suspense so it never holds the page back; a hidden bar
// costs nothing, because the hide is on the membership requireTenant loaded.
// ============================================================

/** ADR 0045 part B — read in its own Suspense, from a minute-long copy, so it never holds a page back. */
async function AnnouncementSlot() {
  const items = await getLiveAnnouncements();
  return items.length ? <AnnouncementBar items={items} /> : null;
}

async function SetupBarSlot({ tenantId, membershipId }: { tenantId: string; membershipId: string }) {
  const o = await getOnboardingForRequest(tenantId, membershipId);
  if (o.dismissed || o.doneCount >= o.steps.length) return null;
  return <SetupBar steps={o.steps.map((key) => ({ key, done: o.done[key] }))} teamDone={o.done.team} method={o.method} />;
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, membership, can, membershipCount } = await requireTenant("any:member");

  const addonOn = (a: "dailyClose" | undefined) => a === undefined || (a === "dailyClose" && membership.tenant.dailyCloseEnabled);
  // An item the reader cannot open by its own `need` may still open by `alt`
  // (สำรองจ่าย: an accountant pays staff back without buying anything).
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items
      .filter((i) => addonOn(i.addon))
      .flatMap((i) => (can(i.need) ? [i] : i.alt && can(i.alt.need) ? [{ ...i, href: i.alt.href, need: i.alt.need, match: i.href }] : [])),
  })).filter(
    (g) => g.items.length > 0
  );

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="min-h-screen lg:flex">
      <Sidebar
        groups={groups}
        shopName={membership.tenant.name}
        reach={membership.allBranches ? "ทุกสาขา" : `${membership.branchAccess.length} สาขา`}
        userLabel={user.name ?? user.email ?? ""}
        canSwitchShop={membershipCount > 1}
        canOpenShop={membership.role === "owner"}
        signOutSlot={
          <form action={doSignOut}>
            <button type="submit" className="text-muted-foreground hover:text-foreground">
              ออกจากระบบ
            </button>
          </form>
        }
      />
      <div className="min-w-0 flex-1">
        {/* ADR 0043 — the operator's door, on every page and above the fold on a phone (AdminStrip.tsx). */}
        {isPlatformAdminEmail(user.email) ? <AdminStrip /> : null}
        <VersionBanner />
        <Suspense fallback={null}>
          <AnnouncementSlot />
        </Suspense>
        {can("settings:write") && membership.onboardingDismissedAt === null ? (
          <Suspense fallback={null}>
            <SetupBarSlot tenantId={membership.tenantId} membershipId={membership.id} />
          </Suspense>
        ) : null}
        {children}
      </div>
    </div>
  );
}
