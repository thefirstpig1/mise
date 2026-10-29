// ADR 0043 — the operator's screens. Outside the (app) group on purpose: these
// pages belong to no shop, so the shop sidebar and requireTenant do not apply.
// Every page and action below calls requirePlatformAdmin() itself; this check
// only keeps the chrome from drawing for someone who is about to get 404.

import type { ReactNode } from "react";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import PlatformTabs from "./_components/PlatformTabs";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const actor = await requirePlatformAdmin();
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 lg:px-8">
          <p className="font-display text-lg font-semibold">
            คิดครัว <span className="text-sm font-normal text-muted-foreground">· ผู้ดูแลระบบ</span>
          </p>
          <PlatformTabs />
          <span className="ml-auto flex items-center gap-4 text-sm">
            <span className="truncate text-muted-foreground">{actor.email}</span>
            <Link href="/dashboard" className="text-primary hover:underline">
              กลับเข้าร้าน
            </Link>
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 lg:px-8">{children}</main>
    </div>
  );
}
