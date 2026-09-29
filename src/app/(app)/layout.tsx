import type { ReactNode } from "react";
import { signOut } from "@/lib/auth";
import { requireTenant } from "@/lib/require-tenant";
import Sidebar from "@/components/layout/Sidebar";
import VersionBanner from "@/components/layout/VersionBanner";
import { NAV_GROUPS } from "@/components/layout/nav";

// ============================================================
// Mise — the frame around every signed-in page (Part 35 L4)
// ============================================================
// A route GROUP: the URLs are unchanged, `(app)` is invisible in them. What
// sits outside it — /login, /signup, /choose-shop, /denied — has no sidebar,
// because none of those pages has a shop to show a menu for yet.
//
// `any:member` because the frame itself asks nothing more than membership;
// every page inside still names its own capability.
// ============================================================

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, membership, can, membershipCount } = await requireTenant("any:member");

  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => can(i.need)) })).filter(
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
        userLabel={user.name ?? user.email ?? ""}
        canSwitchShop={membershipCount > 1}
        signOutSlot={
          <form action={doSignOut}>
            <button type="submit" className="text-muted-foreground hover:text-foreground">
              ออกจากระบบ
            </button>
          </form>
        }
      />
      <div className="min-w-0 flex-1">
        <VersionBanner />
        {children}
      </div>
    </div>
  );
}
