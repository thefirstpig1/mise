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
import Link from "next/link";
import type { Route } from "next";
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

  // The item pressed lights up at once, before its page has arrived.
  const [pressed, setPressed] = useState<string | null>(null);

  // A tap on a link navigates; the drawer must not stay over the new page.
  useEffect(() => {
    setOpen(false);
    setPressed(null);
  }, [pathname]);

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

      {/* Kong (2026-09-28): the group heading was SMALLER than the items under
          it, so nothing read as a heading at all. Now a heading is the
          largest, darkest text in its block, and its items hang off a rule
          beneath it — hierarchy by size, weight AND position, not by colour. */}
      <div className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {groups.map((g) => {
          const link = (item: NavGroup["items"][number], nested: boolean) => {
            const active = item.href === current;
            // <Link>, not <a> (Kong 2026-09-29: "อยากให้ลื่นไหลทุกหน้า"): a plain
            // anchor reloaded the whole document — scripts, sidebar and all —
            // on every press. A Link swaps only the page, keeps this frame,
            // and fetches the next page's loading state ahead of the press.
            return (
              <Link
                href={item.href as Route}
                aria-current={active ? "page" : undefined}
                // Plain left clicks only — a ctrl/middle click opens a new tab and this page stays.
                onClick={(e) => {
                  if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) setPressed(item.href);
                }}
                className={`block rounded-md py-1.5 pr-2 transition-colors ${nested ? "pl-3 text-sm" : "px-2 text-[15px] font-semibold"} ${
                  (pressed ? pressed === item.href : active)
                    ? "bg-primary font-medium text-primary-foreground"
                    : "text-foreground hover:bg-muted"
                }`}
              >
                {item.label}
              </Link>
            );
          };
          // A one-item group is just a link; a heading over one line is noise.
          if (g.items.length === 1) return <div key={g.label}>{link(g.items[0], false)}</div>;
          const open = g.items.some((i) => i.href === current);
          return (
            <div key={g.label}>
              <p className={`px-2 pb-1.5 text-[15px] font-semibold ${open ? "text-primary" : "text-foreground"}`}>
                {g.label}
              </p>
              <ul className="ml-3 space-y-0.5 border-l border-border-strong pl-1.5">
                {g.items.map((item) => (
                  <li key={item.href}>{link(item, true)}</li>
                ))}
              </ul>
            </div>
          );
        })}
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
