"use client";

// ============================================================
// Mise — the sidebar (Part 35 L4)
// ============================================================
// Client-side only for two things: knowing which page is current
// (usePathname) and opening/closing on a phone. WHAT it lists is decided on
// the server — the layout passes groups already filtered by capability, so a
// cook's browser never receives the links it would hide. Hiding is tidiness,
// not security (rule A7): every page still refuses on its own.
// ============================================================

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Logo from "@/components/layout/Logo";
import { currentNavHref, type NavGroup } from "@/components/layout/nav";

export default function Sidebar({
  groups,
  shopName,
  userLabel,
  canSwitchShop,
  signOutSlot,
}: {
  groups: readonly NavGroup[];
  shopName: string;
  userLabel: string;
  canSwitchShop: boolean;
  signOutSlot: ReactNode;
}) {
  const pathname = usePathname();
  const current = currentNavHref(pathname);
  const [open, setOpen] = useState(false);

  // A tap on a link navigates; the drawer must not stay over the new page.
  useEffect(() => setOpen(false), [pathname]);

  const panel = (
    <nav aria-label="เมนูหลัก" className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <Logo size={30} />
        <div className="min-w-0">
          <p className="font-display text-lg font-semibold leading-none text-primary">คิดครัว</p>
          <p className="mt-1 truncate text-xs text-muted-foreground" title={shopName}>
            {shopName}
          </p>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {g.label}
            </p>
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const active = item.href === current;
                return (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`block rounded-md px-2 py-1.5 text-sm transition-colors ${
                        active
                          ? "bg-primary font-medium text-primary-foreground"
                          : "text-foreground hover:bg-muted"
                      }`}
                    >
                      {item.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="space-y-2 border-t border-border px-5 py-4 text-sm">
        <p className="truncate text-muted-foreground" title={userLabel}>
          {userLabel}
        </p>
        <div className="flex items-center gap-4">
          {/* Only when there is somewhere to switch TO (ADR 0029 Q3). */}
          {canSwitchShop ? (
            <a href="/choose-shop" className="text-primary hover:underline">
              เปลี่ยนร้าน
            </a>
          ) : null}
          {signOutSlot}
        </div>
      </div>
    </nav>
  );

  return (
    <>
      {/* Phone: a bar with ☰, and the same panel as a drawer. */}
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-surface px-4 py-3 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="เปิดเมนู"
          aria-expanded={open}
          className="rounded-md p-1.5 hover:bg-muted"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
          </svg>
        </button>
        <Logo size={24} />
        <span className="truncate text-sm font-medium">{shopName}</span>
      </div>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="ปิดเมนู"
            className="absolute inset-0 bg-foreground/30"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-surface shadow-xl">{panel}</div>
        </div>
      ) : null}

      {/* Desktop: always there. */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-border bg-surface lg:block">
        {panel}
      </aside>
    </>
  );
}
